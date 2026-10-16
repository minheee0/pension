/**
 * 발송 엔진: 대기 중인 알림을 가져와 실제로 보낸다.
 *  - 가져가는 즉시 시도 횟수를 올리고 5분 '임대'를 걸어, 동시에 두 번 실행돼도 같은 알림을 두 번 보내지 않는다(FOR UPDATE SKIP LOCKED).
 *  - 실패하면 1분 → 5분 → 30분 → 2시간 간격으로 재시도하고, 5번째 실패하면 '실패'로 남겨 관리자 대시보드에 표시한다.
 *  - 주소 오류·인증 오류처럼 다시 해도 소용없는 실패는 바로 '실패' 처리한다.
 */
import type { Pool } from "pg";
import { decryptText } from "@/server/crypto";
import { RETENTION } from "@/lib/legal";
import { maskRecipient } from "./mask";
import { notifyMode } from "./mode";
import { providersFromEnv } from "./providers";
import { ProviderError, type Providers } from "./types";

export const MAX_ATTEMPTS = 5;
const BACKOFF_MIN = [1, 5, 30, 120];

export async function sendDue(pool: Pool, opts: { limit?: number; providers?: Providers } = {}) {
  const providers = opts.providers ?? providersFromEnv();
  // 스위치가 꺼져 있거나(off) 사장님 전용(owner)이면, 보내면 안 되는 대기 알림은 '건너뜀'으로 정리한다.
  // (나중에 다시 켰을 때 오래된 알림이 한꺼번에 발송되는 일을 막는다)
  const mode = notifyMode();
  let skipped = 0;
  if (mode !== "all") {
    const r = await pool.query(
      `update notifications set status = 'skipped', last_error = $1
        where status = 'pending' and scheduled_at <= now() and ($2 = 'off' or audience = 'guest')`,
      [mode === "off" ? "자동 알림이 꺼져 있어 보내지 않음 (NOTIFY_MODE=off)" : "손님 알림이 꺼져 있어 보내지 않음 (NOTIFY_MODE=owner)", mode]);
    skipped = r.rowCount ?? 0;
    if (mode === "off") return { claimed: 0, sent: 0, retry: 0, failed: 0, skipped };
  }
  const { rows } = await pool.query(
    `with c as (
       select id from notifications where status = 'pending' and scheduled_at <= now() order by id limit $1 for update skip locked)
     update notifications n set attempts = n.attempts + 1, scheduled_at = now() + interval '5 minutes'
       from c where n.id = c.id
     returning n.id, n.kind, n.channel, n.audience, n.recipient_enc, n.subject, n.body, n.attempts`, [opts.limit ?? 20]);

  const out = { claimed: rows.length, sent: 0, retry: 0, failed: 0, skipped };
  const fail = async (id: number, attempts: number, message: string, retryable: boolean) => {
    const final = !retryable || attempts >= MAX_ATTEMPTS;
    if (final) out.failed++; else out.retry++;
    await pool.query(
      `update notifications set status = $2, last_error = $3, scheduled_at = now() + make_interval(mins => $4::int) where id = $1`,
      [id, final ? "failed" : "pending", message.slice(0, 300), BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)]]);
  };

  for (const n of rows) {
    const to = n.audience === "owner" ? (n.channel === "sms" ? process.env.OWNER_PHONE : process.env.OWNER_EMAIL) : n.recipient_enc ? decryptText(n.recipient_enc) : null;
    if (!to) { await fail(n.id, n.attempts, `수신 연락처가 없습니다 (${n.audience === "owner" ? (n.channel === "sms" ? "OWNER_PHONE" : "OWNER_EMAIL") + " 환경변수" : "손님 연락처"})`, false); continue; }
    const provider = n.channel === "sms" ? providers.sms : providers.email;
    if (!provider && n.channel === "email" && n.audience === "guest") {
      // 이메일은 선택 사항: SMTP 를 설정하지 않았다면 손님 이메일은 실패가 아니라 '건너뜀'으로 둔다(문자는 정상 발송)
      await pool.query(`update notifications set status = 'skipped', last_error = '이메일 발송을 사용하지 않음 (SMTP_URL 미설정)' where id = $1`, [n.id]);
      continue;
    }
    if (!provider) { await fail(n.id, n.attempts, `${n.channel === "sms" ? "문자" : "이메일"} 발송 설정이 없습니다 (${n.channel === "sms" ? "SMS_PROVIDER·SOLAPI_*·SMS_FROM" : "SMTP_URL·MAIL_FROM"})`, false); continue; }
    try {
      if (n.channel === "sms") await (provider as any).send({ to, text: n.body, subject: n.subject ?? undefined });
      else await (provider as any).send({ to, subject: n.subject ?? "", text: n.body });
      await pool.query(`update notifications set status = 'sent', sent_at = now(), last_error = null where id = $1`, [n.id]);
      out.sent++;
    } catch (e) {
      const retryable = e instanceof ProviderError ? e.retryable : true;
      await fail(n.id, n.attempts, `${(e as Error).message} → ${maskRecipient(to)}`, retryable);
    }
  }
  return out;
}

/** 오래된 기록 정리: 발송 완료·실패·건너뜀 기록의 보유기간은 src/lib/legal.ts 의 RETENTION (개인정보처리방침과 같은 값)(연락처 암호문·문구를 오래 쌓아 두지 않는다) */
export async function cleanupNotifications(pool: Pool) {
  const a = await pool.query(`delete from notifications where status = 'sent' and created_at < now() - make_interval(days => $1::int)`, [RETENTION.notificationSentDays]);
  const b = await pool.query(`delete from notifications where status in ('failed', 'skipped') and created_at < now() - make_interval(days => $1::int)`, [RETENTION.notificationFailedDays]);
  return { deleted: (a.rowCount ?? 0) + (b.rowCount ?? 0) };
}
