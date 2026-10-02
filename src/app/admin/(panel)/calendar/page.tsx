import type { Metadata } from "next";
import Link from "next/link";
import { pool } from "@/server/db";
import { getAdminMonth } from "@/server/admin/calendar";
import { requireAdminPage } from "@/server/admin/session";
import JsonForm from "@/components/admin/JsonForm";
import { inputCls, won } from "@/components/admin/ui";

export const metadata: Metadata = { title: "달력·차단" };

const shift = (m: string, n: number) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7); };
const TONE: Record<string, string> = {
  available: "bg-white", booked: "bg-green-100", held: "bg-amber-100", blocked: "bg-line text-giwa",
};
const LABEL: Record<string, string> = { available: "빈 날", booked: "예약", held: "결제·입금 대기", blocked: "차단" };

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const admin = await requireAdminPage();
  const sp = await searchParams;
  const nowMonth = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7);
  const month = /^20\d{2}-(0[1-9]|1[0-2])$/.test(sp.m ?? "") ? sp.m! : nowMonth;
  const days = await getAdminMonth(pool, month);
  const lead = new Date(`${month}-01T00:00:00Z`).getUTCDay();
  const owner = admin.role === "owner";

  return (
    <div className="space-y-6">
      <h1 className="font-serif text-2xl font-bold text-wood">달력 · 날짜 차단</h1>
      <div className="flex items-center gap-4">
        <Link className="underline" href={`/admin/calendar?m=${shift(month, -1)}`}>← 이전 달</Link>
        <b className="text-lg">{month}</b>
        <Link className="underline" href={`/admin/calendar?m=${shift(month, 1)}`}>다음 달 →</Link>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs text-giwa">{["일", "월", "화", "수", "목", "금", "토"].map((w) => <div key={w}>{w}</div>)}</div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: lead }, (_, i) => <div key={i} />)}
        {days.map((d) => (
          <div key={d.date} className={`min-h-20 rounded border border-line p-1.5 ${TONE[d.status]}`}>
            <div className="flex justify-between"><b>{Number(d.date.slice(8))}</b><span className="text-[10px] text-giwa">{LABEL[d.status]}</span></div>
            {d.bookingNo && <Link href={`/admin/bookings/${d.bookingNo}`} className="block truncate underline">{d.guestName ?? d.bookingNo}</Link>}
            {d.memo && <div className="truncate text-[11px] text-giwa">{d.memo}</div>}
            {d.price != null && d.status === "available" && <div className="text-[11px] text-giwa">{won(d.price)}</div>}
          </div>
        ))}
      </div>
      <p className="text-xs text-giwa">숫자는 그 날 "밤"입니다. 예약 한 건은 체크인일부터 체크아웃 전날까지 칸이 채워집니다.</p>

      {owner ? (
        <div className="grid gap-6 md:grid-cols-2">
          <section className="rounded border border-line bg-white p-4"><h2 className="mb-2 font-bold">날짜 차단 (수리·개인 사용·전화 예약 대기)</h2>
            <JsonForm endpoint="/api/admin/calendar" op="block" submitLabel="차단하기" resetOnSuccess confirmMessage="이 기간을 예약할 수 없게 막습니다. 계속할까요?">
              <div className="grid grid-cols-2 gap-2"><label>시작일(포함)<input type="date" name="from" required className={inputCls} /></label><label>종료일(포함)<input type="date" name="to" required className={inputCls} /></label></div>
              <label className="block">메모<input name="memo" maxLength={100} placeholder="예: 보일러 수리" className={inputCls} /></label>
            </JsonForm>
            <p className="mt-2 text-xs text-giwa">이미 예약된 날이 하나라도 있으면 아무것도 막지 않고 알려 드립니다.</p>
          </section>
          <section className="rounded border border-line bg-white p-4"><h2 className="mb-2 font-bold">차단 해제</h2>
            <JsonForm endpoint="/api/admin/calendar" op="unblock" submitLabel="해제하기" resetOnSuccess>
              <div className="grid grid-cols-2 gap-2"><label>시작일(포함)<input type="date" name="from" required className={inputCls} /></label><label>종료일(포함)<input type="date" name="to" required className={inputCls} /></label></div>
            </JsonForm>
            <p className="mt-2 text-xs text-giwa">차단한 날만 풀립니다. 예약된 날에는 영향이 없습니다.</p>
          </section>
        </div>
      ) : <p className="text-giwa">날짜 차단은 소유자 계정만 할 수 있습니다.</p>}
    </div>
  );
}
