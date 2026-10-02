import type { Metadata } from "next";
import Link from "next/link";
import { pool } from "@/server/db";
import { listRefunds } from "@/server/admin/refunds";
import { requireAdminPage } from "@/server/admin/session";
import JsonForm from "@/components/admin/JsonForm";
import { Banner, REFUND_KO, td, th, won } from "@/components/admin/ui";

export const metadata: Metadata = { title: "환불 현황" };

export default async function RefundsPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const admin = await requireAdminPage();
  const sp = await searchParams;
  const all = sp.all === "1";
  const rows = await listRefunds(pool, !all);
  const open = rows.filter((r: any) => r.status !== "done");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><h1 className="font-serif text-2xl font-bold text-wood">환불 현황</h1>
        <Link className="underline" href={all ? "/admin/refunds" : "/admin/refunds?all=1"}>{all ? "처리 필요한 건만 보기" : "전체 보기"}</Link></div>
      {open.length > 0 ? <Banner tone="warn">처리가 끝나지 않은 환불이 {open.length}건 있습니다. 같은 요청을 다시 보내도 환불이 중복되지 않습니다. 계속 실패하면 토스페이먼츠 대시보드를 확인하세요.</Banner> : <Banner>처리가 필요한 환불이 없습니다.</Banner>}
      <div className="overflow-x-auto"><table className="w-full min-w-[44rem]">
        <thead><tr><th className={th}>예약</th><th className={th}>환불액</th><th className={th}>공제</th><th className={th}>상태</th><th className={th}>사유</th><th className={th}>요청</th><th className={th}></th></tr></thead>
        <tbody>
          {rows.map((r: any) => (
            <tr key={r.id}>
              <td className={td}><Link className="underline" href={`/admin/bookings/${r.booking_no}`}>{r.booking_no}</Link> <span className="text-giwa">{r.guest_name}</span></td>
              <td className={td}>{won(r.amount)}</td><td className={td}>{won(r.deduct_amount)}</td>
              <td className={td}><span className={r.status === "done" ? "" : "font-bold text-red-800"}>{REFUND_KO[r.status] ?? r.status}</span>{r.method === "가상계좌" && r.status !== "done" && !r.has_account && <span className="block text-xs text-red-800">환불 계좌 정보 없음 → 직접 처리 필요</span>}</td>
              <td className={td}>{r.reason}</td>
              <td className={td}>{new Date(r.requested_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" })}</td>
              <td className={td}>{admin.role === "owner" && r.status !== "done" && <JsonForm endpoint="/api/admin/refunds" op="retry" extra={{ id: r.id }} submitLabel="다시 시도" inline />}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td className={td} colSpan={7}>내역이 없습니다.</td></tr>}
        </tbody>
      </table></div>
    </div>
  );
}
