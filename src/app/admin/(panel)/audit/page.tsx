import type { Metadata } from "next";
import { pool } from "@/server/db";
import { listAudit } from "@/server/admin/audit";
import { requireAdminPage } from "@/server/admin/session";
import { td, th } from "@/components/admin/ui";

export const metadata: Metadata = { title: "작업 기록" };

export default async function AuditPage() {
  await requireAdminPage();
  const rows = await listAudit(pool, 200);
  const j = (v: unknown) => (v == null ? "" : JSON.stringify(v).slice(0, 160));
  return (
    <div className="space-y-4">
      <h1 className="font-serif text-2xl font-bold text-wood">작업 기록</h1>
      <p className="text-giwa">로그인, 예약 열람·취소, 요금·규정 변경 등 관리자가 한 일이 기록됩니다. 최근 200건. 비밀번호·계좌번호는 기록하지 않습니다.</p>
      <div className="overflow-x-auto"><table className="w-full min-w-[56rem]">
        <thead><tr><th className={th}>시각</th><th className={th}>관리자</th><th className={th}>작업</th><th className={th}>대상</th><th className={th}>이전 → 이후</th><th className={th}>IP</th></tr></thead>
        <tbody>{rows.map((r: any) => (
          <tr key={r.id}>
            <td className={td}>{new Date(r.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "medium" })}</td>
            <td className={td}>{r.admin_name ?? "-"}</td><td className={td}>{r.action}</td><td className={td}>{r.target_id ?? ""}</td>
            <td className={`${td} max-w-md break-all text-xs text-giwa`}>{j(r.before_data)}{r.before_data && r.after_data ? " → " : ""}{j(r.after_data)}</td>
            <td className={td}>{r.ip ?? ""}</td>
          </tr>))}</tbody>
      </table></div>
    </div>
  );
}
