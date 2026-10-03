import type { Metadata } from "next";
import Link from "next/link";
import { pool } from "@/server/db";
import { listBookings } from "@/server/admin/bookings";
import { requireAdminPage } from "@/server/admin/session";
import { Badge, inputCls, PAY_KO, td, th, won } from "@/components/admin/ui";

export const metadata: Metadata = { title: "예약" };

export default async function Bookings({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdminPage();
  const sp = await searchParams;
  const page = Math.max(0, Number(sp.page ?? 0) || 0);
  const res = await listBookings(pool, { q: sp.q, status: sp.status, from: sp.from, to: sp.to, outFrom: sp.outFrom, outTo: sp.outTo, page });
  const qs = (p: number) => new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([, v]) => v) as [string, string][]), page: String(p) }).toString();
  const pages = Math.ceil(res.total / res.pageSize);

  return (
    <div className="space-y-4">
      <h1 className="font-serif text-2xl font-bold text-wood">예약</h1>
      {(sp.outFrom || sp.outTo) && (
        <p className="rounded border border-line bg-white p-2 text-sm">체크아웃 {sp.outFrom ?? ""}{sp.outTo && sp.outTo !== sp.outFrom ? ` ~ ${sp.outTo}` : ""} 예약만 표시 중 · <Link className="underline" href="/admin/bookings">필터 해제</Link></p>
      )}
      <form className="grid gap-2 rounded border border-line bg-white p-3 md:grid-cols-[2fr_1fr_1fr_1fr_auto]">
        {sp.outFrom && <input type="hidden" name="outFrom" value={sp.outFrom} />}{sp.outTo && <input type="hidden" name="outTo" value={sp.outTo} />}
        <label>검색<input name="q" defaultValue={sp.q} placeholder="예약번호, 이름, 전화번호 끝 4자리" className={inputCls} /></label>
        <label>상태<select name="status" defaultValue={sp.status ?? ""} className={inputCls}>
          <option value="">전체</option><option value="confirmed,completed">예약 확정·이용 완료</option>{["confirmed", "pending_payment", "held", "completed", "cancelled", "expired", "no_show"].map((s) => <option key={s} value={s}>{({ confirmed: "예약 확정", pending_payment: "입금 대기", held: "결제 대기", completed: "이용 완료", cancelled: "취소", expired: "만료", no_show: "노쇼" } as any)[s]}</option>)}
        </select></label>
        <label>체크인 시작<input type="date" name="from" defaultValue={sp.from} className={inputCls} /></label>
        <label>체크인 끝<input type="date" name="to" defaultValue={sp.to} className={inputCls} /></label>
        <button className="self-end rounded bg-wood px-4 py-2 text-white">검색</button>
      </form>

      <p className="text-giwa">총 {res.total}건</p>
      <div className="overflow-x-auto"><table className="w-full min-w-[48rem]">
        <thead><tr><th className={th}>예약번호</th><th className={th}>예약자</th><th className={th}>숙박</th><th className={th}>금액</th><th className={th}>결제</th><th className={th}>상태</th><th className={th}>예약일</th></tr></thead>
        <tbody>
          {res.rows.map((b: any) => (
            <tr key={b.booking_no}>
              <td className={td}><Link className="underline" href={`/admin/bookings/${b.booking_no}`}>{b.booking_no}</Link></td>
              <td className={td}>{b.guest_name} <span className="text-giwa">({b.last4})</span></td>
              <td className={td}>{b.check_in} ~ {b.check_out} ({b.nights}박 · {b.guests}명)</td>
              <td className={td}>{won(b.total_amount)}</td>
              <td className={td}>{b.pay_status ? `${PAY_KO[b.pay_status] ?? b.pay_status}${b.pay_method ? ` · ${b.pay_method}` : ""}` : "-"}</td>
              <td className={td}><Badge status={b.status} /></td>
              <td className={td}>{new Date(b.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" })}</td>
            </tr>
          ))}
          {res.rows.length === 0 && <tr><td className={td} colSpan={7}>조건에 맞는 예약이 없습니다.</td></tr>}
        </tbody>
      </table></div>
      {pages > 1 && (
        <div className="flex gap-3">
          {page > 0 && <Link className="underline" href={`/admin/bookings?${qs(page - 1)}`}>← 이전</Link>}
          <span>{page + 1} / {pages}</span>
          {page + 1 < pages && <Link className="underline" href={`/admin/bookings?${qs(page + 1)}`}>다음 →</Link>}
        </div>
      )}
    </div>
  );
}
