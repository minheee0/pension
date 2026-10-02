import type { Pool } from "pg";
import { audit, type AdminCtx } from "./audit";
import { AdminError } from "./errors";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const bad = (m: string) => new AdminError("INVALID_INPUT", m, 400);
const money = (n: number, label: string) => { if (!Number.isInteger(n) || n < 0 || n > 10_000_000) throw bad(`${label}은(는) 0~10,000,000원 사이의 숫자여야 합니다`); return n; };
const date = (s: string, label: string) => { if (!ISO.test(s) || isNaN(Date.parse(s))) throw bad(`${label} 날짜 형식이 올바르지 않습니다`); return s; };

export async function getPricing(pool: Pool) {
  const [base, seasons, overrides, options, fee] = await Promise.all([
    pool.query(`select day_type, price from base_prices`),
    pool.query(`select id::int as id, name, date_from::text as date_from, date_to::text as date_to, price_weekday, price_weekend, min_nights, refund_tier, active from season_periods order by date_from`),
    pool.query(`select date::text as date, price, day_type, refund_tier, min_nights, memo from date_overrides where date >= current_date - 30 order by date`),
    pool.query(`select id::int as id, code, name, description, price, unit_type, max_qty, time_slots, order_deadline_days_before as deadline_days, order_deadline_time::text as deadline_time, active from options order by sort_order, id`),
    pool.query(`select value from policy_settings where key = 'extra_person_fee'`),
  ]);
  const b = Object.fromEntries(base.rows.map((r) => [r.day_type, r.price as number]));
  return { base: { weekday: b.weekday as number, weekend: b.weekend as number }, seasons: seasons.rows, overrides: overrides.rows,
    options: options.rows.map((o) => ({ ...o, deadline_time: String(o.deadline_time).slice(0, 5) })), extraPersonFee: Number(fee.rows[0]?.value ?? 0) };
}

export async function setBasePrices(pool: Pool, admin: AdminCtx, p: { weekday: number; weekend: number }) {
  const before = await getPricing(pool).then((x) => x.base);
  money(p.weekday, "평일 요금"); money(p.weekend, "주말 요금");
  await pool.query(`update base_prices set price = case day_type when 'weekday' then $1::int else $2::int end`, [p.weekday, p.weekend]);
  await audit(pool, admin, "pricing.base", {}, before, p);
}

export async function saveSeason(pool: Pool, admin: AdminCtx, p: { id?: number; name: string; dateFrom: string; dateTo: string; priceWeekday: number; priceWeekend: number; minNights: number; active: boolean }) {
  if (!p.name.trim()) throw bad("성수기 이름을 입력해 주세요");
  date(p.dateFrom, "시작"); date(p.dateTo, "종료");
  if (p.dateTo < p.dateFrom) throw bad("종료일이 시작일보다 빠릅니다");
  money(p.priceWeekday, "평일 요금"); money(p.priceWeekend, "주말 요금");
  if (!Number.isInteger(p.minNights) || p.minNights < 1 || p.minNights > 30) throw bad("최소 숙박일은 1~30박이어야 합니다");
  try {
    if (p.id) {
      const before = (await pool.query(`select * from season_periods where id = $1`, [p.id])).rows[0];
      if (!before) throw new AdminError("NOT_FOUND", "성수기를 찾을 수 없습니다", 404);
      await pool.query(`update season_periods set name=$2, date_from=$3::date, date_to=$4::date, price_weekday=$5, price_weekend=$6, min_nights=$7, active=$8 where id=$1`,
        [p.id, p.name.trim(), p.dateFrom, p.dateTo, p.priceWeekday, p.priceWeekend, p.minNights, p.active]);
      await audit(pool, admin, "pricing.season.update", { type: "season", id: String(p.id) }, before, p);
    } else {
      const r = await pool.query(`insert into season_periods (name, date_from, date_to, price_weekday, price_weekend, min_nights, active) values ($1,$2::date,$3::date,$4,$5,$6,$7) returning id`,
        [p.name.trim(), p.dateFrom, p.dateTo, p.priceWeekday, p.priceWeekend, p.minNights, p.active]);
      await audit(pool, admin, "pricing.season.create", { type: "season", id: String(r.rows[0].id) }, undefined, p);
    }
  } catch (e: any) {
    if (e?.code === "23P01") throw new AdminError("CONFLICT", "다른 성수기와 기간이 겹칩니다. 기간을 확인해 주세요", 409);
    throw e;
  }
}

