"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import RangeCalendar, { CalDay, addDays, fmtDate, shiftMonth } from "./RangeCalendar";
import { SITE } from "@/lib/site";

const fieldCls = "mt-1 block w-full rounded border border-line bg-white px-3 py-2 text-left text-base";

/**
 * 홈 화면 예약 상자. 브라우저 기본 날짜 선택기 대신 예약 화면과 같은 달력(예약 가능일·요금 표시)을 펼쳐서 고르게 한다.
 * 고른 날짜·인원은 /reserve 로 넘기고, 최종 확인(요금·점유)은 예약 화면에서 한다.
 */
export default function HomeSearch() {
  const router = useRouter();
  const [nowMonth] = useState(() => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7));   // 한국 날짜 기준 이번 달
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(nowMonth);
  const [days, setDays] = useState<Record<string, CalDay>>({});
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(false);
  const [checkIn, setCheckIn] = useState<string | null>(null);
  const [checkOut, setCheckOut] = useState<string | null>(null);
  const [guests, setGuests] = useState(SITE.baseGuests);

  // 보이는 달 + 다음 달 (월말 체크인 → 다음 달 체크아웃)
  const load = useCallback(async (m: string) => {
    setLoading(true);
    setErr(false);
    const one = async (mm: string) => {
      const r = await fetch(`/api/calendar?month=${mm}`, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as { days: CalDay[] };
      setDays((prev) => {
        const next = { ...prev };
        for (const d of j.days) next[d.date] = d;
        return next;
      });
    };
    try { await Promise.all([one(m), one(shiftMonth(m, 1))]); }
    catch { setErr(true); }
    finally { setLoading(false); }
  }, []);

  // 달력을 처음 펼칠 때와 달을 넘길 때 불러온다
  const openCalendar = () => { if (!open) { setOpen(true); load(month); } };
  const changeMonth = (m: string) => { setMonth(m); load(m); };

  // 날짜 선택 규칙은 예약 화면(ReserveFlow)과 같다
  const nightsFree = (from: string, to: string) => {
    for (let d = from; d < to; d = addDays(d, 1)) if (!days[d]?.available) return false;
    return true;
  };
  const clickable = (d: string) => {
    if (checkIn && !checkOut && d > checkIn && d <= addDays(checkIn, 30) && nightsFree(checkIn, d)) return true;
    return !!days[d]?.available;
  };
  const pick = (d: string) => {
    if (checkIn && !checkOut && d > checkIn && nightsFree(checkIn, d)) { setCheckOut(d); setOpen(false); return; }
    if (days[d]?.available) { setCheckIn(d); setCheckOut(null); }
  };

  const go = () => {
    const qs = new URLSearchParams({ guests: String(guests) });
    if (checkIn && checkOut) { qs.set("checkIn", checkIn); qs.set("checkOut", checkOut); }
    router.push(`/reserve?${qs}`);
  };

  return (
    <div className="mt-10 rounded-xl bg-hanji p-4 text-ink">
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_7rem_auto]">
        <div className="text-xs">체크인
          <button type="button" onClick={openCalendar} aria-expanded={open} className={fieldCls}>
            {checkIn ? fmtDate(checkIn) : <span className="text-giwa">날짜 선택</span>}
          </button>
        </div>
        <div className="text-xs">체크아웃
          <button type="button" onClick={openCalendar} aria-expanded={open} className={fieldCls}>
            {checkOut ? fmtDate(checkOut) : <span className="text-giwa">{checkIn ? "체크아웃 선택" : "날짜 선택"}</span>}
          </button>
        </div>
        <label className="text-xs">인원
          <select value={guests} onChange={(e) => setGuests(Number(e.target.value))} className={fieldCls}>
            {Array.from({ length: SITE.maxGuests }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{n}명</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={go} className="rounded bg-wood px-6 py-3 text-hanji hover:bg-giwa md:self-end">
          {checkIn && checkOut ? "예약하기" : "예약 가능일 보기"}
        </button>
      </div>

      {open && (
        <div className="mx-auto mt-4 max-w-md">
          <p className="mb-2 text-sm text-giwa">
            {checkIn ? (checkOut ? "" : `체크인 ${fmtDate(checkIn)} · 체크아웃 날짜를 고르세요`) : "체크인 날짜를 고르세요"}
          </p>
          {err && (
            <p role="alert" className="mb-2 text-sm text-red-800">
              달력을 불러오지 못했습니다.
              <button type="button" onClick={() => load(month)} className="ml-2 underline">다시 시도</button>
            </p>
          )}
          <RangeCalendar month={month} minMonth={nowMonth} days={days} loading={loading}
            checkIn={checkIn} checkOut={checkOut} clickable={clickable} onPick={pick} onMonth={changeMonth} />
          <div className="mt-2 flex justify-end gap-4 text-sm">
            {checkIn && <button type="button" onClick={() => { setCheckIn(null); setCheckOut(null); }} className="text-giwa underline">다시 선택</button>}
            <button type="button" onClick={() => setOpen(false)} className="text-giwa underline">닫기</button>
          </div>
        </div>
      )}
    </div>
  );
}
