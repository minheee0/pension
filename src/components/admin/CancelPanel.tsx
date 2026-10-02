"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { BANKS } from "@/lib/banks";
import { inputCls, won } from "./ui";

interface Assess {
  allowed: boolean; reason?: string; expectedRefund: number; refundAccountRequired: boolean;
  preview: null | { daysBefore: number; lines: { label: string; amount: number; deduct: number; refund: number }[]; totalAmount: number; deductTotal: number; refundTotal: number };
}

/** 관리자 예약 취소: 방식 선택 → 환불 금액 미리보기 → 확인 후 실행 (미리보기와 다른 금액이면 서버가 거절하고 다시 보여 줌) */
export default function CancelPanel({ bookingNo, canCancel }: { bookingNo: string; canCancel: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"host" | "policy">("host");
  const [a, setA] = useState<Assess | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [bank, setBank] = useState(""); const [acct, setAcct] = useState(""); const [holder, setHolder] = useState("");

  const call = useCallback(async (body: object) => {
    const r = await fetch("/api/admin/bookings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { ok: r.ok, json: await r.json().catch(() => ({})) };
  }, []);

  useEffect(() => {
    setA(null); setErr(null); setConfirmed(false);
    call({ op: "preview", bookingNo, mode }).then((r) => (r.ok ? setA(r.json) : setErr(r.json.error?.message ?? "미리보기를 불러오지 못했습니다")));
  }, [bookingNo, mode, call]);

  const acctOk = !!bank && acct.replace(/\D/g, "").length >= 8 && holder.trim().length > 0;

  async function run() {
    if (!a) return;
    setBusy(true); setErr(null);
    const r = await call({ op: "cancel", bookingNo, mode, expectedRefund: a.expectedRefund,
      ...(a.refundAccountRequired ? { refundAccount: { bank, accountNumber: acct, holderName: holder } } : {}) });
    setBusy(false);
    if (r.ok) {
      setOk(r.json.refund ? `취소했습니다. 환불 ${won(r.json.refund.amount)} ${r.json.refund.done ? "접수 완료" : "처리 중(환불 처리 현황에서 확인)"}` : "취소했습니다. (환불할 금액 없음)");
      router.refresh();
      return;
    }
    setErr(r.json.error?.message ?? "취소하지 못했습니다");
    if (r.json.error?.code === "REFUND_CHANGED" && r.json.error.detail?.cancel) { setA(r.json.error.detail.cancel); setConfirmed(false); }
  }

  if (ok) return <p className="rounded border border-line bg-white p-4 text-sm">{ok}</p>;
  if (!canCancel) return <p className="text-sm text-giwa">취소는 소유자 계정만 할 수 있습니다.</p>;

  return (
    <div className="space-y-3 rounded border border-line bg-white p-4 text-sm">
      <fieldset className="space-y-1">
        <legend className="font-medium">취소 방식</legend>
        <label className="flex items-start gap-2"><input type="radio" checked={mode === "host"} onChange={() => setMode("host")} className="mt-1" />
          <span>사업자 사정 (전액 환불)<span className="block text-xs text-giwa">시설 문제, 사장님 사정 등 손님 귀책이 아닌 경우</span></span></label>
        <label className="flex items-start gap-2"><input type="radio" checked={mode === "policy"} onChange={() => setMode("policy")} className="mt-1" />
          <span>환불 규정 적용<span className="block text-xs text-giwa">손님 요청·노쇼. 체크인일 이후에는 당일 취소 기준으로 계산</span></span></label>
      </fieldset>

      {!a && !err && <p className="text-giwa">불러오는 중…</p>}
      {a && !a.allowed && <p className="text-red-800">{a.reason}</p>}
      {a?.allowed && (
        <>
          {a.preview ? (
            <table className="w-full">
              <thead><tr className="text-left text-giwa"><th>항목</th><th className="text-right">결제</th><th className="text-right">공제</th><th className="text-right">환불</th></tr></thead>
              <tbody>{a.preview.lines.map((l, i) => <tr key={i} className="border-t border-line/60"><td>{l.label}</td><td className="text-right">{won(l.amount)}</td><td className="text-right">{l.deduct ? `-${won(l.deduct)}` : "-"}</td><td className="text-right">{won(l.refund)}</td></tr>)}</tbody>
              <tfoot><tr className="border-t border-line font-bold"><td>합계</td><td className="text-right">{won(a.preview.totalAmount)}</td><td className="text-right">{a.preview.deductTotal ? `-${won(a.preview.deductTotal)}` : "-"}</td><td className="text-right">{won(a.preview.refundTotal)}</td></tr></tfoot>
            </table>
          ) : <p className="text-giwa">결제 전(또는 입금 전) 예약이라 환불할 금액이 없습니다. 입금 대기 중이면 발급된 가상계좌도 함께 닫힙니다.</p>}

          {a.refundAccountRequired && (
            <div className="rounded border border-line p-3">
              <p className="font-medium">환불 받을 계좌 (손님께 전화로 확인)</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                <select aria-label="은행" className={inputCls} value={bank} onChange={(e) => setBank(e.target.value)}><option value="">은행 선택</option>{BANKS.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}</select>
                <input aria-label="계좌번호" className={inputCls} placeholder="계좌번호" inputMode="numeric" value={acct} onChange={(e) => setAcct(e.target.value.replace(/[^\d-]/g, "").slice(0, 24))} />
                <input aria-label="예금주" className={inputCls} placeholder="예금주" value={holder} maxLength={30} onChange={(e) => setHolder(e.target.value)} />
              </div>
            </div>
          )}

          <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>{a.preview ? `환불 ${won(a.expectedRefund)}` : "취소"}을(를) 확인했습니다. 취소는 되돌릴 수 없습니다.</span></label>
          <button onClick={run} disabled={!confirmed || busy || (a.refundAccountRequired && !acctOk)} className="rounded bg-red-800 px-4 py-2 text-white hover:bg-red-900 disabled:opacity-40">
            {busy ? "처리 중…" : "예약 취소 실행"}
          </button>
        </>
      )}
      {err && <p role="alert" className="text-red-800">{err}</p>}
    </div>
  );
}
