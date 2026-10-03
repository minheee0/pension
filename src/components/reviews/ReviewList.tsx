import Link from "next/link";
import type { PublicReview } from "@/server/reviews/service";
import { DETAIL_LABEL } from "@/server/reviews/service";
import ReportButton from "./ReportButton";
import Stars from "./Stars";

const ymd = (d: Date | string) => new Date(d).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\.\s?/g, ".").replace(/\.$/, "");

/** 공개 후기 목록. 삭제 버튼은 두지 않는다 — 숨김·삭제는 관리자 화면에서만 한다(관리자로 로그인했다면 이동 링크만 표시). */
export default function ReviewList({ reviews, isAdmin = false, compact = false }: { reviews: PublicReview[]; isAdmin?: boolean; compact?: boolean }) {
  return (
    <ul className="space-y-4">
      {reviews.map((r) => (
        <li key={r.id} className="rounded-lg border border-line bg-white/70 p-5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Stars value={r.rating} />
            <b>{r.author}</b>
            <span className="text-xs text-giwa">{r.stay} 이용 · {ymd(r.createdAt)}</span>
          </div>
          {!compact && Object.keys(r.details).length > 0 && (
            <p className="mt-1 text-xs text-giwa">{Object.entries(r.details).map(([k, v]) => `${(DETAIL_LABEL as Record<string, string>)[k] ?? k} ${v}`).join(" · ")}</p>
          )}
          <p className={`mt-3 whitespace-pre-wrap ${compact ? "line-clamp-4" : ""}`}>{r.content}</p>
          {r.reply && (
            <div className="mt-3 rounded bg-hanji p-3 text-sm">
              <b className="text-wood">사장님 답글</b>{r.replyAt && <span className="ml-2 text-xs text-giwa">{ymd(r.replyAt)}</span>}
              <p className="mt-1 whitespace-pre-wrap">{r.reply}</p>
            </div>
          )}
          {!compact && (
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <ReportButton reviewId={r.id} />
              {isAdmin && <Link href={`/admin/reviews#review-${r.id}`} className="text-xs text-wood underline">관리자에서 보기</Link>}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
