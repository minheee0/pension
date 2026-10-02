import type { Metadata } from "next";
import Link from "next/link";
import PaySection from "@/components/reserve/PaySection";

export const metadata: Metadata = { title: "결제 실패", robots: { index: false } };

const FRIENDLY: Record<string, string> = {
  PAY_PROCESS_CANCELED: "결제를 취소하셨습니다.",
  PAY_PROCESS_ABORTED: "결제 진행 중 문제가 생겨 중단되었습니다.",
  REJECT_CARD_COMPANY: "카드사에서 결제를 거절했습니다. 다른 카드로 시도해 주세요.",
};

export default async function PayFail({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const code = str("code"), no = /^H[0-9A-Z]{10}$/.test(str("no")) ? str("no") : "";

  return (
    <div className="mx-auto max-w-3xl px-5 py-16">
      <h1 className="font-serif text-4xl font-bold text-wood">결제가 완료되지 않았습니다</h1>
      <div className="mt-8 max-w-lg rounded-lg border border-line bg-white p-6">
        <p>{FRIENDLY[code] ?? str("message") ?? "결제를 완료하지 못했습니다."}</p>
        {no ? (
          <>
            <p className="mt-2 text-sm text-giwa">날짜는 확보 시간(약 15분) 동안 유지됩니다. 시간이 남아 있으면 바로 다시 결제할 수 있습니다.</p>
            <PaySection bookingNo={no} />
          </>
        ) : null}
        <div className="mt-4"><Link href="/reserve" className="underline">예약 화면으로 돌아가기</Link></div>
      </div>
    </div>
  );
}
