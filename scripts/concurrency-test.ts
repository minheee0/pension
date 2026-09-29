/**
 * 동시 예약 테스트. 반드시 "테스트용 DB"에서만 실행할 것 (테이블을 비운다).
 *
 *   ALLOW_TRUNCATE=1 DATABASE_URL=postgres://... npx tsx concurrency-test.ts
 */
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import {
  confirmStay, holdStay, newBookingNo, releaseExpiredHolds, StayError, withTx, HoldRequest,
} from '../src/server/booking/hold';

if (process.env.ALLOW_TRUNCATE !== '1') {
  console.error('테스트 DB 전용입니다. ALLOW_TRUNCATE=1 을 지정하세요.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 40 });

function addDays(base: string, n: number): string {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function req(checkIn: string, checkOut: string): HoldRequest {
  return {
    checkIn, checkOut, guests: 4,
    guest: { name: '테스터', phoneEnc: 'enc', phoneHash: newBookingNo(), phoneLast4: '0000' },
    agreedTerms: true,
  };
}

async function reset() {
  await pool.query('truncate bookings, stay_dates cascade');
  await pool.query(`update policy_settings set value = '15' where key = 'hold_minutes'`);
  await pool.query(`select ensure_stay_dates(current_date, current_date + 400)`);
}

async function tryHold(r: HoldRequest) {
  try {
    return { ok: true as const, res: await holdStay(pool, r) };
  } catch (e) {
    if (e instanceof StayError && e.code === 'UNAVAILABLE') return { ok: false as const };
    throw e;
  }
}

async function main() {
  const { rows } = await pool.query<{ d: string }>(
    `select ((now() at time zone 'Asia/Seoul')::date + 30)::text as d`,
  );
  const d0 = rows[0].d;

  // ---- A. 같은 2박에 동시 30건 → 정확히 1건만 성공
  await reset();
  const a = await Promise.all(Array.from({ length: 30 }, () => tryHold(req(d0, addDays(d0, 2)))));
  assert.equal(a.filter((x) => x.ok).length, 1, 'A: 성공은 정확히 1건이어야 함');
  console.log('A 통과: 동일 날짜 30건 동시 → 1건 성공');

  // ---- B. 서로 겹치는 범위 혼합 → 한 날짜가 두 예약에 걸리면 안 됨
  await reset();
  const ranges: [number, number][] = [[0, 2], [1, 3], [2, 3], [3, 4], [0, 4], [1, 2]];
  const batch = ranges.flatMap(([s, e]) => Array.from({ length: 8 }, () => [s, e] as [number, number]));
  const b = await Promise.all(batch.map(([s, e]) => tryHold(req(addDays(d0, s), addDays(d0, e)))));
  const wins = b.filter((x): x is { ok: true; res: Awaited<ReturnType<typeof holdStay>> } => x.ok);
  assert.ok(wins.length >= 1, 'B: 최소 1건은 성공해야 함');
  const owned = await pool.query(
    `select date::text, booking_id from stay_dates where status = 'held' order by date`,
  );
  const expectedNights = wins.reduce((s, w) => s + w.res.quote.nightsCount, 0);
  assert.equal(owned.rowCount, expectedNights, 'B: 점유된 박 수 = 성공한 예약의 박 수 합');
  console.log(`B 통과: 겹치는 범위 ${batch.length}건 동시 → ${wins.length}건 성공, 중복 없음`);

  // ---- C. 점유가 만료되어 남이 가져간 뒤 늦은 결제 → HOLD_LOST
  await reset();
  const dC = addDays(d0, 10);
  await pool.query(`update policy_settings set value = '0' where key = 'hold_minutes'`); // 즉시 만료
  const first = await holdStay(pool, req(dC, addDays(dC, 1)));
  await pool.query(`update policy_settings set value = '15' where key = 'hold_minutes'`);
  const second = await holdStay(pool, req(dC, addDays(dC, 1))); // 만료 점유를 덮어써야 함
  const lateFirst = await withTx(pool, (c) => confirmStay(c, first.bookingId));
  assert.deepEqual(lateFirst, { ok: false, reason: 'HOLD_LOST' });
  const okSecond = await withTx(pool, (c) => confirmStay(c, second.bookingId));
  assert.deepEqual(okSecond, { ok: true, alreadyConfirmed: false });
  const st1 = await pool.query(`select status from bookings where id = $1`, [first.bookingId]);
  assert.equal(st1.rows[0].status, 'expired');
  console.log('C 통과: 만료 점유 덮어쓰기, 늦은 결제는 HOLD_LOST');

  // ---- D. 점유 만료 후 아무도 안 잡았으면 늦은 결제도 확정 + 웹훅 중복은 멱등
  await reset();
  await pool.query(`update policy_settings set value = '0' where key = 'hold_minutes'`);
  const lone = await holdStay(pool, req(dC, addDays(dC, 1)));
  await pool.query(`update policy_settings set value = '15' where key = 'hold_minutes'`);
  await releaseExpiredHolds(pool); // 크론이 먼저 해제
  const late = await withTx(pool, (c) => confirmStay(c, lone.bookingId));
  assert.deepEqual(late, { ok: true, alreadyConfirmed: false });
  const dup = await withTx(pool, (c) => confirmStay(c, lone.bookingId));
  assert.deepEqual(dup, { ok: true, alreadyConfirmed: true });
  console.log('D 통과: 해제 후 늦은 결제도 재확보해 확정, 중복 호출 멱등');

  // ---- E. 동시에 확정 + 새 점유 경쟁 (데드락 없이 끝나야 함)
  await reset();
  await pool.query(`update policy_settings set value = '0' where key = 'hold_minutes'`);
  const stale = await holdStay(pool, req(dC, addDays(dC, 2)));
  await pool.query(`update policy_settings set value = '15' where key = 'hold_minutes'`);
  const race = await Promise.all([
    withTx(pool, (c) => confirmStay(c, stale.bookingId)),
    ...Array.from({ length: 10 }, () => tryHold(req(dC, addDays(dC, 2)))),
  ]);
  const confirmRes = race[0] as { ok: boolean };
  const holdWins = (race.slice(1) as { ok: boolean }[]).filter((x) => x.ok).length;
  assert.equal(Number(confirmRes.ok) + holdWins, 1, 'E: 확정과 새 점유 중 정확히 하나만 이겨야 함');
  console.log('E 통과: 확정 vs 신규 점유 경쟁 → 승자 1명, 데드락 없음');

  console.log('\n전체 통과');
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => pool.end());
