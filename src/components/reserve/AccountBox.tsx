"use client";

import { useState } from "react";
import { bankName } from "@/lib/banks";

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
const fmtDue = (s: string | null) => {
  if (!s) return "";
  const d = new Date(s.includes("+") || s.endsWith("Z") ? s : `${s}+09:00`);
  return isNaN(d.getTime()) ? s : d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
};

/** 가상계좌 입금 안내 (결제 완료 화면, 예약 조회 화면 공용) */
export default function AccountBox({ va, amount }: {
  va: { bankCode: string; accountNumber: string; holderName: string | null; dueDate: string | null }; amount: number;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg border-2 border-wood bg-white p-5">
      <h3 className="font-serif text-xl font-bold text-wood">입금 안내</h3>
      <dl className="mt-3 space-y-1 text-sm">
        <div className="flex justify-between"><dt>입금 은행</dt><dd className="font-bold">{bankName(va.bankCode)}</dd></div>
        <div className="flex justify-between"><dt>계좌번호</dt>
          <dd className="font-bold tracking-wide">{va.accountNumber}
            <button type="button" className="ml-2 rounded border border-line px-2 py-0.5 text-xs"
              onClick={() => navigator.clipboard?.writeText(va.accountNumber).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>
              {copied ? "복사됨" : "복사"}
            </button></dd></div>
        {va.holderName && <div className="flex justify-between"><dt>예금주</dt><dd>{va.holderName}</dd></div>}
        <div className="flex justify-between"><dt>입금 금액</dt><dd className="font-bold text-red-800">{won(amount)}</dd></div>
        {va.dueDate && <div className="flex justify-between"><dt>입금 기한</dt><dd className="font-bold">{fmtDue(va.dueDate)}까지</dd></div>}
      </dl>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-giwa">
        <li>금액이 정확히 일치하게 입금해야 합니다. 기한이 지나면 예약이 자동으로 취소됩니다.</li>
        <li>입금이 확인되면 예약이 확정되고, 현금영수증은 입금 후 발급됩니다.</li>
      </ul>
    </div>
  );
}
