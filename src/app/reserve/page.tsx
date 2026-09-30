import type { Metadata } from "next";
import ReserveFlow from "@/components/reserve/ReserveFlow";

export const metadata: Metadata = { title: "예약" };

export default async function ReservePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  return (
    <div className="mx-auto max-w-5xl px-5 py-12">
      <h1 className="font-serif text-4xl font-bold text-wood">예약</h1>
      <p className="mt-2 text-giwa">날짜를 고르면 요금이 바로 계산됩니다. 결제 전까지는 예약이 확정되지 않습니다.</p>
      <ReserveFlow
        initialCheckIn={one("checkIn")}
        initialCheckOut={one("checkOut")}
        initialGuests={Number(one("guests")) || undefined}
      />
    </div>
  );
}
