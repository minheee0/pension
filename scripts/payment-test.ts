/**
 * 결제 흐름 테스트(목 토스 서버 사용). 테스트 DB 전용.   npm run test:pay
 * 정상 결제, 금액 변조, 카드 거절, 점유 상실 후 자동 환불, 응답 유실, 웹훅 스푸핑·중복 등을 검증한다.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

process.env.PII_ENC_KEY ??= randomBytes(32).toString("base64");
process.env.PII_HASH_KEY ??= randomBytes(32).toString("base64");

import { pool } from "../src/server/db";
import { holdStay } from "../src/server/booking/hold";
import { POST as preparePOST } from "../src/app/api/payments/prepare/route";
import { POST as confirmPOST } from "../src/app/api/payments/confirm/route";
import { POST as webhookPOST } from "../src/app/api/webhooks/toss/route";
import { startMockToss } from "./mock-toss";

if (process.env.ALLOW_TRUNCATE !== "1") { console.error("테스트 DB 전용입니다. ALLOW_TRUNCATE=1 을 지정하세요."); process.exit(1); }

const addDays = (b: string, n: number) => { const d = new Date(`${b}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
let ip = 0;
const call = (handler: (r: Request) => Promise<Response>, path: string, body: unknown) =>
  handler(new Request(`http://localhost${path}`, {
    method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `10.1.0.${++ip}` }, body: JSON.stringify(body),
  }));
const q = async <T = any>(sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows as T[];

let mockRef: Awaited<ReturnType<typeof startMockToss>> | undefined;
async function main() {
  const mock = await startMockToss("test_sk_mock");
  mockRef = mock;
  process.env.TOSS_API_BASE = mock.url;
  process.env.TOSS_SECRET_KEY = "test_sk_mock";
  process.env.TOSS_CLIENT_KEY = "test_ck_mock";
  delete process.env.TOSS_WEBHOOK_TOKEN;

  await pool.query("truncate bookings, stay_dates, payment_events cascade");
  await pool.query("delete from season_periods");
  await pool.query("select ensure_stay_dates(current_date, current_date + 400)");
  const base = (await q(`select ((now() at time zone 'Asia/Seoul')::date + 60)::text as d`))[0].d as string;
  let slot = 0;
  const nextDates = () => { const s = addDays(base, slot); slot += 3; return { checkIn: s, checkOut: addDays(s, 1) }; };
  const newHold = (dates = nextDates()) => holdStay(pool, {
    ...dates, guests: 4,
    guest: { name: "결제테스트", phoneEnc: "enc", phoneHash: randomBytes(8).toString("hex"), phoneLast4: "0000" },
    agreedTerms: true,
  });
  const prepare = async (bookingNo: string) => { const r = await call(preparePOST, "/api/payments/prepare", { bookingNo }); return { status: r.status, body: await r.json() as any }; };
  const confirm = async (paymentKey: string, orderId: string, amount: number) => { const r = await call(confirmPOST, "/api/payments/confirm", { paymentKey, orderId, amount }); return { status: r.status, body: await r.json() as any }; };
  const bookingRow = async (no: string) => (await q(`select status from bookings where booking_no = $1`, [no]))[0].status as string;
  const stayStatuses = async (bookingNo: string) => (await q(`select s.status from stay_dates s join bookings b on b.id = s.booking_id where b.booking_no = $1`, [bookingNo])).map((r) => r.status);
  const payRow = async (orderId: string) => (await q(`select * from payments where pg_order_id = $1`, [orderId]))[0];

  // ---- 1. 정상 결제
  const h1 = await newHold();
  const p1 = await prepare(h1.bookingNo);
  assert.equal(p1.status, 200);
  assert.equal(p1.body.amount, h1.quote.totalAmount, "금액은 서버(DB) 값");
  assert.equal(p1.body.clientKey, "test_ck_mock");
  assert.match(p1.body.orderId, /^H[0-9A-Z]{10}_[0-9a-f]{8}$/);
  assert.equal((await prepare(h1.bookingNo)).body.orderId, p1.body.orderId, "결제 전 시도는 주문번호 재사용");
  const k1 = mock.createSession(p1.body.orderId, p1.body.amount);
  let c = await confirm(k1, p1.body.orderId, p1.body.amount);
  assert.equal(c.status, 200);
  assert.equal(c.body.kind, "confirmed");
  assert.equal(c.body.booking.bookingNo, h1.bookingNo);
  assert.equal(await bookingRow(h1.bookingNo), "confirmed");
  assert.deepEqual(await stayStatuses(h1.bookingNo), ["booked"]);
  const pay1 = await payRow(p1.body.orderId);
  assert.equal(pay1.status, "paid");
  assert.equal(pay1.pg_payment_key, k1);
  assert.equal(pay1.method, "카드");
  const cc = mock.state.confirmCalls.at(-1)!;
  assert.equal(cc.auth, `Basic ${Buffer.from("test_sk_mock:").toString("base64")}`, "시크릿키 + ':' 를 base64");
  assert.equal(cc.idem, `confirm-${p1.body.orderId}`);
  const calls = mock.state.confirmCalls.length;
  c = await confirm(k1, p1.body.orderId, p1.body.amount);           // 새로고침·중복 호출
  assert.equal(c.body.kind, "confirmed");
  assert.equal(c.body.already, true);
  assert.equal(mock.state.confirmCalls.length, calls, "이미 결제된 건은 토스를 다시 호출하지 않음");
  console.log("1 통과: 준비 → 승인 → 예약 확정, 시크릿키 인증, 중복 호출 멱등");

  // ---- 2. 금액 변조
  const h2 = await newHold();
  const p2 = await prepare(h2.bookingNo);
  const k2 = mock.createSession(p2.body.orderId, p2.body.amount);
  const before = mock.state.confirmCalls.length;
  c = await confirm(k2, p2.body.orderId, p2.body.amount - 1000);
  assert.equal(c.status, 400);
  assert.equal(c.body.error.code, "AMOUNT_MISMATCH");
  assert.equal(mock.state.confirmCalls.length, before, "변조된 요청은 토스로 보내지도 않음");
  assert.equal(await bookingRow(h2.bookingNo), "held");
  assert.equal((await confirm("x", "NOPE_00000000", 1000)).status, 404);
  console.log("2 통과: 금액 변조 400, 토스 미호출, 예약 그대로");

  // ---- 3. 카드 거절 → 재시도 성공
  mock.state.mode = "reject";
  c = await confirm(k2, p2.body.orderId, p2.body.amount);
  assert.equal(c.status, 402);
  assert.equal(c.body.code, "REJECT_CARD_COMPANY");
  assert.equal((await payRow(p2.body.orderId)).status, "failed");
  assert.equal(await bookingRow(h2.bookingNo), "held", "거절돼도 점유 유지");
  mock.state.mode = "approve";
  const p2b = await prepare(h2.bookingNo);
  assert.notEqual(p2b.body.orderId, p2.body.orderId, "실패한 주문번호는 재사용하지 않음");
  const k2b = mock.createSession(p2b.body.orderId, p2b.body.amount);
  assert.equal((await confirm(k2b, p2b.body.orderId, p2b.body.amount)).body.kind, "confirmed");
  assert.equal(await bookingRow(h2.bookingNo), "confirmed");
  console.log("3 통과: 카드 거절 402 → 점유 유지 → 재결제 성공");

  // ---- 4. 결제하는 사이 점유를 잃음 → 자동 전액 환불
  const d4 = nextDates();
  const h4 = await newHold(d4);
  const p4 = await prepare(h4.bookingNo);
  const k4 = mock.createSession(p4.body.orderId, p4.body.amount);
  await pool.query(`update stay_dates set held_until = now() - interval '1 minute' where booking_id = $1`, [h4.bookingId]);
  const thief = await newHold(d4);                                     // 만료된 점유를 다른 손님이 가져감
  c = await confirm(k4, p4.body.orderId, p4.body.amount);
  assert.equal(c.status, 200);
  assert.equal(c.body.kind, "refunded");
  assert.equal(c.body.reason, "HOLD_LOST");
  assert.equal(c.body.refundOk, true);
  assert.equal(mock.statusOf(k4), "CANCELED", "토스에서 실제로 취소됨");
  assert.equal(mock.state.cancelCalls.at(-1)!.idem, `cancel-full-${(await payRow(p4.body.orderId)).id}`);
  assert.equal((await payRow(p4.body.orderId)).status, "cancelled");
  const rf = (await q(`select * from refunds where booking_id = $1`, [h4.bookingId]))[0];
  assert.equal(rf.status, "done");
  assert.equal(rf.amount, p4.body.amount);
  assert.ok(rf.pg_cancel_key);
  assert.equal(await bookingRow(thief.bookingNo), "held", "다른 손님의 점유는 그대로");
  console.log("4 통과: 점유 상실 → 토스 자동 취소 + refunds 기록");

  // ---- 5. 취소 API마저 실패 → 수동 처리 표시
  const d5 = nextDates();
  const h5 = await newHold(d5);
  const p5 = await prepare(h5.bookingNo);
  const k5 = mock.createSession(p5.body.orderId, p5.body.amount);
  await pool.query(`update stay_dates set held_until = now() - interval '1 minute' where booking_id = $1`, [h5.bookingId]);
  await newHold(d5);
  mock.state.cancelFails = true;
  const errSpy = console.error; console.error = () => {};
  c = await confirm(k5, p5.body.orderId, p5.body.amount);
  console.error = errSpy;
  mock.state.cancelFails = false;
  assert.equal(c.body.kind, "refunded");
  assert.equal(c.body.refundOk, false);
  assert.equal((await q(`select status from refunds where booking_id = $1`, [h5.bookingId]))[0].status, "manual_needed");
  console.log("5 통과: 자동 취소 실패 → refunds.manual_needed 로 남김");

  // ---- 6. 점유는 만료됐지만 아무도 안 가져감 → 그래도 확정
  const h6 = await newHold();
  const p6 = await prepare(h6.bookingNo);
  const k6 = mock.createSession(p6.body.orderId, p6.body.amount);
  await pool.query(`update stay_dates set held_until = now() - interval '1 minute' where booking_id = $1`, [h6.bookingId]);
  assert.equal((await confirm(k6, p6.body.orderId, p6.body.amount)).body.kind, "confirmed");
  assert.equal(await bookingRow(h6.bookingNo), "confirmed");
  console.log("6 통과: 점유 만료 후에도 날짜가 비어 있으면 확정");

  // ---- 7. 승인 응답 유실(500) → 조회로 확인
  const h7 = await newHold();
  const p7 = await prepare(h7.bookingNo);
  const k7 = mock.createSession(p7.body.orderId, p7.body.amount);
  mock.state.mode = "flaky";
  c = await confirm(k7, p7.body.orderId, p7.body.amount);
  mock.state.mode = "approve";
  assert.equal(c.body.kind, "confirmed", "응답은 실패였지만 토스에는 승인돼 있으므로 확정");
  assert.equal(await bookingRow(h7.bookingNo), "confirmed");
  console.log("7 통과: 승인 응답 유실 500 → 주문 조회로 DONE 확인 후 확정");

  // ---- 8. prepare 방어
  assert.equal((await prepare("HZZZZZZZZZZ")).status, 404);
  assert.equal((await prepare(h1.bookingNo)).status, 409, "이미 결제된 예약");
  assert.equal((await prepare("abc")).status, 400);
  const h8 = await newHold();
  await pool.query(`update stay_dates set held_until = now() - interval '1 minute' where booking_id = $1`, [h8.bookingId]);
  assert.equal((await prepare(h8.bookingNo)).status, 409, "점유가 끝난 예약은 결제 시작 불가");
  console.log("8 통과: 없는 예약 404 / 결제 완료 409 / 점유 만료 409 / 형식 오류 400");

  // ---- 9. 웹훅
  const hook = (payload: unknown, qs = "") => webhookPOST(new Request(`http://localhost/api/webhooks/toss${qs}`, {
    method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `10.2.0.${++ip}` }, body: JSON.stringify(payload) }));

  // 9a. 위조 웹훅: 본문은 DONE 이라고 주장하지만 토스에 조회하면 아직 결제 전
  const h9 = await newHold();
  const p9 = await prepare(h9.bookingNo);
  const k9 = mock.createSession(p9.body.orderId, p9.body.amount);
  let r = await hook({ eventType: "PAYMENT_STATUS_CHANGED", createdAt: "2026-10-01T00:00:00.000", data: { paymentKey: k9, status: "DONE", orderId: p9.body.orderId } });
  assert.equal(r.status, 200);
  assert.equal((await payRow(p9.body.orderId)).status, "ready", "본문을 믿지 않고 조회 결과만 반영");
  assert.equal(await bookingRow(h9.bookingNo), "held");

  // 9b. 실제로 승인된 뒤 온 웹훅은 (브라우저가 못 돌아온 경우에도) 예약을 확정한다
  mock.setStatus(k9, "DONE");
  r = await hook({ eventType: "PAYMENT_STATUS_CHANGED", createdAt: "2026-10-01T00:00:01.000", data: { paymentKey: k9, status: "DONE", orderId: p9.body.orderId } });
  assert.equal((await r.json() as any).result, "processed");
  assert.equal(await bookingRow(h9.bookingNo), "confirmed");
  assert.equal((await payRow(p9.body.orderId)).status, "paid");

  // 9c. 같은 이벤트 재전송은 한 번만 처리
  const ev = { eventType: "PAYMENT_STATUS_CHANGED", createdAt: "2026-10-01T00:00:01.000", data: { paymentKey: k9, status: "DONE", orderId: p9.body.orderId } };
  assert.equal((await (await hook(ev)).json() as any).result, "duplicate");
  assert.equal((await q(`select count(*)::int as n from payment_events where event_id like $1`, [`%${k9}%DONE%`]))[0].n, 2, "서로 다른 두 이벤트만 저장");

  // 9d. 토스 대시보드에서 취소 → 결제 상태 반영(예약은 자동으로 건드리지 않음)
  mock.setStatus(k9, "CANCELED");
  const warn = console.warn; console.warn = () => {};
  await hook({ eventType: "PAYMENT_STATUS_CHANGED", createdAt: "2026-10-01T00:00:02.000", data: { paymentKey: k9, status: "CANCELED", orderId: p9.body.orderId } });
  console.warn = warn;
  assert.equal((await payRow(p9.body.orderId)).status, "cancelled");

  // 9e. 모르는 주문·다른 이벤트는 무시하고 200
  r = await hook({ eventType: "PAYMENT_STATUS_CHANGED", createdAt: "x", data: { paymentKey: "k", status: "DONE", orderId: "OTHER_SHOP_ORDER_1" } });
  assert.equal(r.status, 200);
  r = await hook({ eventType: "SOMETHING_ELSE", createdAt: "y", data: {} });
  assert.equal((await r.json() as any).result, "ignored");

  // 9f. 토큰
  process.env.TOSS_WEBHOOK_TOKEN = "secret-token";
  assert.equal((await hook({ eventType: "X" })).status, 401);
  assert.equal((await hook({ eventType: "X", createdAt: "z" }, "?token=wrong")).status, 401);
  assert.equal((await hook({ eventType: "X", createdAt: "z2" }, "?token=secret-token")).status, 200);
  delete process.env.TOSS_WEBHOOK_TOKEN;
  console.log("9 통과: 웹훅 위조 무시 / 승인 후 확정 / 중복 1회 / 취소 반영 / 무시 / 토큰");

  console.log("\n전체 통과");
}

async function cleanup() {
  await pool.query("truncate bookings, stay_dates, payment_events cascade").catch(() => {});
  await pool.query("select ensure_stay_dates(current_date, current_date + 400)").catch(() => {});
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await mockRef?.close(); await cleanup(); await pool.end(); });
