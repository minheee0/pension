import type { Db } from "@/server/booking/hold";
import type { PolicyRule } from "@/server/refund/calc";
import { buildRefundTable, type PolicyView } from "@/server/refund/table";

/** 이용안내·예약 화면에 보여줄 정책 요약. DB의 현재 규정을 그대로 쓴다. */
export async function getPolicyView(db: Db): Promise<PolicyView> {
  const [rules, settings, seasons, options] = await Promise.all([
    db.query(`select tier, day_type, days_before_min, deduct_rate from refund_policies where applies_to = 'room'`),
    db.query(`select key, value from policy_settings`),
    db.query(`select name, date_from::text as date_from, date_to::text as date_to from season_periods
               where active and date_to >= (now() at time zone 'Asia/Seoul')::date order by date_from`),
    db.query(`select name, order_deadline_days_before as d, order_deadline_time::text as t
                from options where active order by sort_order, id`),
  ]);
  const s = new Map<string, string>(settings.rows.map((r) => [r.key, r.value]));
  const policy: PolicyRule[] = rules.rows.map((r) => ({
    tier: r.tier, dayType: r.day_type, daysBeforeMin: r.days_before_min, deductRate: r.deduct_rate,
  }));
  return {
    // 환불 수치를 확정하기 전에는 화면에 "임시 규정"이라고 표시된다. 확정 후 .env 에 REFUND_POLICY_CONFIRMED=true
    confirmed: process.env.REFUND_POLICY_CONFIRMED === "true",
    table: buildRefundTable(policy),
    seasons: seasons.rows.map((r) => ({ name: r.name, dateFrom: r.date_from, dateTo: r.date_to })),
    checkInTime: s.get("check_in_time") ?? "16:00",
    checkOutTime: s.get("check_out_time") ?? "12:00",
    noShowTime: s.get("no_show_deadline_time") ?? "22:00",
    freeChangeDaysOff: Number(s.get("free_change_days_off") ?? 7),
    freeChangeDaysPeak: Number(s.get("free_change_days_peak") ?? 14),
    options: options.rows.map((r) => ({ name: r.name, deadlineDaysBefore: r.d, deadlineTime: String(r.t).slice(0, 5) })),
  };
}
