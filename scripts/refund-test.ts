/** 환불 계산 단위 테스트 (DB 불필요):  npm run test:refund */
import assert from "node:assert/strict";
import {
  calcRefund, daysBeforeCheckIn, lookupRate, RefundPolicyError,
  type DayType, type NightSnap, type PolicyRule, type RefundInput, type Tier,
} from "../src/server/refund/calc";
import { buildRefundTable } from "../src/server/refund/table";

// schema.sql 시드와 동일한 초안 규정
const SPEC: Record<string, [number, number][]> = {
  "off/weekday":  [[10, 0], [7, 0], [5, 0], [3, 10], [1, 10], [0, 20]],
  "off/weekend":  [[10, 0], [7, 0], [5, 10], [3, 20], [1, 20], [0, 30]],
  "peak/weekday": [[10, 0], [7, 10], [5, 30], [3, 50], [1, 70], [0, 80]],
  "peak/weekend": [[10, 0], [7, 10], [5, 30], [3, 50], [1, 80], [0, 90]],
};
const RULES: PolicyRule[] = Object.entries(SPEC).flatMap(([k, rows]) => {
  const [tier, dayType] = k.split("/") as [Tier, DayType];
  return rows.map(([daysBeforeMin, deductRate]) => ({ tier, dayType, daysBeforeMin, deductRate }));
});

const night = (date: string, price: number, refundTier: Tier, dayType: DayType): NightSnap =>
  ({ date, price, refundTier, dayType });
/** date 의 KST 정오에서 minusDays 일 전 */
const kstNoon = (date: string, minusDays: number) => {
  const d = new Date(`${date}T03:00:00Z`);
  d.setUTCDate(d.getUTCDate() - minusDays);
  return d;
};
const base = (over: Partial<RefundInput> = {}): RefundInput => ({
  checkIn: "2026-10-10",
  nights: [night("2026-10-10", 600000, "off", "weekday")],
  extraGuestFee: 0, options: [], discountAmount: 0, policy: RULES, paidAmount: 600000,
  now: kstNoon("2026-10-10", 10), cause: "guest", ...over,
});

let count = 0;
const ok = (name: string) => console.log(`  ✓ ${++count}. ${name}`);

// ---- 기본 구간
assert.equal(calcRefund(base()).refundTotal, 600000);
ok("비수기 평일, 10일 전 → 전액 환불");
assert.equal(calcRefund(base({ now: kstNoon("2026-10-10", 3) })).refundTotal, 540000);
ok("비수기 평일, 3일 전 → 10% 공제");
assert.equal(calcRefund(base({ now: kstNoon("2026-10-10", 0) })).refundTotal, 480000);
ok("비수기 평일, 당일 → 20% 공제 (100% 공제 아님)");

// ---- 성수기 주말 + 추가 인원
const peakSat = base({
  nights: [night("2026-10-10", 800000, "peak", "weekend")], extraGuestFee: 20000, paidAmount: 820000,
});
let r = calcRefund({ ...peakSat, now: kstNoon("2026-10-10", 4) });
assert.equal(r.deductTotal, 410000);
assert.equal(r.refundTotal, 410000);
ok("성수기 토 1박 82만원, 4일 전 → 환불 41만원 (추가 인원도 같은 비율)");
r = calcRefund({ ...peakSat, now: kstNoon("2026-10-10", 0) });
assert.equal(r.deductTotal, 738000);
assert.equal(r.refundTotal, 82000);
ok("성수기 주말 당일 → 90% 공제, 환불 8.2만원");

// ---- 노쇼 / 체크인 이후
r = calcRefund({ ...peakSat, cause: "no_show", now: kstNoon("2026-10-10", 9) });
assert.equal(r.daysBefore, 0);
ok("노쇼는 며칠 전에 처리해도 당일 취소 기준");
assert.equal(daysBeforeCheckIn("2026-10-10", kstNoon("2026-10-10", -2)), 0);
ok("체크인 이후 시각은 0일로 고정");

// ---- 한국시간 자정 경계
assert.equal(daysBeforeCheckIn("2026-10-10", new Date("2026-10-09T14:59:00Z")), 1); // 10/9 23:59 KST
assert.equal(daysBeforeCheckIn("2026-10-10", new Date("2026-10-09T15:00:00Z")), 0);  // 10/10 00:00 KST
assert.equal(daysBeforeCheckIn("2026-10-10", new Date("2026-10-03T14:59:59Z")), 7);
ok("KST 자정 경계 (UTC 15:00)");

// ---- 연박이 등급·요일 유형에 걸칠 때
r = calcRefund(base({
  checkIn: "2026-10-09",
  nights: [night("2026-10-09", 650000, "off", "weekend"), night("2026-10-10", 800000, "peak", "weekend")],
  paidAmount: 1450000, now: kstNoon("2026-10-09", 3),
}));
assert.equal(r.deductTotal, 130000 + 400000);
assert.equal(r.refundTotal, 920000);
ok("비수기 금 + 성수기 토, 3일 전 → 박별 20% / 50%");

