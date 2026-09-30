import type { Metadata } from "next";
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
    <div className="mx-auto max-w-3xl px-5 py-16">
      <h1 className="font-serif text-4xl font-bold text-wood">이용안내</h1>

      <section className="mt-10">
        <h2 className="font-serif text-2xl font-bold">체크인 · 체크아웃</h2>
        <p className="mt-2 text-giwa">체크인 {SITE.checkIn} / 체크아웃 {SITE.checkOut}</p>
      </section>

      <section className="mt-10">
        <h2 className="font-serif text-2xl font-bold">이용 규칙</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-giwa">
          <li>(금연 · 소음 · 반려동물 · 화기 사용 규칙을 입력해 주세요.)</li>
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="font-serif text-2xl font-bold">취소 · 환불 규정</h2>
        <div className="mt-3">
          {view ? <RefundTable view={view} /> : <p className="text-giwa">규정을 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.</p>}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-serif text-2xl font-bold">자주 묻는 질문</h2>
        <div className="mt-3 divide-y divide-line border-y border-line">
          {FAQ.map(([q, a]) => (
            <details key={q} className="py-3">
              <summary className="cursor-pointer font-medium">{q}</summary>
              <p className="mt-2 text-giwa">{a}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
