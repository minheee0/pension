/**
 * 실제 DB에 저장된 예약 스냅샷 → 환불 계산 연동 테스트. 테스트 DB 전용(테이블을 비운다).
 *   npm run test:refund-db
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

process.env.PII_ENC_KEY ??= randomBytes(32).toString("base64");
process.env.PII_HASH_KEY ??= randomBytes(32).toString("base64");

import { pool } from "../src/server/db";
import { holdStay } from "../src/server/booking/hold";
import { calcRefund, refundInputFromBooking, lookupRate } from "../src/server/refund/calc";
import { getPolicyView } from "../src/server/booking/policy";
import { GET as policyGET } from "../src/app/api/policy/route";

if (process.env.ALLOW_TRUNCATE !== "1") {
  console.error("테스트 DB 전용입니다. ALLOW_TRUNCATE=1 을 지정하세요.");
  process.exit(1);
}
const addDays = (b: string, n: number) => { const d = new Date(`${b}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function main() {
  await pool.query("truncate bookings, stay_dates cascade");
  await pool.query("select ensure_stay_dates(current_date, current_date + 400)");
  await pool.query("delete from season_periods");
  await pool.query("update options set price = 40000, active = true where code = 'bbq'");
  const d0 = (await pool.query(`select ((now() at time zone 'Asia/Seoul')::date + 40)::text as d`)).rows[0].d;
  const d2 = addDays(d0, 2);
  await pool.query(
    `insert into season_periods (name, date_from, date_to, price_weekday, price_weekend, min_nights)
     values ('테스트 성수기', $1, $2, 700000, 800000, 2)`, [addDays(d0, -1), addDays(d0, 5)]);

  const hold = await holdStay(pool, {
    checkIn: d0, checkOut: d2, guests: 5,
    options: [{ optionId: (await pool.query("select id from options where code = 'bbq'")).rows[0].id, qty: 1, useDate: d0, useTime: "18:00" }],
    guest: { name: "환불테스트", phoneEnc: "enc", phoneHash: randomBytes(8).toString("hex"), phoneLast4: "0000" },
    agreedTerms: true,
  });
  const row = (await pool.query(
    `select check_in::text, extra_guest_fee, discount_amount, created_at, price_snapshot, policy_snapshot, total_amount
       from bookings where booking_no = $1`, [hold.bookingNo])).rows[0];

  // 1) 스냅샷에 환불 계산에 필요한 정보가 다 들어 있다
  const opt = row.price_snapshot.options[0];
  assert.equal(opt.deadlineDaysBefore, 1);
  assert.equal(opt.deadlineTime, "18:00");
  assert.ok(row.policy_snapshot.refund_policies.length >= 24);
  console.log("1 통과: 스냅샷에 환불 규정·옵션 마감 규칙 저장됨");

  // 2) 4일 전 취소: 성수기 → 50% (주중/주말 동일 구간)
  const now = new Date(`${addDays(d0, -4)}T03:00:00Z`); // 4일 전 KST 정오
  const input = refundInputFromBooking(row, { now, cause: "guest", paidAmount: row.total_amount });
  const res = calcRefund(input);
  const room = row.price_snapshot.roomTotal, extra = row.extra_guest_fee;
  assert.equal(res.daysBefore, 4);
  assert.equal(res.lines.filter((l) => l.kind === "night").every((l) => l.deductRate === 50), true);
  assert.equal(res.deductTotal, Math.floor(room * 0.5) + Math.floor((extra * Math.floor(room * 0.5)) / room));
  assert.equal(res.lines.find((l) => l.kind === "option")!.deduct, 0, "마감 전 옵션은 전액 환불");
  assert.equal(res.refundTotal + res.deductTotal, row.total_amount);
  console.log(`2 통과: 성수기 4일 전 취소 → 환불 ${res.refundTotal.toLocaleString()}원 / 공제 ${res.deductTotal.toLocaleString()}원`);

  // 3) 예약 후 요금표가 바뀌어도 기존 예약은 예약 당시 규정으로 계산된다
  await pool.query("update refund_policies set deduct_rate = 0 where tier = 'peak'");
  const still = calcRefund(refundInputFromBooking(row, { now, cause: "guest", paidAmount: row.total_amount }));
  assert.equal(still.deductTotal, res.deductTotal);
  const live = (await pool.query("select tier, day_type, days_before_min, deduct_rate from refund_policies where applies_to = 'room'")).rows
    .map((r) => ({ tier: r.tier, dayType: r.day_type, daysBeforeMin: r.days_before_min, deductRate: r.deduct_rate }));
  assert.equal(lookupRate(live, "peak", "weekend", 4), 0, "(현재 규정은 바뀌었음)");
  console.log("3 통과: 규정을 나중에 바꿔도 기존 예약은 스냅샷 규정 유지");
  await pool.query(`update refund_policies set deduct_rate = case day_type||'/'||days_before_min
     when 'weekday/10' then 0 when 'weekend/10' then 0 when 'weekday/7' then 10 when 'weekend/7' then 10
     when 'weekday/5' then 30 when 'weekend/5' then 30 when 'weekday/3' then 50 when 'weekend/3' then 50
     when 'weekday/1' then 70 when 'weekend/1' then 80 when 'weekday/0' then 80 when 'weekend/0' then 90 end
     where tier = 'peak'`);

  // 4) 구버전 스냅샷(옵션 마감 정보 없음)도 기본값으로 처리
  const legacy = structuredClone(row);
  delete legacy.price_snapshot.options[0].deadlineDaysBefore;
  delete legacy.price_snapshot.options[0].deadlineTime;
  const lr = calcRefund(refundInputFromBooking(legacy, { now, cause: "guest", paidAmount: row.total_amount }));
  assert.equal(lr.lines.find((l) => l.kind === "option")!.deduct, 0);
  console.log("4 통과: 마감 정보 없는 구버전 스냅샷 호환");

  // 5) 정책 뷰/API
  const view = await getPolicyView(pool);
  assert.equal(view.table.columns.length, 4);
  assert.equal(view.seasons.length, 1);
  assert.equal(view.options[0].name, "바비큐");
  const api = await policyGET(new Request("http://localhost/api/policy", { headers: { "x-forwarded-for": "1.2.3.4" } }));
  const j: any = await api.json();
  assert.equal(api.status, 200);
  assert.equal(j.confirmed, false, "확정 전에는 임시 규정 표시");
  process.env.REFUND_POLICY_CONFIRMED = "true";
  assert.equal((await getPolicyView(pool)).confirmed, true);
  console.log("5 통과: /api/policy, 성수기·옵션 규정 표시, 확정 플래그");

  console.log("\n전체 통과");
}

// 다른 테스트에 영향을 주지 않도록 이 테스트가 만든 데이터는 항상 정리한다
async function cleanup() {
  await pool.query("truncate bookings, stay_dates cascade");
  await pool.query("delete from season_periods");
  await pool.query("update options set price = 0, active = false");
  await pool.query("select ensure_stay_dates(current_date, current_date + 400)");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await cleanup().catch(() => {}); await pool.end(); });
