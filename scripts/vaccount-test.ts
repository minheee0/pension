/**
 * 가상계좌·현금영수증 테스트(목 토스 서버). 테스트 DB 전용.   npm run test:va
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

process.env.PII_ENC_KEY ??= randomBytes(32).toString("base64");
process.env.PII_HASH_KEY ??= randomBytes(32).toString("base64");

import { pool } from "../src/server/db";
import { holdStay } from "../src/server/booking/hold";
import { decryptText, encryptText, hmacHex } from "../src/server/crypto";
import { reconcileWaitingDeposits } from "../src/server/payments/service";
import { POST as preparePOST } from "../src/app/api/payments/prepare/route";
import { POST as confirmPOST } from "../src/app/api/payments/confirm/route";
import { POST as webhookPOST } from "../src/app/api/webhooks/toss/route";
import { POST as lookupPOST } from "../src/app/api/bookings/lookup/route";
import { POST as cancelPOST } from "../src/app/api/bookings/cancel/route";
import { startMockToss } from "./mock-toss";

if (process.env.ALLOW_TRUNCATE !== "1") { console.error("테스트 DB 전용입니다. ALLOW_TRUNCATE=1 을 지정하세요."); process.exit(1); }

const PHONE = "01012345678";
const addDays = (b: string, n: number) => { const d = new Date(`${b}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
let ipSeq = 0;
const post = (h: (r: Request) => Promise<Response>, path: string, body: unknown, headers: Record<string, string> = {}) =>
  h(new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `10.4.${Math.floor(++ipSeq / 200)}.${ipSeq % 200}`, ...headers }, body: JSON.stringify(body) }));
const q = async <T = any>(sql: string, a: unknown[] = []) => (await pool.query(sql, a)).rows as T[];
const j = async (r: Response) => ({ status: r.status, body: await r.json() as any });

let mockRef: Awaited<ReturnType<typeof startMockToss>> | undefined;
async function main() {
  const mock = await startMockToss("test_sk_mock");
  mockRef = mock;
  Object.assign(process.env, { TOSS_API_BASE: mock.url, TOSS_SECRET_KEY: "test_sk_mock", TOSS_CLIENT_KEY: "test_ck_mock" });
  delete process.env.TOSS_WEBHOOK_TOKEN;

  await pool.query("truncate bookings, stay_dates, payment_events, lookup_attempts cascade");
  await pool.query("delete from season_periods; delete from date_overrides");
  await pool.query("update base_prices set price = case day_type when 'weekday' then 600000 else 650000 end");
  await pool.query("select ensure_stay_dates(current_date, current_date + 400)");
  const today = (await q(`select (now() at time zone 'Asia/Seoul')::date::text as d`))[0].d as string;

  const newHold = (offset: number) => holdStay(pool, {
    checkIn: addDays(today, offset), checkOut: addDays(today, offset + 1), guests: 4,
    guest: { name: "홍길동", phoneEnc: encryptText(PHONE), phoneHash: hmacHex(PHONE), phoneLast4: PHONE.slice(-4) },
    agreedTerms: true,
  });
  const prepare = async (bookingNo: string, method = "VIRTUAL_ACCOUNT") => j(await post(preparePOST, "/api/payments/prepare", { bookingNo, method }));
  const confirm = async (key: string, orderId: string, amount: number) => j(await post(confirmPOST, "/api/payments/confirm", { paymentKey: key, orderId, amount }));
  const lookup = async (no: string) => j(await post(lookupPOST, "/api/bookings/lookup", { bookingNo: no, phone: PHONE }));
  const cancel = async (no: string, expectedRefund: number, refundAccount?: unknown) => j(await post(cancelPOST, "/api/bookings/cancel", { bookingNo: no, phone: PHONE, expectedRefund, refundAccount }));
  const bookingStatus = async (no: string) => (await q(`select status from bookings where booking_no = $1`, [no]))[0].status as string;
  const pay = async (orderId: string) => (await q(`select * from payments where pg_order_id = $1`, [orderId]))[0];
  const stayRows = async (id: string) => q(`select status, held_until from stay_dates where booking_id = $1`, [id]);

  /** 가상계좌 발급까지 진행 (입금 전) */
  async function issueAccount(offset: number, receiptType = "소득공제") {
    const h = await newHold(offset);
    const p = await prepare(h.bookingNo);
    assert.equal(p.status, 200, JSON.stringify(p.body));
    const key = mock.createSession(p.body.orderId, p.body.amount, { method: "VIRTUAL_ACCOUNT", receiptType });
    const c = await confirm(key, p.body.orderId, p.body.amount);
    return { ...h, p: p.body, key, c, orderId: p.body.orderId as string, checkIn: addDays(today, offset) };
  }

  // ---- 1. 준비: 입금 기한(KST) 반환, 카드는 기한 없음
  const h1 = await newHold(60);
  const p1 = await prepare(h1.bookingNo);
  assert.equal(p1.status, 200);
  assert.equal(p1.body.method, "VIRTUAL_ACCOUNT");
  assert.match(p1.body.dueDate, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  const dueMs = Date.parse(p1.body.dueDate + "+09:00");
  assert.ok(Math.abs(dueMs - (Date.now() + 120 * 60_000)) < 60_000, "기본 입금 기한 120분(KST 기준)");
  assert.equal((await prepare(h1.bookingNo, "CARD")).body.dueDate, null);
  assert.equal((await prepare(h1.bookingNo, "BITCOIN")).status, 400);
  const heldBefore = (await stayRows(h1.bookingId))[0];
  assert.ok(Date.parse(heldBefore.held_until) - Date.now() < 16 * 60_000, "결제창만 연 단계에서는 날짜를 오래 잡지 않음(15분)");
  console.log("1 통과: 준비 단계 — dueDate(KST) 반환, 이 단계에서는 점유 연장 없음");

  // ---- 2. 계좌 발급: 입금 대기 + 날짜 점유 연장 + 비밀값은 해시로만 저장
  const A = await issueAccount(61);
  assert.equal(A.c.status, 200, JSON.stringify(A.c.body));
  assert.equal(A.c.body.kind, "waiting_deposit");
  assert.equal(A.c.body.virtualAccount.bankCode, "20");
  assert.match(A.c.body.virtualAccount.accountNumber, /^X\d+/);
  assert.equal(A.c.body.amount, A.p.amount);
  const pa = await pay(A.orderId);
  assert.equal(pa.status, "waiting_deposit");
  assert.equal(pa.method, "가상계좌");
  assert.ok(pa.virtual_account.secretHash && pa.virtual_account.secretHash.length === 64);
  assert.equal(JSON.stringify(pa).includes(mock.secretOf(A.key)!), false, "승인 응답의 secret 원문은 어디에도 저장하지 않음");
  assert.equal(await bookingStatus(A.bookingNo), "pending_payment");
  const heldUntil = Date.parse((await stayRows(A.bookingId))[0].held_until);
  assert.ok(heldUntil - Date.now() > 100 * 60_000, "계좌가 발급된 뒤에는 입금 기한(≈2시간) 동안 날짜 점유");
  const calls = mock.state.confirmCalls.length;
  const again = await confirm(A.key, A.orderId, A.p.amount);
  assert.equal(again.body.kind, "waiting_deposit");
  assert.equal(again.body.virtualAccount.accountNumber, A.c.body.virtualAccount.accountNumber);
  assert.equal(mock.state.confirmCalls.length, calls, "새로고침해도 토스 재호출 없음");
  console.log("2 통과: 가상계좌 발급 → waiting_deposit / pending_payment / 점유 ≈2시간 / secret 해시만 저장 / 새로고침 멱등");

  // ---- 3. 조회 화면에 입금 안내가 나온다
  let lk = await lookup(A.bookingNo);
  assert.equal(lk.body.booking.status, "pending_payment");
  assert.equal(lk.body.payment.status, "waiting_deposit");
  assert.equal(lk.body.payment.virtualAccount.accountNumber, A.c.body.virtualAccount.accountNumber);
  assert.equal(lk.body.cancel.allowed, true);
  assert.equal(lk.body.cancel.expectedRefund, 0);
  assert.equal(lk.body.cancel.refundAccountRequired, false);
  console.log("3 통과: 조회 화면에 은행·계좌·기한 표시, 입금 전 취소 가능(환불 0)");

  // ---- 4. 입금 웹훅: 위조 secret 은 거절, 진짜는 예약 확정 + 현금영수증 기록, 재전송은 1회
  const hook = (payload: unknown, headers: Record<string, string> = {}) => post(webhookPOST, "/api/webhooks/toss", payload, headers);
  const fake = { createdAt: "2026-10-01T10:00:00.000000", secret: "forged", status: "DONE", transactionKey: "dep_fake", orderId: A.orderId };
  assert.equal((await hook(fake)).status, 401);
  assert.equal(await bookingStatus(A.bookingNo), "pending_payment", "위조 웹훅은 아무것도 바꾸지 못함");
  const dep = mock.deposit(A.key);                                  // eventType 이 없는 평평한 본문
  assert.equal("eventType" in dep, false);
  let r = await j(await hook(dep, { "tosspayments-webhook-transmission-id": "tr-1" }));
  assert.equal(r.status, 200);
  assert.equal(r.body.result, "processed");
  assert.equal(await bookingStatus(A.bookingNo), "confirmed");
  assert.deepEqual((await stayRows(A.bookingId)).map((x) => x.status), ["booked"]);
  assert.equal((await pay(A.orderId)).status, "paid");
  const cr = (await q(`select * from cash_receipts where payment_id = $1`, [(await pay(A.orderId)).id]))[0];
  assert.equal(cr.type, "income");
  assert.equal(cr.status, "issued");
  assert.match(cr.receipt_no, /^ISSUE/);
  assert.equal(decryptText(cr.identifier_enc), "-", "번호는 토스 결제창에서 입력되어 우리 DB에는 없음");
  r = await j(await hook(dep, { "tosspayments-webhook-transmission-id": "tr-1" }));
  assert.equal(r.body.result, "duplicate");
  assert.equal((await q(`select count(*)::int as n from cash_receipts where payment_id = $1`, [cr.payment_id]))[0].n, 1);
  lk = await lookup(A.bookingNo);
  assert.equal(lk.body.payment.status, "paid");
  assert.match(lk.body.payment.cashReceiptUrl, /mock\.toss\/cash/);
  assert.equal(lk.body.cancel.refundAccountRequired, true, "입금 후 환불에는 환불 계좌가 필요");
  console.log("4 통과: 위조 secret 401 / 입금 웹훅 → 예약 확정 / 현금영수증 기록·조회 / 재전송 1회");

  // ---- 5. 입금 후 환불: 계좌 없으면 400, 있으면 토스에 전달·암호화 보관·완료 후 삭제
  const exp5 = lk.body.cancel.expectedRefund as number;
  let c5 = await cancel(A.bookingNo, exp5);
  assert.equal(c5.status, 400);
  assert.equal(c5.body.error.code, "REFUND_ACCOUNT_REQUIRED");
  assert.equal(await bookingStatus(A.bookingNo), "confirmed", "거절 시 아무것도 바뀌지 않음");
  assert.equal((await cancel(A.bookingNo, exp5, { bank: "99", accountNumber: "12", holderName: "" })).status, 400);
  c5 = await cancel(A.bookingNo, exp5, { bank: "06", accountNumber: "123-456-789012", holderName: "홍길동" });
  assert.equal(c5.status, 200, JSON.stringify(c5.body));
  assert.equal(c5.body.refund.done, true);
  const tc = mock.state.cancelCalls.at(-1)!;
  assert.deepEqual(tc.body.refundReceiveAccount, { bank: "06", accountNumber: "123456789012", holderName: "홍길동" });
  const rf = (await q(`select * from refunds where booking_id = $1`, [A.bookingId]))[0];
  assert.equal(rf.status, "done");
  assert.equal(rf.refund_account_enc, null, "환불이 끝나면 계좌 정보를 지움");
  assert.equal(await bookingStatus(A.bookingNo), "cancelled");
  console.log(`5 통과: 입금 후 환불 — 계좌 필수(400), 숫자만 정리해 토스 전달, 완료 후 계좌 삭제 (환불 ${rf.amount.toLocaleString()}원)`);

  // ---- 6. 환불 계좌가 암호화돼 보관되는지(토스 실패 → 재시도에 사용)
  const B = await issueAccount(62);
  await post(webhookPOST, "/api/webhooks/toss", mock.deposit(B.key));
  const lkB = await lookup(B.bookingNo);
  mock.state.cancelFails = true;
  const errSpy = console.error; console.error = () => {};
  const cB = await cancel(B.bookingNo, lkB.body.cancel.expectedRefund, { bank: "90", accountNumber: "3333011122233", holderName: "홍길동" });
  console.error = errSpy;
  mock.state.cancelFails = false;
  assert.equal(cB.body.refund.done, false);
  const rfB = (await q(`select * from refunds where booking_id = $1`, [B.bookingId]))[0];
  assert.equal(rfB.status, "manual_needed");
  assert.ok(rfB.refund_account_enc && !rfB.refund_account_enc.includes("3333011122233"), "계좌번호 평문 저장 금지");
  await pool.query(`update refunds set requested_at = now() - interval '5 minutes' where id = $1`, [rfB.id]);
  const { retryPendingRefunds } = await import("../src/server/booking/cancel");
  assert.deepEqual(await retryPendingRefunds(pool), [{ id: rfB.id, ok: true }]);
  assert.equal(mock.state.cancelCalls.at(-1)!.body.refundReceiveAccount.accountNumber, "3333011122233", "재시도에 저장된 계좌를 사용");
  assert.equal((await q(`select refund_account_enc from refunds where id = $1`, [rfB.id]))[0].refund_account_enc, null);
  console.log("6 통과: 토스 실패 시 환불 계좌 암호화 보관 → 재시도로 환불 → 계좌 삭제");

  // ---- 7. 입금 전 취소: 토스에서 계좌를 먼저 닫고, 날짜를 푼다 / 토스 실패면 취소를 거절
  const C = await issueAccount(63);
  mock.state.cancelFails = true;
  const errSpy2 = console.error; console.error = () => {};
  let c7 = await cancel(C.bookingNo, 0);
  console.error = errSpy2;
  mock.state.cancelFails = false;
  assert.equal(c7.status, 502, "계좌를 못 닫으면 예약도 취소하지 않음");
  assert.equal(await bookingStatus(C.bookingNo), "pending_payment");
  c7 = await cancel(C.bookingNo, 0);
  assert.equal(c7.status, 200);
  assert.equal(c7.body.refund, null);
  const t7 = mock.state.cancelCalls.at(-1)!;
  assert.equal(t7.paymentKey, C.key);
  assert.equal("refundReceiveAccount" in t7.body, false);
  assert.equal(mock.statusOf(C.key), "CANCELED");
  assert.equal((await pay(C.orderId)).status, "cancelled");
  assert.equal(await bookingStatus(C.bookingNo), "cancelled");
  assert.equal((await stayRows(C.bookingId)).length, 0);
  console.log("7 통과: 입금 전 취소 — 계좌 먼저 닫음(실패 시 거절), 결제·예약 취소, 날짜 해제");

  // ---- 8. 계좌 발급 사이에 날짜를 잃음 → 계좌 취소 + unavailable
  const h8 = await newHold(64);
  const p8 = (await prepare(h8.bookingNo)).body;
  const k8 = mock.createSession(p8.orderId, p8.amount, { method: "VIRTUAL_ACCOUNT" });
  await pool.query(`update stay_dates set held_until = now() - interval '1 minute' where booking_id = $1`, [h8.bookingId]);
  await newHold(64);                                                // 만료된 점유를 다른 손님이 가져감
  const c8 = await confirm(k8, p8.orderId, p8.amount);
  assert.equal(c8.body.kind, "unavailable");
  assert.equal(mock.statusOf(k8), "CANCELED", "발급된 가상계좌를 즉시 닫음");
  assert.equal((await pay(p8.orderId)).status, "cancelled");
  console.log("8 통과: 계좌 발급 사이 날짜를 잃으면 계좌 자동 취소(unavailable)");

  // ---- 9. 입금 기한 만료 대사
  const D = await issueAccount(65);
  await pool.query(`update bookings set hold_expires_at = now() - interval '10 minutes' where id = $1`, [D.bookingId]);
  mock.setStatus(D.key, "EXPIRED");                                 // 토스에서 기한 만료
  const out = await reconcileWaitingDeposits(pool);
  assert.deepEqual(out, [{ orderId: D.orderId, result: "closed" }]);
  assert.equal((await pay(D.orderId)).status, "expired");
  assert.equal(await bookingStatus(D.bookingNo), "cancelled");
  assert.equal((await stayRows(D.bookingId)).length, 0, "날짜 해제");
  // 만료 직전에 입금된 건은 대사로 확정된다
  const E = await issueAccount(66);
  await pool.query(`update bookings set hold_expires_at = now() - interval '10 minutes' where id = $1`, [E.bookingId]);
  mock.deposit(E.key);
  assert.deepEqual(await reconcileWaitingDeposits(pool), [{ orderId: E.orderId, result: "settled" }]);
  assert.equal(await bookingStatus(E.bookingNo), "confirmed");
  console.log("9 통과: 입금 기한 대사 — 만료는 닫고 날짜 해제, 웹훅 누락된 입금은 확정");

  // ---- 10. 현금영수증 '미발행' 선택 / 카드 결제는 영수증 행 없음
  const F = await issueAccount(67, "미발행");
  await post(webhookPOST, "/api/webhooks/toss", mock.deposit(F.key));
  assert.equal(await bookingStatus(F.bookingNo), "confirmed");
  assert.equal((await q(`select count(*)::int as n from cash_receipts where payment_id = $1`, [(await pay(F.orderId)).id]))[0].n, 0);
  const G = await newHold(68);
  const pg = (await prepare(G.bookingNo, "CARD")).body;
  await confirm(mock.createSession(pg.orderId, pg.amount), pg.orderId, pg.amount);
  assert.equal((await q(`select count(*)::int as n from cash_receipts where payment_id = $1`, [(await pay(pg.orderId)).id]))[0].n, 0);
  console.log("10 통과: 미발행·카드 결제는 현금영수증 기록 없음");

  // ---- 11. 웹훅이 오지 않아도 조회하면 입금이 반영된다 (로컬 개발·웹훅 누락 대비)
  const H = await issueAccount(69);
  mock.deposit(H.key);                                              // 웹훅 없이 입금만 발생
  assert.equal(await bookingStatus(H.bookingNo), "pending_payment");
  const lkH = await lookup(H.bookingNo);
  assert.equal(lkH.body.booking.status, "confirmed");
  assert.equal(lkH.body.payment.status, "paid");
  assert.match(lkH.body.payment.cashReceiptUrl, /mock\.toss\/cash/);
  const lkH2 = await lookup(A.bookingNo);                           // 취소 완료 예약 조회는 토스를 건드리지 않음
  assert.equal(lkH2.body.booking.status, "cancelled");
  console.log("11 통과: 웹훅 없이도 조회 시 입금 확인·예약 확정");

  console.log("\n전체 통과");
}

async function cleanup() {
  await pool.query("truncate bookings, stay_dates, payment_events, lookup_attempts cascade").catch(() => {});
  await pool.query("select ensure_stay_dates(current_date, current_date + 400)").catch(() => {});
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await mockRef?.close(); await cleanup(); await pool.end(); });
