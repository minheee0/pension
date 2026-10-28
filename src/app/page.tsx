import Link from "next/link";
import Photo from "@/components/Photo";
import HomeReviews from "@/components/reviews/HomeReviews";
import HomeSearch from "@/components/reserve/HomeSearch";
import { SITE } from "@/lib/site";

export const dynamic = "force-dynamic";   // 후기를 DB에서 읽어 오므로 매 요청마다 만든다

export default function Home() {
  return (
    <>
      <section className="bg-gradient-to-b from-wood to-giwa text-hanji">
        <div className="mx-auto max-w-5xl px-5 py-20 md:py-32">
          <p className="text-sm tracking-[0.3em] opacity-80">{SITE.region} · 독채 한옥 스테이</p>
          <h1 className="mt-4 font-serif text-5xl font-bold md:text-7xl">{SITE.name}</h1>
          <p className="mt-4 max-w-xl text-lg opacity-90">{SITE.tagline}</p>

          <HomeSearch />
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-5 pt-20">
        <h2 className="font-serif text-3xl font-bold text-wood">온 집을 한 팀이 씁니다</h2>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {[
            ["독채 한 채", "다른 손님 없이 안채와 마당을 우리 가족, 우리 일행만 씁니다."],
            ["온돌과 툇마루", "따뜻한 구들방과 마루에 앉아 한옥의 시간을 천천히 느껴 보세요."],
            ["바비큐 · 찜질방", "저녁엔 마당에서 바비큐를, 밤엔 찜질방에서 몸을 풀 수 있습니다. (유료 옵션)"],
          ].map(([t, d]) => (
            <div key={t} className="rounded-lg border border-line bg-white/60 p-6">
              <h3 className="font-serif text-xl font-bold">{t}</h3>
              <p className="mt-2 text-sm text-giwa">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto mt-20 grid max-w-5xl gap-8 px-5 md:grid-cols-2">
        <Photo label="외관·마당" className="aspect-[4/3]" />
        <div className="self-center">
          <h2 className="font-serif text-3xl font-bold text-wood">독채 안내</h2>
          <p className="mt-3 text-giwa">기준 {SITE.baseGuests}명, 최대 {SITE.maxGuests}명까지 머물 수 있습니다. 요금은 예약 달력에서 날짜별로 확인하실 수 있어요.</p>
          <Link href="/stay" className="mt-5 inline-block border-b border-wood pb-0.5 text-wood">공간 자세히 보기 →</Link>
        </div>
      </section>

      <section className="mx-auto mt-20 max-w-5xl px-5">
        <dl className="grid gap-4 rounded-lg border border-line p-6 text-center md:grid-cols-4">
          {[["체크인", SITE.checkIn], ["체크아웃", SITE.checkOut], ["기준 / 최대", `${SITE.baseGuests}명 / ${SITE.maxGuests}명`], ["숙박 형태", "독채 (1팀)"]].map(([k, v]) => (
            <div key={k}><dt className="text-xs text-giwa">{k}</dt><dd className="font-serif text-xl font-bold">{v}</dd></div>
          ))}
        </dl>
      </section>

      <HomeReviews />

      <section className="mx-auto mt-20 max-w-5xl px-5">
        <h2 className="font-serif text-3xl font-bold text-wood">오시는 길</h2>
        <p className="mt-3">{SITE.address}</p>
        <p className="text-giwa">{SITE.phone}</p>
      </section>
    </>
  );
}
