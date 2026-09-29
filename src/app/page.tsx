import Link from "next/link";
import Photo from "@/components/Photo";
import { SITE } from "@/lib/site";

const inputCls = "mt-1 block w-full rounded border border-line bg-white px-3 py-2 text-base";

export default function Home() {
  return (
    <>
      <section className="bg-gradient-to-b from-wood to-giwa text-hanji">
        <div className="mx-auto max-w-5xl px-5 py-20 md:py-32">
          <p className="text-sm tracking-[0.3em] opacity-80">{SITE.region} · 독채 한옥 스테이</p>
          <h1 className="mt-4 font-serif text-5xl font-bold md:text-7xl">{SITE.name}</h1>
          <p className="mt-4 max-w-xl text-lg opacity-90">{SITE.tagline}</p>

          <form action="/reserve" className="mt-10 grid gap-3 rounded-xl bg-hanji p-4 text-ink md:grid-cols-[1fr_1fr_7rem_auto]">
            <label className="text-xs">체크인<input type="date" name="checkIn" required className={inputCls} /></label>
            <label className="text-xs">체크아웃<input type="date" name="checkOut" required className={inputCls} /></label>
            <label className="text-xs">인원
              <select name="guests" defaultValue={SITE.baseGuests} className={inputCls}>
                {Array.from({ length: SITE.maxGuests }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>{n}명</option>
                ))}
              </select>
            </label>
            <button className="rounded bg-wood px-6 py-3 text-hanji hover:bg-giwa md:self-end">예약 가능일 보기</button>
          </form>
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

      <section className="mx-auto mt-20 max-w-5xl px-5">
        <h2 className="font-serif text-3xl font-bold text-wood">머문 분들의 이야기</h2>
        <p className="mt-3 text-giwa">이용을 마친 분들이 남긴 후기가 이곳에 표시됩니다. (오픈 후 노출)</p>
      </section>

      <section className="mx-auto mt-20 max-w-5xl px-5">
        <h2 className="font-serif text-3xl font-bold text-wood">오시는 길</h2>
        <p className="mt-3">{SITE.address}</p>
        <p className="text-giwa">{SITE.phone}</p>
      </section>
    </>
  );
}
