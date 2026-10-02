import type { Db } from "@/server/booking/hold";

export interface AdminCtx { id: number; email: string; name: string; role: "owner" | "staff"; ip?: string | null }

const SENSITIVE = /password|accountNumber|secret|token|refundAccount/i;
function scrub(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, SENSITIVE.test(k) ? "[redacted]" : scrub(x)]));
  }
  return v;
}

/** 관리자가 한 일을 audit_logs 에 남긴다. 비밀번호·계좌번호 같은 값은 자동으로 가린다. */
export async function audit(db: Db, admin: AdminCtx, action: string, target: { type?: string; id?: string }, before?: unknown, after?: unknown) {
  await db.query(
    `insert into audit_logs (admin_id, action, target_type, target_id, before_data, after_data, ip)
     values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::inet)`,
    [admin.id, action, target.type ?? null, target.id ?? null,
     before === undefined ? null : JSON.stringify(scrub(before)), after === undefined ? null : JSON.stringify(scrub(after)),
     admin.ip && /^[0-9a-f:.]+$/i.test(admin.ip) ? admin.ip : null]);
}

export async function listAudit(db: Db, limit = 100, offset = 0) {
  const { rows } = await db.query(
    `select a.id, a.created_at, a.action, a.target_type, a.target_id, a.before_data, a.after_data, host(a.ip) as ip, u.name as admin_name, u.email as admin_email
       from audit_logs a left join admin_users u on u.id = a.admin_id order by a.id desc limit $1 offset $2`, [limit, offset]);
  return rows;
}
