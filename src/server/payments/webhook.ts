import { createHash, timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";
import { createTossClient, type TossClient } from "./toss";
import { reconcileByOrderId } from "./service";

export class WebhookAuthError extends Error {}
const sha = (s: string) => createHash("sha256").update(s).digest();

/** 웹훅 URL 뒤에 붙인 ?token= 값 확인 (결제 웹훅에는 서명이 없어서 추가로 둔 1차 방어) */
export function webhookTokenOk(req: Request): boolean {
  const expected = process.env.TOSS_WEBHOOK_TOKEN;
  if (!expected) return true;   // 설정 안 하면 검사 생략. 운영에서는 반드시 설정할 것
  const got = new URL(req.url).searchParams.get("token") ?? "";
  return timingSafeEqual(sha(got), sha(expected));
}

/**
 * 같은 이벤트가 여러 번 와도 한 번만 처리한다(payment_events 유니크 키).
 * 처리 중 오류가 나면 예외를 던져 500 을 돌려주고, 토스가 재전송하면 다시 처리한다.
 *
 *  - PAYMENT_STATUS_CHANGED : 카드 등. data.orderId
 *  - DEPOSIT_CALLBACK       : 가상계좌 입금. 본문에 eventType 이 없고 { createdAt, secret, status, transactionKey, orderId } 로 평평하다.
 *                             secret 이 승인 응답의 secret 과 같아야 한다(여기서는 저장해 둔 해시와 비교).
 */
export async function handleTossWebhook(pool: Pool, body: any, toss: TossClient = createTossClient(), meta: { transmissionId?: string | null } = {}) {
  const type = String(body?.eventType ?? "");
  const data = body?.data ?? body;
  const orderId = typeof data?.orderId === "string" ? data.orderId : null;
  const isDeposit = type === "DEPOSIT_CALLBACK" || (!type && typeof body?.secret === "string" && !!orderId);

  if (isDeposit && orderId) {
    const r = await pool.query(`select virtual_account->>'secretHash' as h from payments where pg_order_id = $1 and pg_provider = 'toss'`, [orderId]);
    if (!r.rows[0]) return "ignored" as const;                      // 우리 주문이 아님
    const h: string | null = r.rows[0].h;
    if (h) {
      const got = createHash("sha256").update(String(body.secret ?? "")).digest("hex");
      if (!timingSafeEqual(Buffer.from(got), Buffer.from(h))) throw new WebhookAuthError("secret 불일치");
    }
  }

  const eventId = meta.transmissionId
    || [type || "DEPOSIT", data?.paymentKey ?? data?.transactionKey ?? orderId ?? "", data?.status ?? "", body?.createdAt ?? ""].join(":");
  const ins = await pool.query(
    `insert into payment_events (provider, event_id, payload) values ('toss', $1, $2::jsonb)
     on conflict (provider, event_id) do nothing returning id`, [eventId, JSON.stringify({ ...body, secret: body?.secret ? "[redacted]" : undefined })]);
  let rowId: number | undefined = ins.rows[0]?.id;
  if (!rowId) {
    const ex = await pool.query(`select id, processed_at from payment_events where provider = 'toss' and event_id = $1`, [eventId]);
    if (ex.rows[0].processed_at) return "duplicate" as const;
    rowId = ex.rows[0].id;
  }

  let result: "processed" | "ignored" = "ignored";
  if ((isDeposit || type === "PAYMENT_STATUS_CHANGED" || type === "CANCEL_STATUS_CHANGED") && orderId) {
    await reconcileByOrderId(pool, orderId, toss);
    result = "processed";
  }
  await pool.query(`update payment_events set processed_at = now() where id = $1`, [rowId]);
  return result;
}
