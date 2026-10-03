import Link from "next/link";
import { pool } from "@/server/db";
import { getDashboard } from "@/server/admin/dashboard";
import { syncWaitingDeposits } from "@/server/admin/sync";
import { requireAdminPage } from "@/server/admin/session";
import { Badge, td, th, won } from "@/components/admin/ui";

export default async function Dashboard() {
  const admin = await requireAdminPage();
  await syncWaitingDeposits(pool, admin);   // 입금 대기 건이 있으면 토스에 확인해 입금을 반영
  const d = await getDashboard(pool);
  // 카드는 모두 누를 수 있다: 숫자와 같은 조건으로 걸러 놓은 목록 화면으로 이동한다
  const Card = ({ label, value, warn, href }: { label: string; value: string | number; warn?: boolean; href: string }) => (
    <Link href={href} className={`block rounded border p-4 transition hover:shadow-md hover:border-wood ${warn ? "border-red-800/40 bg-red-50" : "border-line bg-white"}`}>
      <div className="flex items-center justify-between text-giwa"><span>{label}</span><span className="text-xs">자세히 →</span></div>
      <div className={`mt-1 text-2xl font-bold ${warn ? "text-red-800" : ""}`}>{value}</div>
    </Link>
  );
  const tr = `from=${d.today}&to=${d.today}`;
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

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Card label="오늘 체크인" value={d.checkInsToday.length} href={`/admin/bookings?${tr}&status=confirmed`} />
        <Card label="오늘 체크아웃" value={d.checkOutsToday.length} href={`/admin/bookings?outFrom=${d.today}&outTo=${d.today}&status=confirmed,completed`} />
        <Card label="입금 대기" value={d.pendingDeposits.length} href="/admin/bookings?status=pending_payment" />
        <Card label="환불 처리 필요" value={d.refundIssues.length} warn={d.refundIssues.length > 0} href="/admin/refunds" />
        <Card label="신고된 후기" value={d.reviewsReported} warn={d.reviewsReported > 0} href="/admin/reviews?f=reported" />
        <Card label="답글 안 단 후기" value={d.reviewsNeedReply} href="/admin/reviews?f=needs_reply" />
      </section>

      {d.refundIssues.length > 0 && (
        <section className="rounded border border-red-800/40 bg-red-50 p-4">
          <h2 className="font-bold text-red-800">환불 처리가 필요합니다</h2>
          <p className="mt-1">자동 환불이 끝나지 않은 건이 {d.refundIssues.length}건 있습니다. <Link className="underline" href="/admin/refunds">환불 현황에서 다시 시도</Link>하세요.</p>
        </section>
      )}

      <section><h2 className="mb-2 font-bold">{d.month} 현황</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Card label="결제 금액" value={won(d.monthPaid)} href={`/admin/sales?m=${d.month}&tab=payments`} /><Card label="환불 금액" value={won(d.monthRefunded)} href={`/admin/sales?m=${d.month}&tab=refunds`} />
          <Card label="순매출" value={won(d.monthNet)} href={`/admin/sales?m=${d.month}&tab=net`} /><Card label="예약된 박 수" value={`${d.monthBookedNights}박`} href={`/admin/sales?m=${d.month}&tab=nights`} />
        </div><p className="mt-1 text-xs text-giwa">각 카드를 누르면 내역을 볼 수 있습니다. 결제 금액은 이번 달에 결제된 금액, 환불 금액은 이번 달에 환불이 완료된 금액입니다.</p>
      </section>

      <section><h2 className="mb-2 font-bold">오늘 체크인</h2><BookingTable rows={d.checkInsToday} empty="오늘 체크인이 없습니다." /></section>
      <section><h2 className="mb-2 font-bold">오늘 체크아웃</h2><BookingTable rows={d.checkOutsToday} empty="오늘 체크아웃이 없습니다." /></section>
      <section><h2 className="mb-2 font-bold">앞으로 7일 체크인</h2><BookingTable rows={d.upcoming} empty="예정된 체크인이 없습니다." /></section>
      <section><h2 className="mb-2 font-bold">입금 대기 (가상계좌)</h2><BookingTable rows={d.pendingDeposits} empty="입금 대기 중인 예약이 없습니다." /></section>
    </div>
  );
}
