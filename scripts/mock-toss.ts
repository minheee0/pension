/** 토스페이먼츠 API 흉내 서버(테스트 전용): 인증·멱등키·부분취소·가상계좌(입금 대기·입금·환불 계좌)·현금영수증 */
import http from "node:http";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";

export type ConfirmMode = "approve" | "reject" | "flaky";   // flaky: 실제로는 승인됐지만 응답은 500
interface Session {
  paymentKey: string; orderId: string; amount: number; status: string; method: "CARD" | "VIRTUAL_ACCOUNT";
  cancels: any[]; secret?: string; va?: any; cashReceipt?: any; receiptType: string;
}

export async function startMockToss(secretKey = "test_sk_mock") {
  const sessions = new Map<string, Session>();
  const idem = new Map<string, { status: number; body: any }>();
  const state = {
    mode: "approve" as ConfirmMode,
    cancelFails: false,
    confirmCalls: [] as { body: any; auth: string | undefined; idem: string | undefined }[],
    cancelCalls: [] as { paymentKey: string; body: any; idem: string | undefined }[],
  };
  const expectedAuth = `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`;

  const payment = (s: Session, withSecret = false) => ({
    paymentKey: s.paymentKey, orderId: s.orderId, status: s.status, totalAmount: s.amount,
    method: s.method === "VIRTUAL_ACCOUNT" ? "가상계좌" : "카드",
    approvedAt: s.status === "READY" || s.status === "IN_PROGRESS" ? null : new Date().toISOString(),
    receipt: { url: `https://mock.toss/receipt/${s.paymentKey}` },
    virtualAccount: s.va ?? null, cashReceipt: s.cashReceipt ?? null,
    secret: withSecret ? s.secret ?? null : null,                   // secret 은 승인 응답에만 내려온다
    cancels: s.cancels.length ? s.cancels : null,
  });

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const send = (status: number, body: any) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
      if (req.headers.authorization !== expectedAuth) return send(401, { code: "UNAUTHORIZED_KEY", message: "인증되지 않은 시크릿 키 혹은 클라이언트 키 입니다." });
      const body = raw ? JSON.parse(raw) : {};
      const idemKey = req.headers["idempotency-key"] as string | undefined;
      const url = req.url ?? "";

      if (req.method === "POST" && url === "/v1/payments/confirm") {
        state.confirmCalls.push({ body, auth: req.headers.authorization, idem: idemKey });
        if (idemKey && idem.has(idemKey)) return send(idem.get(idemKey)!.status, idem.get(idemKey)!.body);
        const s = sessions.get(body.paymentKey);
        if (!s || s.orderId !== body.orderId) return send(404, { code: "NOT_FOUND_PAYMENT_SESSION", message: "결제 시간이 만료되어 결제 진행 데이터가 존재하지 않습니다." });
        if (s.amount !== body.amount) return send(400, { code: "INVALID_REQUEST", message: "결제 금액이 일치하지 않습니다." });
        if (s.status !== "IN_PROGRESS") return send(400, { code: "ALREADY_PROCESSED_PAYMENT", message: "이미 처리된 결제 입니다." });
        if (state.mode === "reject") return send(400, { code: "REJECT_CARD_COMPANY", message: "카드사에서 결제를 거절했습니다." });
        if (s.method === "VIRTUAL_ACCOUNT") {
          s.status = "WAITING_FOR_DEPOSIT";
          s.secret = `secret_${randomBytes(6).toString("hex")}`;
          s.va = { accountType: "일반", accountNumber: `X${Math.floor(Math.random() * 1e12)}`, bankCode: "20", customerName: "(주)테스트상점",
            dueDate: new Date(Date.now() + 2 * 3600e3).toISOString(), expired: false, settlementStatus: "INCOMPLETED", refundStatus: "NONE" };
          const out = payment(s, true);
          if (idemKey) idem.set(idemKey, { status: 200, body: out });
          return send(200, out);
        }
        s.status = "DONE";
        if (state.mode === "flaky") return send(500, { code: "FAILED_INTERNAL_SYSTEM_PROCESSING", message: "내부 시스템 처리 작업이 실패했습니다." });
        const out = payment(s);
        if (idemKey) idem.set(idemKey, { status: 200, body: out });
        return send(200, out);
      }
      let m = url.match(/^\/v1\/payments\/orders\/([^/]+)$/);
      if (req.method === "GET" && m) {
        const s = [...sessions.values()].find((x) => x.orderId === decodeURIComponent(m![1]));
        return s ? send(200, payment(s)) : send(404, { code: "NOT_FOUND_PAYMENT", message: "존재하지 않는 결제 입니다." });
      }
      m = url.match(/^\/v1\/payments\/([^/]+)\/cancel$/);
      if (req.method === "POST" && m) {
        const key = decodeURIComponent(m[1]);
        state.cancelCalls.push({ paymentKey: key, body, idem: idemKey });
        if (state.cancelFails) return send(500, { code: "FAILED_INTERNAL_SYSTEM_PROCESSING", message: "취소 실패" });
        const s = sessions.get(key);
        if (!s) return send(404, { code: "NOT_FOUND_PAYMENT", message: "존재하지 않는 결제 입니다." });
        if (idemKey && idem.has(idemKey)) return send(idem.get(idemKey)!.status, idem.get(idemKey)!.body);
        if (s.method === "VIRTUAL_ACCOUNT" && s.status === "WAITING_FOR_DEPOSIT") {      // 입금 전: 계좌 반납
          s.status = "CANCELED";
          s.cancels.push({ cancelAmount: s.amount, cancelReason: body.cancelReason, transactionKey: `tx_${randomBytes(4).toString("hex")}` });
          return send(200, payment(s));
        }
        if (s.method === "VIRTUAL_ACCOUNT") {                                             // 입금 후: 환불 계좌 필수
          const a = body.refundReceiveAccount;
          if (!a?.bank || !a?.accountNumber || !a?.holderName) return send(400, { code: "INVALID_REFUND_ACCOUNT", message: "환불 계좌 정보가 필요합니다." });
        }
        const already = s.cancels.reduce((t, c) => t + c.cancelAmount, 0);
        const amt = body.cancelAmount ?? s.amount - already;
        if (amt <= 0 || already + amt > s.amount) return send(400, { code: "INVALID_CANCEL_AMOUNT", message: "취소 금액이 올바르지 않습니다." });
        s.cancels.push({ cancelAmount: amt, cancelReason: body.cancelReason, transactionKey: `tx_${randomBytes(4).toString("hex")}` });
        s.status = already + amt >= s.amount ? "CANCELED" : "PARTIAL_CANCELED";
        const out = payment(s);
        if (idemKey) idem.set(idemKey, { status: 200, body: out });
        return send(200, out);
      }
      m = url.match(/^\/v1\/payments\/([^/]+)$/);
      if (req.method === "GET" && m) {
        const s = sessions.get(decodeURIComponent(m[1]));
        return s ? send(200, payment(s)) : send(404, { code: "NOT_FOUND_PAYMENT", message: "존재하지 않는 결제 입니다." });
      }
      send(404, { code: "NOT_FOUND", message: url });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}`,
    state,
    /** 결제창 인증을 마친 상태(승인 전). 반환값이 successUrl 로 돌아오는 paymentKey */
    createSession(orderId: string, amount: number, opts: { method?: "CARD" | "VIRTUAL_ACCOUNT"; receiptType?: string } = {}) {
      const paymentKey = `pk_${randomBytes(8).toString("hex")}`;
      sessions.set(paymentKey, { paymentKey, orderId, amount, status: "IN_PROGRESS", method: opts.method ?? "CARD", cancels: [], receiptType: opts.receiptType ?? "소득공제" });
      return paymentKey;
    },
    setStatus(paymentKey: string, status: string) { sessions.get(paymentKey)!.status = status; },
    statusOf: (paymentKey: string) => sessions.get(paymentKey)?.status,
    secretOf: (paymentKey: string) => sessions.get(paymentKey)?.secret,
    /** 구매자가 가상계좌에 입금함 → DEPOSIT_CALLBACK 본문(eventType 없음, 평평한 구조)을 돌려준다 */
    deposit(paymentKey: string) {
      const s = sessions.get(paymentKey)!;
      s.status = "DONE";
      if (s.receiptType !== "미발행") {
        s.cashReceipt = { type: s.receiptType, receiptKey: `rk_${randomBytes(4).toString("hex")}`, issueNumber: `ISSUE${Math.floor(Math.random() * 1e8)}`,
          receiptUrl: `https://mock.toss/cash/${paymentKey}`, amount: s.amount };
      }
      return { createdAt: new Date().toISOString(), secret: s.secret, status: "DONE", transactionKey: `dep_${randomBytes(4).toString("hex")}`, orderId: s.orderId };
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
