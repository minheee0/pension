/**
 * 한옥 독채 펜션: 재고 점유 · 확정 · 취소 · 만료 해제
 *
 * 의존성: npm i pg && npm i -D typescript tsx @types/pg
 *
 * 핵심 규칙 (이 파일의 모든 함수가 따른다)
 *  1) 모든 재고 변경은 stay_dates 행을 "날짜 오름차순으로" SELECT ... FOR UPDATE 한 뒤에 한다.
 *     → 여러 트랜잭션이 겹치는 날짜를 잡아도 항상 같은 순서로 잠그므로 데드락이 없다.
 *  2) 잠금 순서는 언제나  stay_dates → bookings.
 *  3) 금액은 서버가 DB의 요금표로 다시 계산한다. 클라이언트가 보낸 금액은 신뢰하지 않는다.
 *  4) 만료된 임시 점유(held_until <= now())는 크론이 늦어도 "빈 날"로 취급한다(lazy expiry).
 *  5) 결제가 이미 끝났다면(늦은 웹훅) 날짜가 아직 비어 있는 한 확정해 준다. 못 잡으면 HOLD_LOST → 환불.
 */
import { randomBytes } from 'node:crypto';
import { Pool, PoolClient, types } from 'pg';

// DATE 컬럼을 JS Date(타임존 오염) 대신 'YYYY-MM-DD' 문자열로 받는다.
types.setTypeParser(1082, (v: string) => v);

export type Db = Pool | PoolClient;

// ------------------------------------------------------------------
// 에러
// ------------------------------------------------------------------
export type StayErrorCode =
  | 'INVALID_INPUT'
  | 'OUT_OF_RANGE'
  | 'MIN_NIGHTS'
  | 'UNAVAILABLE'
  | 'PRICE_MISMATCH'
  | 'OPTION_INVALID'
  | 'NOT_FOUND'
  | 'INVALID_STATE';

export class StayError extends Error {
  constructor(public code: StayErrorCode, message: string, public detail?: unknown) {
    super(message);
    this.name = 'StayError';
  }
}

// ------------------------------------------------------------------
// 트랜잭션 헬퍼 (데드락/직렬화 실패 시 최대 2회 재시도)
// ------------------------------------------------------------------
export async function withTx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const c = await pool.connect();
    try {
      await c.query('begin');
      const result = await fn(c);
      await c.query('commit');
      return result;
    } catch (e: any) {
      await c.query('rollback').catch(() => undefined);
      const retryable = e?.code === '40P01' || e?.code === '40001';
      if (retryable && attempt < 2) continue;
      throw e;
    } finally {
      c.release();
    }
  }
}

// ------------------------------------------------------------------
// 유틸
// ------------------------------------------------------------------
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertDate(s: string, name: string): void {
  const ok = ISO_DATE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
  if (!ok) throw new StayError('INVALID_INPUT', `${name} 형식이 올바르지 않습니다 (YYYY-MM-DD)`);
}

function diffDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** 추측 불가한 예약번호: H + 10자리 Crockford Base32 (약 50bit) */
export function newBookingNo(): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const bytes = randomBytes(10);
  let out = 'H';
  for (const b of bytes) out += alphabet[b % 32];
  return out;
}

async function loadSettings(db: Db) {
  const { rows } = await db.query<{ key: string; value: string }>(
    'select key, value from policy_settings',
  );
  const m = new Map(rows.map((r) => [r.key, r.value]));
  const num = (k: string): number => {
    const v = Number(m.get(k));
    if (!Number.isFinite(v)) throw new Error(`policy_settings.${k} 값이 없거나 숫자가 아닙니다`);
    return v;
  };
  return {
    baseGuests: num('base_guests'),
    maxGuests: num('max_guests'),
    extraPersonFee: num('extra_person_fee'),
    extraFeeMode: (m.get('extra_fee_mode') ?? 'per_stay') as 'per_stay' | 'per_night',
    holdMinutes: num('hold_minutes'),
    virtualAccountDueMinutes: num('virtual_account_due_minutes'),
    bookingOpenDays: num('booking_open_days'),
  };
}

// ------------------------------------------------------------------
// 견적 (서버 기준 요금 계산)
// ------------------------------------------------------------------
export interface OptionRequest {
  optionId: number;
  qty: number;
  useDate?: string; // per_use 옵션은 필수, 숙박일 범위 안이어야 함
  useTime?: string; // options.time_slots 가 있으면 필수
}

