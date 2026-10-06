/** 알림 설정 점검 도구 테스트 (DB 불필요).   npm run test:diagnose */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { analyzeEnv, checkSmtpLive, checkSolapiLive, explainSmtpError, explainSolapiError } from "../src/server/notify/diagnose";
import { createSolapiProvider } from "../src/server/notify/providers/solapi";

const levels = (env: Record<string, string>) => analyzeEnv(env);
const has = (fs: ReturnType<typeof analyzeEnv>, level: string, key: string, re?: RegExp) => fs.some((f) => f.level === level && f.key === key && (!re || re.test(f.message)));
const KEY16 = "NCSAYU7YDBXYORXC", SECRET32 = "CBSEKKX2EOKNJOOV4OC4CZZDXTFOLMQU";
const baseSol = { SMS_PROVIDER: "solapi", SOLAPI_API_KEY: KEY16, SOLAPI_API_SECRET: SECRET32, SMS_FROM: "02-1234-5678" };

// ---- 솔라피 흉내 서버: 실제 서비스처럼 API Key 길이를 검사하고 서명을 검증한다
async function solapiMock() {
  const server = http.createServer((req, res) => {
    req.on("data", () => {}); req.on("end", () => {
      const send = (c: number, j: object) => { res.writeHead(c, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
      const m = String(req.headers.authorization ?? "").match(/^HMAC-SHA256 apiKey=(\S*), date=(\S+), salt=(\S+), signature=([0-9a-f]+)$/);
      if (!m) return send(401, { errorCode: "InvalidAuth", errorMessage: "bad header" });
      if (m[1].length !== 16) return send(400, { errorCode: "ValidationError", errorMessage: 'child "apiKey" fails because ["apiKey" length must be 16 characters long]' });
      if (createHmac("sha256", SECRET32).update(m[2] + m[3]).digest("hex") !== m[4]) return send(401, { errorCode: "SignatureDoesNotMatch", errorMessage: "Signature does not match" });
      if (req.url === "/cash/v1/balance") return send(200, { balance: 12500, point: 300 });
      send(200, { groupId: "G1" });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
}

// ---- SMTP 흉내 서버: 로그인(AUTH PLAIN/LOGIN)을 받고 Gmail 처럼 535 로 거절할 수 있다
async function smtpMock(accept: boolean) {
  const server = net.createServer((sock) => {
    let buf = "", step: "cmd" | "login-user" | "login-pass" = "cmd";
    sock.write("220 fake ESMTP\r\n");
    sock.on("data", (d) => {
      buf += d.toString();
      for (;;) {
        const i = buf.indexOf("\r\n"); if (i < 0) break;
        const line = buf.slice(0, i); buf = buf.slice(i + 2); const up = line.toUpperCase();
        const verdict = () => sock.write(accept ? "235 2.7.0 Accepted\r\n" : "535-5.7.8 Username and Password not accepted. For more information, go to\r\n535 5.7.8 https://support.google.com/mail/?p=BadCredentials gsmtp\r\n");
        if (step === "login-user") { step = "login-pass"; sock.write("334 UGFzc3dvcmQ6\r\n"); continue; }
        if (step === "login-pass") { step = "cmd"; verdict(); continue; }
        if (up.startsWith("EHLO")) sock.write("250-fake\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n");
        else if (up.startsWith("AUTH PLAIN")) { if (line.trim().split(/\s+/).length > 2) verdict(); else sock.write("334 \r\n"); }
        else if (up.startsWith("AUTH LOGIN")) { step = "login-user"; sock.write("334 VXNlcm5hbWU6\r\n"); }
        else if (up === "QUIT") { sock.write("221 bye\r\n"); sock.end(); }
        else if (/^[A-Za-z0-9+/=]+$/.test(line) && line.length > 8) verdict();    // AUTH PLAIN 의 두 번째 줄
        else sock.write("250 OK\r\n");
      }
    });
    sock.on("error", () => {});
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { port: (server.address() as AddressInfo).port, close: () => new Promise<void>((r) => server.close(() => r())) };
}

const closers: (() => Promise<void>)[] = [];
async function main() {
  // ---------- 1. 환경변수 형식 검사
  let f = levels({ ...baseSol, OWNER_PHONE: "010-9999-8888", OWNER_EMAIL: "o@x.co", SITE_URL: "https://manbok.kr" });
  assert.ok(has(f, "ok", "SOLAPI_API_KEY") && has(f, "ok", "SOLAPI_API_SECRET") && has(f, "ok", "SMS_FROM") && has(f, "ok", "OWNER_PHONE"), "올바른 값은 통과");
  assert.ok(!f.some((x) => x.level === "error"));

  f = levels({ ...baseSol, SOLAPI_API_KEY: KEY16 + "  ''" });                      // 사용자가 겪은 상황: 길이가 16이 아닌 키
  assert.ok(has(f, "error", "SOLAPI_API_KEY", /16자여야.*(\d+)자/), "API Key 길이 오류를 길이와 함께 안내");
  f = levels({ ...baseSol, SOLAPI_API_KEY: SECRET32 });
  assert.ok(has(f, "error", "SOLAPI_API_KEY", /API Secret 을 넣으셨을 수/), "Key 자리에 Secret(32자)을 넣은 경우를 짚어 줌");
  f = levels({ ...baseSol, SOLAPI_API_SECRET: KEY16 });
  assert.ok(has(f, "warn", "SOLAPI_API_SECRET", /API Key 를 넣으셨을 수/));
  f = levels({ ...baseSol, SOLAPI_API_KEY: `"${KEY16}"` });
  assert.ok(has(f, "warn", "SOLAPI_API_KEY", /따옴표/) && has(f, "ok", "SOLAPI_API_KEY"), "따옴표는 경고하되 값 자체는 인정");
  assert.ok(has(levels({ ...baseSol, SMS_FROM: "123" }), "error", "SMS_FROM"));
  assert.ok(has(levels({ ...baseSol, SMS_PROVIDER: "" }), "error", "SMS_PROVIDER", /solapi/), "키는 있는데 SMS_PROVIDER 가 없는 경우");
  assert.ok(has(levels({ OWNER_PHONE: "1234" }), "error", "OWNER_PHONE") && has(levels({ OWNER_EMAIL: "x" }), "error", "OWNER_EMAIL"));

  assert.ok(has(levels({ ...baseSol }), "ok", "SMTP_URL", /사용하지 않습니다/), "SMTP 를 설정하지 않는 것은 오류가 아니라 선택");
  assert.ok(has(levels({ ...baseSol, OWNER_EMAIL: "o@x.co" }), "error", "SMTP_URL", /OWNER_EMAIL/), "사장님 이메일은 있는데 SMTP 가 없는 불일치는 오류");
  assert.ok(has(levels({ ...baseSol }), "ok", "OWNER_EMAIL"));
  const smtp = (url: string, from = "만복 <me@gmail.com>") => levels({ SMTP_URL: url, MAIL_FROM: from });
  assert.ok(has(smtp("smtps://me%40gmail.com:abcdefghijklmnop@smtp.gmail.com:465"), "ok", "SMTP_URL", /16자/));
  assert.ok(has(smtp("smtps://me%40gmail.com:abcd efgh ijkl mnop@smtp.gmail.com:465"), "error", "SMTP_URL", /공백/), "구글이 보여 주는 공백 포함 앱 비밀번호");
  assert.ok(has(smtp("smtps://me%40gmail.com:mypassword@smtp.gmail.com:465"), "error", "SMTP_URL", /앱 비밀번호.*10자/), "일반 비밀번호를 넣은 경우");
  assert.ok(has(smtp("smtps://me@gmail.com:abcdefghijklmnop@smtp.gmail.com:465"), "warn", "SMTP_URL", /%40/), "아이디의 @ 미인코딩");
  assert.ok(has(smtp("smtp://u%40x.com:p@smtp.example.com:465"), "warn", "SMTP_URL", /smtps/) && has(smtp("smtps://u%40x.com:p@smtp.example.com:587"), "warn", "SMTP_URL", /STARTTLS/));
  assert.ok(has(smtp("이건 주소가 아닙니다"), "error", "SMTP_URL", /해석할 수 없습니다/));
  assert.ok(has(levels({ SMTP_URL: "smtps://me%40gmail.com:abcdefghijklmnop@smtp.gmail.com:465" }), "error", "MAIL_FROM"));
  assert.ok(has(smtp("smtps://me%40gmail.com:abcdefghijklmnop@smtp.gmail.com:465", "만복 <other@naver.com>"), "warn", "MAIL_FROM", /같게/), "Gmail 은 발신 주소를 계정으로 바꿈");
  const leaky = JSON.stringify(levels({ ...baseSol, SMTP_URL: "smtps://me%40gmail.com:topsecretpassw@smtp.gmail.com:465", MAIL_FROM: "a@b.co" }));
  assert.ok(!leaky.includes(SECRET32) && !leaky.includes("topsecretpassw") && !leaky.includes(KEY16), "점검 결과에 비밀값이 포함되지 않음");
  console.log("1 통과: 설정값 형식 검사 — 길이(16/32)·Key↔Secret 뒤바뀜·따옴표·발신번호·Gmail 앱 비밀번호(공백·길이)·포트/보안방식·@ 인코딩, 비밀값 비노출");

  // ---------- 2. 사용자가 실제로 받은 솔라피 오류를 재현
  const sol = await solapiMock(); closers.push(sol.close);
  const badKey = createSolapiProvider({ apiKey: KEY16 + "xx", apiSecret: SECRET32, from: "0212345678", baseUrl: sol.url });
  await assert.rejects(badKey.send({ to: "01012345678", text: "x" }), (e: any) => /apiKey.*length must be 16/.test(e.message) && e.retryable === false, "실제와 같은 400 ValidationError 는 재시도하지 않는 실패");
  const ok = await checkSolapiLive({ apiKey: KEY16, apiSecret: SECRET32, baseUrl: sol.url });
  assert.deepEqual([ok.ok, ok.message], [true, "인증 성공 — 잔액 12,500원, 포인트 300"]);
  const wrongLen = await checkSolapiLive({ apiKey: KEY16 + "x", apiSecret: SECRET32, baseUrl: sol.url });
  assert.equal(wrongLen.ok, false);
  assert.match(wrongLen.message, /16자여야 함/);
  const wrongSecret = await checkSolapiLive({ apiKey: KEY16, apiSecret: "x".repeat(32), baseUrl: sol.url });
  assert.match(wrongSecret.message, /API Secret 이 맞지 않습니다/);
  assert.match((await checkSolapiLive({ apiKey: KEY16, apiSecret: SECRET32, baseUrl: "http://127.0.0.1:1", timeoutMs: 400 })).message, /연결하지 못했습니다/);
  assert.match(explainSolapiError(429, {}), /너무 많습니다/);
  assert.match(explainSolapiError(503, {}), /일시 오류/);
  console.log("2 통과: 솔라피 — 사용자가 받은 400 ValidationError(apiKey 16자) 재현 → 안내, 잔액 조회로 인증 확인(문자 미발송), Secret 오류·연결 실패 안내");

  // ---------- 3. 사용자가 실제로 받은 Gmail 535 오류를 재현
  const good = await smtpMock(true); closers.push(good.close);
  const bad = await smtpMock(false); closers.push(bad.close);
  const r1 = await checkSmtpLive({ url: `smtp://me%40gmail.com:abcdefghijklmnop@127.0.0.1:${good.port}` });
  assert.deepEqual([r1.ok, r1.message], [true, "접속·로그인 성공 (메일은 보내지 않았습니다)"]);
  const r2 = await checkSmtpLive({ url: `smtp://me%40gmail.com:wrongpassword@127.0.0.1:${bad.port}` });
  assert.equal(r2.ok, false);
  assert.match(r2.message, /앱 비밀번호/, "535 BadCredentials → 앱 비밀번호 안내");
  assert.match(r2.message, /2단계 인증/);
  assert.match((await checkSmtpLive({ url: "smtp://a:b@127.0.0.1:1" })).message, /연결하지 못했습니다/);
  assert.match(explainSmtpError({ code: "ENOTFOUND" }), /서버 이름/);
  assert.match(explainSmtpError({ responseCode: 535, response: "535 5.7.8 Username and Password not accepted" }), /Gmail/);
  assert.match(explainSmtpError({ responseCode: 535, response: "535 authentication failed" }), /아이디/);
  console.log("3 통과: 이메일 — 사용자가 받은 535 BadCredentials 재현 → 앱 비밀번호·2단계 인증 안내, 로그인 성공 확인(메일 미발송), 연결 실패 안내");

  console.log("\n전체 통과");
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { for (const c of closers) await c().catch(() => {}); });
