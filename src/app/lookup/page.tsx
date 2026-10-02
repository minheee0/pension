import type { Metadata } from "next";
import LookupClient from "@/components/lookup/LookupClient";

export const metadata: Metadata = { title: "예약 조회·취소", robots: { index: false } };

export default function LookupPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-16">
      <h1 className="font-serif text-4xl font-bold text-wood">예약 조회 · 취소</h1>
      <p className="mt-2 text-giwa">예약 완료 시 안내된 예약번호와 예약자 휴대폰 번호로 확인할 수 있습니다.</p>
      <LookupClient />
    </div>
  );
}
