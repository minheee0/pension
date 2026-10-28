"use client";

export interface CalDay {
  date: string;
  available: boolean;
  price: number;
  dayType: "weekday" | "weekend";
  isPeak: boolean;
  minNights: number;
}

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

export const addDays = (s: string, n: number) => {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const shiftMonth = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
export const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
export const fmtDate = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEK[d.getUTCDay()]})`;
};

interface Props {
  month: string;
  minMonth: string;
  days: Record<string, CalDay>;
  loading: boolean;
  checkIn: string | null;
  checkOut: string | null;
  clickable: (date: string) => boolean;
  onPick: (date: string) => void;
  onMonth: (month: string) => void;
}

export default function RangeCalendar(p: Props) {
  const [y, m] = p.month.split("-").map(Number);
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dates = Array.from({ length: count }, (_, i) => `${p.month}-${String(i + 1).padStart(2, "0")}`);

  return (
    <div className="w-full max-w-md rounded-lg border border-line bg-white/60 p-4">   {/* 넓은 화면에서 칸이 지나치게 커지지 않게 */}
      <div className="mb-3 flex items-center justify-between">
        <button type="button" aria-label="이전 달" disabled={p.month <= p.minMonth}
          onClick={() => p.onMonth(shiftMonth(p.month, -1))}
          className="rounded px-3 py-1 hover:bg-line disabled:opacity-30">‹</button>
        <div className="font-serif text-lg font-bold">{y}년 {m}월</div>
        <button type="button" aria-label="다음 달" onClick={() => p.onMonth(shiftMonth(p.month, 1))}
          className="rounded px-3 py-1 hover:bg-line">›</button>
      </div>

      <div className="grid grid-cols-7 text-center text-xs text-giwa">
        {WEEK.map((w) => <div key={w} className="py-1">{w}</div>)}
      </div>

      <div className={`grid grid-cols-7 gap-1 ${p.loading ? "opacity-50" : ""}`}>
        {Array.from({ length: lead }, (_, i) => <div key={`b${i}`} />)}
        {dates.map((d) => {
          const day = p.days[d];
          const isIn = d === p.checkIn, isOut = d === p.checkOut;
          const inRange = !!p.checkIn && !!p.checkOut && d > p.checkIn && d < p.checkOut;
          const ok = p.clickable(d);
          const cls = isIn || isOut ? "bg-wood text-hanji"
            : inRange ? "bg-wood/15"
            : ok ? "hover:bg-line" : "text-giwa/35";
          return (
            <button key={d} type="button" disabled={!ok} onClick={() => p.onPick(d)}
              aria-pressed={isIn || isOut}
              aria-label={`${fmtDate(d)}${day ? ` ${won(day.price)}` : ""}${day && !day.available ? " 예약 불가" : ""}`}
              className={`flex aspect-square flex-col items-center justify-center rounded text-sm leading-tight ${cls}`}>
              <span className={day && !day.available && !ok ? "line-through" : ""}>{Number(d.slice(8))}</span>
              {day && (
                <span className={`text-[10px] ${isIn || isOut ? "" : day.isPeak ? "text-red-800" : "text-giwa/70"}`}>
                  {day.available || ok ? day.price / 10000 : "–"}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-giwa">숫자는 1박 요금(만원)입니다. 붉은 숫자는 성수기 요금입니다.</p>
    </div>
  );
}
