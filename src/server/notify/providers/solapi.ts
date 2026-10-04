import { createHmac, randomBytes } from "node:crypto";
import { ProviderError, type SmsProvider } from "../types";

/**
 * 솔라피(SOLAPI) 문자 발송
 *  - POST https://api.solapi.com/messages/v4/send   본문: { message: { to, from, text, subject? } }
 *  - 인증 헤더:  HMAC-SHA256 apiKey=<키>, date=<ISO 8601>, salt=<임의 문자열>, signature=<HMAC-SHA256(비밀키, date + salt) 16진수>
 *  - from 은 솔라피에 미리 등록·인증된 발신번호만 가능(숫자만, 예: 0212345678). 90바이트가 넘는 문자는 장문(LMS)으로 자동 처리된다.
 */
export interface SolapiConfig { apiKey: string; apiSecret: string; from: string; baseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number }

export function solapiAuthHeader(apiKey: string, apiSecret: string, date = new Date().toISOString(), salt = randomBytes(16).toString("hex")) {
  const signature = createHmac("sha256", apiSecret).update(date + salt).digest("hex");
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

const digits = (s: string) => s.replace(/\D/g, "");

export function createSolapiProvider(cfg: SolapiConfig): SmsProvider {
  const base = cfg.baseUrl ?? "https://api.solapi.com";
  const doFetch = cfg.fetchImpl ?? fetch;
  return {
    name: "solapi",
    async send({ to, text, subject }) {
      const dest = digits(to);
      if (!/^01[016789]\d{7,8}$/.test(dest)) throw new ProviderError(`수신 번호 형식이 올바르지 않습니다: ${dest.slice(0, 3)}***`, false);
      let res: Response;
      try {
        res = await doFetch(`${base}/messages/v4/send`, {
          method: "POST",
          headers: { Authorization: solapiAuthHeader(cfg.apiKey, cfg.apiSecret), "Content-Type": "application/json" },
          body: JSON.stringify({ message: { to: dest, from: digits(cfg.from), text, ...(subject ? { subject: subject.slice(0, 20) } : {}) } }),
          signal: AbortSignal.timeout(cfg.timeoutMs ?? 15_000),
        });
      } catch (e) {
        throw new ProviderError(`솔라피 연결 실패: ${String(e)}`, true);
      }
      const j: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 인증·발신번호·잔액 문제(4xx)는 재시도해도 같으니 바로 실패 처리. 429·5xx 는 재시도.
        const retryable = res.status >= 500 || res.status === 429;
        throw new ProviderError(`솔라피 오류 ${res.status} ${j.errorCode ?? ""} ${j.errorMessage ?? j.message ?? ""}`.trim(), retryable);
      }
      return { id: j.groupId as string | undefined };
    },
  };
}
