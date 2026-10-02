/**
 * 입금 기한이 지난 가상계좌 대기 건을 토스 실제 상태와 맞춘다. 주기적으로(예: 10분마다) 실행하거나 수동으로 실행.
 *   npx tsx --env-file=.env.local scripts/reconcile-payments.ts   (DB·토스 키는 .env.local 에서 읽음)
 */
import { pool } from "../src/server/db";
import { reconcileWaitingDeposits } from "../src/server/payments/service";
import { retryPendingRefunds } from "../src/server/booking/cancel";

(async () => {
  console.log("가상계좌 대사:", await reconcileWaitingDeposits(pool));
  console.log("환불 재시도:", await retryPendingRefunds(pool));
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
