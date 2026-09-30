import { lookupRate, type DayType, type PolicyRule, type Tier } from "./calc";

// 화면 표시용. 계산(calc.ts)과 같은 lookupRate 를 써서 표시와 실제 환불이 어긋나지 않게 한다.
export interface RefundTableView {
  rows: { label: string; minDays: number }[];
  columns: { label: string; refundRates: (number | null)[] }[];   // 환불 % (null = 규정 없음)
}

export interface PolicyView {
  confirmed: boolean;
  table: RefundTableView;
  seasons: { name: string; dateFrom: string; dateTo: string }[];
  checkInTime: string; checkOutTime: string; noShowTime: string;
  freeChangeDaysOff: number; freeChangeDaysPeak: number;
  options: { name: string; deadlineDaysBefore: number; deadlineTime: string }[];
}

const COLUMNS: { tier: Tier; dayType: DayType; label: string }[] = [
  { tier: "off", dayType: "weekday", label: "비수기 주중" },
  { tier: "off", dayType: "weekend", label: "비수기 주말" },
  { tier: "peak", dayType: "weekday", label: "성수기 주중" },
  { tier: "peak", dayType: "weekend", label: "성수기 주말·연휴" },
];

export function buildRefundTable(rules: PolicyRule[]): RefundTableView {
  const mins = [...new Set(rules.map((r) => r.daysBeforeMin))].sort((a, b) => b - a);
  const rows = mins.map((m, i) => {
    const upper = i === 0 ? null : mins[i - 1] - 1;
    const label = m === 0 ? "당일 · 노쇼"
      : i === 0 ? `${m}일 전까지`
      : upper === m ? `${m}일 전`
      : `${m}~${upper}일 전`;
    return { label, minDays: m };
  });
  const columns = COLUMNS.map((c) => ({
    label: c.label,
    refundRates: mins.map((m) => {
      try { return 100 - lookupRate(rules, c.tier, c.dayType, m); } catch { return null; }
    }),
  }));
  return { rows, columns };
}
