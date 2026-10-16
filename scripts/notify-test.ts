/**
 * 알림 테스트. 테스트 DB 전용.   npm run test:notify
 * 문구 / 솔라피 서명·요청 / 실제 SMTP 통신 / 재시도·중복 방지 / 결제·취소 흐름 연결 / 정기 알림 / 정기 작업 주소 / 관리자 / 장애 격리
 */
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";

process.env.PII_ENC_KEY ??= randomBytes(32).toString("base64");
process.env.PII_HASH_KEY ??= randomBytes(32).toString("base64");
process.env.ADMIN_SESSION_SECRET ??= randomBytes(32).toString("base64");

import { pool } from "../src/server/db";
import { holdStay } from "../src/server/booking/hold";
import { encryptText, hmacHex } from "../src/server/crypto";
import { createAdmin, signSession, SESSION_COOKIE } from "../src/server/admin/auth";
import { getDashboard } from "../src/server/admin/dashboard";
import { adminCancelBooking } from "../src/server/admin/bookings";
import { cancelBooking, retryPendingRefunds } from "../src/server/booking/cancel";
import { reconcileWaitingDeposits } from "../src/server/payments/service";
import { notify } from "../src/server/notify/enqueue";
import { render, md, type Kind } from "../src/server/notify/templates";
import { cleanupNotifications, sendDue, MAX_ATTEMPTS } from "../src/server/notify/send";
import { scheduleReminders } from "../src/server/notify/schedule";
import { notifyMode } from "../src/server/notify/mode";
import { createSolapiProvider, solapiAuthHeader } from "../src/server/notify/providers/solapi";
import { createSmtpProvider } from "../src/server/notify/providers/smtp";
import { providersFromEnv } from "../src/server/notify/providers";
import { ProviderError, type Providers } from "../src/server/notify/types";
import { configStatus } from "../src/server/admin/notifications";
import { POST as preparePOST } from "../src/app/api/payments/prepare/route";
import { POST as confirmPOST } from "../src/app/api/payments/confirm/route";
import { POST as webhookPOST } from "../src/app/api/webhooks/toss/route";
import { POST as adminNotifPOST } from "../src/app/api/admin/notifications/route";
import { GET as cronGET, POST as cronPOST } from "../src/app/api/cron/run/route";
import { createReview } from "../src/server/reviews/service";
import { startMockToss } from "./mock-toss";

if (process.env.ALLOW_TRUNCATE !== "1") { console.error("테스트 DB 전용입니다. ALLOW_TRUNCATE=1 을 지정하세요."); process.exit(1); }

