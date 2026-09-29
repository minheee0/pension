import type { Metadata } from "next";
import Photo from "@/components/Photo";
import { SITE } from "@/lib/site";

export const metadata: Metadata = { title: "소개" };

export default function About() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-16">
      <h1 className="font-serif text-4xl font-bold text-wood">{SITE.name} 이야기</h1>
      <p className="mt-2 text-giwa">‘만복’은 온갖 복을 뜻합니다. 머무는 동안 복이 가득하길 바라는 마음을 담았습니다.</p>
      <Photo label="한옥 전경" className="mt-8 aspect-video" />

      <section className="mt-12 space-y-3">
        <h2 className="font-serif text-2xl font-bold">우리 집 이야기</h2>
        <p>(한옥의 역사, 지은 이유, 주인장 이야기를 여기에 적어 주세요.)</p>
      </section>

      <section className="mt-12 space-y-3">
        <h2 className="font-serif text-2xl font-bold">한옥의 특징</h2>
        <ul className="list-disc space-y-1 pl-5 text-giwa">
          <li>온돌: 바닥부터 데워지는 전통 난방</li>
          <li>마루와 툇마루: 안과 밖을 잇는 쉼터</li>
          <li>마당: 한 팀만 쓰는 열린 공간</li>
        </ul>
      </section>

      <section className="mt-12 space-y-3">
        <h2 className="font-serif text-2xl font-bold">주변 즐길 거리</h2>
        <p>(근처 관광지, 맛집, 산책로를 적어 주세요.)</p>
      </section>

      <section className="mt-12 space-y-1">
        <h2 className="font-serif text-2xl font-bold">오시는 길</h2>
        <p>{SITE.address}</p>
        <p className="text-giwa">{SITE.phone}</p>
        <Photo label="지도" className="mt-3 aspect-video" />
      </section>
    </div>
  );
}