export async function deleteSeason(pool: Pool, admin: AdminCtx, id: number) {
  const r = await pool.query(`delete from season_periods where id = $1 returning name, date_from::text as date_from, date_to::text as date_to`, [id]);
  if (!r.rows[0]) throw new AdminError("NOT_FOUND", "성수기를 찾을 수 없습니다", 404);
  await audit(pool, admin, "pricing.season.delete", { type: "season", id: String(id) }, r.rows[0]);
}

export async function saveOverride(pool: Pool, admin: AdminCtx, p: { date: string; price: number; dayType: "weekday" | "weekend"; refundTier: "off" | "peak"; minNights: number; memo?: string }) {
  date(p.date, "날짜"); money(p.price, "요금");
  if (!Number.isInteger(p.minNights) || p.minNights < 1 || p.minNights > 30) throw bad("최소 숙박일은 1~30박이어야 합니다");
  const before = (await pool.query(`select * from date_overrides where date = $1::date`, [p.date])).rows[0];
  await pool.query(
    `insert into date_overrides (date, price, day_type, refund_tier, min_nights, memo) values ($1::date,$2,$3,$4,$5,$6)
     on conflict (date) do update set price=$2, day_type=$3, refund_tier=$4, min_nights=$5, memo=$6`,
    [p.date, p.price, p.dayType, p.refundTier, p.minNights, (p.memo ?? "").trim().slice(0, 100) || null]);
  await audit(pool, admin, "pricing.override.save", { type: "override", id: p.date }, before, p);
}

export async function deleteOverride(pool: Pool, admin: AdminCtx, d: string) {
  date(d, "날짜");
  const r = await pool.query(`delete from date_overrides where date = $1::date returning price, memo`, [d]);
  if (!r.rows[0]) throw new AdminError("NOT_FOUND", "특정일 요금을 찾을 수 없습니다", 404);
  await audit(pool, admin, "pricing.override.delete", { type: "override", id: d }, r.rows[0]);
}

export async function saveOption(pool: Pool, admin: AdminCtx, p: { id: number; price: number; active: boolean; maxQty: number; timeSlots: string; deadlineDays: number; deadlineTime: string }) {
  money(p.price, "옵션 가격");
  if (!Number.isInteger(p.maxQty) || p.maxQty < 1 || p.maxQty > 20) throw bad("최대 수량은 1~20이어야 합니다");
  if (!Number.isInteger(p.deadlineDays) || p.deadlineDays < 0 || p.deadlineDays > 30) throw bad("신청 마감일은 0~30일 전이어야 합니다");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.deadlineTime)) throw bad("마감 시각 형식은 HH:MM 입니다");
  const slots = p.timeSlots.split(",").map((s) => s.trim()).filter(Boolean);
  if (slots.some((s) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(s))) throw bad("시작 시간 목록은 17:00,18:00 처럼 HH:MM 을 쉼표로 구분해 주세요");
  if (p.active && p.price === 0) throw bad("가격이 0원인 옵션은 활성화할 수 없습니다. 가격을 먼저 입력해 주세요");
  const before = (await pool.query(`select price, active, max_qty, time_slots from options where id = $1`, [p.id])).rows[0];
  if (!before) throw new AdminError("NOT_FOUND", "옵션을 찾을 수 없습니다", 404);
  await pool.query(`update options set price=$2, active=$3, max_qty=$4, time_slots=$5::text[], order_deadline_days_before=$6, order_deadline_time=$7::time where id=$1`,
    [p.id, p.price, p.active, p.maxQty, slots, p.deadlineDays, p.deadlineTime]);
  await audit(pool, admin, "pricing.option", { type: "option", id: String(p.id) }, before, { ...p, timeSlots: slots });
}
