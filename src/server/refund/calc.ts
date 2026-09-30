/**
 * 취소 환불 계산 (순수 함수: DB·네트워크 없음)
 *
 * 규칙 요약
 *  - 며칠 전인지: 체크인 "날짜"와 취소 시각의 한국시간(KST) 날짜 차이. 노쇼는 0일(당일).
 *  - 객실: 박마다 (요금 등급, 주중/주말)로 공제율을 찾아 박 요금에 적용한다. 며칠 전은 체크인일 기준으로 모든 박에 동일.
 *  - 추가 인원 요금: 객실 요금과 같은 비율로 공제한다.
 *  - 옵션(바비큐·찜질방): 이용 N일 전 HH:MM(KST)까지는 전액 환불, 이후는 환불 불가.
 *  - 사업자 귀책(cause='host')은 전액 환불. 예약 직후 무료취소 시간(선택)은 체크인 1일 전까지만 적용.
 *  - 공제액은 원 단위 내림(고객에게 유리). 환불액은 결제액을 넘지 않는다.
 *  - 규정에 빈 구간이 있거나 할인이 적용된 예약은 추측하지 않고 오류를 던진다(수동 확인).
 *  - 규정은 "예약 당시 스냅샷"(bookings.policy_snapshot / price_snapshot)을 넘겨서 쓴다.
 */

export type Tier = "off" | "peak";
export type DayType = "weekday" | "weekend";

export interface PolicyRule { tier: Tier; dayType: DayType; daysBeforeMin: number; deductRate: number }
export interface NightSnap { date: string; price: number; refundTier: Tier; dayType: DayType }
export interface OptionSnap {
  name: string; amount: number; useDate: string | null; useTime: string | null;
  deadlineDaysBefore: number; deadlineTime: string;
}

export interface RefundInput {
  checkIn: string;              // YYYY-MM-DD
  nights: NightSnap[];
  extraGuestFee: number;
  options: OptionSnap[];
  discountAmount: number;
  policy: PolicyRule[];         // 객실 환불 규정(예약 당시)
  paidAmount: number;           // 실제 결제된 금액
  now: Date;                    // 취소 시각
  cause: "guest" | "no_show" | "host";
  bookedAt?: Date;
  freeCancelMinutes?: number;   // 예약 직후 무료취소 시간(분). 미사용이면 생략
}

export interface RefundLine {
  kind: "night" | "extra" | "option";
  label: string;
  amount: number;
  deductRate: number;           // 실제 적용된 공제율(%)
  deduct: number;
  refund: number;
}

export interface RefundResult {
  daysBefore: number;
  basis: "policy" | "host_fault" | "free_cancel_window";
  lines: RefundLine[];
  totalAmount: number;
  deductTotal: number;
  refundTotal: number;
}

export class RefundPolicyError extends Error {
  constructor(message: string) { super(message); this.name = "RefundPolicyError"; }
}

const KST_MS = 9 * 3600e3;
export const kstDate = (d: Date) => new Date(d.getTime() + KST_MS).toISOString().slice(0, 10);
const diffDays = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** 체크인까지 남은 일수(KST 달력일 기준). 체크인 이후면 0 */
export const daysBeforeCheckIn = (checkIn: string, now: Date) => Math.max(0, diffDays(kstDate(now), checkIn));

/** 해당 등급·요일 유형에서 "N일 전"에 적용되는 공제율. 규정에 빈 구간이 있으면 오류 */
export function lookupRate(rules: PolicyRule[], tier: Tier, dayType: DayType, daysBefore: number): number {
  let best: PolicyRule | undefined;
  for (const r of rules) {
    if (r.tier !== tier || r.dayType !== dayType || r.daysBeforeMin > daysBefore) continue;
    if (!best || r.daysBeforeMin > best.daysBeforeMin) best = r;
  }
  if (!best) throw new RefundPolicyError(`환불 규정에 ${tier}/${dayType} ${daysBefore}일 전 구간이 없습니다`);
  return best.deductRate;
}