export interface QuoteInput {
  checkIn: string;
  checkOut: string;
  guests: number; // 36개월 미만 제외한 인원
  options?: OptionRequest[];
}

export interface NightLine {
  date: string;
  price: number;
  rule: string;
  refundTier: 'off' | 'peak';
  dayType: 'weekday' | 'weekend';
}

export interface OptionLine {
  optionId: number;
  code: string;
  name: string;
  qty: number;
  unitPrice: number;
  amount: number;
  useDate: string | null;
  useTime: string | null;
  deadlineDaysBefore: number; // 신청·취소 마감 규칙(예약 당시 값). 환불 계산에 사용
  deadlineTime: string;       // 'HH:MM'
}

export interface Quote {
  checkIn: string;
  checkOut: string;
  nightsCount: number;
  guests: number;
  nights: NightLine[];
  minNights: number;
  roomTotal: number;
  extraGuestFee: number;
  optionTotal: number;
  discountAmount: number;
  totalAmount: number;
  options: OptionLine[];
}

/** 미리보기·결제 직전 검증 모두 이 함수 하나로 계산한다. */
export async function quoteStay(db: Db, input: QuoteInput): Promise<Quote> {
  const { checkIn, checkOut, guests } = input;
  assertDate(checkIn, 'checkIn');
  assertDate(checkOut, 'checkOut');
  const nightsCount = diffDays(checkIn, checkOut);
  if (nightsCount < 1) throw new StayError('INVALID_INPUT', '체크아웃은 체크인보다 뒤여야 합니다');
  if (nightsCount > 30) throw new StayError('INVALID_INPUT', '최대 30박까지 예약할 수 있습니다');

  const cfg = await loadSettings(db);
  if (!Number.isInteger(guests) || guests < 1 || guests > cfg.maxGuests) {
    throw new StayError('INVALID_INPUT', `인원은 1~${cfg.maxGuests}명이어야 합니다`);
  }

  // 예약 가능 기간 (한국 날짜 기준)
  const { rows: t } = await db.query<{ today: string }>(
    `select (now() at time zone 'Asia/Seoul')::date::text as today`,
  );
  const today = t[0].today;
  if (checkIn < today) throw new StayError('OUT_OF_RANGE', '지난 날짜는 예약할 수 없습니다');
  if (diffDays(today, checkIn) > cfg.bookingOpenDays) {
    throw new StayError('OUT_OF_RANGE', `${cfg.bookingOpenDays}일 이후 날짜는 아직 예약할 수 없습니다`);
  }

  // 박별 요금 (DB의 resolve_night: 특정일 > 성수기 > 주말 > 평일)
  const { rows: nr } = await db.query<{
    date: string; price: number; rule: string; refund_tier: 'off' | 'peak';
    day_type: 'weekday' | 'weekend'; min_nights: number;
  }>(
    `select (($1::date) + g.i)::text as date, r.price, r.rule, r.refund_tier, r.day_type, r.min_nights
       from generate_series(0, $2::int - 1) as g(i)
      cross join lateral resolve_night(($1::date) + g.i) r
      order by g.i`,
    [checkIn, nightsCount],
  );
  if (nr.length !== nightsCount) {
    throw new Error('요금표가 비어 있는 날짜가 있습니다. base_prices 를 확인하세요.');
  }
  const nights: NightLine[] = nr.map((r) => ({
    date: r.date, price: r.price, rule: r.rule, refundTier: r.refund_tier, dayType: r.day_type,
  }));
  const minNights = Math.max(...nr.map((r) => r.min_nights));
  if (nightsCount < minNights) {
    throw new StayError('MIN_NIGHTS', `이 기간은 ${minNights}박 이상 예약해야 합니다`, { minNights });
  }
  const roomTotal = nights.reduce((s, n) => s + n.price, 0);

  // 추가 인원: 기준 인원 초과분 × 1인당 요금 (per_stay: 1회 / per_night: 박당)
  const extraPeople = Math.max(0, guests - cfg.baseGuests);
  const extraGuestFee =
    extraPeople * cfg.extraPersonFee * (cfg.extraFeeMode === 'per_night' ? nightsCount : 1);

  // 옵션
  const options: OptionLine[] = [];
  for (const req of input.options ?? []) {
    options.push(await priceOption(db, req, checkIn, checkOut, nightsCount));
  }
  const optionTotal = options.reduce((s, o) => s + o.amount, 0);

  // 할인 규칙은 아직 미구현. 규칙이 등록되면 여기서 계산하도록 확장할 것.
  const { rows: dr } = await db.query<{ n: string }>(
    `select count(*) as n from discount_rules where active`,
  );
  if (Number(dr[0].n) > 0) {
    throw new Error('활성 할인 규칙이 있는데 quoteStay 에 할인 계산이 구현되지 않았습니다');
  }
  const discountAmount = 0;

  return {
    checkIn, checkOut, nightsCount, guests, nights, minNights,
    roomTotal, extraGuestFee, optionTotal, discountAmount,
    totalAmount: roomTotal + extraGuestFee + optionTotal - discountAmount,
    options,
  };
}

