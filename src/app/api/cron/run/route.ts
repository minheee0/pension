import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { pool } from "@/server/db";
import { releaseExpiredHolds } from "@/server/booking/hold";
import { completeFinishedBookings } from "@/server/booking/complete";
import { retryPendingRefunds } from "@/server/booking/cancel";
import { reconcileWaitingDeposits } from "@/server/payments/service";
import { cleanupNotifications, sendDue } from "@/server/notify/send";
import { scheduleReminders } from "@/server/notify/schedule";
import { purgePersonalData } from "@/server/privacy/purge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const sha = (s: string) => createHash("sha256").update(s).digest();

/**
 * 정기 작업 (1~5분마다 호출). 호출 방법: Authorization: Bearer <CRON_SECRET>
 *  Vercel Cron, GitHub Actions, cron-job.org 등 어떤 스케줄러든 이 주소를 부르면 된다.
 *  개인정보 파기도 여기서 돈다. 작업은 모두 여러 번 실행해도 안전하며, 하나가 실패해도 나머지는 계속 실행한다.
 */
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: { code: "DISABLED", message: "CRON_SECRET 이 설정되지 않아 정기 작업이 꺼져 있습니다" } }, { status: 503 });
  const got = req.headers.get("authorization") ?? "";
  if (!timingSafeEqual(sha(got), sha(`Bearer ${secret}`))) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "unauthorized" } }, { status: 401 });

  const tasks: [string, () => Promise<unknown>][] = [
    ["bookingsCompleted", () => completeFinishedBookings(pool)],
    ["holdsReleased", () => releaseExpiredHolds(pool)],
    ["depositsReconciled", () => reconcileWaitingDeposits(pool)],
    ["refundsRetried", () => retryPendingRefunds(pool)],
    ["remindersScheduled", () => scheduleReminders(pool)],
    ["notificationsSent", () => sendDue(pool, { limit: 50 })],   // 위 작업에서 만들어진 알림(환불 실패 경고 등)도 같은 실행에서 발송
    ["notificationsCleaned", () => cleanupNotifications(pool)],
    ["personalDataPurged", () => purgePersonalData(pool)],        // 보유기간이 지난 개인정보 파기 (개인정보처리방침의 보유기간과 같은 기준)
  ];
  const results: Record<string, unknown> = {};
  for (const [name, fn] of tasks) {
    try { results[name] = await fn(); }
    catch (e) { console.error(`[cron] ${name} 실패`, e); results[name] = { error: String((e as Error).message ?? e).slice(0, 200) }; }
  }
  return NextResponse.json({ ok: true, at: new Date().toISOString(), results }, { headers: { "Cache-Control": "no-store" } });
}
export const GET = handle;   // Vercel Cron 은 GET 으로 호출한다
export const POST = handle;
