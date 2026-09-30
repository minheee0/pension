import { createHash, timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";
import { createTossClient, type TossClient } from "./toss";
import { reconcileByOrderId } from "./service";

/** 웹훅 URL 뒤에 붙인 ?token= 값 확인 (토스 결제 웹훅에는 서명이 없어서 추가로 둔 1차 방어) */
export function webhookTokenOk(req: Request): boolean {
  const expected = process.env.TOSS_WEBHOOK_TOKEN;
  if (!expected) return true;   // 설정 안 하면 검사 생략. 운영에서는 반드시 설정할 것
  const got = new URL(req.url).searchParams.get("token") ?? "";
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(got), h(expected));
}

/**
 * 같은 이벤트가 여러 번 와도 한 번만 처리한다(payment_events 유니크 키).
 * 처리 중 오류가 나면 예외를 던져 500 을 돌려주고, 토스가 재전송하면 다시 처리한다.
 */
export async function handleTossWebhook(pool: Pool, body: any, toss: TossClient = createTossClient()) {
  const type = String(body?.eventType ?? "");
  const data = body?.data ?? body;   // DEPOSIT_CALLBACK 은 data 없이 평평한 구조
  const orderId = typeof data?.orderId === "string" ? data.orderId : null;
  const eventId = [type, data?.paymentKey ?? data?.transactionKey ?? orderId ?? "", data?.status ?? "", body?.createdAt ?? ""].join(":");

  const ins = await pool.query(
    `insert into payment_events (provider, event_id, payload) values ('toss', $1, $2::jsonb)
     on conflict (provider, event_id) do nothing returning id`, [eventId, JSON.stringify(body ?? {})]);
  let rowId: number | undefined = ins.rows[0]?.id;
  if (!rowId) {
    const ex = await pool.query(`select id, processed_at from payment_events where provider = 'toss' and event_id = $1`, [eventId]);
    if (ex.rows[0].processed_at) return "duplicate" as const;
    rowId = ex.rows[0].id;
  }

  let result: "processed" | "ignored" = "ignored";
  if ((type === "PAYMENT_STATUS_CHANGED" || type === "CANCEL_STATUS_CHANGED") && orderId) {
    await reconcileByOrderId(pool, orderId, toss);
    result = "processed";
  }
  // DEPOSIT_CALLBACK(가상계좌 입금)은 다음 단계에서 처리한다
  await pool.query(`update payment_events set processed_at = now() where id = $1`, [rowId]);
  return result;
}