// ---- 옵션: 이용 전날 18:00(KST)까지 전액 환불
const bbq = { name: "바비큐", amount: 40000, useDate: "2026-10-10", useTime: "18:00", deadlineDaysBefore: 1, deadlineTime: "18:00" };
const withOpt = base({ options: [bbq], paidAmount: 640000 });
const optDeduct = (now: string) => calcRefund({ ...withOpt, now: new Date(now) }).lines.at(-1)!.deduct;
assert.equal(optDeduct("2026-10-09T09:00:00Z"), 0);      // 정확히 18:00:00 KST
assert.equal(optDeduct("2026-10-09T09:00:01Z"), 40000);  // 18:00:01 KST
ok("옵션 마감 경계 (18:00:00 환불 / 18:00:01 불가)");
r = calcRefund({ ...withOpt, now: new Date("2026-10-09T09:30:00Z") }); // 1일 전, 마감 후
assert.equal(r.refundTotal, 640000 - 60000 - 40000);
ok("마감 후 취소: 객실 10% 공제 + 옵션 환불 불가");

// ---- 사업자 귀책 / 예약 직후 무료취소
r = calcRefund({ ...peakSat, cause: "host", now: kstNoon("2026-10-10", 0) });
assert.equal(r.basis, "host_fault");
assert.equal(r.refundTotal, 820000);
ok("사업자 사정 취소는 당일이어도 전액 환불");
const booked = new Date("2026-10-06T03:00:00Z");
const free = (minsLater: number, day = "2026-10-10") =>
  calcRefund({ ...peakSat, checkIn: day, bookedAt: booked, freeCancelMinutes: 60, now: new Date(booked.getTime() + minsLater * 60000) });
assert.equal(free(30).basis, "free_cancel_window");
assert.equal(free(30).refundTotal, 820000);
assert.equal(free(61).basis, "policy");
ok("예약 후 60분 이내 무료취소 (범위 밖이면 일반 규정)");
assert.equal(free(30, "2026-10-06").basis, "policy");
ok("체크인 당일에는 무료취소 창을 악용할 수 없음");

// ---- 결제액 상한 / 미결제
assert.equal(calcRefund(base({ paidAmount: 0 })).refundTotal, 0);
ok("결제 전(0원)이면 환불 0원");
assert.equal(calcRefund(base({ paidAmount: 300000 })).refundTotal, 300000);
ok("환불액은 실제 결제액을 넘지 않음");

// ---- 반올림: 내림
r = calcRefund(base({ nights: [night("2026-10-10", 333333, "off", "weekday")], paidAmount: 333333, now: kstNoon("2026-10-10", 3) }));
assert.equal(r.deductTotal, 33333);
ok("공제액은 원 단위 내림 (333,333원의 10% → 33,333원)");

// ---- 안전장치: 추측하지 않고 오류
assert.throws(() => lookupRate(RULES.filter((x) => x.daysBeforeMin !== 0), "off", "weekday", 0), RefundPolicyError);
assert.throws(() => calcRefund(base({ discountAmount: 1000 })), RefundPolicyError);
assert.throws(() => calcRefund(base({ nights: [] })), RefundPolicyError);
ok("규정 빈 구간·할인 예약·박 스냅샷 없음 → 오류(수동 확인)");

// ---- 불변식: 무작위 500건
let seed = 12345;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
for (let i = 0; i < 500; i++) {
  const nights = Array.from({ length: 1 + Math.floor(rnd() * 4) }, (_, k) =>
    night(`2026-10-${10 + k}`, 1000 * (1 + Math.floor(rnd() * 900)) + Math.floor(rnd() * 999), pick<Tier>(["off", "peak"]), pick<DayType>(["weekday", "weekend"])));
  const extra = pick([0, 10000, 20000]);
  const opts = rnd() < 0.5 ? [bbq] : [];
  const total = nights.reduce((s, x) => s + x.price, 0) + extra + opts.reduce((s, o) => s + o.amount, 0);
  const res = calcRefund(base({
    nights, extraGuestFee: extra, options: opts, paidAmount: total,
    cause: pick(["guest", "guest", "no_show", "host"] as const),
    now: new Date(Date.parse("2026-09-20T00:00:00Z") + Math.floor(rnd() * 25 * 86400000)),
  }));
  assert.equal(res.refundTotal + res.deductTotal, total);
  assert.ok(res.refundTotal >= 0 && res.refundTotal <= total);
  for (const l of res.lines) { assert.equal(l.refund + l.deduct, l.amount); assert.ok(l.deduct >= 0 && l.deduct <= l.amount); }
}
ok("불변식 500건: 환불+공제=결제액, 0 ≤ 환불 ≤ 결제액, 항목별 합 일치");

// ---- 화면 표와 실제 계산이 일치하는가
const table = buildRefundTable(RULES);
assert.deepEqual(table.rows.map((x) => x.label), ["10일 전까지", "7~9일 전", "5~6일 전", "3~4일 전", "1~2일 전", "당일 · 노쇼"]);
const cols: [Tier, DayType][] = [["off", "weekday"], ["off", "weekend"], ["peak", "weekday"], ["peak", "weekend"]];
table.columns.forEach((c, ci) => {
  table.rows.forEach((row, ri) => {
    const upper = ri === 0 ? row.minDays + 30 : table.rows[ri - 1].minDays - 1;
    for (let d = row.minDays; d <= upper; d++) {
      assert.equal(100 - lookupRate(RULES, cols[ci][0], cols[ci][1], d), c.refundRates[ri], `${c.label} ${d}일 전`);
    }
  });
});
ok("이용안내 표의 모든 구간이 실제 계산과 일치");

console.log(`\n전체 통과 (${count}개 항목)`);
