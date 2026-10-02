"use client";

import { useState } from "react";
import PayButton, { type CashReceiptType, type PayMethod } from "./PayButton";

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

/** 결제수단(카드·간편결제 / 가상계좌)과 현금영수증 용도를 고른 뒤 결제하는 영역 */
export default function PaySection({ bookingNo, amount }: { bookingNo: string; amount?: number }) {
  const [method, setMethod] = useState<PayMethod>("CARD");
  const [receipt, setReceipt] = useState<CashReceiptType>("소득공제");
  const radio = "flex cursor-pointer items-start gap-2 rounded border border-line p-3 text-sm";

  return (
    <div className="mt-5 space-y-3">
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">결제수단</legend>
        <label className={`${radio} ${method === "CARD" ? "border-wood bg-white" : ""}`}>
          <input type="radio" name="method" className="mt-1" checked={method === "CARD"} onChange={() => setMethod("CARD")} />
          <span>카드 · 간편결제<span className="block text-xs text-giwa">결제 즉시 예약이 확정됩니다.</span></span>
        </label>
        <label className={`${radio} ${method === "VIRTUAL_ACCOUNT" ? "border-wood bg-white" : ""}`}>
          <input type="radio" name="method" className="mt-1" checked={method === "VIRTUAL_ACCOUNT"} onChange={() => setMethod("VIRTUAL_ACCOUNT")} />
          <span>가상계좌 (무통장입금)<span className="block text-xs text-giwa">발급된 계좌로 입금 기한 안에 입금하면 예약이 확정됩니다. 현금영수증을 받을 수 있습니다.</span></span>
        </label>
      </fieldset>

      {method === "VIRTUAL_ACCOUNT" && (
        <label className="block text-sm">현금영수증
          <select value={receipt} onChange={(e) => setReceipt(e.target.value as CashReceiptType)}
            className="mt-1 block w-full rounded border border-line bg-white px-3 py-2">
            <option value="소득공제">소득공제용 (개인)</option>
            <option value="지출증빙">지출증빙용 (사업자)</option>
            <option value="미발행">발급 안 함</option>
          </select>
          <span className="mt-1 block text-xs text-giwa">번호(휴대폰·사업자번호)는 결제창에서 입력합니다. 입금이 확인되면 자동으로 발급됩니다.</span>
        </label>
      )}

      <PayButton bookingNo={bookingNo} method={method} cashReceiptType={receipt}
        label={method === "VIRTUAL_ACCOUNT" ? `가상계좌 발급받기${amount ? ` (${won(amount)})` : ""}` : `${amount ? won(amount) + " " : ""}결제하기`} />
    </div>
  );
}
