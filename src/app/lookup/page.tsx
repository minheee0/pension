import type { Metadata } from "next";
import LookupClient from "@/components/lookup/LookupClient";
import { PageShell } from "@/components/PageLayout";

export const metadata: Metadata = { title: "예약 조회·취소", robots: { index: false } };

export default function LookupPage() {
  return (
    <PageShell title="예약 조회 · 취소" lead="예약 완료 시 안내된 예약번호와 예약자 휴대폰 번호로 확인할 수 있습니다.">
      <LookupClient />
    </PageShell>
  );
}
