import type { Metadata } from "next";
import Link from "next/link";
import { pool } from "@/server/db";
import { configStatus, listNotifications } from "@/server/admin/notifications";
import { requireAdminPage } from "@/server/admin/session";
import JsonForm from "@/components/admin/JsonForm";
import { Banner, td, th } from "@/components/admin/ui";

export const metadata: Metadata = { title: "알림" };

const KIND: Record<string, string> = {
  booking_confirmed: "예약 확정", deposit_waiting: "입금 안내", deposit_expired: "입금 기한 만료", booking_cancelled: "예약 취소", auto_refunded: "자동 환불",
  checkin_reminder: "체크인 전날 안내", review_request: "후기 요청", owner_new_booking: "새 예약(사장님)", owner_cancelled: "예약 취소(사장님)",
  owner_refund_failed: "⚠ 환불 실패(사장님)", owner_test: "테스트",
};
const ST: Record<string, [string, string]> = { pending: ["대기", "bg-amber-100 text-amber-900"], sent: ["발송됨", "bg-green-100 text-green-900"], failed: ["실패", "bg-red-100 text-red-900"], skipped: ["건너뜀", "bg-line text-giwa"] };
const when = (v: Date | string | null) => (v ? new Date(v).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" }) : "-");

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  const admin = await requireAdminPage();
  const sp = await searchParams;
  const page = Math.max(0, Number(sp.page ?? 0) || 0);
  const d = await listNotifications(pool, { status: sp.status, page });
  const cfg = configStatus();
  const owner = admin.role === "owner";
  const pages = Math.ceil(d.total / d.pageSize);
  const failed = d.counts.failed ?? 0;

  return (
    <div className="space-y-5">
      <h1 className="font-serif text-2xl font-bold text-wood">알림 (문자·이메일)</h1>
      {failed > 0 ? <Banner tone="warn">발송에 실패한 알림이 {failed}건 있습니다. 아래 사유를 확인하고 설정을 고친 뒤 <b>다시 시도</b>를 누르세요.</Banner>
        : <Banner>실패한 알림이 없습니다.</Banner>}

      <section className="rounded border border-line bg-white p-4"><h2 className="mb-2 font-bold">발송 설정 상태</h2>
        <ul className="grid gap-1 md:grid-cols-2">{cfg.map((c) => <li key={c.key}><span className={c.ok ? "text-green-800" : "text-red-800"}>{c.ok ? "✓" : "✗"}</span> <b>{c.label}</b> <span className="text-giwa">— {c.detail}</span></li>)}</ul>
        {owner && (
          <div className="mt-3 flex flex-wrap gap-4 border-t border-line pt-3">
            <JsonForm endpoint="/api/admin/notifications" op="test" extra={{ channel: "sms" }} submitLabel="문자 테스트 발송" inline />
            <JsonForm endpoint="/api/admin/notifications" op="test" extra={{ channel: "email" }} submitLabel="이메일 테스트 발송" inline />
          </div>
        )}
        <p className="mt-2 text-xs text-giwa">테스트는 사장님 연락처(OWNER_PHONE·OWNER_EMAIL)로 보내며, 결과가 아래 목록에 남습니다. 문자 발송은 대행사에 등록·인증된 발신번호만 사용할 수 있습니다.</p>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        {[["", "전체"], ["failed", "실패"], ["pending", "대기"], ["sent", "발송됨"]].map(([k, l]) => (
          <Link key={k} href={k ? `/admin/notifications?status=${k}` : "/admin/notifications"} className={(sp.status ?? "") === k ? "font-bold underline" : "underline"}>{l}{k ? ` ${d.counts[k] ?? 0}` : ""}</Link>
        ))}
        <span className="text-giwa">총 {d.total}건</span>
      </div>

      <div className="overflow-x-auto"><table className="w-full min-w-[56rem] bg-white">
        <thead><tr><th className={th}>종류</th><th className={th}>대상·수단</th><th className={th}>예약</th><th className={th}>상태</th><th className={th}>시각</th><th className={th}>실패 사유</th><th className={th}></th></tr></thead>
        <tbody>
          {d.rows.map((r) => (
            <tr key={r.id}>
              <td className={td}>{KIND[r.kind] ?? r.kind}</td>
              <td className={td}>{r.audience === "owner" ? "사장님" : "손님"} · {r.channel === "sms" ? "문자" : "이메일"}<div className="text-xs text-giwa">{r.to}</div></td>
              <td className={td}>{r.bookingNo ? <Link className="underline" href={`/admin/bookings/${r.bookingNo}`}>{r.bookingNo}</Link> : "-"}</td>
              <td className={td}><span className={`rounded px-2 py-0.5 text-xs ${ST[r.status]?.[1]}`}>{ST[r.status]?.[0] ?? r.status}</span>{r.attempts > 0 && <span className="ml-1 text-xs text-giwa">{r.attempts}회 시도</span>}</td>
              <td className={td}>{r.status === "sent" ? when(r.sentAt) : r.status === "pending" ? `예정 ${when(r.scheduledAt)}` : when(r.createdAt)}</td>
              <td className={`${td} max-w-xs break-all text-xs text-red-800`}>{r.lastError ?? ""}</td>
              <td className={td}>{owner && r.status === "failed" && <JsonForm endpoint="/api/admin/notifications" op="retry" extra={{ id: r.id }} submitLabel="다시 시도" inline />}</td>
            </tr>
          ))}
          {d.rows.length === 0 && <tr><td className={td} colSpan={7}>알림 내역이 없습니다.</td></tr>}
        </tbody>
      </table></div>
      {pages > 1 && (
        <div className="flex gap-3">
          {page > 0 && <Link className="underline" href={`/admin/notifications?${sp.status ? `status=${sp.status}&` : ""}page=${page - 1}`}>← 이전</Link>}
          <span>{page + 1} / {pages}</span>
          {page + 1 < pages && <Link className="underline" href={`/admin/notifications?${sp.status ? `status=${sp.status}&` : ""}page=${page + 1}`}>다음 →</Link>}
        </div>
      )}
    </div>
  );
}
