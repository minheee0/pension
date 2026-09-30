"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

interface Booking { bookingNo: string; checkIn: string; checkOut: string; nights: number; guests: number; totalAmount: number }
type State =
  | { kind: "loading" }
  | { kind: "confirmed"; booking: Booking; receiptUrl: string | null }
  | { kind: "refunded"; refundOk: boolean; reason: string }
  | { kind: "failed"; message: string }
  | { kind: "error"; message: string };

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

/** 결제창에서 돌아온 직후 서버에 승인을 요청하고 결과를 보여준다. 서버가 멱등이라 새로고침해도 안전. */
export default function ConfirmClient(p: { paymentKey: string; orderId: string; amount: number }) {
  const started = useRef(false);
  const [st, setSt] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    fetch("/api/payments/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paymentKey: p.paymentKey, orderId: p.orderId, amount: p.amount }),
    })
      .then(async (r) => {
        const j = await r.json();
        if (r.ok && j.kind === "confirmed") setSt({ kind: "confirmed", booking: j.booking, receiptUrl: j.receiptUrl });
        else if (r.ok && j.kind === "refunded") setSt({ kind: "refunded", refundOk: j.refundOk, reason: j.reason });
        else if (j.kind === "failed") setSt({ kind: "failed", message: j.message });
        else setSt({ kind: "error", message: j.error?.message ?? "결제 확인 중 문제가 발생했습니다" });
      })
      .catch(() => setSt({ kind: "error", message: "네트워크 오류가 발생했습니다. 이 페이지를 새로고침해 주세요" }));
  }, [p.paymentKey, p.orderId, p.amount]);

  const box = "mt-8 max-w-lg rounded-lg border border-line bg-white p-6";
  if (st.kind === "loading") return <div className={box}><p>결제를 확인하고 있습니다. 창을 닫지 말고 잠시만 기다려 주세요…</p></div>;

  if (st.kind === "confirmed") {
    const b = st.booking;
    return (
      <div className={box}>
        <h2 className="font-serif text-2xl font-bold text-wood">예약이 확정되었습니다</h2>
        <dl className="mt-4 space-y-1 text-sm">
          <div className="flex justify-between"><dt>예약번호</dt><dd className="font-bold tracking-wider">{b.bookingNo}</dd></div>
          <div className="flex justify-between"><dt>숙박</dt><dd>{b.checkIn} ~ {b.checkOut} ({b.nights}박)</dd></div>
          <div className="flex justify-between"><dt>인원</dt><dd>{b.guests}명</dd></div>
          <div className="flex justify-between"><dt>결제 금액</dt><dd>{won(b.totalAmount)}</dd></div>
        </dl>
        <p className="mt-4 text-sm text-giwa">예약번호와 예약 시 입력한 휴대폰 번호는 조회·취소에 필요하니 꼭 보관해 주세요.</p>
        {st.receiptUrl && <a href={st.receiptUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block underline">매출전표 보기</a>}
        <div className="mt-5"><Link href="/" className="rounded bg-wood px-5 py-2 text-hanji hover:bg-giwa">홈으로</Link></div>
      </div>
    );
  }

  if (st.kind === "refunded") {
    return (
      <div className={box}>
        <h2 className="font-serif text-2xl font-bold">예약을 완료하지 못했습니다</h2>
        <p className="mt-3">
          {st.reason === "HOLD_LOST" ? "결제하시는 사이 선택하신 날짜가 다른 예약으로 확정되었습니다." : "예약을 확정할 수 없는 상태였습니다."}
        </p>
        <p className="mt-2 font-medium">{st.refundOk
          ? "결제 금액은 자동으로 전액 취소되었습니다. 카드사에 따라 취소 내역 반영에 며칠 걸릴 수 있습니다."
          : "자동 취소에 실패했습니다. 결제 금액은 반드시 환불해 드리니 아래 연락처로 문의해 주세요."}</p>
        <div className="mt-5"><Link href="/reserve" className="rounded bg-wood px-5 py-2 text-hanji hover:bg-giwa">다른 날짜 보기</Link></div>
      </div>
    );
  }

  return (
    <div className={box}>
      <h2 className="font-serif text-2xl font-bold">{st.kind === "failed" ? "결제가 승인되지 않았습니다" : "결제 확인이 필요합니다"}</h2>
      <p className="mt-3 text-red-800">{st.message}</p>
      <p className="mt-2 text-sm text-giwa">다시 시도하시거나, 결제되었는데 예약이 확인되지 않으면 문의해 주세요.</p>
      <div className="mt-5"><Link href="/reserve" className="rounded bg-wood px-5 py-2 text-hanji hover:bg-giwa">예약 화면으로</Link></div>
    </div>
  );
}
