"use client";

import { useState } from "react";

/**
 * 결제하기: 서버에서 주문번호·금액을 받아 토스 결제창(SDK v2)을 연다.
 * 금액은 서버가 준 값만 사용한다. 결제 후 successUrl 로 돌아와 서버가 다시 검증·승인한다.
 */
export default function PayButton({ bookingNo, label = "결제하기" }: { bookingNo: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function pay() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/payments/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bookingNo }),
      });
      const j = await r.json();
      if (!r.ok) { setErr(j.error?.message ?? "결제를 시작하지 못했습니다"); return; }

      const { loadTossPayments, ANONYMOUS } = await import("@tosspayments/tosspayments-sdk");
      const toss = await loadTossPayments(j.clientKey);
      const payment = toss.payment({ customerKey: ANONYMOUS });   // 비회원 결제
      await payment.requestPayment({
        method: "CARD",   // 카드·간편결제 통합결제창
        amount: { currency: "KRW", value: j.amount },
        orderId: j.orderId,
        orderName: j.orderName,
        successUrl: `${window.location.origin}/reserve/pay/success`,
        failUrl: `${window.location.origin}/reserve/pay/fail?no=${encodeURIComponent(bookingNo)}`,
      });
    } catch (e: any) {
      setErr(e?.message ?? "결제창을 열지 못했습니다");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={pay} disabled={busy}
        className="w-full rounded bg-wood px-4 py-3 text-hanji hover:bg-giwa disabled:cursor-not-allowed disabled:opacity-40">
        {busy ? "결제창 여는 중…" : label}
      </button>
      {err && <p role="alert" className="mt-2 text-sm text-red-800">{err}</p>}
    </div>
  );
}
