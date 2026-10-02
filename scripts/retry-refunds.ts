/** 실패했던 환불을 다시 시도한다.   npx tsx scripts/retry-refunds.ts   (.env.local 의 DB·토스 키 필요) */
import { pool } from "../src/server/db";
import { retryPendingRefunds } from "../src/server/booking/cancel";

retryPendingRefunds(pool)
  .then((r) => console.log(r.length ? r : "재시도할 환불이 없습니다"))
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => pool.end());
