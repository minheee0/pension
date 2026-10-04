import { maskPhone } from "../mask";
import { ProviderError, type MailProvider, type Providers, type SmsProvider } from "../types";
import { createSmtpProvider } from "./smtp";
import { createSolapiProvider } from "./solapi";

/** 개발용: 실제로 보내지 않고 터미널에 출력한다 (운영 환경에서는 실제 발송이 아니므로 '실패'로 처리됨 → 대시보드에 보인다) */
const consoleSms: SmsProvider = { name: "console", async send(m) { console.log(`[notify:dev] 문자 → ${maskPhone(m.to)}\n${m.text}\n`); return {}; } };
const consoleMail: MailProvider = { name: "console", async send(m) { console.log(`[notify:dev] 메일 → ${m.to.replace(/^(.).*(@.*)$/, "$1***$2")}\n제목: ${m.subject}\n${m.text}\n`); return {}; } };

/** 환경변수로 발송 업체를 고른다. 설정이 없으면 개발에서는 콘솔 출력, 운영에서는 null (= 발송 실패로 표시) */
export function providersFromEnv(env = process.env): Providers {
  const prod = env.NODE_ENV === "production";
  let sms: SmsProvider | null = null, email: MailProvider | null = null;

  const smsKind = env.SMS_PROVIDER ?? (prod ? "" : "console");
  if (smsKind === "solapi") {
    if (env.SOLAPI_API_KEY && env.SOLAPI_API_SECRET && env.SMS_FROM) {
      sms = createSolapiProvider({ apiKey: env.SOLAPI_API_KEY, apiSecret: env.SOLAPI_API_SECRET, from: env.SMS_FROM, baseUrl: env.SOLAPI_BASE_URL });
    }
  } else if (smsKind === "console" && !prod) sms = consoleSms;

  if (env.SMTP_URL && env.MAIL_FROM) email = createSmtpProvider({ url: env.SMTP_URL, from: env.MAIL_FROM });
  else if (!prod) email = consoleMail;

  return { sms, email };
}

export { ProviderError };
