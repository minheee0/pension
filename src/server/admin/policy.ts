import type { Pool } from "pg";
import { withTx } from "@/server/booking/hold";
import { audit, type AdminCtx } from "./audit";
import { AdminError } from "./errors";

const bad = (m: string) => new AdminError("INVALID_INPUT", m, 400);

export async function getRefundRules(pool: Pool) {
  const { rows } = await pool.query(
    `select id::int as id, tier, day_type, days_before_min, deduct_rate from refund_policies where applies_to = 'room' order by tier desc, day_type, days_before_min desc`);
  return rows as { id: number; tier: "off" | "peak"; day_type: "weekday" | "weekend"; days_before_min: number; deduct_rate: number }[];
}

/**
 * 환불 공제율 수정. 새 예약부터 적용된다(기존 예약은 예약 당시 규정 유지).
 * 검증: 0~100, 같은 등급·요일 안에서 체크인이 가까울수록 공제율이 같거나 커야 한다.
 */
export async function saveRefundRules(pool: Pool, admin: AdminCtx, updates: { id: number; deductRate: number }[]) {
  const current = await getRefundRules(pool);
  const next = new Map(current.map((r) => [r.id, r.deduct_rate]));
  for (const u of updates) {
    if (!next.has(u.id)) throw new AdminError("NOT_FOUND", "존재하지 않는 규정입니다", 404);
    if (!Number.isInteger(u.deductRate) || u.deductRate < 0 || u.deductRate > 100) throw bad("공제율은 0~100 사이 정수여야 합니다");
    next.set(u.id, u.deductRate);
  }
  const groups = new Map<string, typeof current>();
  for (const r of current) { const k = `${r.tier}/${r.day_type}`; groups.set(k, [...(groups.get(k) ?? []), r]); }
  for (const [k, rows] of groups) {
    const sorted = [...rows].sort((a, b) => b.days_before_min - a.days_before_min);   // 먼 날짜 → 가까운 날짜
    for (let i = 1; i < sorted.length; i++) {
      if (next.get(sorted[i].id)! < next.get(sorted[i - 1].id)!) {
        throw bad(`${k}: 체크인이 가까워질수록 공제율이 줄어들 수 없습니다 (${sorted[i - 1].days_before_min}일 전 ${next.get(sorted[i - 1].id)}% → ${sorted[i].days_before_min}일 전 ${next.get(sorted[i].id)}%)`);
      }
    }
  }
  const changed = updates.filter((u) => current.find((r) => r.id === u.id)!.deduct_rate !== u.deductRate);
  if (!changed.length) return { changed: 0 };
  await withTx(pool, async (c) => { for (const u of changed) await c.query(`update refund_policies set deduct_rate = $2 where id = $1`, [u.id, u.deductRate]); });
  await audit(pool, admin, "policy.refund", {},
    changed.map((u) => ({ id: u.id, rate: current.find((r) => r.id === u.id)!.deduct_rate })), changed.map((u) => ({ id: u.id, rate: u.deductRate })));
  return { changed: changed.length };
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const int = (min: number, max: number, label: string) => (v: string) => {
  if (!/^\d{1,7}$/.test(v) || Number(v) < min || Number(v) > max) throw bad(`${label}은(는) ${min}~${max} 사이의 숫자여야 합니다`);
};
export const SETTING_DEFS: Record<string, { label: string; hint: string; validate: (v: string) => void }> = {
  base_guests: { label: "기준 인원", hint: "추가 요금 없이 머무는 인원", validate: int(1, 10, "기준 인원") },
  max_guests: { label: "최대 인원", hint: "예약 가능한 최대 인원", validate: int(1, 20, "최대 인원") },
  extra_person_fee: { label: "추가 인원 1인당 요금(원)", hint: "기준 인원 초과 시 1인당", validate: int(0, 1_000_000, "추가 인원 요금") },
  extra_fee_mode: { label: "추가 요금 방식", hint: "per_stay = 1회 숙박당 1회, per_night = 박마다", validate: (v) => { if (!["per_stay", "per_night"].includes(v)) throw bad("추가 요금 방식은 per_stay 또는 per_night 입니다"); } },
  hold_minutes: { label: "결제 대기 시 날짜 확보 시간(분)", hint: "결제창을 열고 기다려 주는 시간", validate: int(5, 60, "확보 시간") },
  virtual_account_due_minutes: { label: "가상계좌 입금 기한(분)", hint: "발급 후 입금 가능 시간 (최대 3일)", validate: int(30, 4320, "입금 기한") },
  booking_open_days: { label: "예약 오픈 기간(일)", hint: "오늘부터 며칠 뒤까지 예약 받을지", validate: int(30, 730, "예약 오픈 기간") },
  weekend_days: { label: "주말로 보는 요일", hint: "그날 '밤' 기준. 예: FRI,SAT", validate: (v) => { const d = v.split(",").map((x) => x.trim().toUpperCase()); if (!d.length || d.some((x) => !["MON","TUE","WED","THU","FRI","SAT","SUN"].includes(x))) throw bad("요일은 FRI,SAT 처럼 MON~SUN 을 쉼표로 구분해 주세요"); } },
  checkin_guide: { label: "체크인 안내문 (전날 문자에 덧붙임)", hint: "출입 방법·주차·대문 비밀번호 안내 등. 300자 이내", validate: (v) => { if (v.length > 300) throw bad("체크인 안내문은 300자 이내로 적어 주세요"); } },
  member_review_days: { label: "후기 작성 가능 기간(일)", hint: "체크아웃 후 며칠까지 후기를 쓸 수 있는지", validate: int(1, 365, "후기 작성 기간") },
  check_in_time: { label: "체크인 시각", hint: "HH:MM (안내 문구용)", validate: (v) => { if (!HHMM.test(v)) throw bad("체크인 시각 형식은 HH:MM 입니다"); } },
  check_out_time: { label: "체크아웃 시각", hint: "HH:MM (안내 문구용)", validate: (v) => { if (!HHMM.test(v)) throw bad("체크아웃 시각 형식은 HH:MM 입니다"); } },
  no_show_deadline_time: { label: "노쇼 판정 시각", hint: "체크인 당일 이 시각까지 연락 없으면 노쇼 (안내 문구용)", validate: (v) => { if (!HHMM.test(v)) throw bad("노쇼 판정 시각 형식은 HH:MM 입니다"); } },
};

export async function getSettings(pool: Pool) {
  const { rows } = await pool.query(`select key, value from policy_settings`);
  const m = new Map(rows.map((r) => [r.key, r.value as string]));
  return Object.entries(SETTING_DEFS).map(([key, d]) => ({ key, label: d.label, hint: d.hint, value: m.get(key) ?? "" }));
}

export async function saveSettings(pool: Pool, admin: AdminCtx, values: Record<string, string>) {
  const cur = new Map((await getSettings(pool)).map((s) => [s.key, s.value]));
  const next: Record<string, string> = {};
  for (const [k, raw] of Object.entries(values)) {
    const def = SETTING_DEFS[k];
    if (!def) throw bad(`변경할 수 없는 설정입니다: ${k}`);
    const v = raw.trim();
    def.validate(v);
    next[k] = k === "weekend_days" ? v.split(",").map((x) => x.trim().toUpperCase()).join(",") : v;
  }
  const merged = (k: string) => next[k] ?? cur.get(k) ?? "";
  if (Number(merged("max_guests")) < Number(merged("base_guests"))) throw bad("최대 인원은 기준 인원보다 작을 수 없습니다");
  const changed = Object.entries(next).filter(([k, v]) => cur.get(k) !== v);
  if (!changed.length) return { changed: 0 };
  await withTx(pool, async (c) => { for (const [k, v] of changed) await c.query(`insert into policy_settings (key, value) values ($1, $2) on conflict (key) do update set value = $2`, [k, v]); });
  await audit(pool, admin, "policy.settings", {}, Object.fromEntries(changed.map(([k]) => [k, cur.get(k)])), Object.fromEntries(changed));
  return { changed: changed.length };
}
