import type { Pool } from "pg";
import { decryptText } from "@/server/crypto";
import { notify } from "@/server/notify/enqueue";
import { maskRecipient } from "@/server/notify/mask";
import { describeMode, notifyMode } from "@/server/notify/mode";
import { sendDue } from "@/server/notify/send";
import type { Channel } from "@/server/notify/types";
import { audit, type AdminCtx } from "./audit";
import { AdminError } from "./errors";

const PAGE = 30;
const STATUSES = ["pending", "sent", "failed", "skipped"];

/** 발송 설정이 갖춰졌는지 (비밀값은 보여 주지 않고 설정 여부만) */
export function configStatus(env = process.env) {
  const prod = env.NODE_ENV === "production";
  const sms = env.SMS_PROVIDER === "solapi" ? !!(env.SOLAPI_API_KEY && env.SOLAPI_API_SECRET && env.SMS_FROM) : !prod && (env.SMS_PROVIDER ?? "console") === "console";
  const email = !!(env.SMTP_URL && env.MAIL_FROM) || !prod;
  const mode = notifyMode(env);
  return [
    { key: "mode", label: "자동 알림", ok: mode === "all", detail: `${describeMode(mode)} — NOTIFY_MODE=all | owner | off` },
    { key: "sms", label: "문자 발송", ok: sms, detail: env.SMS_PROVIDER === "solapi" ? "솔라피" : prod ? "SMS_PROVIDER=solapi 와 SOLAPI_API_KEY·SOLAPI_API_SECRET·SMS_FROM 필요" : "개발용(터미널 출력)" },
    { key: "email", label: "이메일 발송 (선택)", ok: email || (prod && !env.OWNER_EMAIL), detail: env.SMTP_URL ? "SMTP" : !prod ? "개발용(터미널 출력)" : env.OWNER_EMAIL ? "OWNER_EMAIL 을 설정했으니 SMTP_URL·MAIL_FROM 도 필요합니다" : "사용 안 함 — 문자만 발송합니다" },
    { key: "owner_phone", label: "사장님 문자 번호", ok: !!env.OWNER_PHONE, detail: env.OWNER_PHONE ? maskRecipient(env.OWNER_PHONE) : "OWNER_PHONE 필요" },
    { key: "owner_email", label: "사장님 이메일 (선택)", ok: true, detail: env.OWNER_EMAIL ? maskRecipient(env.OWNER_EMAIL) : "설정 안 함 — 사장님 알림은 문자로만 받습니다" },
    { key: "cron", label: "정기 작업(재시도·안내 발송)", ok: !!env.CRON_SECRET, detail: env.CRON_SECRET ? "CRON_SECRET 설정됨 — 스케줄러가 /api/cron/run 을 호출해야 합니다" : "CRON_SECRET 필요" },
    { key: "site_url", label: "사이트 주소(문자 속 링크)", ok: !!env.SITE_URL, detail: env.SITE_URL ?? "SITE_URL 필요 (예: https://manbok.kr)" },
  ];
}

export async function listNotifications(pool: Pool, f: { status?: string; page?: number }) {
  const status = f.status && STATUSES.includes(f.status) ? f.status : null;
  const page = Math.max(0, f.page ?? 0);
  const counts = (await pool.query(`select status, count(*)::int as n from notifications group by status`)).rows;
  const where = status ? "where n.status = $1" : "";
  const args = status ? [status] : [];
  const total = (await pool.query(`select count(*)::int as n from notifications n ${where}`, args)).rows[0].n as number;
  const { rows } = await pool.query(
    `select n.id::int as id, n.kind, n.audience, n.channel, n.status, n.attempts, n.last_error, n.scheduled_at, n.sent_at, n.created_at, n.recipient_enc, n.subject, b.booking_no
       from notifications n left join bookings b on b.id = n.booking_id ${where} order by n.id desc limit ${PAGE} offset ${page * PAGE}`, args);
  return {
    total, page, pageSize: PAGE,
    counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) as Record<string, number>,
    rows: rows.map((r) => ({
      id: r.id as number, kind: r.kind as string, audience: r.audience as string, channel: r.channel as string, status: r.status as string,
      attempts: r.attempts as number, lastError: r.last_error as string | null, scheduledAt: r.scheduled_at as Date, sentAt: r.sent_at as Date | null, createdAt: r.created_at as Date,
      bookingNo: r.booking_no as string | null, subject: r.subject as string | null,
      to: r.audience === "owner" ? (r.channel === "sms" ? process.env.OWNER_PHONE : process.env.OWNER_EMAIL) ? maskRecipient((r.channel === "sms" ? process.env.OWNER_PHONE : process.env.OWNER_EMAIL)!) : "(미설정)"
        : r.recipient_enc ? maskRecipient(decryptText(r.recipient_enc)) : "-",
    })),
  };
}

/** 실패한 알림을 다시 대기 상태로 돌리고 바로 한 번 발송을 시도한다 */
export async function retryNotification(pool: Pool, admin: AdminCtx, id: number) {
  const r = await pool.query(`update notifications set status = 'pending', attempts = 0, last_error = null, scheduled_at = now() where id = $1 and status = 'failed' returning id`, [id]);
  if (!r.rows[0]) throw new AdminError("CONFLICT", "실패 상태의 알림이 아닙니다", 409);
  const out = await sendDue(pool, { limit: 20 });
  const now = (await pool.query(`select status, last_error from notifications where id = $1`, [id])).rows[0];
  await audit(pool, admin, "notification.retry", { type: "notification", id: String(id) }, undefined, { status: now.status });
  return { status: now.status as string, error: now.last_error as string | null, ...out };
}

/** 설정 확인용 테스트 발송: 사장님 연락처로 보내고 결과를 바로 알려 준다 */
export async function sendTest(pool: Pool, admin: AdminCtx, channel: Channel) {
  if (notifyMode() === "off") throw new AdminError("INVALID_INPUT", "자동 알림이 꺼져 있습니다(NOTIFY_MODE=off). 설정을 테스트하려면 NOTIFY_MODE 를 owner 또는 all 로 바꾼 뒤 서버를 재시작하세요", 400);
  const env = channel === "sms" ? process.env.OWNER_PHONE : process.env.OWNER_EMAIL;
  if (!env) throw new AdminError("INVALID_INPUT", `${channel === "sms" ? "OWNER_PHONE" : "OWNER_EMAIL"} 환경변수가 설정되어 있지 않습니다`, 400);
  const before = (await pool.query(`select coalesce(max(id), 0)::int as m from notifications`)).rows[0].m as number;
  await notify(pool, { type: "owner_test", channel });
  await sendDue(pool, { limit: 20 });
  const row = (await pool.query(`select status, last_error from notifications where id > $1 and kind = 'owner_test' and channel = $2 order by id desc limit 1`, [before, channel])).rows[0];
  await audit(pool, admin, "notification.test", {}, undefined, { channel, status: row?.status });
  if (!row) throw new AdminError("CONFLICT", "테스트 알림을 만들지 못했습니다", 409);
  return { status: row.status as string, error: row.last_error as string | null, to: maskRecipient(env) };
}
