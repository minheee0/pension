/** 체크아웃이 지난 예약을 '이용 완료'로 바꾼다 (후기 작성 가능 상태).   npm run bookings:complete */
import { pool } from "../src/server/db";
import { completeFinishedBookings } from "../src/server/booking/complete";

completeFinishedBookings(pool)
  .then((n) => console.log(`이용 완료로 변경: ${n}건`))
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => pool.end());