async function priceOption(
  db: Db, req: OptionRequest, checkIn: string, checkOut: string, nightsCount: number,
): Promise<OptionLine> {
  const bad = (msg: string) => new StayError('OPTION_INVALID', msg, { optionId: req.optionId });
  if (!Number.isInteger(req.qty) || req.qty < 1) throw bad('수량이 올바르지 않습니다');

  const { rows } = await db.query<{
    id: string; code: string; name: string; price: number; unit_type: string; max_qty: number;
    time_slots: string[]; order_deadline_days_before: number; order_deadline_time: string;
  }>(`select * from options where id = $1 and active`, [req.optionId]);
  const o = rows[0];
  if (!o) throw bad('이용할 수 없는 옵션입니다');
  if (req.qty > o.max_qty) throw bad(`${o.name}은(는) 최대 ${o.max_qty}개까지 선택할 수 있습니다`);

  const needsDate = o.unit_type === 'per_use';
  if (needsDate && !req.useDate) throw bad('이용 날짜를 선택해 주세요');
  if (req.useDate) {
    assertDate(req.useDate, 'useDate');
    if (req.useDate < checkIn || req.useDate >= checkOut) throw bad('이용 날짜가 숙박 기간 밖입니다');
    // 신청 마감: 이용일 N일 전 order_deadline_time (한국시간)
    const { rows: dl } = await db.query<{ ok: boolean }>(
      `select now() <= ((($1::date - $2::int) + $3::time)::timestamp at time zone 'Asia/Seoul') as ok`,
      [req.useDate, o.order_deadline_days_before, o.order_deadline_time],
    );
    if (!dl[0].ok) throw bad(`${o.name} 신청이 마감되었습니다`);
  }
  if (o.time_slots.length > 0) {
    if (!req.useTime || !o.time_slots.includes(req.useTime)) throw bad('이용 시간을 선택해 주세요');
  }

  const amount = o.price * req.qty * (o.unit_type === 'per_night' ? nightsCount : 1);
  return {
    optionId: Number(o.id), code: o.code, name: o.name, qty: req.qty, unitPrice: o.price, amount,
    useDate: req.useDate ?? null, useTime: req.useTime ?? null,
    deadlineDaysBefore: o.order_deadline_days_before,
    deadlineTime: String(o.order_deadline_time).slice(0, 5),
  };
}

// ------------------------------------------------------------------
// 재고 잠금 (모든 변경 함수의 공통 진입점)
// ------------------------------------------------------------------
interface LockedNight {
  date: string;
  status: 'available' | 'held' | 'booked' | 'blocked';
  bookingId: string | null;
  free: boolean;   // 지금 새로 잡을 수 있는가 (available 또는 만료된 held)
  stale: boolean;  // 만료된 임시 점유인가
}

/** 범위 [checkIn, checkOut) 의 재고 행을 보장하고, 날짜 순으로 FOR UPDATE 잠근다. */
async function lockRange(c: PoolClient, checkIn: string, checkOut: string): Promise<LockedNight[]> {
  const n = diffDays(checkIn, checkOut);
  await c.query(
    `insert into stay_dates (date)
     select ($1::date) + g.i from generate_series(0, $2::int - 1) as g(i)
     on conflict do nothing`,
    [checkIn, n],
  );
  const { rows } = await c.query<{
    date: string; status: LockedNight['status']; booking_id: string | null;
    free: boolean; stale: boolean;
  }>(
    `select date::text as date, status, booking_id,
            (status = 'available' or (status = 'held' and held_until <= now())) as free,
            (status = 'held' and held_until <= now()) as stale
       from stay_dates
      where date >= $1::date and date < $2::date
      order by date
        for update`,
    [checkIn, checkOut],
  );
  return rows.map((r) => ({
    date: r.date, status: r.status, bookingId: r.booking_id, free: r.free, stale: r.stale,
  }));
}

