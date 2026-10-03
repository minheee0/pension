import type { Db } from "@/server/booking/hold";

/**
 * 체크아웃 시각(한국시간)이 지난 '예약 확정' 건을 '이용 완료'로 바꾼다. 후기 작성은 이 상태가 되어야 가능하다.
 * 크론(예: 1시간마다)으로 돌리고, 후기 화면에서도 확인할 때마다 한 번 실행해 크론이 늦어도 정확하다.
 * 몇 번 실행해도 안전하다.
 */
export async function completeFinishedBookings(db: Db): Promise<number> {
  const r = await db.query(
    `update bookings b set status = 'completed'
       where b.status = 'confirmed'
         and ((b.check_out::timestamp + coalesce((select value from policy_settings where key = 'check_out_time'), '12:00')::time)
                at time zone 'Asia/Seoul') <= now()`);
  return r.rowCount ?? 0;
}
