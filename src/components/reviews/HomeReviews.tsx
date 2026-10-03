import Link from "next/link";
import { pool } from "@/server/db";
import { listPublicReviews, reviewSummary } from "@/server/reviews/service";
import ReviewList from "./ReviewList";
import Stars from "./Stars";

/** 홈 화면의 '머문 분들의 이야기'. DB 오류가 나도 홈 화면 전체가 깨지지 않도록 조용히 대체 문구를 보여준다. */
export default async function HomeReviews() {
  let data: Awaited<ReturnType<typeof load>> | null = null;
  try { data = await load(); } catch { data = null; }
  return (
    <section className="mx-auto mt-20 max-w-5xl px-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 className="font-serif text-3xl font-bold text-wood">머문 분들의 이야기</h2>
        {data && data.summary.count > 0 && <Link href="/reviews" className="text-sm text-wood underline">후기 {data.summary.count}개 모두 보기 →</Link>}
      </div>
      {data && data.summary.count > 0 ? (
        <>
          <p className="mt-2 flex items-center gap-2"><Stars value={data.summary.average} className="text-xl" /><b>{data.summary.average.toFixed(1)}</b><span className="text-sm text-giwa">/ 5</span></p>
          <div className="mt-5"><ReviewList reviews={data.latest} compact /></div>
        </>
      ) : <p className="mt-3 text-giwa">이용을 마친 분들이 남긴 후기가 이곳에 표시됩니다.</p>}
    </section>
  );
}

async function load() {
  const [summary, latest] = await Promise.all([reviewSummary(pool), listPublicReviews(pool, { pageSize: 3 })]);
  return { summary, latest };
}
