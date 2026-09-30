/**
 * 토스페이먼츠 API 클라이언트 (서버 전용)
 *  - 승인:  POST /v1/payments/confirm            (paymentKey, orderId, amount)
 *  - 조회:  GET  /v1/payments/{paymentKey}, /v1/payments/orders/{orderId}
 *  - 취소:  POST /v1/payments/{paymentKey}/cancel (cancelReason 필수, cancelAmount 선택)
 *  - 인증:  Authorization: Basic base64(시크릿키 + ":")   ← 콜론 필수
 *  - 멱등:  Idempotency-Key 헤더로 재시도해도 중복 승인·취소가 되지 않게 한다
 * 응답 필드는 API 버전에 따라 다를 수 있어 필요한 것만 느슨하게 읽는다.
 */
export class TossApiError extends Error {
  constructor(
    public httpStatus: number,   // 0 = 네트워크 오류/타임아웃
    public code: string,
    message: string,
    public retryable: boolean,   // 5xx·네트워크 오류: 결과를 알 수 없음(승인됐을 수도 있음)
  ) { super(message); this.name = "TossApiError"; }
}

export interface TossPayment {
  paymentKey: string;
  orderId: string;
  status: string;            // READY | IN_PROGRESS | WAITING_FOR_DEPOSIT | DONE | CANCELED | PARTIAL_CANCELED | ABORTED | EXPIRED
  totalAmount: number;
  method: string | null;
  approvedAt: string | null;
  secret: string | null;     // 가상계좌 승인 응답에만 존재 (웹훅 검증용)
  receiptUrl: string | null;
  virtualAccount: any | null;
  cashReceipt: any | null;
  cancels: any[] | null;
  raw: unknown;              // secret 을 제외한 원본
}

function parsePayment(j: any): TossPayment {
  const { secret, ...rest } = j ?? {};
  return {
    paymentKey: j.paymentKey, orderId: j.orderId, status: j.status,
    totalAmount: Number(j.totalAmount), method: j.method ?? null, approvedAt: j.approvedAt ?? null,
    secret: secret ?? null, receiptUrl: j.receipt?.url ?? null,
    virtualAccount: j.virtualAccount ?? null, cashReceipt: j.cashReceipt ?? null,
    cancels: Array.isArray(j.cancels) ? j.cancels : null, raw: rest,
  };
}

export interface TossClientConfig { secretKey?: string; baseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number }

export function createTossClient(cfg: TossClientConfig = {}) {
  const secretKey = cfg.secretKey ?? process.env.TOSS_SECRET_KEY;
  const baseUrl = cfg.baseUrl ?? process.env.TOSS_API_BASE ?? "https://api.tosspayments.com";
  const doFetch = cfg.fetchImpl ?? fetch;

  async function call(method: "GET" | "POST", path: string, body?: unknown, idempotencyKey?: string) {
    if (!secretKey) throw new Error("환경변수 TOSS_SECRET_KEY 가 없습니다 (.env.local 확인)");
    const headers: Record<string, string> = {
      Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
      "Content-Type": "application/json",
    };
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

    let res: Response;
    try {
      res = await doFetch(baseUrl + path, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(cfg.timeoutMs ?? 15_000),
      });
    } catch (e) {
      throw new TossApiError(0, "NETWORK_ERROR", `토스페이먼츠 연결 실패: ${String(e)}`, true);
    }
    const text = await res.text();
    let json: any = {};
    try { json = text ? JSON.parse(text) : {}; } catch { /* 본문이 JSON 이 아니면 빈 객체 */ }
    if (!res.ok) {
      throw new TossApiError(res.status, json.code ?? "UNKNOWN", json.message ?? `HTTP ${res.status}`, res.status >= 500);
    }
    return json;
  }

  return {
    confirm: async (p: { paymentKey: string; orderId: string; amount: number }, idempotencyKey?: string) =>
      parsePayment(await call("POST", "/v1/payments/confirm", p, idempotencyKey)),
    getByPaymentKey: async (paymentKey: string) =>
      parsePayment(await call("GET", `/v1/payments/${encodeURIComponent(paymentKey)}`)),
    getByOrderId: async (orderId: string) =>
      parsePayment(await call("GET", `/v1/payments/orders/${encodeURIComponent(orderId)}`)),
    cancel: async (
      paymentKey: string,
      p: { cancelReason: string; cancelAmount?: number; refundReceiveAccount?: unknown },
      idempotencyKey?: string,
    ) => parsePayment(await call("POST", `/v1/payments/${encodeURIComponent(paymentKey)}/cancel`,
      { ...p, cancelReason: p.cancelReason.slice(0, 200) }, idempotencyKey)),
  };
}
export type TossClient = ReturnType<typeof createTossClient>;