const ORIGIN = "http://localhost";
const PHONE = "01012345678";
const addDays = (b: string, n: number) => { const d = new Date(`${b}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
let ip = 0;
const nextIp = () => `10.10.${Math.floor(++ip / 200)}.${ip % 200}`;
const q = async (sql: string, a: unknown[] = []) => (await pool.query(sql, a)).rows;
const quiet = async <T>(fn: () => Promise<T>) => { const l = console.log, e = console.error, w = console.warn; console.log = console.error = console.warn = () => {}; try { return await fn(); } finally { console.log = l; console.error = e; console.warn = w; } };
const postJson = (h: (r: Request) => Promise<Response>, body: unknown, extra: Record<string, string> = {}) =>
  h(new Request(`${ORIGIN}/api/x`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": nextIp(), origin: ORIGIN, ...extra }, body: JSON.stringify(body) }));

// ---- 테스트용 가짜 서버들 -----------------------------------------------------------------
async function startMockSolapi(secret: string) {
  const state = { mode: "ok" as "ok" | "auth" | "rate" | "down", calls: [] as { auth: string; body: any }[] };
  const server = http.createServer((req, res) => {
    let raw = ""; req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const auth = String(req.headers.authorization ?? ""); const body = raw ? JSON.parse(raw) : {};
      state.calls.push({ auth, body });
      const send = (code: number, j: object) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
      const m = auth.match(/^HMAC-SHA256 apiKey=(\S+), date=(\S+), salt=(\S+), signature=([0-9a-f]+)$/);
      if (!m || req.method !== "POST" || req.url !== "/messages/v4/send") return send(401, { errorCode: "InvalidAuth", errorMessage: "bad header" });
      const expected = createHmac("sha256", secret).update(m[2] + m[3]).digest("hex");
      if (expected !== m[4] || state.mode === "auth") return send(401, { errorCode: "SignatureDoesNotMatch", errorMessage: "서명이 올바르지 않습니다" });
      if (state.mode === "rate") return send(429, { errorCode: "TooManyRequests", errorMessage: "slow down" });
      if (state.mode === "down") return send(503, { errorMessage: "maintenance" });
      send(200, { groupId: "G4V20260101000000TESTGROUP", messageId: "M1" });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, state, close: () => new Promise<void>((r) => server.close(() => r())) };
}

/** 최소한의 SMTP 서버: 실제 SMTP 대화(EHLO/MAIL/RCPT/DATA)를 받아 메시지를 저장한다 */
async function startFakeSmtp(opts: { rejectRcpt?: boolean } = {}) {
  const messages: { from: string; to: string[]; raw: string }[] = [];
  const server = net.createServer((sock) => {
    let state: "cmd" | "data" = "cmd"; let cur = { from: "", to: [] as string[], raw: "" }; let buf = "";
    sock.write("220 fake ESMTP\r\n");
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      for (;;) {
        if (state === "data") {
          const i = buf.indexOf("\r\n.\r\n"); if (i < 0) break;
          cur.raw = buf.slice(0, i); buf = buf.slice(i + 5); messages.push(cur); cur = { from: "", to: [], raw: "" }; state = "cmd"; sock.write("250 OK queued\r\n"); continue;
        }
        const i = buf.indexOf("\r\n"); if (i < 0) break;
        const line = buf.slice(0, i); buf = buf.slice(i + 2); const up = line.toUpperCase();
        if (up.startsWith("EHLO") || up.startsWith("HELO")) sock.write("250-fake\r\n250 8BITMIME\r\n");
        else if (up.startsWith("MAIL FROM")) { cur.from = line; sock.write("250 OK\r\n"); }
        else if (up.startsWith("RCPT TO")) { if (opts.rejectRcpt) sock.write("550 5.1.1 no such user\r\n"); else { cur.to.push(line); sock.write("250 OK\r\n"); } }
        else if (up === "DATA") { state = "data"; sock.write("354 go ahead\r\n"); }
        else if (up === "QUIT") { sock.write("221 bye\r\n"); sock.end(); }
        else sock.write("250 OK\r\n");
      }
    });
    sock.on("error", () => {});
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { port: (server.address() as AddressInfo).port, messages, close: () => new Promise<void>((r) => server.close(() => r())) };
}
function parseMail(raw: string) {
  const [head, ...rest] = raw.split("\r\n\r\n"); const body = rest.join("\r\n\r\n");
  const h = (name: string) => (head.match(new RegExp(`^${name}:\\s*((?:.|\\r\\n[ \\t])*)`, "im"))?.[1] ?? "").replace(/\r\n[ \t]+/g, " ");
  const mime = (s: string) => s.replace(/(\?=)\s+(=\?UTF-8\?)/gi, "$1$2")                      // 인접한 인코딩 단어 사이의 공백은 무시한다
    .replace(/=\?UTF-8\?([BQ])\?([^?]*)\?=/gi, (_m, enc, t) => enc.toUpperCase() === "B" ? Buffer.from(t, "base64").toString("utf8")
      : Buffer.from(t.replace(/_/g, " ").replace(/=([0-9A-F]{2})/gi, (_x: string, hx: string) => String.fromCharCode(parseInt(hx, 16))), "latin1").toString("utf8"));
  const cte = h("Content-Transfer-Encoding").toLowerCase();
  const text = cte === "base64" ? Buffer.from(body.replace(/\s/g, ""), "base64").toString("utf8")
    : cte === "quoted-printable" ? Buffer.from(body.replace(/=\r\n/g, "").replace(/=([0-9A-F]{2})/gi, (_m, hx) => String.fromCharCode(parseInt(hx, 16))), "latin1").toString("utf8") : body;
  return { subject: mime(h("Subject")), from: mime(h("From")), to: h("To"), text };
}

const closers: (() => Promise<void>)[] = [];
let mockRef: Awaited<ReturnType<typeof startMockToss>> | undefined;
async function main() {
  const mock = await startMockToss("test_sk_mock");
  mockRef = mock;
  Object.assign(process.env, { TOSS_API_BASE: mock.url, TOSS_SECRET_KEY: "test_sk_mock", TOSS_CLIENT_KEY: "test_ck_mock", SITE_URL: "https://manbok.example.kr/" });
  delete process.env.OWNER_PHONE; delete process.env.OWNER_EMAIL; delete process.env.CRON_SECRET; delete process.env.NOTIFY_MODE;
  await pool.query("truncate bookings, stay_dates, payment_events, audit_logs, admin_users, lookup_attempts, notifications restart identity cascade");
  await pool.query("delete from season_periods; delete from date_overrides");
  await pool.query("update base_prices set price = case day_type when 'weekday' then 600000 else 650000 end");
  await pool.query("update policy_settings set value = '' where key = 'checkin_guide'");
  await pool.query("select ensure_stay_dates(current_date, current_date + 400)");
  const today = (await q(`select (now() at time zone 'Asia/Seoul')::date::text as d`))[0].d as string;
  const count = async (where = "true", args: unknown[] = []) => (await q(`select count(*)::int as n from notifications where ${where}`, args))[0].n as number;

  // ---------- 1. 문구
  const base = { bookingNo: "HABCDEFGHIJ", guestName: "홍길동", checkIn: "2026-10-12", checkOut: "2026-10-14", nights: 2, guests: 4, total: 1300000 };
  const kinds: Kind[] = ["booking_confirmed", "deposit_waiting", "deposit_expired", "booking_cancelled", "auto_refunded", "checkin_reminder", "review_request", "owner_new_booking", "owner_cancelled", "owner_refund_failed", "owner_test"];
  for (const k of kinds) {
    const m = render(k, { ...base, account: { bank: "우리은행", number: "X123456", holder: "(주)테스트", dueDate: "2026-10-05T18:30:00" }, refund: { amount: 1170000, deduct: 130000, done: true }, guide: "대문 비밀번호는 입실 당일 안내" });
    assert.ok(m.subject && m.body, k);
    assert.ok(!/undefined|null|NaN/.test(m.subject + m.body), `${k}: 빈 값이 문구에 섞임`);
    assert.ok(m.body.length < 700, `${k}: 너무 긴 문구`);
  }
  const bc = render("booking_confirmed", base).body;
  for (const s of ["HABCDEFGHIJ", "10/12(월)~10/14(수) 2박", "1,300,000원", "https://manbok.example.kr/lookup"]) assert.ok(bc.includes(s), `예약 확정 문구에 '${s}' 없음`);
  assert.ok(!bc.includes("manbok.example.kr//"), "주소 끝 슬래시 중복 없음");
  assert.ok(render("deposit_waiting", { ...base, account: { bank: "우리은행", number: "X123456", dueDate: "2026-10-05T18:30:00" } }).body.includes("10. 5.") || render("deposit_waiting", { ...base, account: { bank: "우리은행", number: "X123456", dueDate: "2026-10-05T18:30:00" } }).body.includes("10/5"), "입금 기한 표시");
  assert.ok(render("checkin_reminder", { ...base, guide: "대문 비밀번호는 입실 당일 안내" }).body.includes("대문 비밀번호는 입실 당일 안내"));
  assert.ok(!render("checkin_reminder", base).body.includes("undefined"));
  assert.ok(render("booking_cancelled", { ...base, refund: { amount: 600000, deduct: 0, done: false } }).body.includes("처리 중"));
  assert.ok(render("booking_cancelled", { ...base, refund: null }).body.includes("환불할 금액이 없습니다"));
  assert.ok(!/010|@/.test(render("owner_new_booking", base).body), "사장님 알림에 손님 전화번호·이메일은 넣지 않는다");
  console.log("1 통과: 모든 알림 문구 — 필요한 정보 포함, 빈 값 없음, 길이, 사이트 주소 정리");

  // ---------- 2. 솔라피 연동
  const sol = await startMockSolapi("s3cret"); closers.push(sol.close);
  const solapi = createSolapiProvider({ apiKey: "KEY123", apiSecret: "s3cret", from: "02-1234-5678", baseUrl: sol.url });
  assert.equal(solapiAuthHeader("K", "S", "2019-07-01T00:41:48Z", "jqsba2jxjnrjor"), `HMAC-SHA256 apiKey=K, date=2019-07-01T00:41:48Z, salt=jqsba2jxjnrjor, signature=${createHmac("sha256", "S").update("2019-07-01T00:41:48Zjqsba2jxjnrjor").digest("hex")}`);
  const ok = await solapi.send({ to: "010-1234-5678", text: "테스트 문자입니다", subject: "[만복] 테스트 제목이 아주 길어서 잘려야 합니다" });
  assert.equal(ok.id, "G4V20260101000000TESTGROUP");
  const call = sol.state.calls.at(-1)!;
  assert.deepEqual(Object.keys(call.body), ["message"]);
  assert.equal(call.body.message.to, "01012345678", "수신 번호는 숫자만");
  assert.equal(call.body.message.from, "0212345678", "발신 번호도 숫자만");
  assert.ok(call.body.message.subject.length <= 20, "제목은 20자 이내로 자름");
  const date = call.auth.match(/date=(\S+),/)![1];
  assert.ok(Math.abs(Date.now() - Date.parse(date)) < 60_000, "서명 시각은 현재 시각(ISO 8601)");
  const salts = new Set([solapiAuthHeader("K", "S").match(/salt=(\S+),/)![1], solapiAuthHeader("K", "S").match(/salt=(\S+),/)![1]]);
  assert.equal(salts.size, 2, "요청마다 다른 salt");
  await assert.rejects(solapi.send({ to: "12345", text: "x" }), (e: any) => e instanceof ProviderError && !e.retryable && !e.message.includes("12345"));
  sol.state.mode = "auth";    await assert.rejects(solapi.send({ to: PHONE, text: "x" }), (e: any) => e instanceof ProviderError && !e.retryable && /SignatureDoesNotMatch/.test(e.message));
  sol.state.mode = "rate";    await assert.rejects(solapi.send({ to: PHONE, text: "x" }), (e: any) => e.retryable === true);
  sol.state.mode = "down";    await assert.rejects(solapi.send({ to: PHONE, text: "x" }), (e: any) => e.retryable === true);
  await assert.rejects(createSolapiProvider({ apiKey: "K", apiSecret: "wrong-secret", from: "0212345678", baseUrl: sol.url }).send({ to: PHONE, text: "x" }), (e: any) => !e.retryable, "비밀키가 다르면 서버가 거절");
  const dead = createSolapiProvider({ apiKey: "K", apiSecret: "S", from: "0212345678", baseUrl: "http://127.0.0.1:1", timeoutMs: 500 });
  await assert.rejects(dead.send({ to: PHONE, text: "x" }), (e: any) => e.retryable === true, "연결 실패는 재시도 대상");
  await sol.close();
  console.log("2 통과: 솔라피 — 서명(HMAC-SHA256)·헤더·본문 형식, 번호 정리, 인증 오류=즉시 실패 / 429·5xx·연결 실패=재시도");

  // ---------- 3. 실제 SMTP 통신
  const smtp = await startFakeSmtp(); closers.push(smtp.close);
  const mail = createSmtpProvider({ url: `smtp://127.0.0.1:${smtp.port}`, from: "만복 <noreply@manbok.example.kr>" });
  const r = await mail.send({ to: "guest@example.com", subject: "[만복] 예약이 확정되었습니다 (HABC)", text: "홍길동님, 예약이 확정되었습니다.\n체크인 16:00" });
  assert.ok(r.id);
  const got = parseMail(smtp.messages[0].raw);
  assert.equal(got.subject, "[만복] 예약이 확정되었습니다 (HABC)");
  assert.ok(got.from.includes("만복") && got.from.includes("noreply@manbok.example.kr"));
  assert.ok(got.to.includes("guest@example.com"));
  assert.equal(got.text.trim(), "홍길동님, 예약이 확정되었습니다.\n체크인 16:00".replace(/\n/g, got.text.includes("\r\n") ? "\r\n" : "\n"));
  assert.ok(smtp.messages[0].from.includes("noreply@manbok.example.kr") && smtp.messages[0].to[0].includes("guest@example.com"), "봉투(MAIL FROM/RCPT TO) 주소");
  await smtp.close();
  const rej = await startFakeSmtp({ rejectRcpt: true }); closers.push(rej.close);
  await assert.rejects(createSmtpProvider({ url: `smtp://127.0.0.1:${rej.port}`, from: "a@b.co" }).send({ to: "nobody@example.com", subject: "x", text: "y" }), (e: any) => e instanceof ProviderError && !e.retryable, "수신 주소 거부(550)는 재시도하지 않음");
  await rej.close();
  await assert.rejects(createSmtpProvider({ url: "smtp://127.0.0.1:1", from: "a@b.co" }).send({ to: "a@b.co", subject: "x", text: "y" }), (e: any) => e instanceof ProviderError && e.retryable, "연결 실패는 재시도");
  console.log("3 통과: 이메일 — 실제 SMTP 대화로 한글 제목·본문·발신자 전달, 주소 거부=즉시 실패, 연결 실패=재시도");

  // ---------- 4. 환경 설정에 따른 발송 업체 선택
  assert.equal(providersFromEnv({ NODE_ENV: "development" } as any).sms?.name, "console");
  const prodNone = providersFromEnv({ NODE_ENV: "production" } as any);
  assert.deepEqual([prodNone.sms, prodNone.email], [null, null], "운영에서 설정이 없으면 콘솔로 위장하지 않고 null");
  assert.equal(providersFromEnv({ NODE_ENV: "production", SMS_PROVIDER: "console" } as any).sms, null, "운영에서 console 지정도 막음");
  assert.equal(providersFromEnv({ NODE_ENV: "production", SMS_PROVIDER: "solapi", SOLAPI_API_KEY: "k", SOLAPI_API_SECRET: "s", SMS_FROM: "0212345678" } as any).sms?.name, "solapi");
  assert.equal(providersFromEnv({ NODE_ENV: "production", SMS_PROVIDER: "solapi", SOLAPI_API_KEY: "k" } as any).sms, null, "필수 값 하나라도 없으면 null");
  assert.equal(providersFromEnv({ NODE_ENV: "production", SMTP_URL: "smtp://x", MAIL_FROM: "a@b.co" } as any).email?.name, "smtp");
  const cs = configStatus({ NODE_ENV: "production", OWNER_PHONE: "01099998888" } as any);
  assert.equal(cs.find((c) => c.key === "sms")!.ok, false);
  assert.equal(cs.find((c) => c.key === "owner_phone")!.ok, true);
  assert.ok(!JSON.stringify(cs).includes("01099998888"), "설정 상태 화면에 번호 전체를 보이지 않음");
  console.log("4 통과: 운영 환경에서 설정이 빠지면 '발송된 척' 하지 않고 실패로 드러남, 비밀값 비노출");

  // ---------- 예약 도우미
  const hold = (offset: number, name = "홍길동", email?: string) => holdStay(pool, {
    checkIn: addDays(today, offset), checkOut: addDays(today, offset + 1), guests: 2,
    guest: { name, phoneEnc: encryptText(PHONE), phoneHash: hmacHex(PHONE), phoneLast4: PHONE.slice(-4), email }, agreedTerms: true });
  const route = async (h: (r: Request) => Promise<Response>, body: unknown) => (await postJson(h, body)).json() as Promise<any>;
  async function paid(offset: number, name?: string, email?: string, method: "CARD" | "VIRTUAL_ACCOUNT" = "CARD") {
    const h = await hold(offset, name, email);
    const p = await route(preparePOST, { bookingNo: h.bookingNo, method });
    const key = mock.createSession(p.orderId, p.amount, { method });
    const c = await route(confirmPOST, { paymentKey: key, orderId: p.orderId, amount: p.amount });
    return { ...h, key, c, total: p.amount as number };
  }

  // ---------- 5. 대기열 등록: 수신자·수단·중복 방지
  const E = await hold(60, "이메일손님", "guest@example.com");
  const N = await hold(62, "문자만");
  await quiet(() => notify(pool, { type: "booking_confirmed", bookingId: N.bookingId }));
  assert.equal(await count("booking_id = $1", [N.bookingId]), 1, "OWNER 연락처가 없으면 손님 문자 1건만 (사장님 알림은 만들지 않고 경고)");
  process.env.OWNER_PHONE = "01099998888"; process.env.OWNER_EMAIL = "owner@example.com";
  await notify(pool, { type: "booking_confirmed", bookingId: E.bookingId });
  const rows = await q(`select audience, channel, kind, recipient_enc is not null as has_to from notifications where booking_id = $1 order by id`, [E.bookingId]);
  assert.deepEqual(rows.map((r) => `${r.audience}/${r.channel}/${r.kind}`).sort(), ["guest/email/booking_confirmed", "guest/sms/booking_confirmed", "owner/email/owner_new_booking", "owner/sms/owner_new_booking"]);
  assert.deepEqual(rows.filter((r) => r.audience === "owner").map((r) => r.has_to), [false, false], "사장님 연락처는 DB에 복사하지 않고 발송할 때 환경변수에서 읽음");
  assert.equal((await q(`select recipient_enc from notifications where booking_id = $1 and channel = 'email' and audience = 'guest'`, [E.bookingId]))[0].recipient_enc.includes("@"), false, "손님 이메일은 암호화 저장");
  await notify(pool, { type: "booking_confirmed", bookingId: E.bookingId });
  await notify(pool, { type: "booking_confirmed", bookingId: E.bookingId });
  assert.equal(await count("booking_id = $1", [E.bookingId]), 4, "같은 이벤트를 여러 번 알려도 알림은 한 번만");
  await quiet(() => notify(pool, { type: "booking_confirmed", bookingId: "00000000-0000-0000-0000-000000000000" }));   // 없는 예약 → 오류를 삼킨다
  console.log("5 통과: 손님 문자(+이메일은 입력한 경우만), 사장님 알림, 연락처 암호화·미복사, 중복 방지, 오류 삼킴");

  // ---------- 6. 발송 엔진: 성공 / 재시도·백오프 / 영구 실패 / 동시 실행
  await pool.query("truncate notifications restart identity");
  const sent: { ch: string; to: string; text: string }[] = [];
  let smsBehavior: "ok" | "retry" | "permanent" = "ok";
  const prov: Providers = {
    sms: { name: "t", async send(m) { if (smsBehavior === "retry") throw new ProviderError("일시 오류", true); if (smsBehavior === "permanent") throw new ProviderError("발신번호 미등록", false); sent.push({ ch: "sms", to: m.to, text: m.text }); return {}; } },
    email: { name: "t", async send(m) { sent.push({ ch: "email", to: m.to, text: m.text }); return {}; } },
  };
  await notify(pool, { type: "booking_confirmed", bookingId: E.bookingId });
  let res = await sendDue(pool, { providers: prov });
  assert.deepEqual([res.claimed, res.sent, res.failed, res.retry], [4, 4, 0, 0]);
  assert.deepEqual(sent.map((s) => `${s.ch}:${s.to}`).sort(), ["email:guest@example.com", "email:owner@example.com", "sms:01012345678", "sms:01099998888"], "손님은 복호화한 연락처로, 사장님은 환경변수 연락처로");
  assert.equal((await sendDue(pool, { providers: prov })).claimed, 0, "이미 보낸 알림은 다시 보내지 않음");

  await pool.query("truncate notifications restart identity");
  await notify(pool, { type: "booking_cancelled", bookingId: N.bookingId, notifyOwner: false, refund: null });
  smsBehavior = "retry";
  const waits: number[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await pool.query("update notifications set scheduled_at = now()");
    await sendDue(pool, { providers: prov });
    const n = (await q(`select status, attempts, last_error, extract(epoch from scheduled_at - now())::int as wait from notifications`))[0];
    assert.equal(n.attempts, attempt);
    if (attempt < MAX_ATTEMPTS) { assert.equal(n.status, "pending"); waits.push(Math.round(n.wait / 60)); } else { assert.equal(n.status, "failed"); assert.match(n.last_error, /일시 오류 → 010\*\*\*\*5678/, "사유에는 마스킹된 연락처만"); }
  }
  assert.deepEqual(waits, [1, 5, 30, 120], "재시도 간격 1분 → 5분 → 30분 → 2시간 후 실패 처리");
  await pool.query("truncate notifications restart identity");
  await notify(pool, { type: "booking_cancelled", bookingId: N.bookingId, notifyOwner: false, refund: null });
  smsBehavior = "permanent";
  await sendDue(pool, { providers: prov });
  assert.deepEqual((await q(`select status, attempts from notifications`))[0], { status: "failed", attempts: 1 }, "영구 오류는 재시도 없이 바로 실패");
  smsBehavior = "ok";

  await pool.query("truncate notifications restart identity");
  for (let i = 0; i < 6; i++) await notify(pool, { type: "booking_confirmed", bookingId: (await hold(200 + i * 2, `동시${i}`)).bookingId });
  const calls: string[] = [];
  const slow: Providers = { sms: { name: "slow", async send(m) { await new Promise((r) => setTimeout(r, 40)); calls.push(m.text); return {}; } }, email: prov.email };
  const [a, b] = await Promise.all([sendDue(pool, { providers: slow, limit: 100 }), sendDue(pool, { providers: slow, limit: 100 })]);
  const smsCount = await count("channel = 'sms'");                       // 손님용 + 사장님용 문자 전체
  assert.equal(calls.length, smsCount, "두 발송 작업이 동시에 돌아도 같은 알림을 두 번 보내지 않음");
  assert.equal(new Set(calls).size, calls.length);
  assert.ok(a.claimed + b.claimed >= smsCount);
  const noCfg = await (async () => { await pool.query("truncate notifications restart identity"); await notify(pool, { type: "booking_cancelled", bookingId: N.bookingId, notifyOwner: false, refund: null }); await sendDue(pool, { providers: { sms: null, email: null } }); return (await q(`select status, last_error from notifications`))[0]; })();
  assert.equal(noCfg.status, "failed");
  assert.match(noCfg.last_error, /발송 설정이 없습니다/);
  // 이메일은 선택 사항: SMTP 가 없으면 손님 이메일은 '건너뜀'(실패 아님), 문자는 정상. 단 사장님 이메일을 설정했는데 SMTP 가 없으면 설정 오류로 '실패'
  await pool.query("truncate notifications restart identity");
  process.env.OWNER_EMAIL = "owner@example.com";
  await notify(pool, { type: "booking_cancelled", bookingId: E.bookingId, notifyOwner: true, refund: null });
  await sendDue(pool, { providers: { sms: prov.sms, email: null } });
  const byKind = Object.fromEntries((await q(`select audience || '/' || channel as k, status, last_error from notifications`)).map((r) => [r.k, r]));
  assert.equal(byKind["guest/sms"].status, "sent");
  assert.equal(byKind["guest/email"].status, "skipped", "SMTP 없이 손님 이메일은 실패가 아니라 건너뜀");
  assert.match(byKind["guest/email"].last_error, /이메일 발송을 사용하지 않음/);
  assert.equal(byKind["owner/email"].status, "failed", "OWNER_EMAIL 을 설정했는데 SMTP 가 없으면 설정 오류로 실패 표시");
  assert.equal((await getDashboard(pool)).notificationsFailed, 1, "건너뜀은 실패 카드에 세지 않음");
  const cfgSmsOnly = configStatus({ NODE_ENV: "production", SMS_PROVIDER: "solapi", SOLAPI_API_KEY: "k", SOLAPI_API_SECRET: "s", SMS_FROM: "0212345678", OWNER_PHONE: "01099998888" } as any);
  assert.ok(cfgSmsOnly.every((c) => c.key === "cron" || c.key === "site_url" || c.ok), "문자만 쓰는 구성은 이메일 때문에 ✗ 가 나오지 않는다");
  delete process.env.OWNER_EMAIL;
  console.log("6 통과: 발송 엔진 — 정상 발송, 재시도 간격(1분/5분/30분/2시간)→실패, 영구 오류 즉시 실패, 동시 실행 중복 없음, 설정 누락=실패 표시");

  // ---------- 7. 결제·취소·환불 흐름 연결
  await pool.query("truncate notifications restart identity");
  process.env.OWNER_PHONE = "01099998888"; delete process.env.OWNER_EMAIL;
  const P = await paid(80, "카드손님", "card@example.com");
  assert.equal(P.c.kind, "confirmed");
  let kindsOf = async (bookingId: string) => (await q(`select audience || '/' || channel || '/' || kind as k from notifications where booking_id = $1 order by id`, [bookingId])).map((r) => r.k as string);
  assert.deepEqual((await kindsOf(P.bookingId)).sort(), ["guest/email/booking_confirmed", "guest/sms/booking_confirmed", "owner/sms/owner_new_booking"]);
  const smsBody = (await q(`select body from notifications where booking_id = $1 and channel = 'sms' and audience = 'guest'`, [P.bookingId]))[0].body as string;
  assert.ok(smsBody.includes(P.bookingNo) && smsBody.includes("카드손님") && smsBody.includes(P.total.toLocaleString("ko-KR")));
  await route(confirmPOST, { paymentKey: P.key, orderId: (await q(`select pg_order_id from payments where booking_id = $1`, [P.bookingId]))[0].pg_order_id, amount: P.total });   // 새로고침(중복 호출)
  assert.equal((await kindsOf(P.bookingId)).length, 3, "결제 확정 화면을 새로고침해도 알림은 늘지 않음");

  const V = await paid(82, "가상계좌손님", undefined, "VIRTUAL_ACCOUNT");
  assert.equal(V.c.kind, "waiting_deposit");
  const dw = (await q(`select body from notifications where booking_id = $1 and kind = 'deposit_waiting'`, [V.bookingId]))[0].body as string;
  assert.ok(dw.includes("우리은행") && dw.includes(V.total.toLocaleString("ko-KR")) && /X\d+/.test(dw) && dw.includes("기한"), "입금 안내 문자에 은행·계좌·금액·기한");
  await postJson(webhookPOST, mock.deposit(V.key));
  assert.ok((await kindsOf(V.bookingId)).includes("guest/sms/booking_confirmed"), "입금 확인되면 예약 확정 안내");

  const X = await paid(84, "취소손님");
  await pool.query("delete from notifications");
  const exp = (await q(`select total_amount from bookings where id = $1`, [X.bookingId]))[0].total_amount as number;
  const cg = await cancelBooking(pool, { bookingNo: X.bookingNo, phone: PHONE, expectedRefund: exp, ip: "9.9.9.9" });
  assert.equal(cg.refund!.done, true);
  assert.deepEqual((await kindsOf(X.bookingId)).sort(), ["guest/sms/booking_cancelled", "owner/sms/owner_cancelled"], "손님이 취소하면 손님과 사장님 모두에게");
  assert.ok((await q(`select body from notifications where kind = 'booking_cancelled'`))[0].body.includes("환불"));

  const Y = await paid(86, "관리자취소");
  await pool.query("delete from notifications");
  const adminId = await createAdmin(pool, { email: "o@x.co", name: "사장님", password: "owner-pass-1234", role: "owner" });
  const adm = { id: adminId, email: "o@x.co", name: "사장님", role: "owner" as const };
  await adminCancelBooking(pool, adm, { bookingNo: Y.bookingNo, mode: "host", expectedRefund: Y.total });
  assert.deepEqual(await kindsOf(Y.bookingId), ["guest/sms/booking_cancelled"], "관리자가 취소하면 손님에게만");
  assert.ok((await q(`select body from notifications where kind = 'booking_cancelled'`))[0].body.includes("사업자 사정"));

  // 환불 실패 → 사장님 경고 (재시도가 또 실패해도 경고는 한 번)
  const F = await paid(88, "환불실패");
  await pool.query("delete from notifications");
  mock.state.cancelFails = true;
  await quiet(() => adminCancelBooking(pool, adm, { bookingNo: F.bookingNo, mode: "host", expectedRefund: F.total }));
  assert.equal(await count("kind = 'owner_refund_failed'"), 1);
  await pool.query("update refunds set requested_at = now() - interval '5 minutes'");
  await quiet(() => retryPendingRefunds(pool)); await quiet(() => retryPendingRefunds(pool));
  assert.equal(await count("kind = 'owner_refund_failed'"), 1, "환불 재시도가 또 실패해도 경고 문자는 한 번만");
  mock.state.cancelFails = false;

  // 결제 중 날짜를 잃어 자동 환불 → 손님 안내
  const L = await hold(90, "자동환불");
  const lp = await route(preparePOST, { bookingNo: L.bookingNo });
  const lkey = mock.createSession(lp.orderId, lp.amount);
  await pool.query(`update stay_dates set held_until = now() - interval '1 minute' where booking_id = $1`, [L.bookingId]);
  await hold(90, "가로챈손님");
  await pool.query("delete from notifications");
  const lr = await route(confirmPOST, { paymentKey: lkey, orderId: lp.orderId, amount: lp.amount });
  assert.equal(lr.kind, "refunded");
  assert.deepEqual(await kindsOf(L.bookingId), ["guest/sms/auto_refunded"]);

  // 가상계좌 기한 만료 → 손님 안내
  const Z = await paid(92, "기한만료", undefined, "VIRTUAL_ACCOUNT");
  await pool.query(`update bookings set hold_expires_at = now() - interval '10 minutes' where id = $1`, [Z.bookingId]);
  mock.setStatus(Z.key, "EXPIRED");
  await pool.query("delete from notifications");
  await reconcileWaitingDeposits(pool);
  assert.deepEqual(await kindsOf(Z.bookingId), ["guest/sms/deposit_expired"]);
  console.log("7 통과: 카드 확정·가상계좌 안내·입금 확정·손님 취소·관리자 취소·환불 실패 경고(1회)·자동 환불·입금 기한 만료 — 각각 올바른 사람에게");

  // ---------- 8. 알림 오류가 결제를 막지 않는다
  await pool.query("alter table notifications rename to notifications_broken");
  const B = await quiet(() => paid(94, "격리테스트"));
  await pool.query("alter table notifications_broken rename to notifications");
  assert.equal(B.c.kind, "confirmed", "알림 테이블이 고장 나도 결제는 정상 확정");
  assert.equal((await q(`select status from bookings where id = $1`, [B.bookingId]))[0].status, "confirmed");
  console.log("8 통과: 알림 저장이 실패해도 결제·예약 확정은 그대로 성공");

  // ---------- 9. 정기 알림 (체크인 전날 / 후기 요청)
  await pool.query("truncate bookings, stay_dates, notifications restart identity cascade");
  await pool.query("select ensure_stay_dates(current_date, current_date + 400)");
  await pool.query(`update policy_settings set value = '대문 비밀번호는 당일 오전 문자로 안내드립니다' where key = 'checkin_guide'`);
  const mk = async (off: number, name: string, status: string, ci: number, co: number, email?: string) => {
    const h = await hold(off, name, email);
    await pool.query(`update bookings set status = $2, check_in = $3::date, check_out = $4::date, hold_expires_at = null where id = $1`, [h.bookingId, status, addDays(today, ci), addDays(today, co)]);
    return h;
  };
  const tomorrow = await mk(100, "내일체크인", "confirmed", 1, 2, "t@example.com");
  const cancelled = await mk(102, "취소됨", "cancelled", 1, 2);
  const later = await mk(104, "모레체크인", "confirmed", 2, 3);
  const doneNoReview = await mk(106, "후기없음", "completed", -3, -1);
  const doneReview = await mk(108, "후기있음", "completed", -3, -1);
  const oldDone = await mk(110, "오래전", "completed", -9, -7);
  const notYet = await mk(112, "아직이용중", "confirmed", -1, 1);
  await createReview(pool, { bookingNo: doneReview.bookingNo, phone: PHONE, ip: "3.3.3.3", rating: 5, content: "정말 좋은 시간을 보냈습니다. 감사합니다." });
  const s1 = await scheduleReminders(pool);
  assert.deepEqual(s1, { checkinReminders: 1, reviewRequests: 1 });
  const s2 = await scheduleReminders(pool);        // 다시 실행해도 알림이 늘지 않아야 한다
  assert.equal(await count("kind = 'checkin_reminder'"), 2, "내일 체크인 손님: 문자 + 이메일 각 1건");
  assert.equal(await count("kind = 'review_request'"), 1);
  assert.equal(await count("booking_id = any($1::uuid[])", [[cancelled.bookingId, later.bookingId, doneReview.bookingId, oldDone.bookingId, notYet.bookingId]]), 0, "취소·모레·후기 작성 완료·3일 지난·이용 중 예약에는 만들지 않음");
  assert.deepEqual(s2, s1);
  const rem = (await q(`select body, scheduled_at from notifications where kind = 'checkin_reminder' and channel = 'sms'`))[0];
  assert.ok(rem.body.includes("대문 비밀번호는 당일 오전 문자로 안내드립니다"), "체크인 안내문 설정이 문자에 덧붙음");
  assert.ok(rem.body.includes(md(addDays(today, 1))));
  const at17 = new Date(`${today}T17:00:00+09:00`).getTime();
  const expectAt = Math.max(Date.now(), at17);
  assert.ok(Math.abs(new Date(rem.scheduled_at).getTime() - expectAt) < 120_000, "체크인 안내는 오늘 17:00(KST) 이후에 발송 (이미 지났다면 즉시)");
  const rq = (await q(`select scheduled_at from notifications where kind = 'review_request'`))[0];
  const at12 = new Date(`${today}T12:00:00+09:00`).getTime();
  assert.ok(Math.abs(new Date(rq.scheduled_at).getTime() - Math.max(Date.now(), at12)) < 120_000, "후기 요청은 12:00(KST) 이후");
  await pool.query("update policy_settings set value = '' where key = 'checkin_guide'");
  console.log("9 통과: 체크인 전날 안내·후기 요청 — 대상 선별(취소·이미 후기·기간 밖 제외), 중복 없음, 안내문 설정, 발송 시각");

  // ---------- 10. 정기 작업 주소
  const cron = (m: "GET" | "POST", auth?: string) => (m === "GET" ? cronGET : cronPOST)(new Request(`${ORIGIN}/api/cron/run`, { method: m, headers: auth ? { authorization: auth } : {} }));
  assert.equal((await cron("POST")).status, 503, "CRON_SECRET 이 없으면 꺼져 있음");
  process.env.CRON_SECRET = "cron-secret-value"; process.env.SMS_PROVIDER = "console";
  assert.equal((await cron("POST")).status, 401);
  assert.equal((await cron("POST", "Bearer wrong")).status, 401);
  assert.equal((await cron("GET", "cron-secret-value")).status, 401, "Bearer 형식이 아니면 거절");
  const cr = await quiet(async () => cron("GET", "Bearer cron-secret-value"));
  assert.equal(cr.status, 200);
  const cj: any = await cr.json();
  assert.deepEqual(Object.keys(cj.results), ["bookingsCompleted", "holdsReleased", "depositsReconciled", "refundsRetried", "remindersScheduled", "notificationsSent", "notificationsCleaned", "personalDataPurged"]);
  assert.ok(Object.values(cj.results).every((v: any) => !v?.error), JSON.stringify(cj.results));
  assert.ok(cj.results.notificationsSent.sent >= 1, "정기 작업이 대기 중인 알림을 발송");
  const again: any = await (await quiet(async () => cron("POST", "Bearer cron-secret-value"))).json();
  assert.equal(again.results.notificationsSent.claimed, 0, "두 번째 실행은 보낼 것이 없음");
  await pool.query(`update notifications set status = 'sent', created_at = now() - interval '100 days' where id = (select min(id) from notifications)`);
  assert.equal((await cleanupNotifications(pool)).deleted, 1, "발송 완료 후 90일이 지난 기록은 정리");
  console.log("10 통과: 정기 작업 주소 — 비밀키 없으면 503, 틀리면 401, 정상 실행·발송, 재실행 안전, 오래된 기록 정리");

  // ---------- 11. 관리자: 재시도·테스트 발송·대시보드
  const ownerTok = signSession(adminId, (await q(`select password_hash from admin_users where id = $1`, [adminId]))[0].password_hash);
  const sid = await createAdmin(pool, { email: "s@x.co", name: "직원", password: "staff-pass-1234", role: "staff" });
  const staffTok = signSession(sid, (await q(`select password_hash from admin_users where id = $1`, [sid]))[0].password_hash);
  const api = async (body: object, tok?: string) => { const r = await postJson(adminNotifPOST, body, tok ? { cookie: `${SESSION_COOKIE}=${tok}` } : {}); return { status: r.status, body: await r.json() as any }; };
  assert.equal((await api({ op: "test", channel: "sms" })).status, 401);
  assert.equal((await api({ op: "test", channel: "sms" }, staffTok)).status, 403, "직원은 테스트 발송·재시도 불가");
  process.env.OWNER_PHONE = "01099998888";
  const t1 = await quiet(() => api({ op: "test", channel: "sms" }, ownerTok));
  assert.deepEqual([t1.status, t1.body.status, t1.body.to], [200, "sent", "010****8888"], "테스트 발송 결과가 바로 돌아오고 번호는 마스킹");
  delete process.env.OWNER_EMAIL;
  assert.equal((await api({ op: "test", channel: "email" }, ownerTok)).status, 400, "OWNER_EMAIL 이 없으면 안내");
  await pool.query("delete from notifications");
  await notify(pool, { type: "booking_cancelled", bookingId: tomorrow.bookingId, notifyOwner: false, refund: null });
  await sendDue(pool, { providers: { sms: null, email: null } });
  const failedId = (await q(`select id from notifications where status = 'failed'`))[0].id;
  assert.equal((await getDashboard(pool)).notificationsFailed, 1, "대시보드 '알림 발송 실패' 카드 (문자 1건. 이메일은 선택 사항이라 '건너뜀')");
  assert.equal(await count("status = 'skipped'"), 1, "SMTP 가 없을 때 손님 이메일은 건너뜀으로 기록");
  const rt = await quiet(() => api({ op: "retry", id: Number(failedId) }, ownerTok));
  assert.equal(rt.status, 200);
  assert.equal(rt.body.status, "sent", "설정을 고친 뒤 다시 시도하면 발송됨 (개발용 콘솔)");
  assert.equal((await api({ op: "retry", id: Number(failedId) }, ownerTok)).status, 409, "실패 상태가 아니면 재시도 불가");
  assert.equal((await getDashboard(pool)).notificationsFailed, 0, "재시도해 성공하면 실패 건수가 줄어든다");
  console.log("11 통과: 관리자 — 테스트 발송(번호 마스킹), 실패 재시도, 직원 403, 대시보드 실패 카드");

  // ---------- 12. 자동 알림 스위치 (NOTIFY_MODE)
  await pool.query("truncate notifications restart identity");
  process.env.OWNER_PHONE = "01099998888"; delete process.env.OWNER_EMAIL;
  const boom: Providers = { sms: { name: "x", async send() { throw new Error("보내면 안 됨"); } }, email: { name: "x", async send() { throw new Error("보내면 안 됨"); } } };
  assert.deepEqual(["", "all", "ALL", "on", "owner", "OWNER ", "off", "of", "maybe"].map((v) => notifyMode({ NOTIFY_MODE: v })), ["all", "all", "all", "all", "owner", "owner", "off", "off", "off"], "미설정=all, 알 수 없는 값(오타)은 안전하게 off");

  // (a) off: 아무 알림도 만들지 않고, 결제·예약은 정상
  process.env.NOTIFY_MODE = "off";
  const off1 = await paid(150, "끄기테스트", "off@example.com");
  assert.equal(off1.c.kind, "confirmed", "알림이 꺼져 있어도 결제·예약 확정은 정상");
  assert.equal(await count(), 0, "off: 어떤 알림도 만들지 않음");
  await mk(152, "내일체크인", "confirmed", 1, 2);
  assert.deepEqual(await scheduleReminders(pool), { checkinReminders: 0, reviewRequests: 0, disabled: true });
  assert.equal(await count(), 0, "off: 체크인 안내·후기 요청도 만들지 않음");
  delete process.env.NOTIFY_MODE;                                         // 켜져 있을 때 만들어진 대기 알림이 있었다면…
  await notify(pool, { type: "booking_confirmed", bookingId: off1.bookingId });
  assert.ok((await count("status = 'pending'")) >= 3);
  process.env.NOTIFY_MODE = "off";                                         // …꺼진 뒤에는 보내지 않고 '건너뜀'으로 정리한다 (나중에 켜도 오래된 알림이 쏟아지지 않음)
  const r1 = await sendDue(pool, { providers: boom });
  assert.equal(r1.sent, 0); assert.ok(r1.skipped >= 3);
  assert.equal(await count("status = 'pending'"), 0);
  assert.match((await q(`select last_error from notifications limit 1`))[0].last_error, /꺼져 있어 보내지 않음/);
  assert.equal((await getDashboard(pool)).notificationsFailed, 0, "건너뜀은 실패로 세지 않음");
  const offTest = await api({ op: "test", channel: "sms" }, ownerTok);
  assert.equal(offTest.status, 400);
  assert.match(offTest.body.error.message, /NOTIFY_MODE/);
  assert.equal(configStatus({ NOTIFY_MODE: "off" } as any).find((c) => c.key === "mode")!.ok, false);

  // (b) owner: 사장님에게만
  await pool.query("truncate notifications restart identity");
  process.env.NOTIFY_MODE = "owner";
  const own = await paid(154, "사장님전용", "own@example.com");
  assert.deepEqual((await q(`select audience || '/' || channel || '/' || kind as k from notifications order by id`)).map((r) => r.k), ["owner/sms/owner_new_booking"], "owner: 손님 문자·이메일은 만들지 않고 사장님 알림만");
  await cancelBooking(pool, { bookingNo: own.bookingNo, phone: PHONE, expectedRefund: own.total, ip: "9.9.9.9" });
  assert.deepEqual((await q(`select kind from notifications order by id`)).map((r) => r.kind), ["owner_new_booking", "owner_cancelled"], "손님이 취소해도 사장님에게만");
  const ofail = await paid(156, "환불실패O");
  mock.state.cancelFails = true;
  await quiet(() => adminCancelBooking(pool, adm, { bookingNo: ofail.bookingNo, mode: "host", expectedRefund: ofail.total }));
  mock.state.cancelFails = false;
  assert.equal(await count("kind = 'owner_refund_failed'"), 1, "owner 모드에서도 환불 실패 경고는 사장님께 간다");
  assert.deepEqual(await scheduleReminders(pool), { checkinReminders: 0, reviewRequests: 0, disabled: true });
  delete process.env.NOTIFY_MODE;                                          // 켜져 있던 시절의 손님 대기 알림이 남아 있다면…
  await notify(pool, { type: "booking_confirmed", bookingId: own.bookingId });
  process.env.NOTIFY_MODE = "owner";
  const sentTo: string[] = [];
  const rec: Providers = { sms: { name: "r", async send(m) { sentTo.push(m.to); return {}; } }, email: { name: "r", async send(m) { sentTo.push(m.to); return {}; } } };
  await sendDue(pool, { providers: rec });
  assert.ok(sentTo.length >= 1 && sentTo.every((t) => t === "01099998888"), `owner 모드: 사장님 번호로만 발송 (${sentTo.join(",")})`);
  assert.ok((await count("audience = 'guest' and status = 'skipped'")) >= 1, "…손님 알림은 건너뜀으로 정리");
  assert.equal(await count("audience = 'guest' and status = 'sent'"), 0);
  const ownTest = await quiet(() => api({ op: "test", channel: "sms" }, ownerTok));
  assert.deepEqual([ownTest.status, ownTest.body.status], [200, "sent"], "owner 모드에서는 테스트 발송 가능");

  // (c) 다시 all 로: 정상 동작
  delete process.env.NOTIFY_MODE;
  await pool.query("delete from notifications");
  await notify(pool, { type: "booking_confirmed", bookingId: own.bookingId });
  assert.ok((await count("audience = 'guest'")) >= 1, "all 로 되돌리면 손님 알림이 다시 만들어짐");
  console.log("12 통과: 자동 알림 스위치 — off(알림 없음·결제 정상·남은 알림 건너뜀) / owner(사장님만, 환불 실패 경고 유지, 손님 알림 건너뜀) / 미설정=all / 오타=off");

  console.log("\n전체 통과");
}

async function cleanup() {
  await pool.query("alter table if exists notifications_broken rename to notifications").catch(() => {});
  await pool.query("truncate bookings, stay_dates, payment_events, audit_logs, admin_users, lookup_attempts, notifications restart identity cascade").catch(() => {});
  await pool.query("update policy_settings set value = '' where key = 'checkin_guide'").catch(() => {});
  await pool.query("select ensure_stay_dates(current_date, current_date + 400)").catch(() => {});
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { for (const c of closers) await c().catch(() => {}); await mockRef?.close(); await cleanup(); await pool.end(); });
