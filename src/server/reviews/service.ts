/**
 * 후기(리뷰)
 *  - 작성 자격: 이용 완료(체크아웃 후)된 예약의 예약자 본인(예약번호 + 휴대폰). 1예약 1후기.
 *  - 작성 기간: 체크아웃 후 member_review_days 일(기본 30일). 수정은 작성 후 7일 이내. 관리자가 숨긴 후기는 손님이 수정·삭제할 수 없다.
 *  - 이름은 마스킹(홍*동)해서 저장하고, 연락처·링크·이메일은 후기에 쓸 수 없다(스팸·개인정보 방지).
 *  - 신고된 후기는 자동으로 숨기지 않는다(신고 남용 방지). 관리자가 검토해 숨김·복구한다.
 */
import type { Pool } from "pg";
import { completeFinishedBookings } from "@/server/booking/complete";
import { verifyBooking } from "@/server/booking/lookup";

export class ReviewError extends Error {
  constructor(public code: "INVALID_INPUT" | "NOT_ALLOWED" | "EXISTS" | "NOT_FOUND" | "LOCKED", message: string, public status: number) {
    super(message);
    this.name = "ReviewError";
  }
}

export const DETAIL_KEYS = ["cleanliness", "facilities", "location", "atmosphere", "service"] as const;
export const DETAIL_LABEL: Record<(typeof DETAIL_KEYS)[number], string> = {
  cleanliness: "청결", facilities: "시설", location: "위치", atmosphere: "한옥 분위기", service: "응대",
};
export const EDIT_DAYS = 7;
export const REPORT_REASONS = ["abuse", "false", "privacy", "spam", "other"] as const;
export const REPORT_LABEL: Record<(typeof REPORT_REASONS)[number], string> = {
  abuse: "욕설·비방", false: "허위 사실", privacy: "개인정보 노출", spam: "광고·스팸", other: "기타",
};

export function maskName(name: string): string {
  const c = [...name.trim()];
  if (c.length <= 1) return `${c.join("")}*`;
  if (c.length === 2) return `${c[0]}*`;
  return c[0] + "*".repeat(c.length - 2) + c[c.length - 1];
}

const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const addDays = (s: string, n: number) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const bad = (m: string) => new ReviewError("INVALID_INPUT", m, 400);

export function cleanText(s: string, max: number): string {
  return s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
}

export function validateReview(input: { rating: unknown; details?: unknown; content: unknown }) {
  const rating = Number(input.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw bad("별점은 1~5점으로 선택해 주세요");
  const details: Record<string, number> = {};
  if (input.details && typeof input.details === "object") {
    for (const k of DETAIL_KEYS) {
      const v = (input.details as Record<string, unknown>)[k];
      if (v === undefined || v === null || v === "") continue;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 5) throw bad(`${DETAIL_LABEL[k]} 점수는 1~5점이어야 합니다`);
      details[k] = n;
    }
  }
  const content = cleanText(String(input.content ?? ""), 1000);
  const len = [...content].length;
  if (len < 10) throw bad("후기는 10자 이상 작성해 주세요");
  if (/01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/.test(content)) throw bad("후기에는 전화번호를 쓸 수 없습니다");
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(content)) throw bad("후기에는 이메일 주소를 쓸 수 없습니다");
  if (/https?:\/\/|www\.|\b[\w-]+\.(com|net|kr|co\.kr|me)\b/i.test(content)) throw bad("후기에는 링크를 넣을 수 없습니다");
  return { rating, details, content };
}

