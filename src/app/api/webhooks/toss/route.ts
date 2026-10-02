import { NextResponse } from "next/server";
import { pool } from "@/server/db";
import { handleTossWebhook, webhookTokenOk, WebhookAuthError } from "@/server/payments/webhook";
import { jsonError, tooMany } from "@/server/http";
import { clientIp, rateLimit } from "@/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/webhooks/toss?token=...  ← 토스 개발자센터 > 웹훅에 이 주소를 등록 (PAYMENT_STATUS_CHANGED, DEPOSIT_CALLBACK)
export async function POST(req: Request) {
  const rl = rateLimit(`toss-webhook:${clientIp(req)}`, 300, 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterSec);
  if (!webhookTokenOk(req)) return jsonError("UNAUTHORIZED", "invalid token", 401);
  try {
    const body = await req.json();
    const result = await handleTossWebhook(pool, body, undefined, { transmissionId: req.headers.get("tosspayments-webhook-transmission-id") });
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    if (e instanceof WebhookAuthError) return jsonError("UNAUTHORIZED", "invalid secret", 401);
    console.error("[webhook] 처리 실패 — 토스가 재전송합니다", e);
    return jsonError("INTERNAL", "processing failed", 500);   // 500 이면 토스가 다시 보낸다
  }
}
