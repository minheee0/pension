/**
 * 관리자 기능 테스트(목 토스 서버 사용). 테스트 DB 전용.   npm run test:admin
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

process.env.PII_ENC_KEY ??= randomBytes(32).toString("base64");
process.env.PII_HASH_KEY ??= randomBytes(32).toString("base64");
process.env.ADMIN_SESSION_SECRET ??= randomBytes(32).toString("base64");

import { pool } from "../src/server/db";
import { holdStay } from "../src/server/booking/hold";
import { encryptText, hmacHex, decryptText } from "../src/server/crypto";
import { createAdmin, getAdminByToken, hashPassword, parseSession, signSession, verifyPassword, SESSION_COOKIE } from "../src/server/admin/auth";
import { getDashboard } from "../src/server/admin/dashboard";
import { listBookings } from "../src/server/admin/bookings";
import { listAudit } from "../src/server/admin/audit";
import { POST as preparePOST } from "../src/app/api/payments/prepare/route";
import { POST as confirmPOST } from "../src/app/api/payments/confirm/route";
import { POST as webhookPOST } from "../src/app/api/webhooks/toss/route";
import { POST as loginPOST } from "../src/app/api/admin/login/route";
import { POST as bookingsPOST } from "../src/app/api/admin/bookings/route";
import { POST as calendarPOST } from "../src/app/api/admin/calendar/route";
import { POST as pricingPOST } from "../src/app/api/admin/pricing/route";
import { POST as policyPOST } from "../src/app/api/admin/policy/route";
import { POST as refundsPOST } from "../src/app/api/admin/refunds/route";
import { startMockToss } from "./mock-toss";

if (process.env.ALLOW_TRUNCATE !== "1") { console.error("테스트 DB 전용입니다. ALLOW_TRUNCATE=1 을 지정하세요."); process.exit(1); }

const PHONE = "01012345678";
const ORIGIN = "http://localhost";
const addDays = (b: string, n: number) => { const d = new Date(`${b}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
let ipSeq = 0;
type H = (r: Request) => Promise<Response>;
async function call(h: H, path: string, body: unknown, o: { token?: string; origin?: string | null; ct?: string } = {}) {
  const headers: Record<string, string> = { "content-type": o.ct ?? "application/json", "x-forwarded-for": `10.5.${Math.floor(++ipSeq / 200)}.${ipSeq % 200}` };
  if (o.origin !== null) headers.origin = o.origin ?? ORIGIN;
  if (o.token) headers.cookie = `${SESSION_COOKIE}=${o.token}`;
  const r = await h(new Request(`${ORIGIN}${path}`, { method: "POST", headers, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() as any, res: r };
}
const q = async <T = any>(sql: string, a: unknown[] = []) => (await pool.query(sql, a)).rows as T[];

let mockRef: Awaited<ReturnType<typeof startMockToss>> | undefined;
let originalRates: { id: number; deduct_rate: number }[] = [];
async function main() {
  originalRates = (await q(`select id::int as id, deduct_rate from refund_policies`)) as typeof originalRates;   // 이 테스트가 바꾸는 값이라 끝나면 복구한다
  const mock = await startMockToss("test_sk_mock");
  mockRef = mock;
  Object.assign(process.env, { TOSS_API_BASE: mock.url, TOSS_SECRET_KEY: "test_sk_mock", TOSS_CLIENT_KEY: "test_ck_mock" });
  delete process.env.TOSS_WEBHOOK_TOKEN;

  await pool.query("truncate bookings, stay_dates, payment_events, lookup_attempts, audit_logs, admin_users restart identity cascade");
  await pool.query("delete from season_periods; delete from date_overrides");
  await pool.query("update base_prices set price = case day_type when 'weekday' then 600000 else 650000 end");
  await pool.query("update policy_settings set value = '15' where key = 'hold_minutes'");
  await pool.query("update options set price = 0, active = false");
  await pool.query("select ensure_stay_dates(current_date, current_date + 400)");
  const today = (await q(`select (now() at time zone 'Asia/Seoul')::date::text as d`))[0].d as string;

  // ---------- 1. 비밀번호
  const h1 = hashPassword("correct-horse-battery");
  assert.ok(verifyPassword("correct-horse-battery", h1));
  assert.ok(!verifyPassword("wrong-password-123", h1));
  assert.notEqual(h1, hashPassword("correct-horse-battery"), "같은 비밀번호도 솔트가 달라 해시가 다름");
  assert.ok(!h1.includes("correct-horse"));
  assert.ok(!verifyPassword("x", "garbage"));
  await assert.rejects(createAdmin(pool, { email: "a@b.co", name: "x", password: "short" }), /10자/);
  console.log("1 통과: scrypt 해시(솔트), 짧은 비밀번호 거절");

  // ---------- 2. 세션 토큰
  const ownerId = await createAdmin(pool, { email: "Owner@Example.com", name: "사장님", password: "owner-pass-1234", role: "owner" });
  const staffId = await createAdmin(pool, { email: "staff@example.com", name: "직원", password: "staff-pass-1234", role: "staff" });
  await assert.rejects(createAdmin(pool, { email: "owner@example.com", name: "중복", password: "another-pass-123" }), /이미 등록/);
  const pw = (await q(`select password_hash from admin_users where id = $1`, [ownerId]))[0].password_hash as string;
  const tok = signSession(ownerId, pw);
  assert.equal((await getAdminByToken(pool, tok))!.role, "owner");
  const parts = tok.split(".");
  assert.equal(parseSession(`${parts[0]}.${parts[1]}.${parts[2]}.${parts[3].slice(0, -2)}xx`), null, "서명 변조");
  assert.equal(parseSession(`${Number(parts[0]) + 1}.${parts[1]}.${parts[2]}.${parts[3]}`), null, "관리자 번호 변조");
  assert.equal(parseSession(signSession(ownerId, pw, Date.now() - 9 * 3600e3)), null, "만료(8시간)");
  assert.equal(await getAdminByToken(pool, "not.a.token"), null);
  await pool.query(`update admin_users set password_hash = $2 where id = $1`, [ownerId, hashPassword("new-owner-pass-99")]);
  assert.equal(await getAdminByToken(pool, tok), null, "비밀번호를 바꾸면 기존 세션이 모두 무효");
  await pool.query(`update admin_users set password_hash = $2 where id = $1`, [ownerId, pw]);
  assert.ok(await getAdminByToken(pool, tok));
  await pool.query(`update admin_users set active = false where id = $1`, [staffId]);
  assert.equal(await getAdminByToken(pool, signSession(staffId, (await q(`select password_hash from admin_users where id = $1`, [staffId]))[0].password_hash)), null, "비활성 계정은 즉시 차단");
  await pool.query(`update admin_users set active = true where id = $1`, [staffId]);
  console.log("2 통과: 세션 서명·만료·변조·비밀번호 변경·비활성 계정");

  // ---------- 3. 로그인 API
  let r = await call(loginPOST, "/api/admin/login", { email: "owner@example.com", password: "wrong-wrong-1" });
  const unknown = await call(loginPOST, "/api/admin/login", { email: "nobody@example.com", password: "wrong-wrong-1" });
  assert.equal(r.status, 401);
  assert.equal(r.body.error.message, unknown.body.error.message, "계정 유무를 알려 주지 않음");
  assert.equal((await call(loginPOST, "/api/admin/login", { email: "owner@example.com", password: "owner-pass-1234" }, { origin: "https://evil.example" })).status, 403);
  assert.equal((await call(loginPOST, "/api/admin/login", { email: "owner@example.com", password: "owner-pass-1234" }, { origin: null })).status, 403);
  for (let i = 0; i < 4; i++) await call(loginPOST, "/api/admin/login", { email: "owner@example.com", password: `wrong-pass-${i}` });
  r = await call(loginPOST, "/api/admin/login", { email: "owner@example.com", password: "owner-pass-1234" });
  assert.equal(r.status, 429, "같은 이메일 5회 실패 → 정답도 잠금");
  await pool.query("truncate lookup_attempts");
  r = await call(loginPOST, "/api/admin/login", { email: "OWNER@example.com", password: "owner-pass-1234" });
  assert.equal(r.status, 200);
  const setCookie = r.res.headers.get("set-cookie")!;
  assert.match(setCookie, new RegExp(`^${SESSION_COOKIE}=`));
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=strict/i);
  assert.match(setCookie, /Path=\//i);
  const OWNER = setCookie.split(";")[0].split("=")[1];
  const sr = await call(loginPOST, "/api/admin/login", { email: "staff@example.com", password: "staff-pass-1234" });
  const STAFF = sr.res.headers.get("set-cookie")!.split(";")[0].split("=")[1];
  assert.equal((await q(`select count(*)::int as n from audit_logs where action = 'auth.login'`))[0].n, 2);
  console.log("3 통과: 로그인 — 계정 유무 비공개, 출처 검사, 5회 실패 잠금, HttpOnly·SameSite=Strict 쿠키, 로그 기록");

  // ---------- 4. 접근 통제
  const probe = { op: "base", weekday: "600000", weekend: "650000" };
  assert.equal((await call(pricingPOST, "/api/admin/pricing", probe)).status, 401, "쿠키 없음");
  assert.equal((await call(pricingPOST, "/api/admin/pricing", probe, { token: "a.b.c.d" })).status, 401, "엉터리 토큰");
  assert.equal((await call(pricingPOST, "/api/admin/pricing", probe, { token: OWNER, origin: "https://evil.example" })).status, 403, "다른 사이트에서 온 요청(CSRF)");
  assert.equal((await call(pricingPOST, "/api/admin/pricing", probe, { token: OWNER, origin: null })).status, 403);
  assert.equal((await call(pricingPOST, "/api/admin/pricing", probe, { token: OWNER, ct: "text/plain" })).status, 415);
  assert.equal((await call(pricingPOST, "/api/admin/pricing", probe, { token: STAFF })).status, 403, "직원은 요금 변경 불가");
  assert.equal((await call(policyPOST, "/api/admin/policy", { op: "settings" }, { token: STAFF })).status, 403);
  assert.equal((await call(calendarPOST, "/api/admin/calendar", { op: "block", from: addDays(today, 5), to: addDays(today, 5) }, { token: STAFF })).status, 403);
  assert.equal((await call(refundsPOST, "/api/admin/refunds", { op: "retry", id: 1 }, { token: STAFF })).status, 403);
  assert.equal((await call(pricingPOST, "/api/admin/pricing", probe, { token: OWNER })).status, 200);
  console.log("4 통과: 무인증 401 / 출처 불일치 403 / 직원 변경 403 / 소유자 200");

  // ---------- 예약 준비 도우미
  const newHold = (offset: number, name = "홍길동", guests = 4) => holdStay(pool, {
    checkIn: addDays(today, offset), checkOut: addDays(today, offset + 1), guests,
    guest: { name, phoneEnc: encryptText(PHONE), phoneHash: hmacHex(PHONE), phoneLast4: PHONE.slice(-4) }, agreedTerms: true });
  const post = (h: H, path: string, body: unknown) => h(new Request(`${ORIGIN}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `10.6.0.${++ipSeq % 250}` }, body: JSON.stringify(body) }));
  async function confirmed(offset: number, name?: string) {
    const h = await newHold(offset, name);
    const p = await (await post(preparePOST, "/api/payments/prepare", { bookingNo: h.bookingNo })).json() as any;
    const key = mock.createSession(p.orderId, p.amount);
    await post(confirmPOST, "/api/payments/confirm", { paymentKey: key, orderId: p.orderId, amount: p.amount });
    return { ...h, key, orderId: p.orderId as string, total: p.amount as number };
  }
  async function vaPending(offset: number) {
    const h = await newHold(offset, "가상계좌");
    const p = await (await post(preparePOST, "/api/payments/prepare", { bookingNo: h.bookingNo, method: "VIRTUAL_ACCOUNT" })).json() as any;
    const key = mock.createSession(p.orderId, p.amount, { method: "VIRTUAL_ACCOUNT" });
    await post(confirmPOST, "/api/payments/confirm", { paymentKey: key, orderId: p.orderId, amount: p.amount });
    return { ...h, key, orderId: p.orderId as string, total: p.amount as number };
  }

  // ---------- 5. 대시보드 · 목록 · 상세
  const A = await confirmed(0, "오늘체크인");        // 오늘 체크인
  const B = await confirmed(2, "이틀뒤손님");
  const V = await vaPending(8);
  const dash = await getDashboard(pool);
  assert.equal(dash.today, today);
  assert.ok(dash.checkInsToday.some((x: any) => x.booking_no === A.bookingNo));
  assert.ok(dash.upcoming.some((x: any) => x.booking_no === B.bookingNo));
  assert.ok(dash.pendingDeposits.some((x: any) => x.booking_no === V.bookingNo));
  assert.ok(dash.newBookings24h >= 2);
  assert.equal(dash.monthPaid, A.total + B.total, "이번 달 결제액(확정 건)");
  const list = await listBookings(pool, { q: "오늘" });
  assert.deepEqual(list.rows.map((x: any) => x.booking_no), [A.bookingNo]);
  assert.equal((await listBookings(pool, { q: A.bookingNo.slice(0, 5).toLowerCase() })).rows[0].booking_no, A.bookingNo, "예약번호 앞부분 검색(대소문자 무관)");
  assert.equal((await listBookings(pool, { q: "5678" })).total, 3, "전화번호 끝 4자리 검색");
  assert.equal((await listBookings(pool, { status: "pending_payment" })).total, 1);
  assert.equal((await listBookings(pool, { q: "%" })).total, 0, "검색어의 % 는 문자 그대로 취급");
  console.log("5 통과: 대시보드(오늘 체크인·입금 대기·이번 달 결제액), 목록 검색(이름·번호·끝 4자리·상태)");

  // ---------- 6. 관리자 취소
  const prev = (bn: string, mode: string, tok = OWNER) => call(bookingsPOST, "/api/admin/bookings", { op: "preview", bookingNo: bn, mode }, { token: tok });
  const cancel = (bn: string, mode: string, expectedRefund: number, extra: object = {}, tok = OWNER) =>
    call(bookingsPOST, "/api/admin/bookings", { op: "cancel", bookingNo: bn, mode, expectedRefund, ...extra }, { token: tok });

  let pv = await prev(B.bookingNo, "host", STAFF);                 // 직원도 미리보기는 가능
  assert.equal(pv.status, 200);
  assert.equal(pv.body.expectedRefund, B.total, "사업자 사정은 전액 환불");
  pv = await prev(B.bookingNo, "policy");
  assert.ok(pv.body.expectedRefund < B.total && pv.body.expectedRefund > 0);
  assert.equal((await cancel(B.bookingNo, "host", B.total, {}, STAFF)).status, 403, "직원은 취소 불가");
  r = await cancel(B.bookingNo, "host", B.total - 1);
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, "REFUND_CHANGED");
  r = await cancel(B.bookingNo, "host", B.total);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.refund.amount, B.total);
  assert.equal(r.body.refund.done, true);
  assert.equal("cancelAmount" in mock.state.cancelCalls.at(-1)!.body, false, "전액 취소");
  assert.equal((await q(`select status, cancelled_by from bookings where id = $1`, [B.bookingId]))[0].cancelled_by, "admin");
  assert.equal((await q(`select reason from refunds where booking_id = $1`, [B.bookingId]))[0].reason, "사업자 사정 취소(전액 환불)");
  assert.equal((await q(`select count(*)::int as n from stay_dates where booking_id = $1`, [B.bookingId]))[0].n, 0);

  // 오늘 체크인 예약을 '규정 적용'으로 취소 = 노쇼 처리와 같은 당일 공제
  pv = await prev(A.bookingNo, "policy");
  assert.equal(pv.body.preview.daysBefore, 0);
  assert.ok(pv.body.preview.deductTotal > 0);
  r = await cancel(A.bookingNo, "policy", pv.body.expectedRefund);
  assert.equal(r.status, 200);
  assert.equal(r.body.refund.deductAmount, pv.body.preview.deductTotal);

  // 이용이 시작된 예약: 고객은 못 하지만 관리자는 가능
  const S = await confirmed(3, "이용중");
  await pool.query(`update bookings set check_in = $2::date, check_out = $3::date where id = $1`, [S.bookingId, addDays(today, -1), addDays(today, 1)]);
  pv = await prev(S.bookingNo, "policy");
  assert.equal(pv.body.allowed, true);
  console.log("6 통과: 관리자 취소 — 사업자 사정 전액 / 규정 적용(당일 공제) / 금액 변경 감지 / 직원 403 / 이용 시작 후에도 가능");

  // ---------- 7. 가상계좌: 입금 후 환불 계좌, 입금 전 계좌 닫기
  const D = await vaPending(9);
  await post(webhookPOST, "/api/webhooks/toss", mock.deposit(D.key));
  pv = await prev(D.bookingNo, "host");
  assert.equal(pv.body.refundAccountRequired, true);
  r = await cancel(D.bookingNo, "host", pv.body.expectedRefund);
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, "REFUND_ACCOUNT_REQUIRED");
  r = await cancel(D.bookingNo, "host", pv.body.expectedRefund, { refundAccount: { bank: "06", accountNumber: "123-4567-890123", holderName: "홍길동" } });
  assert.equal(r.status, 200);
  assert.equal(mock.state.cancelCalls.at(-1)!.body.refundReceiveAccount.accountNumber, "1234567890123");
  const closing = await vaPending(10);                              // 입금 전
  r = await cancel(closing.bookingNo, "host", 0);
  assert.equal(r.status, 200);
  assert.equal(mock.statusOf(closing.key), "CANCELED", "토스에서 가상계좌 닫힘");
  console.log("7 통과: 가상계좌 — 입금 후 환불 계좌 필수, 입금 전 취소는 계좌 닫기");

  // ---------- 8. 환불 재시도
  const F = await confirmed(11, "환불실패");
  mock.state.cancelFails = true;
  const errSpy = console.error; console.error = () => {};
  await cancel(F.bookingNo, "host", F.total);
  console.error = errSpy;
  mock.state.cancelFails = false;
  const rf = (await q(`select id, status from refunds where booking_id = $1`, [F.bookingId]))[0];
  assert.equal(rf.status, "manual_needed");
  assert.ok((await getDashboard(pool)).refundIssues.some((x: any) => x.id === Number(rf.id)), "대시보드에 환불 처리 필요로 표시");
  assert.equal((await call(refundsPOST, "/api/admin/refunds", { op: "retry", id: rf.id })).status, 401);
  r = await call(refundsPOST, "/api/admin/refunds", { op: "retry", id: rf.id }, { token: OWNER });
  assert.deepEqual(r.body, { ok: true });
  assert.equal((await q(`select status from refunds where id = $1`, [rf.id]))[0].status, "done");
  assert.equal((await call(refundsPOST, "/api/admin/refunds", { op: "retry", id: rf.id }, { token: OWNER })).status, 409, "완료된 환불은 다시 처리 불가");
  console.log("8 통과: 환불 실패 건이 대시보드에 보이고, 재시도로 완료(중복 불가)");

  // ---------- 9. 달력 차단
  const cal = (body: object, tok = OWNER) => call(calendarPOST, "/api/admin/calendar", body, { token: tok });
  const c1 = addDays(today, 20), c3 = addDays(today, 22);
  r = await cal({ op: "block", from: c1, to: c3, memo: "보일러 수리" });
  assert.equal(r.body.changed, 3);
  assert.deepEqual((await q(`select status, memo from stay_dates where date between $1 and $2 order by date`, [c1, c3])).map((x) => `${x.status}:${x.memo}`), Array(3).fill("blocked:보일러 수리"));
  await assert.rejects(newHold(20), /이미 예약되었거나/, "차단된 날은 손님이 예약할 수 없음");
  const { getAdminMonth } = await import("../src/server/admin/calendar");
  assert.equal((await getAdminMonth(pool, c1.slice(0, 7))).find((d) => d.date === c1)!.status, "blocked");
  const booked = await confirmed(24, "예약된날");
  r = await cal({ op: "block", from: addDays(today, 23), to: addDays(today, 25) });   // 24일에 예약이 있음
  assert.equal(r.status, 409);
  assert.match(r.body.error.message, new RegExp(booked.bookingNo));
  assert.equal((await q(`select status from stay_dates where date = $1`, [addDays(today, 23)]))[0].status, "available", "충돌 시 아무것도 바꾸지 않음");
  assert.equal((await cal({ op: "block", from: addDays(today, -3), to: addDays(today, -2) })).status, 400, "지난 날짜");
  assert.equal((await cal({ op: "block", from: c3, to: c1 })).status, 400, "끝이 시작보다 빠름");
  r = await cal({ op: "unblock", from: c1, to: c3 });
  assert.equal(r.body.changed, 3);
  assert.equal((await q(`select status from stay_dates where date = $1`, [c1]))[0].status, "available");
  const g = await newHold(20, "차단해제후");
  assert.ok(g.bookingNo);
  console.log("9 통과: 날짜 차단·해제, 차단일 예약 불가, 예약 충돌 시 전체 취소, 지난 날짜·역순 거절");

  // ---------- 10. 요금 · 성수기 · 옵션
  const price = (body: object, tok = OWNER) => call(pricingPOST, "/api/admin/pricing", body, { token: tok });
  const night = async (d: string) => (await q(`select * from resolve_night($1::date)`, [d]))[0];
  assert.equal((await price({ op: "base", weekday: "550000", weekend: "700000" })).status, 200);       // 폼처럼 문자열
  const wed = addDays(today, 40 + ((3 - new Date(`${addDays(today, 40)}T00:00:00Z`).getUTCDay() + 7) % 7));
  assert.equal((await night(wed)).price, 550000);
  assert.equal((await price({ op: "base", weekday: "", weekend: "700000" })).status, 400, "빈 칸을 0원으로 저장하지 않음");
  assert.equal((await price({ op: "base", weekday: "-5", weekend: "700000" })).status, 400);
  assert.equal((await price({ op: "base", weekday: "600000", weekend: "650000" })).status, 200);

  const s1 = addDays(today, 100), s2 = addDays(today, 110);
  r = await price({ op: "season_save", id: "", name: "여름", dateFrom: s1, dateTo: s2, priceWeekday: "700000", priceWeekend: "800000", minNights: "2", active: "on" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await night(addDays(s1, 3))).rule, "season");
  const sid = (await q(`select id from season_periods`))[0].id as number;
  r = await price({ op: "season_save", id: "", name: "겹침", dateFrom: addDays(s1, 5), dateTo: addDays(s2, 5), priceWeekday: "1", priceWeekend: "1", minNights: "1", active: "on" });
  assert.equal(r.status, 409);
  assert.match(r.body.error.message, /겹칩니다/);
  assert.equal((await price({ op: "season_save", id: String(sid), name: "여름", dateFrom: s1, dateTo: s2, priceWeekday: "720000", priceWeekend: "800000", minNights: "2", active: "on" })).status, 200);
  const dow = new Date(`${addDays(s1, 3)}T00:00:00Z`).getUTCDay();                 // 금(5)·토(6) 밤은 주말 요금
  assert.equal((await night(addDays(s1, 3))).price, dow === 5 || dow === 6 ? 800000 : 720000);
  assert.equal((await price({ op: "season_save", id: String(sid), name: "여름", dateFrom: s1, dateTo: s2, priceWeekday: "720000", priceWeekend: "800000", minNights: "2" })).status, 200, "체크박스 해제 = 비활성");
  assert.equal((await night(addDays(s1, 3))).rule === "season", false);
  assert.equal((await price({ op: "season_delete", id: String(sid) })).status, 200);
  assert.equal((await price({ op: "season_delete", id: String(sid) })).status, 404);

  const od = addDays(today, 120);
  assert.equal((await price({ op: "override_save", date: od, price: "900000", minNights: "2", memo: "연휴" })).status, 200);
  assert.deepEqual([(await night(od)).price, (await night(od)).rule], [900000, "override"]);
  assert.equal((await price({ op: "override_delete", date: od })).status, 200);
  assert.equal((await night(od)).rule === "override", false);

  const bbq = (await q(`select id from options where code = 'bbq'`))[0].id as number;
  const opt = (o: object) => price({ op: "option_save", id: String(bbq), price: "40000", maxQty: "1", timeSlots: "17:00, 18:00", deadlineDays: "1", deadlineTime: "18:00", ...o });
  assert.equal((await opt({ price: "0", active: "on" })).status, 400, "가격 0원 옵션은 활성화 불가");
  assert.equal((await opt({ active: "on", timeSlots: "7pm" })).status, 400);
  assert.equal((await opt({ active: "on" })).status, 200);
  const ob = (await q(`select price, active, time_slots from options where id = $1`, [bbq]))[0];
  assert.deepEqual([ob.price, ob.active, ob.time_slots], [40000, true, ["17:00", "18:00"]]);
  console.log("10 통과: 요금(빈 칸·음수 거절)·성수기(겹침 409·비활성·삭제)·특정일·옵션 수정이 즉시 요금 계산에 반영");

  // ---------- 11. 환불 규정 · 운영 설정
  const pol = (body: object, tok = OWNER) => call(policyPOST, "/api/admin/policy", body, { token: tok });
  const rules = await q(`select id, tier, day_type, days_before_min, deduct_rate from refund_policies where applies_to = 'room'`);
  const rule = (t: string, d: string, m: number) => rules.find((x) => x.tier === t && x.day_type === d && x.days_before_min === m)!;
  r = await pol({ op: "refund", [`rate_${rule("peak", "weekend", 0).id}`]: "50" });                  // 당일(50) < 1일 전(80) → 거절
  assert.equal(r.status, 400);
  assert.match(r.body.error.message, /줄어들 수 없습니다/);
  assert.equal((await pol({ op: "refund", [`rate_${rule("peak", "weekend", 0).id}`]: "101" })).status, 400);
  assert.equal((await pol({ op: "refund", [`rate_${rule("peak", "weekend", 0).id}`]: "abc" })).status, 400);
  const orig = (await q(`select deduct_rate from refund_policies where id = $1`, [rule("off", "weekday", 0).id]))[0].deduct_rate as number;
  const nv = orig === 25 ? 30 : 25;
  const rateOf = async (bookingId: string) => (await q(`select policy_snapshot from bookings where id = $1`, [bookingId]))[0].policy_snapshot.refund_policies
    .find((x: any) => x.tier === "off" && x.day_type === "weekday" && x.days_before_min === 0).deduct_rate as number;
  const held = await newHold(30, "규정스냅샷");
  r = await pol({ op: "refund", [`rate_${rule("off", "weekday", 0).id}`]: String(nv) });
  assert.equal(r.body.changed, 1);
  const held2 = await newHold(31, "새규정");
  assert.deepEqual([await rateOf(held.bookingId), await rateOf(held2.bookingId)], [orig, nv], "기존 예약은 예약 당시 공제율 유지, 새 예약만 새 값");

  assert.equal((await pol({ op: "settings", s_hold_minutes: "3" })).status, 400);
  assert.equal((await pol({ op: "settings", s_hold_minutes: "15", s_weekend_days: "fri, sat" })).body.changed, 0, "정리하면 같은 값이므로 변경 없음");
  assert.equal((await pol({ op: "settings", s_hold_minutes: "20", s_weekend_days: "sat, sun" })).body.changed, 2);
  assert.equal((await q(`select value from policy_settings where key = 'weekend_days'`))[0].value, "SAT,SUN", "요일은 대문자·공백 없이 정리되어 저장");
  await pool.query("update policy_settings set value = 'FRI,SAT' where key = 'weekend_days'");
  assert.equal((await pol({ op: "settings", s_max_guests: "3" })).status, 400, "최대 인원 < 기준 인원");
  assert.equal((await pol({ op: "settings", s_check_in_time: "25:00" })).status, 400);
  assert.equal((await pol({ op: "settings", s_secret_key: "x" })).status, 400, "허용 목록에 없는 설정 거절");
  await pool.query("update policy_settings set value = '15' where key = 'hold_minutes'");
  console.log("11 통과: 환불 공제율(0~100, 가까울수록 공제↑) / 운영 설정 검증 / 기존 예약은 예약 당시 규정 유지");

  // ---------- 12. 작업 기록
  const log = await listAudit(pool, 500);
  const actions = new Set(log.map((x: any) => x.action));
  for (const a of ["auth.login", "booking.cancel", "calendar.block", "pricing.base", "pricing.season.create", "pricing.option", "policy.refund", "policy.settings", "refund.retry"]) {
    assert.ok(actions.has(a), `감사 기록 누락: ${a}`);
  }
  const dump = JSON.stringify(log);
  assert.equal(dump.includes("1234567890123"), false, "감사 기록에 계좌번호가 남지 않음");
  assert.equal(dump.includes("owner-pass"), false);
  const sample = log.find((x: any) => x.action === "pricing.base");
  assert.ok(sample.admin_name && sample.before_data && sample.after_data && sample.ip);
  console.log("12 통과: 모든 변경이 누가·언제·전/후 값과 함께 기록되고, 계좌번호·비밀번호는 기록되지 않음");

  console.log("\n전체 통과");
}

async function cleanup() {
  for (const r of originalRates) await pool.query(`update refund_policies set deduct_rate = $2 where id = $1`, [r.id, r.deduct_rate]).catch(() => {});
  await pool.query("update policy_settings set value = 'FRI,SAT' where key = 'weekend_days'; update policy_settings set value = '15' where key = 'hold_minutes'").catch(() => {});
  await pool.query("truncate bookings, stay_dates, payment_events, lookup_attempts, audit_logs, admin_users restart identity cascade").catch(() => {});
  await pool.query("delete from season_periods; delete from date_overrides; update options set price = 0, active = false").catch(() => {});
  await pool.query("update base_prices set price = case day_type when 'weekday' then 600000 else 650000 end").catch(() => {});
  await pool.query("select ensure_stay_dates(current_date, current_date + 400)").catch(() => {});
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await mockRef?.close(); await cleanup(); await pool.end(); });