function optionDeadline(useDate: string, daysBefore: number, time: string): Date {
  const d = new Date(`${useDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - daysBefore);
  return new Date(`${d.toISOString().slice(0, 10)}T${time}:00+09:00`);
}

export function calcRefund(input: RefundInput): RefundResult {
  if (input.discountAmount > 0) throw new RefundPolicyError("할인이 적용된 예약은 환불 금액을 수동으로 확인해야 합니다");
  if (input.nights.length === 0) throw new RefundPolicyError("박별 요금 스냅샷이 없습니다");

  const daysBefore = input.cause === "no_show" ? 0 : daysBeforeCheckIn(input.checkIn, input.now);

  let basis: RefundResult["basis"] = "policy";
  if (input.cause === "host") basis = "host_fault";
  else if (
    input.cause === "guest" && input.freeCancelMinutes && input.freeCancelMinutes > 0 && input.bookedAt &&
    daysBefore >= 1
  ) {
    const elapsed = input.now.getTime() - input.bookedAt.getTime();
    if (elapsed >= 0 && elapsed <= input.freeCancelMinutes * 60_000) basis = "free_cancel_window";
  }
  const waive = basis !== "policy";

  const lines: RefundLine[] = [];
  const push = (kind: RefundLine["kind"], label: string, amount: number, deduct: number) =>
    lines.push({
      kind, label, amount, deduct, refund: amount - deduct,
      deductRate: amount > 0 ? (deduct * 100) / amount : 0,
    });

  let roomTotal = 0, roomDeduct = 0;
  for (const n of input.nights) {
    const rate = waive ? 0 : lookupRate(input.policy, n.refundTier, n.dayType, daysBefore);
    const deduct = Math.floor((n.price * rate) / 100);
    roomTotal += n.price; roomDeduct += deduct;
    push("night", n.date, n.price, deduct);
  }

  if (input.extraGuestFee > 0) {
    const deduct = roomTotal > 0 ? Math.floor((input.extraGuestFee * roomDeduct) / roomTotal) : 0;
    push("extra", "추가 인원", input.extraGuestFee, deduct);
  }

  for (const o of input.options) {
    const refundable =
      waive || input.now.getTime() <= optionDeadline(o.useDate ?? input.checkIn, o.deadlineDaysBefore, o.deadlineTime).getTime();
    push("option", o.name, o.amount, refundable ? 0 : o.amount);
  }

  const totalAmount = lines.reduce((s, l) => s + l.amount, 0);
  const deductTotal = lines.reduce((s, l) => s + l.deduct, 0);
  const refundTotal = Math.max(0, Math.min(input.paidAmount, totalAmount - deductTotal));
  return { daysBefore, basis, lines, totalAmount, deductTotal, refundTotal };
}

// ------------------------------------------------------------------
// DB 예약 행(스냅샷) → 계산 입력. 스냅샷 형식이 바뀌면 이 함수와 테스트가 함께 깨져야 한다.
// ------------------------------------------------------------------
export interface BookingRefundRow {
  check_in: string;
  extra_guest_fee: number;
  discount_amount: number;
  created_at: Date;
  price_snapshot: any;   // holdStay 가 저장한 Quote(JSON)
  policy_snapshot: any;  // { refund_policies: [{applies_to,tier,day_type,days_before_min,deduct_rate}], settings }
}

export function refundInputFromBooking(
  row: BookingRefundRow,
  opts: { now: Date; cause: RefundInput["cause"]; paidAmount: number; freeCancelMinutes?: number },
): RefundInput {
  const q = row.price_snapshot;
  return {
    checkIn: row.check_in,
    nights: (q.nights as any[]).map((n) => ({ date: n.date, price: n.price, refundTier: n.refundTier, dayType: n.dayType })),
    extraGuestFee: row.extra_guest_fee,
    options: ((q.options ?? []) as any[]).map((o) => ({
      name: o.name, amount: o.amount, useDate: o.useDate ?? null, useTime: o.useTime ?? null,
      deadlineDaysBefore: o.deadlineDaysBefore ?? 1,   // 구버전 스냅샷 대비 기본값
      deadlineTime: o.deadlineTime ?? "18:00",
    })),
    discountAmount: row.discount_amount,
    policy: ((row.policy_snapshot?.refund_policies ?? []) as any[])
      .filter((r) => r.applies_to === "room")
      .map((r) => ({ tier: r.tier, dayType: r.day_type, daysBeforeMin: r.days_before_min, deductRate: r.deduct_rate })),
    paidAmount: opts.paidAmount,
    now: opts.now,
    cause: opts.cause,
    bookedAt: row.created_at,
    freeCancelMinutes: opts.freeCancelMinutes,
  };
}
