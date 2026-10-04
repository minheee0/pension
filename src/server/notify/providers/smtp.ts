import nodemailer from "nodemailer";
import { ProviderError, type MailProvider } from "../types";

/**
 * 이메일 발송(SMTP). 평문 메일만 보낸다.
 *  SMTP_URL 예: smtps://사용자:비밀번호@smtp.gmail.com:465   (Gmail은 앱 비밀번호 사용)
 *  MAIL_FROM 예: "만복 <noreply@example.com>"
 */
export function createSmtpProvider(cfg: { url: string; from: string }): MailProvider {
  // 접속 주소(SMTP_URL)에 제한 시간을 함께 지정한다 — 메일 서버가 응답하지 않아도 발송 작업이 멈추지 않게
  const transporter = nodemailer.createTransport({ url: cfg.url, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 } as any);
  return {
    name: "smtp",
    async send({ to, subject, text }) {
      try {
        const info = await transporter.sendMail({ from: cfg.from, to, subject, text });
        return { id: info.messageId };
      } catch (e: any) {
        // 5xx 응답(주소 거부 등)은 재시도해도 같으므로 영구 실패, 연결·4xx 는 재시도
        const permanent = typeof e?.responseCode === "number" && e.responseCode >= 500;
        throw new ProviderError(`메일 발송 실패: ${e?.response ?? e?.message ?? e}`, !permanent);
      }
    },
  };
}
