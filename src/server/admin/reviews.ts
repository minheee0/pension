import type { Pool } from "pg";
import { audit, type AdminCtx } from "./audit";
import { AdminError } from "./errors";

const PAGE = 20;
const bad = (m: string) => new AdminError("INVALID_INPUT", m, 400);
const excerpt = (s: string) => (s.length > 80 ? `${s.slice(0, 80)}…` : s);

export type ReviewFilter = "all" | "reported" | "hidden" | "needs_reply";

export async function listAdminReviews(pool: Pool, f: { filter?: ReviewFilter; page?: number }) {
  const where = f.filter === "reported" ? "r.status = 'reported'" : f.filter === "hidden" ? "r.status = 'hidden'"
    : f.filter === "needs_reply" ? "rp.id is null and r.status <> 'hidden'" : "true";
  const page = Math.max(0, f.page ?? 0);
  const base = `from reviews r join bookings b on b.id = r.booking_id left join review_replies rp on rp.review_id = r.id where ${where}`;
  const total = (await pool.query(`select count(*)::int as n ${base}`)).rows[0].n as number;
  const { rows } = await pool.query(
    `select r.id::int as id, r.rating, r.rating_details, r.content, r.status, r.created_at, r.author_name, b.booking_no, b.guest_name, b.check_in::text as check_in,
            rp.content as reply,
            coalesce((select json_agg(json_build_object('reason', x.reason, 'detail', x.detail, 'at', x.created_at) order by x.id)
                        from review_reports x where x.review_id = r.id), '[]'::json) as reports
       ${base} order by (r.status = 'reported') desc, r.created_at desc limit ${PAGE} offset ${page * PAGE}`);
  return { rows, total, page, pageSize: PAGE };
}

async function getReview(pool: Pool, id: number) {
  const r = (await pool.query(`select id::int as id, status, content, rating from reviews where id = $1`, [id])).rows[0];
  if (!r) throw new AdminError("NOT_FOUND", "후기를 찾을 수 없습니다", 404);
  return r as { id: number; status: string; content: string; rating: number };
}

export async function hideReview(pool: Pool, admin: AdminCtx, id: number, reason: string) {
  const r = await getReview(pool, id);
  const why = reason.trim();
  if (why.length < 2 || why.length > 200) throw bad("숨기는 사유를 2~200자로 적어 주세요");
  await pool.query(`update reviews set status = 'hidden' where id = $1`, [id]);
  await audit(pool, admin, "review.hide", { type: "review", id: String(id) }, { status: r.status, content: excerpt(r.content) }, { status: "hidden", reason: why });
}

export async function restoreReview(pool: Pool, admin: AdminCtx, id: number) {
  const r = await getReview(pool, id);
  if (r.status !== "hidden") throw new AdminError("CONFLICT", "비공개 상태가 아닙니다", 409);
  const reports = (await pool.query(`select count(*)::int as n from review_reports where review_id = $1`, [id])).rows[0].n as number;
  await pool.query(`update reviews set status = $2 where id = $1`, [id, reports > 0 ? "reported" : "visible"]);
  await audit(pool, admin, "review.restore", { type: "review", id: String(id) }, { status: "hidden" }, { status: reports > 0 ? "reported" : "visible" });
}

/** 신고를 검토했더니 문제가 없을 때: 신고 기록을 지우고 정상 상태로 되돌린다 */
export async function dismissReports(pool: Pool, admin: AdminCtx, id: number) {
  const r = await getReview(pool, id);
  const del = await pool.query(`delete from review_reports where review_id = $1`, [id]);
  if (r.status === "reported") await pool.query(`update reviews set status = 'visible' where id = $1`, [id]);
  await audit(pool, admin, "review.dismiss_reports", { type: "review", id: String(id) }, { reports: del.rowCount }, { status: r.status === "reported" ? "visible" : r.status });
}

export async function saveReply(pool: Pool, admin: AdminCtx, id: number, content: string) {
  const r = await getReview(pool, id);
  if (r.status === "hidden") throw new AdminError("CONFLICT", "비공개 후기에는 답글을 달 수 없습니다", 409);
  const text = content.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (text.length < 2 || text.length > 1000) throw bad("답글은 2~1000자로 작성해 주세요");
  const before = (await pool.query(`select content from review_replies where review_id = $1`, [id])).rows[0];
  await pool.query(`insert into review_replies (review_id, content) values ($1, $2) on conflict (review_id) do update set content = $2`, [id, text]);
  await audit(pool, admin, before ? "review.reply.update" : "review.reply.create", { type: "review", id: String(id) }, before && { content: excerpt(before.content) }, { content: excerpt(text) });
}

export async function deleteReply(pool: Pool, admin: AdminCtx, id: number) {
  const r = await pool.query(`delete from review_replies where review_id = $1 returning content`, [id]);
  if (!r.rows[0]) throw new AdminError("NOT_FOUND", "답글이 없습니다", 404);
  await audit(pool, admin, "review.reply.delete", { type: "review", id: String(id) }, { content: excerpt(r.rows[0].content) });
}

/** 영구 삭제. 되돌릴 수 없으므로 사유를 필수로 받고 기록에 남긴다. 일반적인 정리는 '숨김'을 쓴다. */
export async function deleteReview(pool: Pool, admin: AdminCtx, id: number, reason: string) {
  const r = await getReview(pool, id);
  const why = reason.trim();
  if (why.length < 2 || why.length > 200) throw bad("삭제 사유를 2~200자로 적어 주세요");
  await pool.query(`delete from reviews where id = $1`, [id]);
  await audit(pool, admin, "review.delete", { type: "review", id: String(id) }, { status: r.status, rating: r.rating, content: excerpt(r.content) }, { reason: why });
}
