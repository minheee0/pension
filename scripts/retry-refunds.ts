/** 실패했던 환불을 다시 시도한다.   npx tsx --env-file=.env.local scripts/retry-refunds.ts   (DB·토스 키는 .env.local 에서 읽음) */
import { pool } from "../src/server/db";
import { retryPendingRefunds } from "../src/server/booking/cancel";

retryPendingRefunds(pool)
  .then((r) => console.log(r.length ? r : "재시도할 환불이 없습니다"))
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => pool.end());