async function windowDays(db: Pool): Promise<number> {
  const r = await db.query(`select value from policy_settings where key = 'member_review_days'`);
  const n = Number(r.rows[0]?.value);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

const REVIEW_SQL = `select r.id::int as id, r.rating, r.rating_details, r.content, r.status, r.created_at, r.updated_at, rp.content as reply, rp.created_at as reply_at
                      from reviews r left join review_replies rp on rp.review_id = r.id`;

function shape(r: any) {
  const editable = r.status !== "hidden" && Date.now() - new Date(r.created_at).getTime() < EDIT_DAYS * 86400e3;
  return {
    id: r.id as number, rating: r.rating as number, details: (r.rating_details ?? {}) as Record<string, number>, content: r.content as string,
    status: r.status as string, createdAt: r.created_at as Date, edited: new Date(r.updated_at).getTime() - new Date(r.created_at).getTime() > 60_000,
    editable, deletable: r.status !== "hidden", reply: (r.reply as string | null) ?? null,
  };
}

export type ReviewState =
  | { state: "not_yet" | "unavailable" | "expired" | "eligible"; windowEndsAt: string; review?: undefined }
  | { state: "written"; windowEndsAt: string; review: ReturnType<typeof shape> };

/** 이 예약으로 후기를 쓸 수 있는지, 이미 썼는지 */
export async function getReviewState(pool: Pool, p: { bookingNo: string; phone: string; ip: string }): Promise<ReviewState> {
  const row = await verifyBooking(pool, p.bookingNo, p.phone, p.ip);
  await completeFinishedBookings(pool);
  const b = (await pool.query(`select id, status, check_out::text as check_out from bookings where id = $1`, [row.id])).rows[0];
  const windowEndsAt = addDays(b.check_out, await windowDays(pool));
  const rev = (await pool.query(`${REVIEW_SQL} where r.booking_id = $1`, [b.id])).rows[0];
  if (rev) return { state: "written", windowEndsAt, review: shape(rev) };
  if (b.status === "confirmed") return { state: "not_yet", windowEndsAt };
  if (b.status !== "completed") return { state: "unavailable", windowEndsAt };
  if (kstToday() > windowEndsAt) return { state: "expired", windowEndsAt };
  return { state: "eligible", windowEndsAt };
}

export async function createReview(pool: Pool, p: { bookingNo: string; phone: string; ip: string; rating: unknown; details?: unknown; content: unknown }) {
  const v = validateReview(p);
  const st = await getReviewState(pool, p);
  if (st.state === "written") throw new ReviewError("EXISTS", "이미 이 예약의 후기를 작성하셨습니다", 409);
  if (st.state === "not_yet") throw new ReviewError("NOT_ALLOWED", "이용이 끝난 뒤에 후기를 작성할 수 있습니다", 409);
  if (st.state === "expired") throw new ReviewError("NOT_ALLOWED", "후기 작성 기간이 지났습니다", 409);
  if (st.state !== "eligible") throw new ReviewError("NOT_ALLOWED", "후기를 작성할 수 없는 예약입니다", 409);
  const row = await verifyBooking(pool, p.bookingNo, p.phone, p.ip);
  try {
    const ins = await pool.query(
      `insert into reviews (booking_id, author_name, rating, rating_details, content) values ($1, $2, $3, $4::jsonb, $5) returning id`,
      [row.id, maskName(row.guest_name), v.rating, JSON.stringify(v.details), v.content]);
    return { id: ins.rows[0].id as number };
  } catch (e: any) {
    if (e?.code === "23505") throw new ReviewError("EXISTS", "이미 이 예약의 후기를 작성하셨습니다", 409);
    throw e;
  }
}

async function ownReview(pool: Pool, p: { bookingNo: string; phone: string; ip: string }) {
  const row = await verifyBooking(pool, p.bookingNo, p.phone, p.ip);
  const rev = (await pool.query(`${REVIEW_SQL} where r.booking_id = $1`, [row.id])).rows[0];
  if (!rev) throw new ReviewError("NOT_FOUND", "작성한 후기가 없습니다", 404);
  return rev;
}

export async function updateReview(pool: Pool, p: { bookingNo: string; phone: string; ip: string; rating: unknown; details?: unknown; content: unknown }) {
  const v = validateReview(p);
  const rev = await ownReview(pool, p);
  if (rev.status === "hidden") throw new ReviewError("LOCKED", "비공개 처리된 후기는 수정할 수 없습니다. 문의해 주세요", 409);
  if (!shape(rev).editable) throw new ReviewError("LOCKED", `후기는 작성 후 ${EDIT_DAYS}일 안에만 수정할 수 있습니다`, 409);
  await pool.query(`update reviews set rating = $2, rating_details = $3::jsonb, content = $4 where id = $1`, [rev.id, v.rating, JSON.stringify(v.details), v.content]);
  return { id: rev.id as number };
}

export async function deleteOwnReview(pool: Pool, p: { bookingNo: string; phone: string; ip: string }) {
  const rev = await ownReview(pool, p);
  if (rev.status === "hidden") throw new ReviewError("LOCKED", "비공개 처리된 후기는 삭제할 수 없습니다. 문의해 주세요", 409);
  await pool.query(`delete from reviews where id = $1`, [rev.id]);
  return { ok: true };
}

// ---------------------------------------------------------------- 공개 목록·요약
const PUBLIC = `r.status in ('visible', 'reported')`;

export async function reviewSummary(pool: Pool) {
  const { rows } = await pool.query(
    `select count(*)::int as n, coalesce(round(avg(rating)::numeric, 1), 0)::float as avg,
            count(*) filter (where rating = 5)::int as c5, count(*) filter (where rating = 4)::int as c4, count(*) filter (where rating = 3)::int as c3,
            count(*) filter (where rating = 2)::int as c2, count(*) filter (where rating = 1)::int as c1,
            ${DETAIL_KEYS.map((k) => `round(avg((rating_details->>'${k}')::int)::numeric, 1)::float as d_${k}`).join(", ")}
       from reviews r where ${PUBLIC}`);
  const r = rows[0];
  return {
    count: r.n as number, average: r.avg as number,
    distribution: { 5: r.c5, 4: r.c4, 3: r.c3, 2: r.c2, 1: r.c1 } as Record<number, number>,
    details: DETAIL_KEYS.flatMap((k) => (r[`d_${k}`] == null ? [] : [{ key: k, label: DETAIL_LABEL[k], average: r[`d_${k}`] as number }])),
  };
}

export async function listPublicReviews(pool: Pool, p: { page?: number; pageSize?: number } = {}) {
  const pageSize = Math.min(Math.max(p.pageSize ?? 10, 1), 50);
  const page = Math.max(0, p.page ?? 0);
  const { rows } = await pool.query(
    `select r.id::int as id, r.author_name, r.rating, r.rating_details, r.content, r.created_at, to_char(b.check_in, 'YYYY.MM') as stay,
            rp.content as reply, rp.created_at as reply_at
       from reviews r join bookings b on b.id = r.booking_id left join review_replies rp on rp.review_id = r.id
      where ${PUBLIC} order by r.created_at desc limit $1 offset $2`, [pageSize, page * pageSize]);
  return rows.map((r) => ({
    id: r.id as number, author: r.author_name as string, rating: r.rating as number, details: (r.rating_details ?? {}) as Record<string, number>,
    content: r.content as string, createdAt: r.created_at as Date, stay: r.stay as string, reply: (r.reply as string | null) ?? null, replyAt: (r.reply_at as Date | null) ?? null,
  }));
}

export type PublicReview = Awaited<ReturnType<typeof listPublicReviews>>[number];

// ---------------------------------------------------------------- 신고
export async function reportReview(pool: Pool, p: { reviewId: number; reason: string; detail?: string; ip: string | null }) {
  if (!(REPORT_REASONS as readonly string[]).includes(p.reason)) throw bad("신고 사유를 선택해 주세요");
  const detail = cleanText(p.detail ?? "", 300) || null;
  const r = await pool.query(`select status from reviews where id = $1`, [p.reviewId]);
  if (!r.rows[0] || r.rows[0].status === "hidden") throw new ReviewError("NOT_FOUND", "후기를 찾을 수 없습니다", 404);
  const ins = await pool.query(
    `insert into review_reports (review_id, reason, detail, ip) values ($1, $2, $3, $4::inet)
     on conflict (review_id, ip) where ip is not null do nothing returning id`, [p.reviewId, p.reason, detail, p.ip]);
  await pool.query(`update reviews set status = 'reported' where id = $1 and status = 'visible'`, [p.reviewId]);   // 숨기지는 않고 관리자 검토 대상으로만 표시
  return { ok: true, duplicate: ins.rowCount === 0 };
}
