import type { Metadata } from "next";
import Photo from "@/components/Photo";
import { PageShell, Section } from "@/components/PageLayout";
import { isPlaceholder } from "@/lib/legal";
import { SITE } from "@/lib/site";

export const metadata: Metadata = { title: "소개" };

// 주소·전화번호가 아직 "(입력 필요)"면 오시는 길을 숨긴다 (site.ts 에 입력하면 자동으로 나타남)
const hasAddress = !isPlaceholder(SITE.address);
const hasPhone = !isPlaceholder(SITE.phone);

export default function About() {
  return (
    <PageShell title={`${SITE.name} 이야기`} lead={SITE.tagline}>
      {/* 대표 사진 자리 (나중에 교체 예정). 다시 넣을 때:
          <Photo label="사진 설명" src="/images/stay/파일명.webp" className="mt-8 aspect-video" sizes="(max-width: 768px) 100vw, 768px" priority /> */}

      <Section title="이름에 담은 마음">
        <p>
          ‘만복(萬福)’은 온갖 복을 뜻합니다. 이곳에 머무는 하루가 누군가에게는 오랜만의 가족 모임이고,
          누군가에게는 바쁜 일상 속 쉼표일 거라 생각했습니다. 그 하루에 복이 가득하길 바라는 마음으로 이름을 지었습니다.
        </p>
      </Section>

      <Section title="이런 분들께 추천해요">
        <ul className="grid gap-3 sm:grid-cols-2">
          {[
            ["가족 모임", "부모님, 아이들과 함께 오랜만에 한자리에"],
            ["친구 여행", "눈치 볼 사람 없이 밤늦게까지 이야기 나누고 싶을 때"],
            ["조용한 휴식", "북적이는 숙소 대신 우리끼리만 머물고 싶을 때"],
            ["특별한 날", "생일, 기념일을 한옥에서 오붓하게"],
          ].map(([t, d]) => (
            <li key={t} className="rounded-lg border border-line bg-white/60 p-4">
              <p className="font-serif font-bold text-ink">{t}</p>
              <p className="mt-1 text-sm">{d}</p>
            </li>
          ))}
        </ul>
      </Section>

      {hasAddress && (
        <Section title="오시는 길">
          <p className="text-ink">{SITE.address}</p>
          {hasPhone && <p>{SITE.phone}</p>}
          <Photo label="지도" className="aspect-video" />
        </Section>
      )}
    </PageShell>
  );
}
