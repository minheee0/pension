/**
 * 후기 기능 테스트. 테스트 DB 전용.   npm run test:review
 * (예약 완료 처리, 작성 자격, 검증, 수정·삭제, 공개 목록·요약, 신고, 관리자 처리)
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

process.env.PII_ENC_KEY ??= randomBytes(32).toString("base64");
process.env.PII_HASH_KEY ??= randomBytes(32).toString("base64");
process.env.ADMIN_SESSION_SECRET ??= randomBytes(32).toString("base64");

import { pool } from "../src/server/db";
import { holdStay } from "../src/server/booking/hold";
import { completeFinishedBookings } from "../src/server/booking/complete";
import { encryptText, hmacHex } from "../src/server/crypto";
import { createAdmin, signSession, SESSION_COOKIE } from "../src/server/admin/auth";
import { getDashboard } from "../src/server/admin/dashboard";
import { listPublicReviews, maskName, reviewSummary, validateReview, ReviewError } from "../src/server/reviews/service";
import { POST as statusPOST } from "../src/app/api/reviews/status/route";
import { POST as reviewsPOST } from "../src/app/api/reviews/route";
import { POST as reportPOST } from "../src/app/api/reviews/report/route";
import { POST as adminReviewsPOST } from "../src/app/api/admin/reviews/route";

if (process.env.ALLOW_TRUNCATE !== "1") { console.error("테스트 DB 전용입니다. ALLOW_TRUNCATE=1 을 지정하세요."); process.exit(1); }

const ORIGIN = "http://localhost";
const addDays = (b: string, n: number) => { const d = new Date(`${b}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
let ipSeq = 0;
const nextIp = () => `10.7.${Math.floor(++ipSeq / 200)}.${ipSeq % 200}`;
type H = (r: Request) => Promise<Response>;
async function call(h: H, path: string, body: unknown, o: { token?: string; ip?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": o.ip ?? nextIp(), origin: ORIGIN };
  if (o.token) headers.cookie = `${SESSION_COOKIE}=${o.token}`;
  const r = await h(new Request(`${ORIGIN}${path}`, { method: "POST", headers, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() as any };
}
const q = async <T = any>(sql: string, a: unknown[] = []) => (await pool.query(sql, a)).rows as T[];

async function main() {
  await pool.query("truncate bookings, stay_dates, lookup_attempts, audit_logs, admin_users restart identity cascade");
  await pool.query("update policy_settings set value = '12:00' where key = 'check_out_time'");
  await pool.query("update policy_settings set value = '30' where key = 'member_review_days'");
  await pool.query("select ensure_stay_dates(current_date, current_date + 400)");
  const today = (await q(`select (now() at time zone 'Asia/Seoul')::date::text as d`))[0].d as string;
  let slot = 10;

  /** 손님 예약 1건을 만든다. 상태와 체크아웃을 원하는 값으로 맞춘다 (checkoutOffset: 오늘 기준 일수, 음수 = 과거) */
  async function booking(name: string, status: string, checkoutOffset: number, phone = "01012345678") {
    const h = await holdStay(pool, {
      checkIn: addDays(today, slot), checkOut: addDays(today, slot + 1), guests: 2,
      guest: { name, phoneEnc: encryptText(phone), phoneHash: hmacHex(phone), phoneLast4: phone.slice(-4) }, agreedTerms: true });
    slot += 2;
    await pool.query(`update bookings set status = $2, check_in = $3::date, check_out = $4::date, hold_expires_at = null where id = $1`,
      [h.bookingId, status, addDays(today, checkoutOffset - 1), addDays(today, checkoutOffset)]);
    return { id: h.bookingId, no: h.bookingNo, phone };
  }
  const state = async (b: { no: string; phone: string }, phone = b.phone) => call(statusPOST, "/api/reviews/status", { bookingNo: b.no, phone });
  const write = (op: string, b: { no: string; phone: string }, extra: object = {}) =>
    call(reviewsPOST, "/api/reviews", { op, bookingNo: b.no, phone: b.phone, ...extra });
  const good = { rating: 5, details: { cleanliness: 5, facilities: 4, location: 5, atmosphere: 5, service: 5 }, content: "한옥에서 정말 편안하게 쉬었습니다. 마당이 좋아요." };

  // ---------- 1. 이름 마스킹 · 입력 검증
  assert.deepEqual(["홍길동", "김철", "남궁민수", "A", "Lee Min"].map(maskName), ["홍*동", "김*", "남**수", "A*", "L*****n"]);
  const bad = (i: object, re: RegExp) => assert.throws(() => validateReview(i as any), (e: any) => e instanceof ReviewError && re.test(e.message));
  bad({ rating: 0, content: "열 글자 이상의 후기입니다." }, /별점/);
  bad({ rating: 6, content: "열 글자 이상의 후기입니다." }, /별점/);
  bad({ rating: 5, content: "짧아요" }, /10자/);
  bad({ rating: 5, content: "좋았어요 https://example.com 가보세요" }, /링크/);
  bad({ rating: 5, content: "좋았어요 www.spam.kr 방문하세요 꼭" }, /링크/);
  bad({ rating: 5, content: "연락주세요 010-1234-5678 입니다" }, /전화번호/);
  bad({ rating: 5, content: "문의는 hello@spam.com 으로 해주세요" }, /이메일/);
  bad({ rating: 5, details: { cleanliness: 9 }, content: "열 글자 이상의 후기입니다." }, /청결/);
  const v = validateReview({ rating: "4", details: { cleanliness: "5", hack: 1 }, content: "  멋진 한옥\u0000이었\u0007어요 정말로   \n\n\n\n좋았습니다  " });
  assert.equal(v.rating, 4);
  assert.deepEqual(v.details, { cleanliness: 5 }, "알 수 없는 항목은 버림");
  assert.equal(v.content, "멋진 한옥이었어요 정말로   \n\n좋았습니다", "제어문자 제거·여백 정리");
  console.log("1 통과: 이름 마스킹, 별점·길이·링크·전화번호·이메일 검증, 입력 정리");

  // ---------- 2. 이용 완료 처리
  const fin = await booking("완료대상", "confirmed", -1);              // 어제 체크아웃
  const tomorrow = await booking("미래", "confirmed", 1);              // 내일 체크아웃
  const todayLate = await booking("오늘늦은퇴실", "confirmed", 0);       // 오늘 체크아웃
  await pool.query(`update policy_settings set value = '23:59' where key = 'check_out_time'`);
  const n1 = await completeFinishedBookings(pool);
  const st = async (id: string) => (await q(`select status from bookings where id = $1`, [id]))[0].status;
  assert.equal(await st(fin.id), "completed");
  assert.equal(await st(tomorrow.id), "confirmed");
  assert.equal(await st(todayLate.id), "confirmed", "체크아웃 시각(23:59 가정)이 안 지났으면 아직 이용 중");
  await pool.query(`update policy_settings set value = '00:00' where key = 'check_out_time'`);
  await completeFinishedBookings(pool);
  assert.equal(await st(todayLate.id), "completed", "체크아웃 시각이 지나면 완료");
  assert.equal(n1, 1);
  assert.equal(await completeFinishedBookings(pool), 0, "다시 실행해도 변화 없음");
  await pool.query(`update policy_settings set value = '12:00' where key = 'check_out_time'`);
  console.log("2 통과: 체크아웃 시각이 지난 예약만 이용 완료로 변경(멱등)");

  // ---------- 3. 작성 자격
  const A = await booking("홍길동", "completed", -3);
  const C = await booking("취소됨", "cancelled", -3);
  const E = await booking("기간지남", "completed", -45);
  const F = await booking("미이용", "confirmed", 5);
  assert.equal((await state(A)).body.state, "eligible");
  assert.equal((await state(C)).body.state, "unavailable");
  assert.equal((await state(E)).body.state, "expired");
  assert.equal((await state(F)).body.state, "not_yet");
  const eligibleResp = (await state(A)).body;
  assert.equal(eligibleResp.windowEndsAt, addDays(addDays(today, -3), 30));
  const wrong = await call(statusPOST, "/api/reviews/status", { bookingNo: A.no, phone: "01099998888" });
  assert.equal(wrong.status, 404, "전화번호가 다르면 확인 불가");
  assert.equal((await write("create", E, good)).status, 409);
  assert.equal((await write("create", F, good)).status, 409);
  assert.equal((await write("create", C, good)).status, 409);
  assert.equal((await write("create", A, { ...good, content: "짧음" })).status, 400);
  console.log("3 통과: 작성 가능(이용 완료·기간 내) / 이용 전 / 기간 지남 / 취소 예약 / 타인 번호");

  // ---------- 4. 작성 · 중복 · 수정 · 삭제
  let r = await write("create", A, good);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const rv = (await q(`select * from reviews where booking_id = $1`, [A.id]))[0];
  assert.equal(rv.author_name, "홍*동", "실명이 아니라 마스킹된 이름 저장");
  assert.equal(rv.status, "visible");
  assert.equal(rv.rating_details.facilities, 4);
  assert.equal((await write("create", A, good)).status, 409, "1예약 1후기");
  let s = (await state(A)).body;
  assert.equal(s.state, "written");
  assert.equal(s.review.editable, true);
  r = await write("update", A, { rating: 4, details: { cleanliness: 4 }, content: "다시 생각해 보니 조금 아쉬운 점도 있었습니다." });
  assert.equal(r.status, 200);
  assert.equal((await q(`select rating, content from reviews where id = $1`, [rv.id]))[0].rating, 4);
  await pool.query(`update reviews set created_at = now() - interval '8 days' where id = $1`, [rv.id]);
  assert.equal((await write("update", A, good)).status, 409, "작성 7일 후에는 수정 불가");
  s = (await state(A)).body;
  assert.equal(s.review.editable, false);
  assert.equal(s.review.deletable, true);
  assert.equal((await write("delete", A)).status, 200);
  assert.equal((await q(`select count(*)::int as n from reviews`))[0].n, 0);
  assert.equal((await write("delete", A)).status, 404);
  assert.equal((await write("create", A, good)).status, 200, "삭제하면 기간 안에서 다시 작성 가능");
  console.log("4 통과: 작성, 마스킹 저장, 1예약 1후기, 7일 내 수정, 삭제 후 재작성");

  // ---------- 5. 공개 목록 · 요약
  const B2 = await booking("김철수", "completed", -2, "01022223333");
  const B3 = await booking("이영희", "completed", -2, "01033334444");
  await write("create", B2, { rating: 5, details: { cleanliness: 5, service: 4 }, content: "마당이 넓고 조용해서 아이들이 좋아했어요." });
  await write("create", B3, { rating: 4, content: "온돌방이 따뜻했고 바비큐도 맛있었습니다." });
  let sum = await reviewSummary(pool);
  assert.equal(sum.count, 3);
  assert.equal(sum.average, 4.7, "(5+5+4)/3 = 4.67 → 4.7");
  assert.deepEqual(sum.distribution, { 5: 2, 4: 1, 3: 0, 2: 0, 1: 0 });
  const avgOf = (k: string) => sum.details.find((d) => d.key === k)!.average;
  assert.equal(avgOf("cleanliness"), 5, "홍길동 5 + 김철수 5");
  assert.equal(avgOf("service"), 4.5, "홍길동 5 + 김철수 4 → 4.5");
  assert.equal(avgOf("facilities"), 4, "응답한 사람(홍길동 4)만으로 계산");
  assert.equal(avgOf("atmosphere"), 5);
  await pool.query(`update reviews set rating_details = rating_details - 'atmosphere'`);      // 아무도 응답하지 않은 항목
  assert.ok(!(await reviewSummary(pool)).details.find((d) => d.key === "atmosphere"), "응답이 없는 항목은 평균 표에서 제외");
  const list = await listPublicReviews(pool);
  assert.equal(list.length, 3);
  assert.deepEqual(list.map((x) => x.author).sort(), ["김*수", "이*희", "홍*동"].sort());
  assert.match(list[0].stay, /^\d{4}\.\d{2}$/);
  assert.equal(JSON.stringify(list).includes("01022223333"), false);
  assert.equal((await listPublicReviews(pool, { pageSize: 2 })).length, 2);
  assert.equal((await listPublicReviews(pool, { pageSize: 2, page: 1 })).length, 1);
  console.log("5 통과: 평균·분포·항목별 평균, 마스킹된 이름, 페이지 나누기");

  // ---------- 6. 신고
  const target = list.find((x) => x.author === "이*희")!;
  const report = (body: object, ip = nextIp()) => call(reportPOST, "/api/reviews/report", body, { ip });
  assert.equal((await report({ reviewId: target.id, reason: "nonsense" })).status, 400);
  assert.equal((await report({ reviewId: 999999, reason: "abuse" })).status, 404);
  const ipA = "203.0.113.5";
  assert.equal((await report({ reviewId: target.id, reason: "abuse", detail: "욕설이 있어요" }, ipA)).body.duplicate, false);
  assert.equal((await report({ reviewId: target.id, reason: "abuse" }, ipA)).body.duplicate, true, "같은 IP 중복 신고는 한 번만");
  assert.equal((await report({ reviewId: target.id, reason: "spam" }, "203.0.113.6")).body.duplicate, false);
  assert.equal((await q(`select count(*)::int as n from review_reports where review_id = $1`, [target.id]))[0].n, 2);
  assert.equal((await q(`select status from reviews where id = $1`, [target.id]))[0].status, "reported");
  assert.equal((await listPublicReviews(pool)).length, 3, "신고만으로 숨겨지지 않는다");
  console.log("5b 통과: 신고 사유 검증, IP별 중복 방지, 신고돼도 자동으로 숨겨지지 않음");

  // ---------- 7. 관리자 처리
  const ownerId = await createAdmin(pool, { email: "owner@example.com", name: "사장님", password: "owner-pass-1234", role: "owner" });
  const staffId = await createAdmin(pool, { email: "staff@example.com", name: "직원", password: "staff-pass-1234", role: "staff" });
  const tok = async (id: number) => signSession(id, (await q(`select password_hash from admin_users where id = $1`, [id]))[0].password_hash);
  const OWNER = await tok(ownerId), STAFF = await tok(staffId);
  const adm = (body: object, token = OWNER) => call(adminReviewsPOST, "/api/admin/reviews", body, { token });

  assert.equal((await adm({ op: "hide", id: target.id, reason: "욕설" }, STAFF)).status, 403, "직원은 처리 불가");
  assert.equal((await adm({ op: "hide", id: target.id, reason: "욕설" }, "")).status, 401);
  assert.equal((await adm({ op: "hide", id: target.id, reason: "" })).status, 400, "숨김 사유 필수");
  assert.equal((await adm({ op: "reply", id: target.id, content: "" })).status, 400);
  assert.equal((await adm({ op: "reply", id: target.id, content: "소중한 후기 감사합니다. 또 방문해 주세요." })).status, 200);
  assert.equal((await listPublicReviews(pool)).find((x) => x.id === target.id)!.reply, "소중한 후기 감사합니다. 또 방문해 주세요.", "답글이 공개 화면에 표시");
  assert.equal((await adm({ op: "reply", id: target.id, content: "수정한 답글입니다 감사합니다" })).status, 200);
  assert.equal((await q(`select count(*)::int as n from review_replies where review_id = $1`, [target.id]))[0].n, 1, "답글은 후기당 1개");

  assert.equal((await adm({ op: "hide", id: target.id, reason: "욕설 포함" })).status, 200);
  assert.equal((await listPublicReviews(pool)).length, 2, "숨기면 공개 목록에서 사라짐");
  sum = await reviewSummary(pool);
  assert.equal(sum.count, 2);
  assert.equal(sum.average, 5, "숨긴 4점 후기가 평균에서 빠져 남은 (5+5)/2 = 5.0 (숨기기 전에는 4.7)");
  assert.deepEqual(sum.distribution, { 5: 2, 4: 0, 3: 0, 2: 0, 1: 0 });
  assert.equal((await report({ reviewId: target.id, reason: "abuse" })).status, 404, "숨긴 후기는 신고 대상 아님");
  assert.equal((await write("update", B3, good)).status, 409, "숨겨진 후기는 손님이 수정할 수 없다");
  assert.equal((await write("delete", B3)).status, 409, "삭제도 불가(증거 보존)");
  assert.equal((await adm({ op: "reply", id: target.id, content: "숨긴 후기 답글" })).status, 409);
  assert.equal((await state(B3)).body.review.deletable, false);

  assert.equal((await adm({ op: "restore", id: target.id })).status, 200);
  assert.equal((await q(`select status from reviews where id = $1`, [target.id]))[0].status, "reported", "신고가 남아 있으면 복구 후에도 검토 대상");
  assert.equal((await adm({ op: "restore", id: target.id })).status, 409, "숨김 상태가 아니면 복구 불가");
  const dash = await getDashboard(pool);
  assert.equal(dash.reviewsReported, 1);
  assert.equal(dash.reviewsNeedReply, 2, "답글 없는 공개 후기 2건");
  assert.equal((await adm({ op: "dismiss", id: target.id })).status, 200);
  assert.deepEqual((await q(`select r.status, (select count(*)::int from review_reports x where x.review_id = r.id) as n from reviews r where id = $1`, [target.id]))[0], { status: "visible", n: 0 });
  assert.equal((await adm({ op: "reply_delete", id: target.id })).status, 200);
  assert.equal((await adm({ op: "reply_delete", id: target.id })).status, 404);

  assert.equal((await adm({ op: "delete", id: target.id, reason: "" })).status, 400, "삭제 사유 필수");
  assert.equal((await adm({ op: "delete", id: target.id, reason: "손님 요청" })).status, 200);
  assert.equal((await q(`select count(*)::int as n from reviews where id = $1`, [target.id]))[0].n, 0);
  assert.equal((await adm({ op: "delete", id: target.id, reason: "중복 삭제" })).status, 404);
  console.log("7 통과: 답글(후기당 1개)·숨김(공개·평균에서 제외, 손님 수정·삭제 잠금)·복구·신고 기각·영구 삭제, 직원 403");

  // ---------- 8. 작업 기록 · DB 안전장치
  const log = await q(`select action, before_data, after_data from audit_logs order by id`);
  const actions = new Set(log.map((x) => x.action));
  for (const a of ["review.reply.create", "review.reply.update", "review.hide", "review.restore", "review.dismiss_reports", "review.reply.delete", "review.delete"]) assert.ok(actions.has(a), `기록 누락: ${a}`);
  const hideLog = log.find((x) => x.action === "review.hide")!;
  assert.equal(hideLog.after_data.reason, "욕설 포함");
  assert.ok(JSON.stringify(log).length > 0 && !JSON.stringify(log).includes("01033334444"));
  await assert.rejects(pool.query(`insert into reviews (booking_id, author_name, rating, content) values ($1, 'x*', 5, '이용 전 예약에 억지로 후기 넣기')`, [F.id]), /completed/, "DB가 이용 완료 아닌 예약의 후기를 거부");
  console.log("8 통과: 모든 처리가 작업 기록에 남고, DB도 이용 완료 전 후기를 막는다");

  console.log("\n전체 통과");
}

async function cleanup() {
  await pool.query("truncate bookings, stay_dates, lookup_attempts, audit_logs, admin_users restart identity cascade").catch(() => {});
  await pool.query("update policy_settings set value = '12:00' where key = 'check_out_time'; update policy_settings set value = '30' where key = 'member_review_days'").catch(() => {});
  await pool.query("select ensure_stay_dates(current_date, current_date + 400)").catch(() => {});
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await cleanup(); await pool.end(); });
