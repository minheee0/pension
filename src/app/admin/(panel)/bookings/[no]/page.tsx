import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { pool } from "@/server/db";
import { getBookingDetail } from "@/server/admin/bookings";
import { AdminError } from "@/server/admin/errors";
import { requireAdminPage } from "@/server/admin/session";
import CancelPanel from "@/components/admin/CancelPanel";
import { formatPhone } from "@/lib/phone";
import { Badge, PAY_KO, REFUND_KO, td, th, won } from "@/components/admin/ui";

export const metadata: Metadata = { title: "예약 상세" };

export default async function BookingDetail({ params }: { params: Promise<{ no: string }> }) {
  const admin = await requireAdminPage();
  const { no } = await params;
  let d;
  try { d = await getBookingDetail(pool, admin, no); } catch (e) { if (e instanceof AdminError && e.status === 404) notFound(); throw e; }
  const b = d.booking;
  const fmt = (v: any) => (v ? new Date(v).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" }) : "-");
  const row = (k: string, v: React.ReactNode) => <div className="flex justify-between gap-4 border-b border-line/60 py-1.5"><dt className="text-giwa">{k}</dt><dd className="text-right">{v}</dd></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3"><Link href="/admin/bookings" className="underline">← 목록</Link>
        <h1 className="font-serif text-2xl font-bold text-wood">{b.bookingNo}</h1><Badge status={b.status} /></div>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded border border-line bg-white p-4"><h2 className="mb-2 font-bold">예약 정보</h2>
          <dl>
            {row("예약자", b.guestName)}{row("휴대폰", <a className="underline" href={`tel:${b.phone}`}>{formatPhone(b.phone)}</a>)}{row("이메일", b.email ?? "-")}
            {row("숙박", `${b.checkIn} ~ ${b.checkOut} (${b.nights}박)`)}{row("인원", `${b.guests}명`)}
            {row("객실 요금", won(b.roomTotal))}{b.extraGuestFee > 0 && row("추가 인원", won(b.extraGuestFee))}
            {d.options.map((o: any, i: number) => row(`${o.name}${o.use_date ? ` ${o.use_date}` : ""}${o.use_time ? ` ${o.use_time}` : ""}`, won(o.amount)))}
            {row("총 금액", <b>{won(b.totalAmount)}</b>)}{row("예약 시각", fmt(b.createdAt))}{row("요청사항", b.memo ?? "-")}
          </dl>
          <p className="mt-2 text-xs text-giwa">전화번호를 열람하면 작업 기록에 남습니다.</p>
        </section>

        <section className="rounded border border-line bg-white p-4"><h2 className="mb-2 font-bold">박별 요금 (예약 당시)</h2>
          <table className="w-full"><thead><tr><th className={th}>날짜</th><th className={th}>요금</th><th className={th}>적용</th><th className={th}>환불 등급</th></tr></thead>
            <tbody>{d.nights.map((n: any) => <tr key={n.date}><td className={td}>{n.date}</td><td className={td}>{won(n.price)}</td><td className={td}>{n.rule_applied}</td><td className={td}>{n.refund_tier === "peak" ? "성수기" : "비수기"} · {n.day_type === "weekend" ? "주말" : "주중"}</td></tr>)}</tbody></table>
        </section>
      </div>

      <section className="rounded border border-line bg-white p-4"><h2 className="mb-2 font-bold">결제</h2>
        {d.payments.length === 0 ? <p className="text-giwa">결제 내역이 없습니다.</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[40rem]"><thead><tr><th className={th}>주문번호</th><th className={th}>상태</th><th className={th}>수단</th><th className={th}>금액</th><th className={th}>결제 시각</th><th className={th}>영수증</th></tr></thead>
            <tbody>{d.payments.map((p: any) => <tr key={p.id}>
              <td className={td}>{p.pg_order_id}</td><td className={td}>{PAY_KO[p.status] ?? p.status}</td>
              <td className={td}>{p.method ?? "-"}{p.account_number ? ` · ${p.account_number}` : ""}</td><td className={td}>{won(p.amount)}</td><td className={td}>{fmt(p.paid_at)}</td>
              <td className={td}>{p.receipt_url && <a className="mr-2 underline" href={p.receipt_url} target="_blank" rel="noreferrer">전표</a>}{p.cash_receipt_url && <a className="underline" href={p.cash_receipt_url} target="_blank" rel="noreferrer">현금영수증</a>}</td></tr>)}</tbody></table></div>
        )}
        {d.cashReceipts.length > 0 && <p className="mt-2 text-giwa">현금영수증: {d.cashReceipts.map((c: any) => `${c.type === "income" ? "소득공제" : "지출증빙"} · ${c.status === "issued" ? "발급" : "취소"} · ${c.receipt_no ?? ""}`).join(", ")}</p>}
      </section>

      {d.refunds.length > 0 && (
        <section className="rounded border border-line bg-white p-4"><h2 className="mb-2 font-bold">환불</h2>
          <table className="w-full"><thead><tr><th className={th}>환불액</th><th className={th}>공제</th><th className={th}>상태</th><th className={th}>사유</th><th className={th}>요청</th></tr></thead>
            <tbody>{d.refunds.map((r: any) => <tr key={r.id}><td className={td}>{won(r.amount)}</td><td className={td}>{won(r.deduct_amount)}</td>
              <td className={td}>{REFUND_KO[r.status] ?? r.status}</td><td className={td}>{r.reason}</td><td className={td}>{fmt(r.requested_at)}</td></tr>)}</tbody></table>
        </section>
      )}

      {["held", "pending_payment", "confirmed"].includes(b.status) && (
        <section><h2 className="mb-2 font-bold">예약 취소</h2><CancelPanel bookingNo={b.bookingNo} canCancel={admin.role === "owner"} /></section>
      )}
    </div>
  );
}
