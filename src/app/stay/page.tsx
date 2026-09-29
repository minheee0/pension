import type { Metadata } from "next";
import Link from "next/link";
import Photo from "@/components/Photo";
import { SITE } from "@/lib/site";

export const metadata: Metadata = { title: "독채 안내" };

export default function Stay() {
  return (
    <div className="mx-auto max-w-4xl px-5 py-16">
      <h1 className="font-serif text-4xl font-bold text-wood">독채 안내</h1>
      <p className="mt-2 text-giwa">기준 {SITE.baseGuests}명 · 최대 {SITE.maxGuests}명 · 한 팀 전용</p>

      <div className="mt-8 grid gap-3 md:grid-cols-3">
        <Photo label="안채" className="aspect-[4/3] md:col-span-2 md:row-span-2 md:aspect-auto" />
        <Photo label="마당" className="aspect-[4/3]" />
        <Photo label="찜질방" className="aspect-[4/3]" />
      </div>

      <section className="mt-12 grid gap-8 md:grid-cols-2">
        <div>
          <h2 className="font-serif text-2xl font-bold">공간 구성</h2>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-giwa">
            <li>(방 개수 · 침구 구성 입력)</li>
            <li>(화장실 · 주방 · 마루 등 입력)</li>
          </ul>
        </div>
        <div>
          <h2 className="font-serif text-2xl font-bold">편의시설</h2>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-giwa">
            <li>(에어컨 · 난방 · Wi-Fi · 주차 등 입력)</li>
          </ul>
        </div>
      </section>

      <section className="mt-12">
        <h2 className="font-serif text-2xl font-bold">요금</h2>
        <p className="mt-3 text-giwa">
          평일·주말·성수기에 따라 요금이 달라져 예약 달력에서 날짜별로 확인하실 수 있습니다.
          기준 {SITE.baseGuests}명 초과 시 1인당 {SITE.extraPersonFee.toLocaleString()}원이 추가됩니다. (36개월 미만 제외)
        </p>
      </section>

      <section className="mt-12">
        <h2 className="font-serif text-2xl font-bold">유료 옵션</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-giwa">
          <li>바비큐: 마당에서 즐기는 숯불 바비큐 (가격은 예약 시 표시)</li>
          <li>찜질방: 예열 후 이용 (가격은 예약 시 표시)</li>
        </ul>
      </section>

      <Link href="/reserve" className="mt-12 inline-block rounded bg-wood px-8 py-3 text-hanji hover:bg-giwa">예약 가능일 보기</Link>
    </div>
  );
}
