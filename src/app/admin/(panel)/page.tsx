import Link from "next/link";
import { pool } from "@/server/db";
import { getDashboard } from "@/server/admin/dashboard";
import { requireAdminPage } from "@/server/admin/session";
import { Badge, td, th, won } from "@/components/admin/ui";

export default async function Dashboard() {
  await requireAdminPage();
  const d = await getDashboard(pool);
  const Card = ({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) => (
    <div className={`rounded border p-4 ${warn ? "border-red-800/40 bg-red-50" : "border-line bg-white"}`}>
      <div className="text-giwa">{label}</div><div className={`mt-1 text-2xl font-bold ${warn ? "text-red-800" : ""}`}>{value}</div>
    </div>
  );
  const BookingTable = ({ rows, empty }: { rows: any[]; empty: string }) => rows.length === 0 ? <p className="text-giwa">{empty}</p> : (
    <table className="w-full"><thead><tr><th className={th}>예약번호</th><th className={th}>예약자</th><th className={th}>숙박</th><th className={th}>인원</th><th className={th}>금액</th><th className={th}>상태</th></tr></thead>
      <tbody>{rows.map((b) => <tr key={b.booking_no}>
        <td className={td}><Link className="underline" href={`/admin/bookings/${b.booking_no}`}>{b.booking_no}</Link></td>
        <td className={td}>{b.guest_name} <span className="text-giwa">({b.last4})</span></td><td className={td}>{b.check_in} ~ {b.check_out}</td>
        <td className={td}>{b.guests}명</td><td className={td}>{won(b.total_amount)}</td><td className={td}><Badge status={b.status} /></td></tr>)}</tbody></table>
  );

  return (
    <div className="space-y-8">
      <div><h1 className="font-serif text-2xl font-bold text-wood">대시보드</h1><p className="text-giwa">{d.today} 기준 (한국시간)</p></div>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card label="오늘 체크인" value={d.checkInsToday.length} />
        <Card label="오늘 체크아웃" value={d.checkOutsToday.length} />
        <Card label="입금 대기" value={d.pendingDeposits.length} />
        <Card label="환불 처리 필요" value={d.refundIssues.length} warn={d.refundIssues.length > 0} />
      </section>

      {d.refundIssues.length > 0 && (
        <section className="rounded border border-red-800/40 bg-red-50 p-4">
          <h2 className="font-bold text-red-800">환불 처리가 필요합니다</h2>
          <p className="mt-1">자동 환불이 끝나지 않은 건이 {d.refundIssues.length}건 있습니다. <Link className="underline" href="/admin/refunds">환불 현황에서 다시 시도</Link>하세요.</p>
        </section>
      )}

      <section><h2 className="mb-2 font-bold">{d.month} 현황</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Card label="결제 금액" value={won(d.monthPaid)} /><Card label="환불 금액" value={won(d.monthRefunded)} />
          <Card label="순매출" value={won(d.monthNet)} /><Card label="예약된 박 수" value={`${d.monthBookedNights}박`} />
        </div><p className="mt-1 text-xs text-giwa">결제 금액은 이번 달에 결제된 금액, 환불 금액은 이번 달에 환불 완료된 금액입니다.</p>
      </section>

      <section><h2 className="mb-2 font-bold">오늘 체크인</h2><BookingTable rows={d.checkInsToday} empty="오늘 체크인이 없습니다." /></section>
      <section><h2 className="mb-2 font-bold">오늘 체크아웃</h2><BookingTable rows={d.checkOutsToday} empty="오늘 체크아웃이 없습니다." /></section>
      <section><h2 className="mb-2 font-bold">앞으로 7일 체크인</h2><BookingTable rows={d.upcoming} empty="예정된 체크인이 없습니다." /></section>
      <section><h2 className="mb-2 font-bold">입금 대기 (가상계좌)</h2><BookingTable rows={d.pendingDeposits} empty="입금 대기 중인 예약이 없습니다." /></section>
    </div>
  );
}
