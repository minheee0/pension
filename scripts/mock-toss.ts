/** 토스페이먼츠 API 흉내 서버(테스트 전용). 인증·멱등키·오류 상황을 재현한다. */
import http from "node:http";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";

export type ConfirmMode = "approve" | "reject" | "flaky";   // flaky: 실제로는 승인됐지만 응답은 500
interface Session { paymentKey: string; orderId: string; amount: number; status: string; cancels: any[] }

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

  const payment = (s: Session) => ({
    paymentKey: s.paymentKey, orderId: s.orderId, status: s.status, totalAmount: s.amount,
    method: "카드", approvedAt: s.status === "READY" ? null : new Date().toISOString(),
    receipt: { url: `https://mock.toss/receipt/${s.paymentKey}` }, secret: null, cancels: s.cancels.length ? s.cancels : null,
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
        if (s.status === "DONE") return send(400, { code: "ALREADY_PROCESSED_PAYMENT", message: "이미 처리된 결제 입니다." });
        if (state.mode === "reject") return send(400, { code: "REJECT_CARD_COMPANY", message: "카드사에서 결제를 거절했습니다." });
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
        s.status = "CANCELED";
        s.cancels.push({ cancelAmount: s.amount, cancelReason: body.cancelReason, transactionKey: `tx_${randomBytes(4).toString("hex")}` });
        return send(200, payment(s));
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
    /** 결제창에서 인증을 마친 상태(승인 전)를 만든다. 반환값이 successUrl 로 돌아오는 paymentKey */
    createSession(orderId: string, amount: number) {
      const paymentKey = `pk_${randomBytes(8).toString("hex")}`;
      sessions.set(paymentKey, { paymentKey, orderId, amount, status: "IN_PROGRESS", cancels: [] });
      return paymentKey;
    },
    setStatus(paymentKey: string, status: string) { sessions.get(paymentKey)!.status = status; },
    statusOf: (paymentKey: string) => sessions.get(paymentKey)?.status,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
