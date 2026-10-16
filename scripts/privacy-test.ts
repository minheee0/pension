/**
 * 개인정보 파기·동의 기록 테스트. 테스트 DB 전용.   npm run test:privacy
 * 보유기간이 지난 개인정보만 지워지고, 지워지면 안 되는 것(진행 중 예약, 기간 안의 기록)은 남는지 확인한다.
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
import { getBookingDetail } from "../src/server/admin/bookings";
import { verifyBooking } from "../src/server/booking/lookup";
import { purgePersonalData } from "../src/server/privacy/purge";
import { cleanupNotifications } from "../src/server/notify/send";
import { listPublicReviews } from "../src/server/reviews/service";
import { LEGAL, RETENTION, isPlaceholder, unresolvedPlaceholders } from "../src/lib/legal";
import { POST as cronPOST } from "../src/app/api/cron/run/route";

if (process.env.ALLOW_TRUNCATE !== "1") { console.error("테스트 DB 전용입니다. ALLOW_TRUNCATE=1 을 지정하세요."); process.exit(1); }

const PHONE = "01012345678";
const addDays = (b: string, n: number) => { const d = new Date(`${b}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const q = async (sql: string, a: unknown[] = []) => (await pool.query(sql, a)).rows;
const YEAR = 365;

async function main() {
  await pool.query("truncate bookings, stay_dates, payment_events, audit_logs, admin_users, lookup_attempts, notifications restart identity cascade");
  await pool.query("select ensure_stay_dates(current_date, current_date + 400)");
  const today = (await q(`select (now() at time zone 'Asia/Seoul')::date::text as d`))[0].d as string;
  let slot = 5, seq = 0;

  /** 예약 1건을 원하는 상태·나이로 만든다. 날짜는 '오늘로부터 며칠 전'으로 지정한다. */
  async function mk(name: string, o: { status: string; createdDaysAgo?: number; checkOutDaysAgo?: number; cancelledDaysAgo?: number; paid?: boolean; paymentStatus?: string }) {
    const h = await holdStay(pool, {
      checkIn: addDays(today, slot), checkOut: addDays(today, slot + 1), guests: 2,
      guest: { name, phoneEnc: encryptText(PHONE), phoneHash: hmacHex(PHONE), phoneLast4: PHONE.slice(-4), email: `${seq}@example.com` }, memo: "요청사항 메모", agreedTerms: true });
    slot += 2; seq++;
    const outAgo = o.checkOutDaysAgo ?? -30;
    await pool.query(
      `update bookings set status = $2, created_at = now() - make_interval(days => $3::int),
              check_in = $4::date, check_out = $5::date, hold_expires_at = null,
              cancelled_at = case when $6::int is null then null else now() - make_interval(days => $6::int) end
        where id = $1`,
      [h.bookingId, o.status, o.createdDaysAgo ?? 100, addDays(today, -outAgo - 1), addDays(today, -outAgo), o.cancelledDaysAgo ?? null]);
    const pay = (await pool.query(
      `insert into payments (booking_id, pg_provider, pg_order_id, pg_payment_key, method, amount, status, paid_at, raw_response, virtual_account)
       values ($1, 'toss', $2, $3, 'card', 100000, $4, $5, $6::jsonb, $7::jsonb) returning id`,
      [h.bookingId, `ORD-${seq}`, `KEY-${seq}`, o.paymentStatus ?? (o.paid ? "paid" : "expired"),
       o.paid ? `${addDays(today, -outAgo - 3)}T00:00:00+09:00` : null,
       JSON.stringify({ card: { number: "1234-56**-****-7890", issuerCode: "11" }, receipt: { url: "https://receipt.example/x" } }),
       JSON.stringify({ accountNumber: "X123456789", holderName: "예금주" })])).rows[0].id;
    await pool.query(`insert into refunds (booking_id, payment_id, amount, status, refund_account_enc) values ($1, $2, 0, 'manual_needed', $3)`, [h.bookingId, pay, encryptText("{\"account\":\"x\"}")]);
    if (o.paid) await pool.query(`insert into cash_receipts (payment_id, type, identifier_enc, receipt_no, status) values ($1, 'income', $2, 'RN-1', 'issued')`, [pay, encryptText("-")]);
    return { ...h, name };
  }

  // ---------- 0. 스키마 · 동의 버전 기록
  const stamp = await holdStay(pool, { checkIn: addDays(today, 300), checkOut: addDays(today, 301), guests: 2,
    guest: { name: "동의기록", phoneEnc: encryptText(PHONE), phoneHash: hmacHex(PHONE), phoneLast4: "5678" }, agreedTerms: true });
  const sv = (await q(`select terms_version, privacy_version, agreed_terms_at, anonymized_at from bookings where id = $1`, [stamp.bookingId]))[0];
  assert.deepEqual([sv.terms_version, sv.privacy_version, sv.anonymized_at], [LEGAL.termsVersion, LEGAL.privacyVersion, null], "예약에 동의 시점의 약관·방침 버전이 기록됨");
  assert.ok(sv.agreed_terms_at);
  assert.deepEqual(Object.values(RETENTION).every((n) => Number.isInteger(n) && n > 0), true);
  assert.ok(isPlaceholder("(주소 입력 필요)") && isPlaceholder("(대표자명)") && !isPlaceholder("서울시 종로구 1") && !isPlaceholder("010-1234-5678"));
  console.log("0 통과: 예약에 약관·방침 버전 기록, 보유기간 상수, 자리표시자 판별");

  // ---------- 1. 데이터 준비
  const D = (years: number, extra = 0) => years * YEAR + extra;
  const oldPaid        = await mk("오래된완료", { status: "completed", paid: true, checkOutDaysAgo: D(5, 40), createdDaysAgo: D(5, 60) });   // 5년 40일 전 → 파기
  const oldConfirmed   = await mk("오래된확정", { status: "confirmed", paid: true, checkOutDaysAgo: D(6) });                                  // 6년 전 → 파기
  const oldCancelPaid  = await mk("오래된취소", { status: "cancelled", paid: true, checkOutDaysAgo: D(6, 50), cancelledDaysAgo: D(6) });     // 취소일 6년 전 → 파기
  const recentPaid     = await mk("4년11개월", { status: "completed", paid: true, checkOutDaysAgo: D(5, -30) });                              // 5년 안 → 유지
  const cancelPaidNew  = await mk("최근취소", { status: "cancelled", paid: true, checkOutDaysAgo: -30, cancelledDaysAgo: 700 });             // 이용일이 미래 → 유지
  const upcoming       = await mk("앞으로이용", { status: "confirmed", paid: true, checkOutDaysAgo: -20 });                                   // 유지
  const unpaidOld      = await mk("미결제만료", { status: "expired", createdDaysAgo: RETENTION.unpaidDays + 10, paymentStatus: "expired" });    // 40일 → 파기
  const unpaidCancel   = await mk("결제전취소", { status: "cancelled", createdDaysAgo: RETENTION.unpaidDays + 5, paymentStatus: "failed" });    // 파기
  const unpaidNew      = await mk("미결제최근", { status: "expired", createdDaysAgo: RETENTION.unpaidDays - 20, paymentStatus: "expired" });    // 10일 → 유지
  const waitingOld     = await mk("입금대기중", { status: "pending_payment", createdDaysAgo: RETENTION.unpaidDays + 10, paymentStatus: "waiting_deposit" });  // 진행 중 → 유지
  await pool.query(`insert into reviews (booking_id, author_name, rating, content) values ($1, '오*된', 5, '아주 오래전에 머물렀던 곳이고 정말 좋았습니다.')`, [oldPaid.bookingId]);
  const logRows = [[RETENTION.accessLogDays + 1], [RETENTION.accessLogDays - 1], [0]];
  for (const [d] of logRows) await pool.query(`insert into lookup_attempts (booking_no, ip, success, created_at) values ('HX', '1.2.3.4', false, now() - make_interval(days => $1::int))`, [d]);
  for (const [i, y] of [[1, RETENTION.paymentEventYears + 1], [2, RETENTION.paymentEventYears - 1]]) await pool.query(`insert into payment_events (provider, event_id, payload, created_at) values ('toss', $1, '{"a":1}'::jsonb, now() - make_interval(days => $2::int))`, [`e${i}`, Number(y) * YEAR]);

  // ---------- 2. 파기 실행
  const snapshot = async (id: string) => (await q(`select booking_no, status, total_amount, check_in::text as ci, check_out::text as co from bookings where id = $1`, [id]))[0];
  const before = { oldPaid: await snapshot(oldPaid.bookingId), unpaidOld: await snapshot(unpaidOld.bookingId) };
  const res = await purgePersonalData(pool);
  assert.deepEqual(res, { unpaidBookings: 2, paidBookings: 3, accessLogs: 1, paymentEvents: 1 });

  const gone = [oldPaid, oldConfirmed, oldCancelPaid, unpaidOld, unpaidCancel];
  for (const b of gone) {
    const r = (await q(`select guest_name, guest_phone_enc, guest_phone_hash, guest_phone_last4, guest_email, request_memo, anonymized_at from bookings where id = $1`, [b.bookingId]))[0];
    assert.equal(r.guest_name, "(삭제됨)", `${b.name}: 이름 삭제`);
    assert.equal(r.guest_phone_enc, "", `${b.name}: 암호화된 연락처 삭제`);
    assert.ok(String(r.guest_phone_hash).startsWith("purged:"), `${b.name}: 조회용 해시 무효화`);
    assert.equal(String(r.guest_phone_last4).trim(), "----");
    assert.equal(r.guest_email, null); assert.equal(r.request_memo, null); assert.ok(r.anonymized_at);
    const p = (await q(`select raw_response, virtual_account from payments where booking_id = $1`, [b.bookingId]))[0];
    assert.deepEqual([p.raw_response, p.virtual_account], [null, null], `${b.name}: 결제사 응답·가상계좌 정보 삭제`);
    assert.equal((await q(`select count(*)::int as n from refunds where booking_id = $1 and refund_account_enc is not null`, [b.bookingId]))[0].n, 0, `${b.name}: 남은 환불 계좌 정보 삭제`);
  }
  const keep = [recentPaid, cancelPaidNew, upcoming, unpaidNew, waitingOld];
  for (const b of keep) {
    const r = (await q(`select guest_name, guest_email, request_memo, anonymized_at, guest_phone_enc from bookings where id = $1`, [b.bookingId]))[0];
    assert.equal(r.guest_name, b.name, `${b.name}: 보유기간 안이거나 진행 중이면 그대로`);
    assert.ok(r.guest_email && r.request_memo && r.guest_phone_enc && r.anonymized_at === null);
    assert.ok((await q(`select raw_response from payments where booking_id = $1`, [b.bookingId]))[0].raw_response, `${b.name}: 결제 기록 유지`);
  }
  // 거래 통계(개인 식별 아님)는 남는다
  assert.deepEqual(await snapshot(oldPaid.bookingId), before.oldPaid, "예약번호·상태·금액·일정은 그대로");
  assert.deepEqual(await snapshot(unpaidOld.bookingId), before.unpaidOld);
  assert.equal((await q(`select count(*)::int as n from booking_nights where booking_id = $1`, [oldPaid.bookingId]))[0].n, 1, "박별 요금(통계)은 남음");
  assert.equal((await q(`select count(*)::int as n from cash_receipts`))[0].n, 6, "현금영수증 발급 기록(식별번호는 저장하지 않음)은 거래기록으로 남음");
  // 로그·이벤트
  assert.equal((await q(`select count(*)::int as n from lookup_attempts`))[0].n, 2, "예약 조회 시도 기록: 보유기간 지난 것만 삭제");
  assert.deepEqual((await q(`select event_id from payment_events order by event_id`)).map((r) => r.event_id), ["e2"], "5년 지난 결제사 통지 원문만 삭제");
  console.log("1·2 통과: 결제 완료 5년 경과/결제 미완료 30일 경과만 파기 — 이름·연락처·이메일·메모·결제사 응답·환불계좌, 진행 중·기간 내 예약은 유지");

  // ---------- 3. 파기 후에도 시스템이 정상 동작
  assert.deepEqual(await purgePersonalData(pool), { unpaidBookings: 0, paidBookings: 0, accessLogs: 0, paymentEvents: 0 }, "다시 실행해도 변화 없음");
  const rv = await listPublicReviews(pool);
  assert.equal(rv.length, 1, "예약 정보가 파기돼도 후기는 가린 이름으로 남음");
  assert.equal(rv[0].author, "오*된");
  const adminId = await createAdmin(pool, { email: "o@x.co", name: "사장님", password: "owner-pass-1234", role: "owner" });
  const detail = await getBookingDetail(pool, { id: adminId, email: "o@x.co", name: "사장님", role: "owner" }, oldPaid.bookingNo);
  assert.deepEqual([detail.booking.guestName, detail.booking.phone, detail.booking.email], ["(삭제됨)", "(파기됨)", null], "관리자 예약 상세가 파기된 예약도 오류 없이 표시");
  await assert.rejects(verifyBooking(pool, oldPaid.bookingNo, PHONE, "9.9.9.9"), "파기된 예약은 전화번호로 조회할 수 없다");
  console.log("3 통과: 재실행 안전, 후기 유지(가린 이름), 관리자 상세 정상, 파기된 예약은 손님 조회 불가");

  // ---------- 4. 알림 기록 보유기간 (방침 표와 같은 값)
  const nrow = (key: string, status: string, days: number) => pool.query(
    `insert into notifications (kind, audience, channel, body, dedupe_key, status, created_at) values ('owner_test', 'owner', 'sms', 'x', $1, $2, now() - make_interval(days => $3::int))`, [key, status, days]);
  await nrow("s-old", "sent", RETENTION.notificationSentDays + 1); await nrow("s-new", "sent", RETENTION.notificationSentDays - 1);
  await nrow("f-old", "failed", RETENTION.notificationFailedDays + 1); await nrow("f-new", "failed", RETENTION.notificationFailedDays - 1);
  await nrow("p-old", "pending", 400);
  assert.equal((await cleanupNotifications(pool)).deleted, 2);
  assert.deepEqual((await q(`select dedupe_key from notifications order by dedupe_key`)).map((r) => r.dedupe_key), ["f-new", "p-old", "s-new"], "대기 중인 알림은 오래돼도 건드리지 않음");
  console.log("4 통과: 알림 기록 — 발송 완료 90일·실패 180일 (방침과 같은 상수)");

  // ---------- 5. 정기 작업 주소에 파기 작업이 포함
  process.env.CRON_SECRET = "cron-secret-value";
  const r = await cronPOST(new Request("http://localhost/api/cron/run", { method: "POST", headers: { authorization: "Bearer cron-secret-value" } }));
  const j: any = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(j.results.personalDataPurged).sort(), ["accessLogs", "paidBookings", "paymentEvents", "unpaidBookings"]);
  assert.ok(!j.results.personalDataPurged.error);
  assert.ok(isNaN(Number(unresolvedPlaceholders().length)) === false && unresolvedPlaceholders().length > 0, "기본 상태에서는 채워야 할 자리표시자가 목록으로 나옴");
  console.log("5 통과: 정기 작업(/api/cron/run)에 개인정보 파기 포함, 미입력 항목 목록");

  console.log("\n전체 통과");
}

async function cleanup() {
  await pool.query("truncate bookings, stay_dates, payment_events, audit_logs, admin_users, lookup_attempts, notifications restart identity cascade").catch(() => {});
  await pool.query("select ensure_stay_dates(current_date, current_date + 400)").catch(() => {});
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await cleanup(); await pool.end(); });
