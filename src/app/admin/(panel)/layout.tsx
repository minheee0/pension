import type { Metadata } from "next";
import Link from "next/link";
import LogoutButton from "@/components/admin/LogoutButton";
import { requireAdminPage } from "@/server/admin/session";

export const metadata: Metadata = { title: { default: "관리자", template: "%s | 만복 관리자" }, robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const NAV = [
  ["/admin", "대시보드"], ["/admin/bookings", "예약"], ["/admin/reviews", "후기"], ["/admin/calendar", "달력·차단"], ["/admin/sales", "매출"], ["/admin/pricing", "요금·옵션"],
  ["/admin/policy", "환불 규정·설정"], ["/admin/refunds", "환불 현황"], ["/admin/notifications", "알림"], ["/admin/audit", "작업 기록"],
];

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdminPage();
  return (
    <div className="min-h-screen bg-hanji text-sm">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <nav className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Link href="/admin" className="font-serif text-lg font-bold text-wood">만복 관리자</Link>
            {NAV.map(([href, label]) => <Link key={href} href={href} className="hover:text-wood">{label}</Link>)}
          </nav>
          <div className="flex items-center gap-3 text-giwa">
            <span>{admin.name} ({admin.role === "owner" ? "소유자" : "직원 · 조회 전용"})</span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