/** 다른 예약의 만료된 점유를 덮어쓸 때, 그 예약도 expired 로 표시 */
async function expireStaleOwners(c: PoolClient, locked: LockedNight[], exceptBookingId?: string) {
  const ids = [
    ...new Set(
      locked.filter((l) => l.stale && l.bookingId && l.bookingId !== exceptBookingId)
            .map((l) => l.bookingId as string),
    ),
  ];
  if (ids.length > 0) {
    await c.query(
      `update bookings set status = 'expired'
        where id = any($1::uuid[]) and status in ('held', 'pending_payment')`,
      [ids],
    );
  }
}

// ------------------------------------------------------------------
// 1) 점유 (결제창 진입 직전에 호출)
// ------------------------------------------------------------------
export interface HoldRequest extends QuoteInput {
  guest: {
    name: string;
    phoneEnc: string;   // 앱에서 암호화한 값
    phoneHash: string;  // 조회용 HMAC
    phoneLast4: string;
    email?: string;
  };
  memo?: string;
  agreedTerms: boolean;      // 환불규정 동의 (서버에서도 강제)
  expectedTotal?: number;    // 화면에 보여준 금액. 서버 계산과 다르면 PRICE_MISMATCH
}

export interface HoldResult {
  bookingId: string;
  bookingNo: string;
  holdExpiresAt: Date;
  quote: Quote;
}

export async function holdStay(pool: Pool, req: HoldRequest): Promise<HoldResult> {
  if (!req.agreedTerms) throw new StayError('INVALID_INPUT', '환불 규정에 동의해야 예약할 수 있습니다');
  if (!req.guest.name.trim()) throw new StayError('INVALID_INPUT', '예약자 이름이 필요합니다');

  return withTx(pool, async (c) => {
    // (1) 서버 기준 견적
    const quote = await quoteStay(c, req);
    if (req.expectedTotal !== undefined && req.expectedTotal !== quote.totalAmount) {
      throw new StayError('PRICE_MISMATCH', '요금이 변경되었습니다. 다시 확인해 주세요', {
        expected: req.expectedTotal, actual: quote.totalAmount,
      });
    }
    const cfg = await loadSettings(c);

    // (2) 재고 잠금 + 전부 비었는지 확인 (하나라도 아니면 통째로 실패 → 롤백)
    const locked = await lockRange(c, req.checkIn, req.checkOut);
    const taken = locked.filter((l) => !l.free).map((l) => l.date);
    if (locked.length !== quote.nightsCount || taken.length > 0) {
      throw new StayError('UNAVAILABLE', '선택하신 날짜는 이미 예약되었거나 예약 진행 중입니다', {
        unavailableDates: taken,
      });
    }
    await expireStaleOwners(c, locked);

    // (3) 예약 행 생성 (스냅샷 포함)
    const bookingNo = newBookingNo();
    const { rows: br } = await c.query<{ id: string; hold_expires_at: Date }>(
      `insert into bookings (
         booking_no, status, guest_name, guest_phone_enc, guest_phone_hash, guest_phone_last4,
         guest_email, check_in, check_out, guests,
         room_total, extra_guest_fee, option_total, discount_amount, total_amount,
         hold_expires_at, policy_snapshot, price_snapshot, request_memo, agreed_terms_at)
       values ($1, 'held', $2, $3, $4, $5, $6, $7::date, $8::date, $9,
               $10, $11, $12, $13, $14,
               now() + make_interval(mins => $15::int),
               (select jsonb_build_object(
                  'refund_policies', coalesce((select jsonb_agg(to_jsonb(r) - 'id') from refund_policies r), '[]'::jsonb),
                  'settings',        (select jsonb_object_agg(key, value) from policy_settings))),
               $16::jsonb, $17, now())
       returning id, hold_expires_at`,
      [
        bookingNo, req.guest.name.trim(), req.guest.phoneEnc, req.guest.phoneHash,
        req.guest.phoneLast4, req.guest.email ?? null, req.checkIn, req.checkOut, req.guests,
        quote.roomTotal, quote.extraGuestFee, quote.optionTotal, quote.discountAmount,
        quote.totalAmount, cfg.holdMinutes, JSON.stringify(quote), req.memo ?? null,
      ],
    );
    const { id: bookingId, hold_expires_at: holdExpiresAt } = br[0];

    // (4) 재고 점유
    await c.query(
      `update stay_dates
          set status = 'held', booking_id = $1::uuid, held_until = $2::timestamptz
        where date >= $3::date and date < $4::date`,
      [bookingId, holdExpiresAt, req.checkIn, req.checkOut],
    );

    // (5) 박별·옵션별 스냅샷
    await c.query(
      `insert into booking_nights (booking_id, date, price, rule_applied, refund_tier, day_type)
       select $1::uuid, x.d::date, x.p, x.r, x.t, x.dt
         from unnest($2::text[], $3::int[], $4::text[], $5::text[], $6::text[]) as x(d, p, r, t, dt)`,
      [
        bookingId,
        quote.nights.map((n) => n.date), quote.nights.map((n) => n.price),
        quote.nights.map((n) => n.rule), quote.nights.map((n) => n.refundTier),
        quote.nights.map((n) => n.dayType),
      ],
    );
    if (quote.options.length > 0) {
      await c.query(
        `insert into booking_options (booking_id, option_id, qty, unit_price, amount, use_date, use_time)
         select $1::uuid, x.oid, x.q, x.up, x.amt, x.ud::date, x.ut
           from unnest($2::bigint[], $3::int[], $4::int[], $5::int[], $6::text[], $7::text[])
                as x(oid, q, up, amt, ud, ut)`,
        [
          bookingId,
          quote.options.map((o) => o.optionId), quote.options.map((o) => o.qty),
          quote.options.map((o) => o.unitPrice), quote.options.map((o) => o.amount),
          quote.options.map((o) => o.useDate), quote.options.map((o) => o.useTime),
        ],
      );
    }

    return { bookingId, bookingNo, holdExpiresAt, quote };
  });
}

