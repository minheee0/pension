import type { Metadata } from "next";
import { Bullets, PageShell, Section } from "@/components/PageLayout";
import RefundTable from "@/components/RefundTable";
import { pool } from "@/server/db";
import { getPolicyView } from "@/server/booking/policy";
import { SITE } from "@/lib/site";

export const metadata: Metadata = { title: "이용안내" };
export const dynamic = "force-dynamic"; // 환불표·성수기는 DB 값을 그대로 보여준다

const FAQ = [
  ["영유아도 인원에 포함되나요?", "36개월 미만은 인원에서 제외됩니다."],
  ["최대 인원을 넘겨도 되나요?", `안전과 시설 보호를 위해 최대 ${SITE.maxGuests}명까지만 가능합니다.`],
  ["바비큐와 찜질방은 언제까지 신청하나요?", "이용 전날 18:00까지 예약 시 함께 신청해 주세요. 예열 등 준비가 필요합니다."],
  ["다른 손님과 함께 쓰나요?", "아니요. 독채라 예약하신 한 팀만 이용합니다."],
];

export default async function Guide() {
  const view = await getPolicyView(pool).catch(() => null);
  return (
    <PageShell title="이용안내" lead="머무시기 전에 꼭 확인해 주세요.">
      <Section title="체크인 · 체크아웃">
        <p>체크인 {SITE.checkIn} / 체크아웃 {SITE.checkOut}</p>
      </Section>

      <Section title="이용 규칙">
        <Bullets items={[
          "실내는 전 구역 금연입니다. 흡연은 마당의 지정된 장소에서만 가능합니다.",
          "밤 10시 이후에는 이웃을 위해 소음을 줄여 주세요.",
          "반려동물은 동반할 수 없습니다.",
          "실내에서는 버너 등 화기를 사용할 수 없습니다. 바비큐는 마당의 지정된 장소에서 이용해 주세요.",
          `예약 인원 외 방문객은 출입할 수 없습니다. (최대 ${SITE.maxGuests}명)`,
          "퇴실 시 쓰레기는 분리해서 정해진 곳에 버려 주세요.",
          "시설·비품이 파손되거나 분실된 경우 배상을 요청드릴 수 있습니다.",
        ]} />
      </Section>

      <Section title="취소 · 환불 규정">
        {view ? <div className="text-ink"><RefundTable view={view} /></div> : <p>규정을 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.</p>}
      </Section>

      <Section title="자주 묻는 질문">
        <div className="divide-y divide-line border-y border-line">
          {FAQ.map(([q, a]) => (
            <details key={q} className="py-3">
              <summary className="cursor-pointer font-medium text-ink">{q}</summary>
              <p className="mt-2">{a}</p>
            </details>
          ))}
        </div>
      </Section>
    </PageShell>
  );
}
