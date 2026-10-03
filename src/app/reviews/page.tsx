import type { Metadata } from "next";
import Link from "next/link";
import { pool } from "@/server/db";
import { currentAdmin } from "@/server/admin/session";
import { listPublicReviews, reviewSummary } from "@/server/reviews/service";
import ReviewList from "@/components/reviews/ReviewList";
import ReviewSummaryCard from "@/components/reviews/ReviewSummary";

export const metadata: Metadata = { title: "후기", description: "만복에 머문 분들의 이야기" };
export const dynamic = "force-dynamic";
const PAGE = 10;

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const sp = await searchParams;
  const page = Math.max(0, Number(sp.page ?? 0) || 0);
  const [summary, reviews, admin] = await Promise.all([
    reviewSummary(pool), listPublicReviews(pool, { page, pageSize: PAGE }), currentAdmin().catch(() => null),
  ]);
  const pages = Math.ceil(summary.count / PAGE);

  return (
    <div className="mx-auto max-w-3xl px-5 py-16">
      <h1 className="font-serif text-4xl font-bold text-wood">후기</h1>
      <p className="mt-2 text-giwa">실제로 머무신 분들만 남길 수 있는 후기입니다. 예약 조회 화면에서 이용 후 작성할 수 있어요.</p>

      <div className="mt-8 space-y-6">
        <ReviewSummaryCard s={summary} />
        {reviews.length === 0 ? <p className="text-giwa">아직 등록된 후기가 없습니다.</p> : <ReviewList reviews={reviews} isAdmin={!!admin} />}
      </div>

      {pages > 1 && (
        <nav className="mt-8 flex items-center justify-center gap-4" aria-label="페이지">
          {page > 0 && <Link className="underline" href={`/reviews?page=${page - 1}`}>← 이전</Link>}
          <span className="text-sm text-giwa">{page + 1} / {pages}</span>
          {page + 1 < pages && <Link className="underline" href={`/reviews?page=${page + 1}`}>다음 →</Link>}
        </nav>
      )}
    </div>
  );
}
