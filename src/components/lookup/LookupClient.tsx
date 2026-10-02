"use client";

import { useState } from "react";
import AccountBox from "@/components/reserve/AccountBox";
import { BANKS } from "@/lib/banks";
import { formatPhone, PHONE_OK, sanitizePhone } from "@/lib/phone";
import { SITE } from "@/lib/site";

interface Line { kind: string; label: string; amount: number; deduct: number; refund: number; deductRate: number }
interface Preview { daysBefore: number; lines: Line[]; totalAmount: number; deductTotal: number; refundTotal: number }
interface Assess { allowed: boolean; reason?: string; expectedRefund: number; refundAccountRequired: boolean; preview: Preview | null }
interface View {
  booking: {
    bookingNo: string; status: string; guestName: string; phoneLast4: string; checkIn: string; checkOut: string; nights: number; guests: number;
    roomTotal: number; extraGuestFee: number; optionTotal: number; totalAmount: number;
    options: { name: string; qty: number; amount: number; useDate: string | null; useTime: string | null }[];
  };
  payment: { status: string; method: string | null; amount: number; paidAt: string | null; receiptUrl: string | null; cashReceiptUrl: string | null;
    virtualAccount: { bankCode: string; accountNumber: string; holderName: string | null; dueDate: string | null } | null } | null;
  refund: { amount: number; deductAmount: number; status: string } | null;
  cancel: Assess;
}
interface Done { refund: { amount: number; deductAmount: number; done: boolean | null } | null }

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
const STATUS: Record<string, string> = {
  held: "결제 대기", pending_payment: "입금 대기", confirmed: "예약 확정", completed: "이용 완료",
  cancelled: "취소됨", expired: "시간 만료", no_show: "노쇼",
};
const REFUND_STATUS: Record<string, string> = { requested: "환불 처리 중", done: "환불 완료", failed: "환불 확인 필요", manual_needed: "환불 처리 중" };
const inputCls = "mt-1 block w-full rounded border border-line bg-white px-3 py-2";

