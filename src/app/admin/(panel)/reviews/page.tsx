import type { Metadata } from "next";
import Link from "next/link";
import { pool } from "@/server/db";
import { listAdminReviews, type ReviewFilter } from "@/server/admin/reviews";
import { requireAdminPage } from "@/server/admin/session";
import { DETAIL_LABEL, REPORT_LABEL } from "@/server/reviews/service";
import JsonForm from "@/components/admin/JsonForm";
import { Banner, inputCls } from "@/components/admin/ui";

export const metadata: Metadata = { title: "후기" };
const EP = "/api/admin/reviews";
const FILTERS: [ReviewFilter, string][] = [["all", "전체"], ["reported", "신고됨"], ["needs_reply", "답글 필요"], ["hidden", "비공개"]];
const STATUS: Record<string, [string, string]> = { visible: ["공개", "bg-green-100 text-green-900"], reported: ["신고됨", "bg-amber-100 text-amber-900"], hidden: ["비공개", "bg-line text-giwa"] };

export default async function ReviewsAdmin({ searchParams }: { searchParams: Promise<{ f?: string; page?: string }> }) {
  const admin = await requireAdminPage();
  const sp = await searchParams;
  const filter = (FILTERS.map(([k]) => k) as string[]).includes(sp.f ?? "") ? (sp.f as ReviewFilter) : "all";
  const page = Math.max(0, Number(sp.page ?? 0) || 0);
  const res = await listAdminReviews(pool, { filter, page });
  const owner = admin.role === "owner";
  const pages = Math.ceil(res.total / res.pageSize);

  return (
    <div className="space-y-4">
      <h1 className="font-serif text-2xl font-bold text-wood">후기 관리</h1>
      <Banner>신고가 들어와도 후기는 <b>자동으로 숨겨지지 않습니다.</b> 내용을 확인해 문제가 있으면 <b>비공개</b>로 돌리고, 문제가 없으면 <b>신고 기각</b>을 누르세요. 비공개는 되돌릴 수 있고, 영구 삭제는 되돌릴 수 없습니다. 모든 처리는 작업 기록에 남습니다.</Banner>
      <div className="flex flex-wrap gap-3">
        {FILTERS.map(([k, label]) => <Link key={k} href={`/admin/reviews?f=${k}`} className={filter === k ? "font-bold underline" : "underline"}>{label}</Link>)}
        <span className="text-giwa">총 {res.total}건</span>
      </div>

      {res.rows.length === 0 && <p className="text-giwa">해당하는 후기가 없습니다.</p>}
      {res.rows.map((r: any) => {
        const [stLabel, stCls] = STATUS[r.status] ?? [r.status, "bg-line"];
        return (
          <article key={r.id} id={`review-${r.id}`} className={`scroll-mt-4 space-y-3 rounded border bg-white p-4 ${r.status === "reported" ? "border-amber-400" : "border-line"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded px-2 py-0.5 text-xs ${stCls}`}>{stLabel}</span>
              <b>{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</b>
              <span>{r.author_name}</span>
              <span className="text-giwa">({r.guest_name}) · 이용 {r.check_in} ·</span>
              <Link className="underline" href={`/admin/bookings/${r.booking_no}`}>{r.booking_no}</Link>
              <span className="text-giwa">{new Date(r.created_at).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}</span>
            </div>
            {Object.keys(r.rating_details ?? {}).length > 0 && <p className="text-xs text-giwa">{Object.entries(r.rating_details).map(([k, v]) => `${(DETAIL_LABEL as any)[k] ?? k} ${v}`).join(" · ")}</p>}
            <p className="whitespace-pre-wrap">{r.content}</p>

            {r.reports.length > 0 && (
              <div className="rounded border border-amber-300 bg-amber-50 p-2 text-xs">
                <b>신고 {r.reports.length}건</b>
                <ul className="mt-1 list-disc pl-4">{r.reports.map((x: any, i: number) => <li key={i}>{(REPORT_LABEL as any)[x.reason] ?? x.reason}{x.detail ? `: ${x.detail}` : ""}</li>)}</ul>
              </div>
            )}

            {r.status !== "hidden" && (owner ? (
              <JsonForm endpoint={EP} op="reply" extra={{ id: r.id }} submitLabel={r.reply ? "답글 수정" : "답글 등록"}>
                <label className="block text-xs">사장님 답글 (손님에게 공개됩니다)
                  <textarea name="content" defaultValue={r.reply ?? ""} rows={2} maxLength={1000} className={inputCls} /></label>
              </JsonForm>
            ) : r.reply && <p className="rounded bg-hanji p-2 text-xs">답글: {r.reply}</p>)}

            {owner && (
              <div className="flex flex-wrap items-start gap-4 border-t border-line pt-3">
                {r.status === "hidden" ? (
                  <JsonForm endpoint={EP} op="restore" extra={{ id: r.id }} submitLabel="다시 공개" inline />
                ) : (
                  <JsonForm endpoint={EP} op="hide" extra={{ id: r.id }} submitLabel="비공개로 전환" inline confirmMessage="이 후기를 손님 화면에서 숨깁니다. 계속할까요?">
                    <label className="text-xs">사유(필수)<input name="reason" required minLength={2} maxLength={200} placeholder="예: 욕설 포함" className={`${inputCls} w-56`} /></label>
                  </JsonForm>
                )}
                {r.status === "reported" && <JsonForm endpoint={EP} op="dismiss" extra={{ id: r.id }} submitLabel="신고 기각(정상 처리)" inline />}
                {r.reply && r.status !== "hidden" && <JsonForm endpoint={EP} op="reply_delete" extra={{ id: r.id }} submitLabel="답글 삭제" inline confirmMessage="답글을 삭제할까요?" />}
                <JsonForm endpoint={EP} op="delete" extra={{ id: r.id }} submitLabel="영구 삭제" danger inline confirmMessage="이 후기를 영구 삭제합니다. 되돌릴 수 없습니다. 정말 삭제할까요?">
                  <label className="text-xs">사유(필수)<input name="reason" required minLength={2} maxLength={200} placeholder="예: 손님 요청, 개인정보 노출" className={`${inputCls} w-56`} /></label>
                </JsonForm>
              </div>
            )}
          </article>
        );
      })}
      {pages > 1 && (
        <div className="flex gap-3">
          {page > 0 && <Link className="underline" href={`/admin/reviews?f=${filter}&page=${page - 1}`}>← 이전</Link>}
          <span>{page + 1} / {pages}</span>
          {page + 1 < pages && <Link className="underline" href={`/admin/reviews?f=${filter}&page=${page + 1}`}>다음 →</Link>}
        </div>
      )}
    </div>
  );
}
