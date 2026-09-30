import type { Metadata } from "next";
import Link from "next/link";
import ConfirmClient from "@/components/reserve/ConfirmClient";

export const metadata: Metadata = { title: "결제 확인", robots: { index: false } };

export default async function PaySuccess({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const paymentKey = str("paymentKey"), orderId = str("orderId"), amount = Number(str("amount"));

  return (
    <div className="mx-auto max-w-3xl px-5 py-16">
      <h1 className="font-serif text-4xl font-bold text-wood">결제 확인</h1>
      {paymentKey && orderId && Number.isInteger(amount) && amount > 0
        ? <ConfirmClient paymentKey={paymentKey} orderId={orderId} amount={amount} />
        : <p className="mt-8">잘못된 접근입니다. <Link href="/reserve" className="underline">예약 화면으로</Link></p>}
    </div>
  );
}
