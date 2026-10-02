import { isIP } from "node:net";
import type { Pool } from "pg";
import { hmacHex, normalizeKrMobile } from "@/server/crypto";
import { PaymentError } from "@/server/payments/errors";

export interface BookingRow {
  id: string; booking_no: string; status: string; guest_name: string; guest_phone_last4: string;
  check_in: string; check_out: string; nights: number; guests: number;
  room_total: number; extra_guest_fee: number; option_total: number; discount_amount: number; total_amount: number;
  created_at: Date; price_snapshot: any; policy_snapshot: any;
}

const MAX_FAILS_PER_BOOKING = 5;   // 같은 예약번호에 15분 내 실패 5회 → 잠금
const MAX_FAILS_PER_IP = 20;

/**
 * 예약번호 + 휴대폰 번호로 본인 확인. 실패 사유(번호가 없는지, 전화번호가 틀린지)는 구분해서 알려 주지 않는다.
 * 실패는 lookup_attempts 에 기록해 무차별 대입을 막는다.
 */
export async function verifyBooking(pool: Pool, bookingNo: string, phone: string, ip: string): Promise<BookingRow> {
  const fail = () => new PaymentError("LOOKUP_FAILED", "예약번호 또는 휴대폰 번호를 확인해 주세요", 404);
  const inet = isIP(ip) ? ip : null;

  const { rows: cnt } = await pool.query(
    `select count(*) filter (where booking_no = $1) as by_no,
            count(*) filter (where ip = $2::inet) as by_ip
       from lookup_attempts where success = false and created_at > now() - interval '15 minutes'`,
    [bookingNo, inet]);
  if (Number(cnt[0].by_no) >= MAX_FAILS_PER_BOOKING || Number(cnt[0].by_ip) >= MAX_FAILS_PER_IP) {
    throw new PaymentError("RATE_LIMITED", "확인 시도가 너무 많습니다. 15분 후에 다시 시도해 주세요", 429);
  }

  const norm = normalizeKrMobile(phone);
  let row: BookingRow | undefined;
  if (norm) {
    const r = await pool.query(
      `select id, booking_no, status, guest_name, guest_phone_last4::text as guest_phone_last4,
              check_in::text as check_in, check_out::text as check_out, nights, guests,
              room_total, extra_guest_fee, option_total, discount_amount, total_amount,
              created_at, price_snapshot, policy_snapshot
         from bookings where booking_no = $1 and guest_phone_hash = $2`, [bookingNo, hmacHex(norm)]);
    row = r.rows[0];
  }
  await pool.query(`insert into lookup_attempts (booking_no, ip, success) values ($1, $2::inet, $3)`, [bookingNo, inet, !!row]);
  if (!row) throw fail();
  return row;
}
