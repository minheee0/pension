/**
 * 예약 조회·취소·환불 테스트(목 토스 서버 사용). 테스트 DB 전용.   npm run test:cancel
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

process.env.PII_ENC_KEY ??= randomBytes(32).toString("base64");
process.env.PII_HASH_KEY ??= randomBytes(32).toString("base64");

import { pool } from "../src/server/db";
import { holdStay } from "../src/server/booking/hold";
import { retryPendingRefunds } from "../src/server/booking/cancel";
import { encryptText, hmacHex } from "../src/server/crypto";
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
const post = (h: (r: Request) => Promise<Response>, path: string, body: unknown) =>
  h(new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `10.3.${Math.floor(++ipSeq / 200)}.${ipSeq % 200}` }, body: JSON.stringify(body) }));
const q = async <T = any>(sql: string, a: unknown[] = []) => (await pool.query(sql, a)).rows as T[];
const lookup = async (bookingNo: string, phone = PHONE) => { const r = await post(lookupPOST, "/api/bookings/lookup", { bookingNo, phone }); return { status: r.status, body: await r.json() as any }; };
const cancel = async (bookingNo: string, expectedRefund: number, phone = PHONE) => { const r = await post(cancelPOST, "/api/bookings/cancel", { bookingNo, phone, expectedRefund }); return { status: r.status, body: await r.json() as any }; };

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
  async function makeConfirmed(offset: number) {
    const h = await newHold(offset);
    const p = await (await post(preparePOST, "/api/payments/prepare", { bookingNo: h.bookingNo })).json() as any;
    const key = mock.createSession(p.orderId, p.amount);
    const c = await (await post(confirmPOST, "/api/payments/confirm", { paymentKey: key, orderId: p.orderId, amount: p.amount })).json() as any;
    assert.equal(c.kind, "confirmed");
    return { ...h, orderId: p.orderId, paymentKey: key, total: p.amount, checkIn: addDays(today, offset) };
  }
  const expectedFor2Days = async (checkIn: string) => {          // off 등급, 체크인 2일 전: 평일 10% / 주말 20% 공제 (독립 계산)
    const n = (await q(`select price, day_type from resolve_night($1::date)`, [checkIn]))[0];
    const rate = n.day_type === "weekend" ? 20 : 10;
    return { price: n.price as number, deduct: Math.floor((n.price * rate) / 100), refund: n.price - Math.floor((n.price * rate) / 100) };
  };
  const stayStatus = async (bookingId: string) => (await q(`select status from stay_dates where booking_id = $1`, [bookingId])).length;
  const bookingStatus = async (no: string) => (await q(`select status from bookings where booking_no = $1`, [no]))[0].status as string;

  // ---- 1. 조회 · 본인 확인
  const A = await makeConfirmed(2);
  const eA = await expectedFor2Days(A.checkIn);
  let r = await lookup(A.bookingNo, "010-1234-5678");           // 하이픈 있어도 정규화
  assert.equal(r.status, 200);
  assert.equal(r.body.booking.guestName, "홍길동");
  assert.equal(r.body.booking.status, "confirmed");
  assert.equal(r.body.cancel.allowed, true);
  assert.equal(r.body.cancel.expectedRefund, eA.refund);
  assert.equal(r.body.cancel.preview.daysBefore, 2);
  assert.equal(r.body.payment.status, "paid");
  assert.ok(r.body.payment.receiptUrl?.includes(A.paymentKey), "매출전표 링크");
  assert.equal(JSON.stringify(r.body).includes(PHONE), false, "응답에 전화번호 전체가 들어가면 안 됨");
  const wrongPhone = await lookup(A.bookingNo, "01099998888");
  const wrongNo = await lookup("HZZZZZZZZZZ");
  assert.equal(wrongPhone.status, 404);
  assert.equal(wrongPhone.body.error.message, wrongNo.body.error.message, "번호 오류와 전화번호 오류를 구분해 알려 주지 않음");
  assert.equal((await lookup(A.bookingNo.toLowerCase())).status, 200, "예약번호는 소문자로 입력해도 됨");
  assert.equal((await lookup("abc")).status, 400);
  console.log("1 통과: 조회, 응답에 전화번호 미노출, 오류 메시지 구분 불가, 소문자·하이픈 허용");

  // ---- 2. 무차별 대입 잠금
  await pool.query("truncate lookup_attempts");
  for (let i = 0; i < 5; i++) assert.equal((await lookup(A.bookingNo, `0109999000${i}`)).status, 404);
  r = await lookup(A.bookingNo);                                  // 정답이어도 잠김
  assert.equal(r.status, 429);
  assert.equal(r.body.error.code, "RATE_LIMITED");
  await pool.query("truncate lookup_attempts");
  assert.equal((await lookup(A.bookingNo)).status, 200);
  console.log("2 통과: 같은 예약번호에 5회 실패하면 정답도 잠금(15분), 해제 후 정상");

  // ---- 3. 환불 금액이 달라졌을 때(시간 경과 등) 다시 확인받기
  const callsBefore = mock.state.cancelCalls.length;
  r = await cancel(A.bookingNo, eA.refund + 1000);
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, "REFUND_CHANGED");
  assert.equal(r.body.error.detail.cancel.expectedRefund, eA.refund);
  assert.equal(await bookingStatus(A.bookingNo), "confirmed");
  assert.equal(mock.state.cancelCalls.length, callsBefore, "취소 처리 안 함");
  assert.equal((await cancel(A.bookingNo, eA.refund, "01099998888")).status, 404, "남의 전화번호로는 취소 불가");
  console.log("3 통과: 고객이 본 금액과 다르면 409(새 금액 안내), 타인 번호로 취소 불가");

  // ---- 4. 정상 취소: 부분 환불
  r = await cancel(A.bookingNo, eA.refund);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.refund.amount, eA.refund);
  assert.equal(r.body.refund.deductAmount, eA.deduct);
  assert.equal(r.body.refund.done, true);
  const rf = (await q(`select * from refunds where booking_id = $1`, [A.bookingId]))[0];
  assert.equal(rf.status, "done");
  assert.equal(rf.amount, eA.refund);
  assert.equal(rf.deduct_amount, eA.deduct);
  const tc = mock.state.cancelCalls.at(-1)!;
  assert.equal(tc.paymentKey, A.paymentKey);
  assert.equal(tc.body.cancelAmount, eA.refund, "공제 후 금액만 부분 취소");
  assert.equal(tc.idem, `refund-${rf.id}`);
  assert.equal(mock.statusOf(A.paymentKey), "PARTIAL_CANCELED");
  assert.equal((await q(`select status from payments where id = (select id from payments where pg_order_id = $1)`, [A.orderId]))[0].status, "partial_cancelled");
  assert.equal(await bookingStatus(A.bookingNo), "cancelled");
  assert.equal(await stayStatus(A.bookingId), 0, "재고 해제");
  r = await lookup(A.bookingNo);
  assert.equal(r.body.booking.status, "cancelled");
  assert.equal(r.body.cancel.allowed, false);
  assert.equal(r.body.refund.amount, eA.refund);
  r = await cancel(A.bookingNo, 0);
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, "NOT_CANCELLABLE");
  console.log(`4 통과: 부분 환불 ${eA.refund.toLocaleString()}원 (공제 ${eA.deduct.toLocaleString()}원), 재고 해제, 재취소 409`);

  // ---- 5. 취소한 날짜를 다른 손님이 다시 예약
  const again = await newHold(2);
  assert.ok(again.bookingNo);
  assert.equal((await cancel(again.bookingNo, 0)).status, 200);        // 다음 시나리오를 위해 정리
  console.log("5 통과: 취소된 날짜 재예약 가능");

  // ---- 6. 10일 이상 전 취소: 전액 환불(취소 금액 생략 = 전체 취소)
  const B = await makeConfirmed(60);
  r = await cancel(B.bookingNo, B.total);
  assert.equal(r.status, 200);
  assert.equal(r.body.refund.amount, B.total);
  assert.equal(r.body.refund.deductAmount, 0);
  assert.equal("cancelAmount" in mock.state.cancelCalls.at(-1)!.body, false);
  assert.equal(mock.statusOf(B.paymentKey), "CANCELED");
  assert.equal((await q(`select status from payments where pg_order_id = $1`, [B.orderId]))[0].status, "cancelled");
  console.log("6 통과: 10일 이상 전 → 전액 환불, payments.cancelled");

  // ---- 7. 토스 취소 실패 → 예약은 취소·재고 해제, 환불은 manual_needed → 재시도로 완료(멱등키 동일)
  const C = await makeConfirmed(2);
  const eC = await expectedFor2Days(C.checkIn);
  mock.state.cancelFails = true;
  const errSpy = console.error; console.error = () => {};
  r = await cancel(C.bookingNo, eC.refund);
  console.error = errSpy;
  assert.equal(r.status, 200);
  assert.equal(r.body.refund.done, false);
  assert.equal(await bookingStatus(C.bookingNo), "cancelled");
  assert.equal(await stayStatus(C.bookingId), 0);
  const rfc = (await q(`select * from refunds where booking_id = $1`, [C.bookingId]))[0];
  assert.equal(rfc.status, "manual_needed");
  mock.state.cancelFails = false;
  await pool.query(`update refunds set requested_at = now() - interval '5 minutes' where id = $1`, [rfc.id]);
  const retried = await retryPendingRefunds(pool);
  assert.deepEqual(retried, [{ id: rfc.id, ok: true }]);
  assert.equal((await q(`select status from refunds where id = $1`, [rfc.id]))[0].status, "done");
  const lastTwo = mock.state.cancelCalls.slice(-2);
  assert.equal(lastTwo[0].idem, lastTwo[1].idem, "재시도는 같은 멱등키");
  assert.deepEqual(await retryPendingRefunds(pool), [], "완료된 환불은 다시 처리하지 않음");
  console.log("7 통과: 토스 실패에도 예약 취소 유지, 재시도로 환불 완료(같은 멱등키)");

  // ---- 8. 결제 전(held) 예약 취소
  const D = await newHold(5);
  r = await lookup(D.bookingNo);
  assert.equal(r.body.cancel.allowed, true);
  assert.equal(r.body.cancel.expectedRefund, 0);
  assert.equal(r.body.cancel.preview, null);
  const n0 = mock.state.cancelCalls.length;
  r = await cancel(D.bookingNo, 0);
  assert.equal(r.status, 200);
  assert.equal(r.body.refund, null);
  assert.equal(mock.state.cancelCalls.length, n0, "결제 전 예약은 토스 호출 없음");
  assert.equal(await stayStatus(D.bookingId), 0);
  console.log("8 통과: 결제 전 예약 취소(환불 없음, 토스 미호출)");

  // ---- 9. 이용이 시작된 예약은 온라인 취소 불가
  const E = await makeConfirmed(2);
  await pool.query(`update bookings set check_in = $2::date, check_out = $3::date where id = $1`, [E.bookingId, addDays(today, -1), addDays(today, 1)]);
  r = await lookup(E.bookingNo);
  assert.equal(r.body.cancel.allowed, false);
  assert.match(r.body.cancel.reason, /온라인으로 취소할 수 없습니다/);
  assert.equal((await cancel(E.bookingNo, 0)).status, 409);
  console.log("9 통과: 이용 시작 후 온라인 취소 차단");

  // ---- 10. 우리가 시작한 환불의 웹훅은 경고 없이 동기화
  const F = await makeConfirmed(60);
  await cancel(F.bookingNo, F.total);
  await pool.query(`update payments set status = 'paid' where pg_order_id = $1`, [F.orderId]);   // 웹훅이 먼저 도착한 경쟁 상황
  let warned = 0; const warn = console.warn; console.warn = () => { warned++; };
  const hook = await post(webhookPOST, "/api/webhooks/toss", { eventType: "PAYMENT_STATUS_CHANGED", createdAt: "t1", data: { paymentKey: F.paymentKey, status: "CANCELED", orderId: F.orderId } });
  console.warn = warn;
  assert.equal(hook.status, 200);
  assert.equal(warned, 0, "우리 환불인데 [REVIEW] 경고가 나오면 안 됨");
  assert.equal((await q(`select status from payments where pg_order_id = $1`, [F.orderId]))[0].status, "cancelled");
  console.log("10 통과: 자체 환불의 웹훅은 경고 없이 상태 동기화");

  console.log("\n전체 통과");
}

async function cleanup() {
  await pool.query("truncate bookings, stay_dates, payment_events, lookup_attempts cascade").catch(() => {});
  await pool.query("select ensure_stay_dates(current_date, current_date + 400)").catch(() => {});
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await mockRef?.close(); await cleanup(); await pool.end(); });
