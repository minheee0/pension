/**
 * 알림 설정 점검: 환경변수 형식 검사(비밀값은 출력하지 않음) + 실제 접속 확인(문자는 보내지 않음).
 *  - 솔라피: 잔액 조회(GET /cash/v1/balance)로 API Key·Secret 인증만 확인
 *  - 메일  : SMTP 서버에 접속해 로그인까지만 확인(verify), 메일은 보내지 않음
 */
import nodemailer from "nodemailer";
import { notifyMode } from "./mode";
import { solapiAuthHeader } from "./providers/solapi";

export type Level = "ok" | "warn" | "error";
export interface Finding { level: Level; key: string; message: string }
type Env = Record<string, string | undefined>;

const unquote = (v: string) => v.trim().replace(/^["']|["']$/g, "");
const quoted = (v: string) => /^\s*["'].*["']\s*$/.test(v);

export function analyzeEnv(env: Env): Finding[] {
  const out: Finding[] = [];
  const add = (level: Level, key: string, message: string) => out.push({ level, key, message });

  // ---- 자동 알림 스위치
  const raw = (env.NOTIFY_MODE ?? "").trim().toLowerCase(), mode = notifyMode(env);
  if (raw && !["all", "owner", "off", "on", "true"].includes(raw)) add("error", "NOTIFY_MODE", `알 수 없는 값(${raw})입니다. all, owner, off 중 하나여야 하며, 지금은 안전하게 off 로 동작합니다.`);
  else if (mode === "off") { add("ok", "NOTIFY_MODE", "자동 알림이 꺼져 있습니다(off). 문자·이메일은 발송되지 않아 아래 설정은 검사하지 않습니다. 켜려면 NOTIFY_MODE=owner 또는 all."); return out; }
  else if (mode === "owner") add("ok", "NOTIFY_MODE", "사장님에게만 발송합니다(owner). 손님에게는 문자를 보내지 않습니다.");
  else add("ok", "NOTIFY_MODE", "손님·사장님 모두 발송합니다(all).");

  // ---- 문자 (솔라피)
  const smsKind = env.SMS_PROVIDER ?? "";
  if (smsKind === "solapi" || env.SOLAPI_API_KEY || env.SOLAPI_API_SECRET) {
    if (smsKind !== "solapi") add("error", "SMS_PROVIDER", "솔라피 값은 있는데 SMS_PROVIDER=solapi 가 아니라서 문자가 발송되지 않습니다.");
    const key = env.SOLAPI_API_KEY ?? "", secret = env.SOLAPI_API_SECRET ?? "";
    if (!key) add("error", "SOLAPI_API_KEY", "비어 있습니다. 솔라피 콘솔 → API Key 관리에서 확인하세요.");
    else {
      const k = unquote(key);
      if (quoted(key)) add("warn", "SOLAPI_API_KEY", "값이 따옴표로 감싸져 있습니다. .env.local 에서는 따옴표 없이 쓰는 것이 안전합니다.");
      if (k !== key.trim() && !quoted(key)) add("warn", "SOLAPI_API_KEY", "앞뒤에 공백이 있습니다.");
      if (k.length !== 16) add("error", "SOLAPI_API_KEY", `API Key 는 16자여야 하는데 ${k.length}자입니다.${k.length === 32 ? " 32자라면 API Secret 을 넣으셨을 수 있습니다(두 값이 서로 바뀐 것은 아닌지 확인)." : " 값 끝에 공백·따옴표·줄바꿈이 섞였거나 일부만 복사했을 수 있습니다."}`);
      else add("ok", "SOLAPI_API_KEY", "형식이 올바릅니다(16자).");
    }
    if (!secret) add("error", "SOLAPI_API_SECRET", "비어 있습니다.");
    else {
      const s = unquote(secret);
      if (s.length !== 32) add("warn", "SOLAPI_API_SECRET", `API Secret 은 보통 32자인데 ${s.length}자입니다.${s.length === 16 ? " 16자라면 API Key 를 넣으셨을 수 있습니다." : ""}`);
      else add("ok", "SOLAPI_API_SECRET", "형식이 올바릅니다(32자).");
    }
    const from = (env.SMS_FROM ?? "").replace(/\D/g, "");
    if (!env.SMS_FROM) add("error", "SMS_FROM", "발신번호가 비어 있습니다. 솔라피에 등록·인증을 마친 번호를 숫자로 적으세요.");
    else if (from.length < 8 || from.length > 11) add("error", "SMS_FROM", `발신번호 형식이 올바르지 않습니다(숫자 ${from.length}자리). 예: 0212345678`);
    else add("ok", "SMS_FROM", "형식이 올바릅니다. (솔라피에 등록·인증된 번호인지는 발송해 봐야 확인됩니다)");
  } else if (smsKind === "console") add("warn", "SMS_PROVIDER", "console 은 개발용입니다. 운영에서는 solapi 를 쓰세요.");
  else add("warn", "SMS_PROVIDER", "설정되지 않았습니다. 개발 중에는 터미널 출력, 운영에서는 문자가 발송되지 않습니다.");

  // ---- 이메일 (SMTP)
  if (env.SMTP_URL) {
    const raw = env.SMTP_URL;
    if (quoted(raw)) add("warn", "SMTP_URL", "값이 따옴표로 감싸져 있습니다. 따옴표 없이 쓰세요.");
    let u: URL | null = null;
    try { u = new URL(unquote(raw)); } catch { /* 아래에서 처리 */ }
    if (!u) add("error", "SMTP_URL", "형식을 해석할 수 없습니다. 예: smtps://아이디%40gmail.com:앱비밀번호@smtp.gmail.com:465");
    else {
      const user = decodeURIComponent(u.username), pass = decodeURIComponent(u.password);
      const port = Number(u.port || (u.protocol === "smtps:" ? 465 : 587));
      if (!["smtp:", "smtps:"].includes(u.protocol)) add("error", "SMTP_URL", "주소는 smtp:// 또는 smtps:// 로 시작해야 합니다.");
      if (!user) add("error", "SMTP_URL", "아이디가 없습니다. smtps://아이디:비밀번호@서버:포트 형식으로 쓰세요.");
      if (!pass) add("error", "SMTP_URL", "비밀번호가 없습니다.");
      if (port === 465 && u.protocol === "smtp:") add("warn", "SMTP_URL", "465 포트는 smtps:// 로 써야 합니다(현재 smtp://).");
      if (port === 587 && u.protocol === "smtps:") add("warn", "SMTP_URL", "587 포트는 smtp:// (STARTTLS)로 써야 합니다(현재 smtps://).");
      const authority = raw.replace(/^[^:]*:\/\//, "").split("/")[0];
      if ((authority.match(/@/g) ?? []).length > 1) add("warn", "SMTP_URL", "아이디의 @ 는 %40 으로 바꿔 쓰는 것을 권장합니다. 예: smtps://me%40gmail.com:비밀번호@smtp.gmail.com:465");
      if (/gmail\.com$/i.test(u.hostname)) {
        if (/\s/.test(pass)) add("error", "SMTP_URL", "비밀번호에 공백이 있습니다. 구글이 보여 주는 앱 비밀번호의 공백(4자리씩 끊긴 부분)을 모두 지우세요.");
        else if (pass.length !== 16) add("error", "SMTP_URL", `Gmail 은 계정 비밀번호가 아니라 '앱 비밀번호'(공백 없는 16자)를 써야 합니다. 현재 ${pass.length}자입니다. 2단계 인증을 켠 뒤 myaccount.google.com/apppasswords 에서 만드세요.`);
        else add("ok", "SMTP_URL", "Gmail 앱 비밀번호 형식(16자)입니다.");
        if (user && !/@/.test(user)) add("warn", "SMTP_URL", "Gmail 아이디는 전체 주소(예: me@gmail.com)여야 합니다.");
      }
      if (u.hostname && !user.includes("@") && !/gmail/i.test(u.hostname)) add("warn", "SMTP_URL", "아이디가 이메일 주소 형태가 아닙니다. 서비스에 따라 전체 주소가 필요할 수 있습니다.");
      if (!env.MAIL_FROM) add("error", "MAIL_FROM", "발신자가 비어 있습니다. 예: \"만복 <내계정@gmail.com>\"");
      else if (/gmail\.com$/i.test(u.hostname)) {
        const addr = env.MAIL_FROM.match(/<([^>]+)>/)?.[1] ?? env.MAIL_FROM;
        if (user && addr.trim().toLowerCase() !== user.toLowerCase()) add("warn", "MAIL_FROM", "Gmail 은 보내는 주소를 로그인한 계정으로 바꿔서 보냅니다. MAIL_FROM 의 주소를 SMTP 아이디와 같게 하세요.");
      }
    }
  } else if (env.OWNER_EMAIL) add("error", "SMTP_URL", "OWNER_EMAIL 을 설정했는데 SMTP_URL 이 없어 사장님 이메일이 발송되지 않습니다. SMTP_URL·MAIL_FROM 을 설정하거나 OWNER_EMAIL 을 비우세요.");
  else add("ok", "SMTP_URL", "이메일은 사용하지 않습니다(선택 사항). 문자만 발송하며, 손님이 입력한 이메일로는 보내지 않습니다.");

  // ---- 사장님 연락처 · 기타
  if (!env.OWNER_PHONE) add("warn", "OWNER_PHONE", "비어 있습니다. 새 예약·환불 실패 문자가 사장님께 가지 않습니다.");
  else if (!/^01[016789]\d{7,8}$/.test(env.OWNER_PHONE.replace(/\D/g, ""))) add("error", "OWNER_PHONE", "휴대폰 번호 형식이 올바르지 않습니다.");
  else add("ok", "OWNER_PHONE", "형식이 올바릅니다.");
  if (!env.OWNER_EMAIL) add("ok", "OWNER_EMAIL", "설정하지 않았습니다(선택). 사장님 알림은 문자로만 받습니다. 긴급 알림(환불 실패)은 이메일도 함께 받으면 더 안전합니다.");
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.OWNER_EMAIL)) add("error", "OWNER_EMAIL", "이메일 형식이 올바르지 않습니다.");
  else add("ok", "OWNER_EMAIL", "형식이 올바릅니다.");
  if (!env.SITE_URL) add("warn", "SITE_URL", "비어 있습니다. 문자 속 링크가 http://localhost:3000 으로 나갑니다.");
  else if (!/^https?:\/\//.test(env.SITE_URL)) add("error", "SITE_URL", "http:// 또는 https:// 로 시작해야 합니다.");
  if (!env.CRON_SECRET) add("warn", "CRON_SECRET", "비어 있습니다. 체크인 전날 안내·재시도를 돌리는 정기 작업 주소가 꺼져 있습니다(배포 전에 설정).");
  return out;
}

/** 솔라피 오류를 쉬운 말로 */
export function explainSolapiError(status: number, body: any): string {
  const code = String(body?.errorCode ?? ""), msg = String(body?.errorMessage ?? body?.message ?? "");
  if (/apiKey/i.test(msg) && /length/i.test(msg)) return "API Key 길이가 다릅니다(16자여야 함). 값을 다시 복사하세요 — 따옴표·공백이 섞였거나 API Secret 을 넣었을 수 있습니다.";
  if (code === "SignatureDoesNotMatch" || /signature/i.test(msg)) return "API Secret 이 맞지 않습니다. 솔라피 콘솔에서 Secret 을 다시 확인하세요. (PC 시계가 크게 틀어져 있어도 발생합니다)";
  if (/ApiKeyNotFound|apiKey.*not found|invalid.*apikey/i.test(code + msg)) return "API Key 를 솔라피가 찾지 못했습니다. 키가 삭제됐거나 잘못 복사된 것은 아닌지 확인하세요.";
  if (status === 401 || status === 403) return `인증이 거절되었습니다(${status} ${code}). API Key·Secret 을 다시 확인하세요.`;
  if (status === 429) return "요청이 너무 많습니다. 잠시 후 다시 시도하세요.";
  if (status >= 500) return "솔라피 서버 일시 오류입니다. 잠시 후 다시 시도하세요.";
  return `솔라피 오류 ${status} ${code} ${msg}`.trim();
}

/** SMTP 오류를 쉬운 말로 */
export function explainSmtpError(e: any): string {
  const code = String(e?.code ?? ""), resp = Number(e?.responseCode ?? 0), text = String(e?.response ?? e?.message ?? e);
  if (resp === 535 || code === "EAUTH") {
    return /gmail|google|5\.7\.8/i.test(text)
      ? "Gmail 이 아이디/비밀번호를 거절했습니다(535). ① 구글 계정의 2단계 인증을 켜고 ② '앱 비밀번호'를 새로 만들어 ③ 공백 없이 16자를 SMTP_URL 의 비밀번호 자리에 넣으세요. 평소 쓰는 구글 비밀번호는 쓸 수 없습니다. 아이디의 @ 는 %40 으로 쓰세요."
      : "메일 서버가 아이디/비밀번호를 거절했습니다(535). 아이디(전체 이메일 주소 여부)와 비밀번호를 확인하세요. 서비스에 따라 '앱 비밀번호' 또는 'SMTP 사용 설정'이 필요합니다.";
  }
  if (code === "ECONNREFUSED" || code === "ETIMEDOUT" || code === "ECONNECTION" || code === "ESOCKET") return `메일 서버에 연결하지 못했습니다(${code}). 서버 주소·포트(465 는 smtps://, 587 은 smtp://)와 방화벽·네트워크를 확인하세요.`;
  if (code === "ENOTFOUND" || code === "EDNS") return "메일 서버 주소를 찾을 수 없습니다. SMTP_URL 의 서버 이름 철자를 확인하세요.";
  if (/wrong version number|ssl/i.test(text)) return "보안 연결 방식이 맞지 않습니다. 465 포트는 smtps://, 587 포트는 smtp:// 로 쓰세요.";
  return `메일 서버 오류: ${text}`.slice(0, 300);
}

/** 문자는 보내지 않고 솔라피 인증만 확인한다 (잔액 조회) */
export async function checkSolapiLive(c: { apiKey: string; apiSecret: string; baseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number }) {
  try {
    const res = await (c.fetchImpl ?? fetch)(`${c.baseUrl ?? "https://api.solapi.com"}/cash/v1/balance`, {
      headers: { Authorization: solapiAuthHeader(c.apiKey, c.apiSecret) }, signal: AbortSignal.timeout(c.timeoutMs ?? 15_000),
    });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false as const, message: explainSolapiError(res.status, j) };
    return { ok: true as const, message: `인증 성공 — 잔액 ${Number(j.balance ?? 0).toLocaleString("ko-KR")}원${j.point != null ? `, 포인트 ${Number(j.point).toLocaleString("ko-KR")}` : ""}`, balance: Number(j.balance ?? 0) };
  } catch (e) {
    return { ok: false as const, message: `솔라피에 연결하지 못했습니다: ${(e as Error).message}` };
  }
}

/** 메일은 보내지 않고 SMTP 접속·로그인만 확인한다 */
export async function checkSmtpLive(c: { url: string }) {
  try {
    const t = nodemailer.createTransport({ url: c.url, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000 } as any);
    await t.verify();
    return { ok: true as const, message: "접속·로그인 성공 (메일은 보내지 않았습니다)" };
  } catch (e) {
    return { ok: false as const, message: explainSmtpError(e) };
  }
}
