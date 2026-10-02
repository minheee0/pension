import type { Pool } from "pg";
import { withTx } from "@/server/booking/hold";
import { audit, type AdminCtx } from "./audit";
import { AdminError } from "./errors";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (s: string, n: number) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const diff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

export interface AdminDay { date: string; status: "available" | "held" | "booked" | "blocked"; bookingNo: string | null; guestName: string | null; memo: string | null; price: number | null }

/** 월별 재고 현황. 만료된 임시 점유는 빈 날로 본다(고객 화면과 동일 기준). */
export async function getAdminMonth(pool: Pool, month: string): Promise<AdminDay[]> {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) throw new AdminError("INVALID_INPUT", "월 형식이 올바르지 않습니다", 400);
  const { rows } = await pool.query(
    `with p as (select ($1::text || '-01')::date as f)
     select (p.f + g.i)::text as date,
            case when sd.status is null or (sd.status = 'held' and sd.held_until <= now()) then 'available' else sd.status end as status,
            b.booking_no, b.guest_name, sd.memo, r.price
       from p cross join generate_series(0, ((p.f + interval '1 month')::date - p.f) - 1) g(i)
       left join stay_dates sd on sd.date = p.f + g.i
       left join bookings b on b.id = sd.booking_id and not (sd.status = 'held' and sd.held_until <= now())
       left join lateral resolve_night(p.f + g.i) r on true
      order by g.i`, [month]);
  return rows.map((r) => ({ date: r.date, status: r.status, bookingNo: r.booking_no, guestName: r.guest_name, memo: r.memo, price: r.price }));
}

function range(from: string, to: string) {
  if (!ISO.test(from) || !ISO.test(to)) throw new AdminError("INVALID_INPUT", "날짜 형식이 올바르지 않습니다", 400);
  const n = diff(from, to) + 1;
  if (n < 1) throw new AdminError("INVALID_INPUT", "끝 날짜가 시작 날짜보다 빠릅니다", 400);
  if (n > 366) throw new AdminError("INVALID_INPUT", "한 번에 최대 366일까지 설정할 수 있습니다", 400);
  return n;
}

/** [from, to] (끝 날짜 포함, "그 날 밤") 을 예약 불가로 막는다. 이미 예약·진행 중인 날이 하나라도 있으면 아무것도 바꾸지 않는다. */
export async function blockDates(pool: Pool, admin: AdminCtx, p: { from: string; to: string; memo?: string }) {
  const n = range(p.from, p.to);
  const today = (await pool.query(`select (now() at time zone 'Asia/Seoul')::date::text as d`)).rows[0].d as string;
  if (p.from < today) throw new AdminError("INVALID_INPUT", "지난 날짜는 설정할 수 없습니다", 400);
  const memo = (p.memo ?? "").trim().slice(0, 100) || null;

  const changed = await withTx(pool, async (c) => {
    await c.query(`insert into stay_dates (date) select $1::date + g.i from generate_series(0, $2::int - 1) g(i) on conflict do nothing`, [p.from, n]);
    const { rows } = await c.query(
      `select s.date::text as date, s.status, s.booking_id, (s.status = 'held' and s.held_until <= now()) as stale, b.booking_no
         from stay_dates s left join bookings b on b.id = s.booking_id
        where s.date >= $1::date and s.date <= $2::date order by s.date for update of s`, [p.from, p.to]);
    const conflicts = rows.filter((r) => ["booked", "held"].includes(r.status) && !r.stale);
    if (conflicts.length) {
      throw new AdminError("CONFLICT", `이미 예약되었거나 예약 진행 중인 날이 있어 막을 수 없습니다: ${conflicts.map((r) => `${r.date.slice(5)}(${r.booking_no})`).join(", ")}`, 409, { conflicts: conflicts.map((r) => r.date) });
    }
    const staleOwners = [...new Set(rows.filter((r) => r.stale && r.booking_id).map((r) => r.booking_id))];
    if (staleOwners.length) await c.query(`update bookings set status = 'expired' where id = any($1::uuid[]) and status in ('held','pending_payment')`, [staleOwners]);
    await c.query(
      `update stay_dates set status = 'blocked', booking_id = null, held_until = null, memo = $3 where date >= $1::date and date <= $2::date`,
      [p.from, p.to, memo]);
    return rows.length;
  });
  await audit(pool, admin, "calendar.block", { type: "calendar", id: `${p.from}~${p.to}` }, undefined, { nights: changed, memo });
  return { changed };
}

export async function unblockDates(pool: Pool, admin: AdminCtx, p: { from: string; to: string }) {
  range(p.from, p.to);
  const r = await pool.query(
    `update stay_dates set status = 'available', memo = null where status = 'blocked' and date >= $1::date and date <= $2::date`, [p.from, p.to]);
  await audit(pool, admin, "calendar.unblock", { type: "calendar", id: `${p.from}~${p.to}` }, undefined, { nights: r.rowCount });
  return { changed: r.rowCount ?? 0 };
}