export default function LookupClient() {
  const [bookingNo, setBookingNo] = useState("");
  const [phone, setPhone] = useState("");
  const [view, setView] = useState<View | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [bank, setBank] = useState("");
  const [acctNo, setAcctNo] = useState("");
  const [holder, setHolder] = useState("");

  const phoneDigits = sanitizePhone(phone);
  const formOk = bookingNo.trim().length >= 11 && PHONE_OK.test(phoneDigits);

  async function post(url: string, body: unknown) {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { ok: r.ok, status: r.status, json: await r.json() };
  }

  async function lookup() {
    setBusy(true); setErr(null);
    try {
      const r = await post("/api/bookings/lookup", { bookingNo, phone: phoneDigits });
      if (!r.ok) { setErr(r.json.error?.message ?? "조회하지 못했습니다"); return; }
      setView(r.json); setConfirmed(false); setDone(null);
    } catch { setErr("네트워크 오류가 발생했습니다. 다시 시도해 주세요"); } finally { setBusy(false); }
  }

  const acctOk = !!bank && acctNo.replace(/\D/g, "").length >= 8 && holder.trim().length > 0;

  async function cancel() {
    if (!view) return;
    setBusy(true); setErr(null);
    try {
      const r = await post("/api/bookings/cancel", { bookingNo: view.booking.bookingNo, phone: phoneDigits, expectedRefund: view.cancel.expectedRefund,
        ...(view.cancel.refundAccountRequired ? { refundAccount: { bank, accountNumber: acctNo, holderName: holder } } : {}) });
      if (r.ok) { setDone(r.json); setView({ ...view, booking: { ...view.booking, status: "cancelled" }, cancel: { allowed: false, expectedRefund: 0, refundAccountRequired: false, preview: null } }); return; }
      setErr(r.json.error?.message ?? "취소하지 못했습니다");
      if (r.json.error?.code === "REFUND_CHANGED" && r.json.error.detail?.cancel) {   // 금액이 바뀌었으면 새 금액으로 다시 확인받는다
        setView({ ...view, cancel: r.json.error.detail.cancel }); setConfirmed(false);
      }
    } catch { setErr("네트워크 오류가 발생했습니다. 다시 시도해 주세요"); } finally { setBusy(false); }
  }

  if (!view) {
    return (
      <form className="mt-8 max-w-md space-y-4" onSubmit={(e) => { e.preventDefault(); if (formOk && !busy) lookup(); }}>
        <label className="block text-sm">예약번호
          <input className={inputCls} value={bookingNo} onChange={(e) => setBookingNo(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 11))}
            placeholder="H로 시작하는 11자리" autoComplete="off" />
        </label>
        <label className="block text-sm">예약자 휴대폰 번호
          <input className={inputCls} type="tel" inputMode="numeric" maxLength={13} placeholder="010-0000-0000"
            value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))} />
        </label>
        {err && <p role="alert" className="text-sm text-red-800">{err}</p>}
        <button disabled={!formOk || busy} className="w-full rounded bg-wood px-4 py-3 text-hanji hover:bg-giwa disabled:cursor-not-allowed disabled:opacity-40">
          {busy ? "확인 중…" : "예약 조회"}
        </button>
      </form>
    );
  }

  const b = view.booking, c = view.cancel, p = c.preview;
  return (
    <div className="mt-8 space-y-6">
      {done && (
        <div className="rounded-lg border border-line bg-white p-5">
          <h2 className="font-serif text-2xl font-bold text-wood">예약이 취소되었습니다</h2>
          {done.refund ? (
            <p className="mt-2">
              환불 금액 <b>{won(done.refund.amount)}</b>
              {done.refund.done ? " · 환불이 접수되었습니다. 카드사에 따라 취소 내역 반영에 며칠 걸릴 수 있습니다."
                : " · 환불을 처리하고 있습니다. 확인되는 대로 반영되며, 지연되면 연락드립니다."}
            </p>
          ) : <p className="mt-2 text-giwa">결제 전 예약이라 환불할 금액이 없습니다.</p>}
        </div>
      )}

      <div className="rounded-lg border border-line bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-2xl font-bold">예약 정보</h2>
          <span className="rounded bg-line px-3 py-1 text-sm">{STATUS[b.status] ?? b.status}</span>
        </div>
        <dl className="mt-4 space-y-1 text-sm">
          <div className="flex justify-between"><dt>예약번호</dt><dd className="font-bold tracking-wider">{b.bookingNo}</dd></div>
          <div className="flex justify-between"><dt>예약자</dt><dd>{b.guestName} (휴대폰 끝자리 {b.phoneLast4})</dd></div>
          <div className="flex justify-between"><dt>숙박</dt><dd>{b.checkIn} ~ {b.checkOut} ({b.nights}박)</dd></div>
          <div className="flex justify-between"><dt>인원</dt><dd>{b.guests}명</dd></div>
          <div className="flex justify-between"><dt>객실 요금</dt><dd>{won(b.roomTotal)}</dd></div>
          {b.extraGuestFee > 0 && <div className="flex justify-between"><dt>추가 인원</dt><dd>{won(b.extraGuestFee)}</dd></div>}
          {b.options.map((o, i) => <div key={i} className="flex justify-between"><dt>{o.name}{o.useDate ? ` ${o.useDate}` : ""}{o.useTime ? ` ${o.useTime}` : ""}</dt><dd>{won(o.amount)}</dd></div>)}
          <div className="flex justify-between border-t border-line pt-2 font-bold"><dt>총 금액</dt><dd>{won(b.totalAmount)}</dd></div>
        </dl>
        {view.payment?.receiptUrl && <a href={view.payment.receiptUrl} target="_blank" rel="noreferrer" className="mr-4 mt-3 inline-block text-sm underline">{view.payment.method === "가상계좌" ? "거래내역서 보기" : "매출전표 보기"}</a>}
        {view.payment?.cashReceiptUrl && <a href={view.payment.cashReceiptUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm underline">현금영수증 보기</a>}
        {view.refund && !done && (
          <p className="mt-3 text-sm">환불 {won(view.refund.amount)} (공제 {won(view.refund.deductAmount)}) · {REFUND_STATUS[view.refund.status] ?? view.refund.status}</p>
        )}
      </div>

      {view.payment?.virtualAccount && b.status === "pending_payment" && <AccountBox va={view.payment.virtualAccount} amount={view.payment.amount} />}

      {c.allowed ? (
        <div className="rounded-lg border border-line bg-white p-5">
          <h2 className="font-serif text-2xl font-bold">예약 취소</h2>
          {p ? (
            <>
              <p className="mt-2 text-sm text-giwa">체크인 {p.daysBefore === 0 ? "당일" : `${p.daysBefore}일 전`} 취소 기준으로 계산한 환불 금액입니다.</p>
              <table className="mt-3 w-full text-sm">
                <thead><tr className="border-b border-line text-left text-giwa"><th className="py-1">항목</th><th className="text-right">결제</th><th className="text-right">공제</th><th className="text-right">환불</th></tr></thead>
                <tbody>
                  {p.lines.map((l, i) => (
                    <tr key={i} className="border-b border-line/60">
                      <td className="py-1">{l.label}</td><td className="text-right">{won(l.amount)}</td>
                      <td className="text-right">{l.deduct ? `-${won(l.deduct)}` : "-"}</td><td className="text-right">{won(l.refund)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="font-bold"><td className="pt-2">합계</td><td className="text-right">{won(p.totalAmount)}</td><td className="text-right">{p.deductTotal ? `-${won(p.deductTotal)}` : "-"}</td><td className="text-right">{won(p.refundTotal)}</td></tr></tfoot>
              </table>
              <p className="mt-3">환불 예정 금액 <b className="text-lg">{won(c.expectedRefund)}</b></p>
            </>
          ) : <p className="mt-2 text-sm text-giwa">{b.status === "pending_payment" ? "입금 전 예약입니다. 취소하면 발급된 가상계좌가 닫히니, 취소 후에는 입금하지 마세요." : "결제 전 예약으로, 취소해도 환불할 금액이 없습니다."}</p>}
          {c.refundAccountRequired && (
            <div className="mt-4 rounded border border-line p-3">
              <p className="text-sm font-medium">환불 받을 계좌</p>
              <p className="text-xs text-giwa">가상계좌로 결제하셔서 환불받을 계좌가 필요합니다. 영업일 기준 2일 안팎으로 입금되며, 환불이 끝나면 입력하신 계좌 정보는 삭제됩니다.</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                <select aria-label="은행" className={inputCls} value={bank} onChange={(e) => setBank(e.target.value)}>
                  <option value="">은행 선택</option>{BANKS.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
                </select>
                <input aria-label="계좌번호" className={inputCls} inputMode="numeric" placeholder="계좌번호(숫자만)" value={acctNo} onChange={(e) => setAcctNo(e.target.value.replace(/[^\d-]/g, "").slice(0, 24))} />
                <input aria-label="예금주" className={inputCls} placeholder="예금주" value={holder} maxLength={30} onChange={(e) => setHolder(e.target.value)} />
              </div>
            </div>
          )}
          <label className="mt-4 flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>{p ? "위 환불 금액을 확인했으며, 예약을 취소합니다." : "예약을 취소합니다."} 취소 후에는 되돌릴 수 없습니다.</span>
          </label>
          {err && <p role="alert" className="mt-3 text-sm text-red-800">{err}</p>}
          <button onClick={cancel} disabled={!confirmed || busy || (c.refundAccountRequired && !acctOk)}
            className="mt-4 w-full rounded bg-red-800 px-4 py-3 text-white hover:bg-red-900 disabled:cursor-not-allowed disabled:opacity-40">
            {busy ? "처리 중…" : "예약 취소하기"}
          </button>
        </div>
      ) : (
        !done && <p className="rounded-lg border border-line bg-white p-5 text-sm text-giwa">{c.reason}</p>
      )}

      <p className="text-sm text-giwa">날짜 변경 등 다른 요청은 {SITE.phone}로 문의해 주세요.</p>
      <button onClick={() => { setView(null); setDone(null); setErr(null); }} className="text-sm underline">다른 예약 조회하기</button>
    </div>
  );
}
