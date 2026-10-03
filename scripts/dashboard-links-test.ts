/**
 * 대시보드 카드 ↔ 이동 화면 일치 테스트 + 매출 내역 테스트. 테스트 DB 전용.   npm run test:dash
 * 카드의 숫자가 눌렀을 때 나오는 목록의 건수·합계와 같은지, 한국시간 월 경계가 맞는지 확인한다.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

process.env.PII_ENC_KEY ??= randomBytes(32).toString("base64");
process.env.PII_HASH_KEY ??= randomBytes(32).toString("base64");
process.env.ADMIN_SESSION_SECRET ??= randomBytes(32).toString("base64");

import { pool } from "../src/server/db";
import { holdStay } from "../src/server/booking/hold";
import { encryptText, hmacHex } from "../src/server/crypto";
import { createAdmin } from "../src/server/admin/auth";
import { getDashboard } from "../src/server/admin/dashboard";
import { adminCancelBooking, listBookings } from "../src/server/admin/bookings";
import { listAdminReviews } from "../src/server/admin/reviews";
import { listRefunds } from "../src/server/admin/refunds";
import { getSales, kstMonth, monthTotals, MONTH_RE } from "../src/server/admin/sales";
import { createReview } from "../src/server/reviews/service";
import { reportReview } from "../src/server/reviews/service";
import { POST as preparePOST } from "../src/app/api/payments/prepare/route";
import { POST as confirmPOST } from "../src/app/api/payments/confirm/route";
import { startMockToss } from "./mock-toss";

if (process.env.ALLOW_TRUNCATE !== "1") { console.error("테스트 DB 전용입니다. ALLOW_TRUNCATE=1 을 지정하세요."); process.exit(1); }

const addDays = (b: string, n: number) => { const d = new Date(`${b}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
let ip = 0;
const post = (h: (r: Request) => Promise<Response>, body: unknown) =>
  h(new Request("http://localhost/api/x", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `10.9.0.${++ip}` }, body: JSON.stringify(body) }));
const q = async (sql: string, a: unknown[] = []) => (await pool.query(sql, a)).rows;
const sum = (rows: { amount: number }[]) => rows.reduce((s, r) => s + r.amount, 0);

let mockRef: Awaited<ReturnType<typeof startMockToss>> | undefined;
async function main() {
  const mock = await startMockToss("test_sk_mock");
  mockRef = mock;
  Object.assign(process.env, { TOSS_API_BASE: mock.url, TOSS_SECRET_KEY: "test_sk_mock", TOSS_CLIENT_KEY: "test_ck_mock" });
  await pool.query("truncate bookings, stay_dates, payment_events, audit_logs, admin_users, lookup_attempts restart identity cascade");
  await pool.query("update base_prices set price = case day_type when 'weekday' then 600000 else 650000 end");
  await pool.query("delete from season_periods; delete from date_overrides");
  await pool.query("select ensure_stay_dates(current_date, current_date + 400)");
  const today = (await q(`select (now() at time zone 'Asia/Seoul')::date::text as d`))[0].d as string;
  const month = await kstMonth(pool);
  const adminId = await createAdmin(pool, { email: "o@x.co", name: "사장님", password: "owner-pass-1234", role: "owner" });
  const admin = { id: adminId, email: "o@x.co", name: "사장님", role: "owner" as const };

  const hold = (offset: number, name: string) => holdStay(pool, {
    checkIn: addDays(today, offset), checkOut: addDays(today, offset + 1), guests: 2,
    guest: { name, phoneEnc: encryptText("01012345678"), phoneHash: hmacHex("01012345678"), phoneLast4: "5678" }, agreedTerms: true });
  async function paid(offset: number, name: string, method: "CARD" | "VIRTUAL_ACCOUNT" = "CARD") {
    const h = await hold(offset, name);
    const p = await (await post(preparePOST, { bookingNo: h.bookingNo, method })).json() as any;
    const key = mock.createSession(p.orderId, p.amount, { method });
    await post(confirmPOST, { paymentKey: key, orderId: p.orderId, amount: p.amount });
    if (method === "VIRTUAL_ACCOUNT") return { ...h, key, total: p.amount as number };
    return { ...h, key, total: p.amount as number };
  }
  const setDates = (id: string, inOff: number, outOff: number) =>
    pool.query(`update bookings set check_in = $2::date, check_out = $3::date where id = $1`, [id, addDays(today, inOff), addDays(today, outOff)]);

  // ---------- 데이터 준비 (실제 흐름)
  const allPaid: { total: number }[] = [];
  const track = <T extends { total: number }>(b: T) => (allPaid.push(b), b);
  const inToday = track(await paid(0, "오늘체크인"));                                                        // 오늘 체크인 (이번 달의 실제 박)
  const outToday = track(await paid(32, "오늘체크아웃"));   await setDates(outToday.bookingId, -1, 0);      // 오늘 체크아웃
  const later = track(await paid(1, "내일손님"));
  const va = await paid(36, "입금대기", "VIRTUAL_ACCOUNT");                                          // 입금 대기
  const toCancel = track(await paid(38, "취소손님"));
  const failRefund = track(await paid(40, "환불실패"));
  const r1 = await adminCancelBooking(pool, admin, { bookingNo: toCancel.bookingNo, mode: "host", expectedRefund: toCancel.total });
  assert.equal(r1.refund!.done, true);
  mock.state.cancelFails = true;
  const errSpy = console.error; console.error = () => {};
  const r2 = await adminCancelBooking(pool, admin, { bookingNo: failRefund.bookingNo, mode: "host", expectedRefund: failRefund.total });
  console.error = errSpy; mock.state.cancelFails = false;
  assert.equal(r2.refund!.done, false);                                                              // manual_needed

  // 후기: 이용 완료 예약 4건 → 후기 4건 (1건 신고됨, 1건 숨김, 1건 답글 있음)
  const rvIds: number[] = [];
  for (let i = 0; i < 4; i++) {
    const b = track(await paid(50 + i * 2, `후기손님${i}`));
    await pool.query(`update bookings set status = 'completed', check_in = $2::date, check_out = $3::date where id = $1`, [b.bookingId, addDays(today, -6 + i), addDays(today, -5 + i)]);
    rvIds.push((await createReview(pool, { bookingNo: b.bookingNo, phone: "01012345678", ip: "1.1.1.1", rating: 5, content: `${i}번째 후기입니다. 아주 편안했어요 감사합니다.` })).id);
  }
  await reportReview(pool, { reviewId: rvIds[0], reason: "abuse", ip: "2.2.2.2" });
  await pool.query(`update reviews set status = 'hidden' where id = $1`, [rvIds[1]]);
  await pool.query(`insert into review_replies (review_id, content) values ($1, '감사합니다')`, [rvIds[2]]);

  const d = await getDashboard(pool);
  assert.equal(d.today, today);
  assert.equal(d.month, month);

  // ---------- 1. 예약 관련 카드 ↔ 목록
  const ci = await listBookings(pool, { from: today, to: today, status: "confirmed" });
  assert.equal(d.checkInsToday.length, 1);
  assert.equal(ci.total, d.checkInsToday.length, "오늘 체크인 카드 = 목록 건수");
  assert.deepEqual(ci.rows.map((r: any) => r.booking_no), d.checkInsToday.map((r: any) => r.booking_no));
  const co = await listBookings(pool, { outFrom: today, outTo: today, status: "confirmed,completed" });
  assert.ok(d.checkOutsToday.length >= 1);
  assert.equal(co.total, d.checkOutsToday.length, "오늘 체크아웃 카드 = 목록 건수");
  assert.ok(co.rows.some((r: any) => r.booking_no === outToday.bookingNo));
  const pend = await listBookings(pool, { status: "pending_payment" });
  assert.equal(pend.total, d.pendingDeposits.length, "입금 대기 카드 = 목록 건수");
  assert.equal(pend.rows[0].booking_no, va.bookingNo);
  assert.equal((await listBookings(pool, { status: "bogus,confirmed" })).total, (await listBookings(pool, { status: "confirmed" })).total, "알 수 없는 상태 값은 무시");
  console.log("1 통과: 오늘 체크인·체크아웃·입금 대기 카드가 이동 목록과 일치 (체크아웃 기간·여러 상태 필터 포함)");

  // ---------- 2. 환불·후기 카드 ↔ 목록
  const open = await listRefunds(pool, true);
  assert.equal(d.refundIssues.length, 1);
  assert.equal(open.length, d.refundIssues.length, "환불 처리 필요 카드 = 환불 현황(처리 필요) 건수");
  assert.equal(open[0].booking_no, failRefund.bookingNo);
  const rep = await listAdminReviews(pool, { filter: "reported" });
  assert.equal(d.reviewsReported, 1);
  assert.equal(rep.total, d.reviewsReported, "신고된 후기 카드 = 후기 목록(신고됨) 건수");
  const need = await listAdminReviews(pool, { filter: "needs_reply" });
  assert.equal(d.reviewsNeedReply, 2, "4건 − 숨김 1 − 답글 있음 1 = 2");
  assert.equal(need.total, d.reviewsNeedReply, "답글 안 단 후기 카드 = 후기 목록(답글 필요) 건수");
  assert.ok(!need.rows.some((r: any) => r.status === "hidden"), "숨긴 후기는 답글 필요 목록에 없음");
  console.log("2 통과: 환불 처리 필요·신고된 후기·답글 안 단 후기 카드가 이동 목록과 일치");

  // ---------- 3. 매출 카드 ↔ 매출 내역 (독립 계산과도 비교)
  const expectedPaid = allPaid.reduce((a, b) => a + b.total, 0);   // 카드 결제가 끝난 예약들의 총액 (입금 전 가상계좌 제외)
  const sp = await getSales(pool, month, "payments");
  assert.equal(sum(sp.payments), d.monthPaid, "결제 금액 카드 = 내역 합계");
  assert.equal(sp.totals.paid, d.monthPaid);
  assert.equal(sp.payments.length, sp.totals.paidCount);
  assert.equal(d.monthPaid, expectedPaid, "독립 계산한 결제 총액과 정확히 일치");
  assert.ok(!sp.payments.some((p: any) => p.booking_no === va.bookingNo), "입금 전 가상계좌는 결제 금액에 포함되지 않음");
  const sr = await getSales(pool, month, "refunds");
  assert.equal(sum(sr.refunds), d.monthRefunded, "환불 금액 카드 = 내역 합계");
  assert.equal(d.monthRefunded, toCancel.total, "완료된 환불은 취소손님 1건뿐 (실패한 건 제외)");
  assert.ok(!sr.refunds.some((r: any) => r.booking_no === failRefund.bookingNo), "환불이 끝나지 않은 건은 환불 금액에 포함되지 않음");
  const sn = await getSales(pool, month, "net");
  const net = sum(sn.payments) - sum(sn.refunds);
  assert.equal(net, d.monthNet, "순매출 카드 = 결제 합계 − 환불 합계");
  assert.equal(d.monthNet, d.monthPaid - d.monthRefunded);
  const sb = await getSales(pool, month, "nights");
  assert.equal(sb.nights.length, d.monthBookedNights, "예약된 박 수 카드 = 내역 행 수");
  const indep = (await q(`select count(*)::int as n from stay_dates where status = 'booked'
                           and date >= date_trunc('month', now() at time zone 'Asia/Seoul')::date
                           and date < (date_trunc('month', now() at time zone 'Asia/Seoul') + interval '1 month')::date`))[0].n;
  assert.equal(d.monthBookedNights, indep, "날짜 범위로 따로 센 값과 일치");
  assert.ok(d.monthBookedNights >= 1 && sb.nights.some((n: any) => n.booking_no === inToday.bookingNo && n.date === today), "오늘 체크인 예약의 박이 이번 달 내역에 있음");
  assert.ok(sb.nights.every((n: any) => n.date.startsWith(month)), "그 달의 박만 표시");
  assert.ok(sb.nights.every((n: any) => n.price != null && n.price > 0), "박별 요금(예약 당시 스냅샷)이 함께 표시");
  assert.deepEqual((await getSales(pool, month, "payments")).totals, (await monthTotals(pool, month)));
  console.log(`3 통과: 결제 ${d.monthPaid.toLocaleString()}원 / 환불 ${d.monthRefunded.toLocaleString()}원 / 순매출 ${d.monthNet.toLocaleString()}원 / ${d.monthBookedNights}박 — 카드와 내역 합계 일치`);

  // ---------- 4. 한국시간 월 경계
  const x = (await q(`select id from payments where status = 'paid' order by id limit 2`)).map((r: any) => Number(r.id));
  // x[0]: 이번 달 1일 00:30(KST) → 이번 달 / x[1]: 이번 달 1일 00:00 직전 23:30(KST) → 지난달
  await pool.query(`update payments set paid_at = (date_trunc('month', now() at time zone 'Asia/Seoul') + interval '30 minutes') at time zone 'Asia/Seoul' where id = $1`, [x[0]]);
  await pool.query(`update payments set paid_at = (date_trunc('month', now() at time zone 'Asia/Seoul') - interval '30 minutes') at time zone 'Asia/Seoul' where id = $1`, [x[1]]);
  const prev = await q(`select to_char((date_trunc('month', now() at time zone 'Asia/Seoul') - interval '1 day'), 'YYYY-MM') as m`);
  const prevMonth = prev[0].m as string;
  const thisPay = (await getSales(pool, month, "payments")).payments.map((p: any) => p.id);
  const prevPay = (await getSales(pool, prevMonth, "payments")).payments.map((p: any) => p.id);
  assert.ok(thisPay.includes(x[0]) && !thisPay.includes(x[1]), "1일 00:30 KST 결제는 이번 달");
  assert.ok(prevPay.includes(x[1]) && !prevPay.includes(x[0]), "전달 말일 23:30 KST 결제는 지난달 (UTC로는 같은 달이라도)");
  assert.equal((await getSales(pool, "2001-01", "net")).totals.net, 0, "과거 빈 달은 0원");
  assert.ok(MONTH_RE.test("2026-12") && !MONTH_RE.test("2026-13") && !MONTH_RE.test("26-1") && !MONTH_RE.test("2026-1; drop"));
  console.log("4 통과: 한국시간 기준 월 경계(1일 00:30 → 이번 달, 전달 23:30 → 지난달), 빈 달, 월 형식 검증");

  console.log("\n전체 통과");
}

async function cleanup() {
  await pool.query("truncate bookings, stay_dates, payment_events, audit_logs, admin_users, lookup_attempts restart identity cascade").catch(() => {});
  await pool.query("select ensure_stay_dates(current_date, current_date + 400)").catch(() => {});
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await mockRef?.close(); await cleanup(); await pool.end(); });