// ------------------------------------------------------------------
// 2) 가상계좌: 입금 기한만큼 점유 연장 (가상계좌 "발급 전에" 호출)
//    false 를 돌려주면 이미 점유를 잃은 것 → 가상계좌를 발급하지 말 것
// ------------------------------------------------------------------
export async function extendHoldForVirtualAccount(pool: Pool, bookingId: string): Promise<Date | null> {
  return withTx(pool, async (c) => {
    const b = await getBookingRange(c, bookingId);
    const cfg = await loadSettings(c);
    const locked = await lockRange(c, b.checkIn, b.checkOut);
    if (!locked.every((l) => l.bookingId === bookingId && l.status === 'held')) return null;

    const { rows } = await c.query<{ until: Date }>(
      `select now() + make_interval(mins => $1::int) as until`, [cfg.virtualAccountDueMinutes],
    );
    const until = rows[0].until;
    await c.query(
      `update stay_dates set held_until = $2::timestamptz where booking_id = $1::uuid and status = 'held'`,
      [bookingId, until],
    );
    await c.query(
      `update bookings set status = 'pending_payment', hold_expires_at = $2::timestamptz
        where id = $1::uuid and status in ('held', 'pending_payment')`,
      [bookingId, until],
    );
    return until;
  });
}

// ------------------------------------------------------------------
// 3) 확정 (결제 성공 웹훅에서 호출). 멱등: 여러 번 불려도 안전
//    payments 상태 갱신과 같은 트랜잭션에서 쓰려면 PoolClient 를 넘긴다.
// ------------------------------------------------------------------
export type ConfirmResult =
  | { ok: true; alreadyConfirmed: boolean }
  | { ok: false; reason: 'HOLD_LOST' | 'CANCELLED' | 'NOT_FOUND' };
// ok:false 이면 호출자는 반드시 PG 결제를 취소(환불)하고 refunds 에 기록해야 한다.

