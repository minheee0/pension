import type { Metadata } from "next";
import Link from "next/link";
import Photo from "@/components/Photo";
import { Bullets, PageShell, Section } from "@/components/PageLayout";
import Video from "@/components/Video";
import { SHOW_PLACEHOLDERS, SITE } from "@/lib/site";
import { button } from "@/lib/ui";

export const metadata: Metadata = { title: "독채 안내" };

const TOUR_VIDEO: string | undefined = undefined;   // 예: "/videos/tour.mp4"

export default function Stay() {
  return (
    <PageShell title="독채 안내" lead={`기준 ${SITE.baseGuests}명 · 최대 ${SITE.maxGuests}명 · 한 팀 전용`}>
      <div className="mt-8 grid gap-3 md:grid-cols-3">
        <Photo label="거실" src="/images/stay/living.webp" priority sizes="(max-width: 768px) 100vw, 512px" className="aspect-[4/3] md:col-span-2 md:row-span-2 md:aspect-auto" />
        <Photo label="창호" src="/images/stay/changho.webp" sizes="(max-width: 768px) 100vw, 256px" className="aspect-[4/3]" />
        <Photo label="창밖 풍경" src="/images/stay/view.webp" sizes="(max-width: 768px) 100vw, 256px" className="aspect-[4/3]" />
      </div>
      {/* 아직 사진이 없는 곳: 사진을 public/images/stay 에 넣고 src="/images/stay/파일명" 을 붙이면 자리표시가 사진으로 바뀐다 */}
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Photo label="마당" className="aspect-[4/3]" />
        <Photo label="찜질방" className="aspect-[4/3]" />
        <Photo label="자쿠지" className="aspect-[4/3]" />
        <Photo label="족욕 공간" className="aspect-[4/3]" />
      </div>

      {/* 영상 자리: 영상 파일을 public/videos 에 넣고 TOUR_VIDEO 에 경로를 적으면 재생 화면으로 바뀐다.
          영상이 없으면 배포 사이트에서는 이 섹션 전체를 숨긴다 */}
      {(TOUR_VIDEO || SHOW_PLACEHOLDERS) && (
        <Section title="영상으로 둘러보기">
          <Video label="독채 둘러보기" src={TOUR_VIDEO} poster="/images/stay/living.webp" className="aspect-video" />
        </Section>
      )}

      <div className="grid gap-x-8 md:grid-cols-2">
        <Section title="공간 구성">
          <Bullets items={[
            `방 2개 · 침구 최대 ${SITE.maxGuests}인분`,
            "대청마루 거실",
            "주방 · 욕실 1개",
            "전용 마당 · 찜질방",
            "자쿠지 · 족욕 공간 (무료 이용)",
          ]} />
        </Section>
        <Section title="편의시설">
          <Bullets items={[
            "냉난방 (에어컨 · 보일러)",
            "무료 Wi-Fi",
            "주방: 냉장고 · 전자레인지 · 기본 조리도구 · 식기",
            "욕실: 수건 · 샴푸 · 바디워시 · 드라이기",
            "전용 주차 공간",
          ]} />
        </Section>
      </div>

      <Section title="요금">
        <p>
          평일·주말·성수기에 따라 요금이 달라져 예약 달력에서 날짜별로 확인하실 수 있습니다.
          기준 {SITE.baseGuests}명 초과 시 1인당 {SITE.extraPersonFee.toLocaleString()}원이 추가됩니다. (36개월 미만 제외)
        </p>
      </Section>

      <Section title="유료 옵션">
        <Bullets items={[
          "바비큐: 마당에서 즐기는 숯불 바비큐 (가격은 예약 시 표시)",
          "찜질방: 예열 후 이용 (가격은 예약 시 표시)",
        ]} />
      </Section>

      <Link href="/reserve" className={`mt-12 ${button("primary", "md")}`}>예약 가능일 보기</Link>
    </PageShell>
  );
}