export async function confirmStay(c: PoolClient, bookingId: string): Promise<ConfirmResult> {
  const { rows: pre } = await c.query<{ check_in: string; check_out: string }>(
    `select check_in::text, check_out::text from bookings where id = $1::uuid`, [bookingId],
  );
  if (!pre[0]) return { ok: false, reason: 'NOT_FOUND' };

  // 잠금 순서: stay_dates(날짜순) → bookings
  const locked = await lockRange(c, pre[0].check_in, pre[0].check_out);
  const { rows: bk } = await c.query<{ status: string }>(
    `select status from bookings where id = $1::uuid for update`, [bookingId],
  );
  const status = bk[0].status;

  if (status === 'confirmed' || status === 'completed') return { ok: true, alreadyConfirmed: true };
  if (status === 'cancelled') return { ok: false, reason: 'CANCELLED' };

  // 내 것이거나(만료됐어도 남이 안 가져갔으면), 다시 비어 있으면 확정 가능. 남이 잡았으면 HOLD_LOST.
  const canTake = locked.every((l) => l.bookingId === bookingId || l.free);
  if (!canTake) return { ok: false, reason: 'HOLD_LOST' };

  await expireStaleOwners(c, locked, bookingId);
  await c.query(
    `update stay_dates
        set status = 'booked', booking_id = $1::uuid, held_until = null
      where date >= $2::date and date < $3::date`,
    [bookingId, pre[0].check_in, pre[0].check_out],
  );
  await c.query(
    `update bookings set status = 'confirmed', hold_expires_at = null where id = $1::uuid`, [bookingId],
  );
  return { ok: true, alreadyConfirmed: false };
}

// ------------------------------------------------------------------
// 4) 취소/해제 (사용자 취소, 결제 실패, 관리자 취소). 환불 금액 계산·PG 취소는 호출자 몫
// ------------------------------------------------------------------
export async function cancelStay(
  c: PoolClient,
  bookingId: string,
  opts: { by: 'guest' | 'admin' | 'system'; reason?: string },
): Promise<{ previousStatus: string; releasedNights: number }> {
  const b = await getBookingRange(c, bookingId);
  await lockRange(c, b.checkIn, b.checkOut);
  const { rows } = await c.query<{ status: string }>(
    `select status from bookings where id = $1::uuid for update`, [bookingId],
  );
  const previous = rows[0].status;
  if (!['held', 'pending_payment', 'confirmed'].includes(previous)) {
    throw new StayError('INVALID_STATE', `현재 상태(${previous})에서는 취소할 수 없습니다`);
  }

  const rel = await c.query(
    `update stay_dates
        set status = 'available', booking_id = null, held_until = null
      where booking_id = $1::uuid and status in ('held', 'booked')`,
    [bookingId],
  );
  await c.query(
    `update bookings
        set status = 'cancelled', cancelled_at = now(), cancelled_by = $2, cancel_reason = $3,
            hold_expires_at = null
      where id = $1::uuid`,
    [bookingId, opts.by, opts.reason ?? null],
  );
  return { previousStatus: previous, releasedNights: rel.rowCount ?? 0 };
}

// ------------------------------------------------------------------
// 5) 만료 점유 해제 (크론 1분마다). SKIP LOCKED → 다른 트랜잭션을 기다리지 않는다
// ------------------------------------------------------------------
export async function releaseExpiredHolds(pool: Pool): Promise<{ nights: number; bookings: number }> {
  return withTx(pool, async (c) => {
    const { rows } = await c.query<{ booking_id: string }>(
      `with target as (
         select date, booking_id from stay_dates
          where status = 'held' and held_until <= now()
          order by date
            for update skip locked
       )
       update stay_dates s
          set status = 'available', booking_id = null, held_until = null
         from target t
        where s.date = t.date
       returning t.booking_id`,
    );
    const ids = [...new Set(rows.map((r) => r.booking_id))];
    let expired = 0;
    if (ids.length > 0) {
      const r = await c.query(
        `update bookings set status = 'expired'
          where id = any($1::uuid[]) and status in ('held', 'pending_payment')`,
        [ids],
      );
      expired = r.rowCount ?? 0;
    }
    return { nights: rows.length, bookings: expired };
  });
}

// ------------------------------------------------------------------
async function getBookingRange(db: Db, bookingId: string): Promise<{ checkIn: string; checkOut: string }> {
  const { rows } = await db.query<{ check_in: string; check_out: string }>(
    `select check_in::text, check_out::text from bookings where id = $1::uuid`, [bookingId],
  );
  if (!rows[0]) throw new StayError('NOT_FOUND', '예약을 찾을 수 없습니다');
  return { checkIn: rows[0].check_in, checkOut: rows[0].check_out };
}
