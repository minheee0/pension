"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import RangeCalendar, { CalDay, addDays, fmtDate, shiftMonth, won } from "./RangeCalendar";
import RefundTable from "@/components/RefundTable";
import type { PolicyView } from "@/server/refund/table";
import { SITE } from "@/lib/site";

interface OptionInfo {
  id: number; code: string; name: string; description: string | null; price: number;
  unitType: "per_stay" | "per_night" | "per_person" | "per_use";
  maxQty: number; timeSlots: string[]; deadlineDaysBefore: number; deadlineTime: string;
}
interface QuoteRes {
  available: boolean;
  quote: {
    nightsCount: number; minNights: number; roomTotal: number; extraGuestFee: number;
    optionTotal: number; totalAmount: number;
    nights: { date: string; price: number }[];
    options: { name: string; qty: number; amount: number; useDate: string | null; useTime: string | null }[];
  };
}
interface Sel { on: boolean; qty: number; useDate: string; useTime: string }
interface Held { bookingNo: string; holdExpiresAt: string; payAmount: number }

const ISO = /^\d{4}-\d{2}-\d{2}$/;
// 휴대폰 번호: 숫자만, 딱 11자리. 붙여넣기("010-1234-5678", "+82 10-1234-5678")도 자동 정리한다.
const sanitizePhone = (raw: string) => {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("82")) d = "0" + d.slice(2);
  return d.slice(0, 11);
};
const PHONE_OK = /^01[016789]\d{8}$/;
const EMPTY_SEL: Sel = { on: false, qty: 1, useDate: "", useTime: "" };
const inputCls = "mt-1 block w-full rounded border border-line bg-white px-3 py-2";

export default function ReserveFlow(props: {
  initialCheckIn?: string; initialCheckOut?: string; initialGuests?: number;
}) {
  const initIn = props.initialCheckIn && ISO.test(props.initialCheckIn) ? props.initialCheckIn : null;
  const initOut = initIn && props.initialCheckOut && ISO.test(props.initialCheckOut) && props.initialCheckOut > initIn
    ? props.initialCheckOut : null;
  const nowMonth = useMemo(() => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7), []);

  const [month, setMonth] = useState(initIn ? initIn.slice(0, 7) : nowMonth);
  const [days, setDays] = useState<Record<string, CalDay>>({});
  const [loadingCal, setLoadingCal] = useState(true);
  const [calErr, setCalErr] = useState<string | null>(null);
  const [policy, setPolicy] = useState<PolicyView | null>(null);
  const [checkIn, setCheckIn] = useState<string | null>(initIn);
  const [checkOut, setCheckOut] = useState<string | null>(initOut);
  const [guests, setGuests] = useState(
    props.initialGuests && props.initialGuests >= 1 && props.initialGuests <= SITE.maxGuests
      ? props.initialGuests : SITE.baseGuests);

  const [optionList, setOptionList] = useState<OptionInfo[]>([]);
  const [sel, setSel] = useState<Record<number, Sel>>({});

  const [quote, setQuote] = useState<QuoteRes | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [memo, setMemo] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [held, setHeld] = useState<Held | null>(null);

  // ---- 달력 데이터 (보이는 달 + 다음 달: 월말 체크인 → 다음 달 체크아웃 선택을 위해)
  const loadMonth = useCallback(async (m: string): Promise<boolean> => {
    try {
      const r = await fetch(`/api/calendar?month=${m}`, { cache: "no-store" });
      if (!r.ok) return false;
      const j = (await r.json()) as { days: CalDay[] };
      setDays((prev) => {
        const next = { ...prev };
        for (const d of j.days) next[d.date] = d;
        return next;
      });
      return true;
    } catch {
      return false;
    }
  }, []);

  const reloadCalendar = useCallback(async (m: string) => {
    setLoadingCal(true);
    setCalErr(null);
    const [ok] = await Promise.all([loadMonth(m), loadMonth(shiftMonth(m, 1))]);
    if (!ok) setCalErr("달력을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    setLoadingCal(false);
  }, [loadMonth]);

  useEffect(() => { reloadCalendar(month); }, [month, reloadCalendar]);

  useEffect(() => {
    fetch("/api/policy").then((r) => (r.ok ? r.json() : null)).then((j) => j && setPolicy(j)).catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/options").then((r) => r.json()).then((j) => setOptionList(j.options ?? [])).catch(() => {});
  }, []);

  // ---- 날짜 선택 규칙
  const nightsFree = useCallback((from: string, to: string) => {
    for (let d = from; d < to; d = addDays(d, 1)) if (!days[d]?.available) return false;
    return true;
  }, [days]);

  const clickable = (d: string) => {
    if (checkIn && !checkOut && d > checkIn && d <= addDays(checkIn, 30) && nightsFree(checkIn, d)) return true;
    return !!days[d]?.available; // 체크아웃 날은 "그날 밤"이 비어 있지 않아도 선택 가능
  };

  const pick = (d: string) => {
    setSubmitErr(null);
    if (checkIn && !checkOut && d > checkIn && nightsFree(checkIn, d)) { setCheckOut(d); return; }
    if (days[d]?.available) { setCheckIn(d); setCheckOut(null); }
  };

  const nightDates = useMemo(() => {
    const out: string[] = [];
    if (checkIn && checkOut) for (let d = checkIn; d < checkOut; d = addDays(d, 1)) out.push(d);
    return out;
  }, [checkIn, checkOut]);

  // ---- 옵션 → 서버로 보낼 형태
  const { payload, incomplete } = useMemo(() => {
    const list: { optionId: number; qty: number; useDate?: string; useTime?: string }[] = [];
    let bad = false;
    for (const o of optionList) {
      const s = sel[o.id];
      if (!s?.on) continue;
      const useDate = nightDates.includes(s.useDate) ? s.useDate : "";
      const needDate = o.unitType === "per_use";
      const needTime = o.timeSlots.length > 0;
      if ((needDate && !useDate) || (needTime && !s.useTime)) { bad = true; continue; }
      list.push({
        optionId: o.id, qty: s.qty,
        ...(useDate ? { useDate } : {}), ...(needTime ? { useTime: s.useTime } : {}),
      });
    }
    return { payload: list, incomplete: bad };
  }, [optionList, sel, nightDates]);
  const payloadKey = JSON.stringify(payload);

  // ---- 견적
  useEffect(() => {
    setQuoteErr(null);
    if (!checkIn || !checkOut) { setQuote(null); return; }
    const ac = new AbortController();
    const qs = new URLSearchParams({ checkIn, checkOut, guests: String(guests) });
    if (payloadKey !== "[]") qs.set("options", payloadKey);
    setQuoting(true);
    fetch(`/api/quote?${qs}`, { signal: ac.signal, cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (r.ok) setQuote(j);
        else { setQuote(null); setQuoteErr(j.error?.message ?? "요금을 계산하지 못했습니다"); }
      })
      .catch((e) => { if (e.name !== "AbortError") setQuoteErr("요금을 계산하지 못했습니다. 잠시 후 다시 시도해 주세요."); })
      .finally(() => { if (!ac.signal.aborted) setQuoting(false); });
    return () => ac.abort();
  }, [checkIn, checkOut, guests, payloadKey]);

  // ---- 점유
  const phoneValid = PHONE_OK.test(phone);
  const canSubmit = !!quote?.available && !quoting && !incomplete && !!name.trim() && phoneValid && agreed && !submitting;

  async function submit() {
    if (!quote || !checkIn || !checkOut) return;
    setSubmitting(true); setSubmitErr(null);
    try {
      const res = await fetch("/api/holds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          checkIn, checkOut, guests, options: payload,
          guest: { name, phone, email: email || undefined },
          memo: memo || undefined, agreedTerms: agreed, expectedTotal: quote.quote.totalAmount,
        }),
      });
      const j = await res.json();
      if (res.status === 201) { setHeld(j); return; }
      setSubmitErr(j.error?.message ?? "예약을 진행하지 못했습니다");
      if (j.error?.code === "UNAVAILABLE") { setCheckIn(null); setCheckOut(null); reloadCalendar(month); }
    } catch {
      setSubmitErr("네트워크 오류가 발생했습니다. 다시 시도해 주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  if (held) return <HeldView held={held} onRestart={() => { setHeld(null); setCheckIn(null); setCheckOut(null); reloadCalendar(month); }} />;

  const q = quote?.quote;
  const patch = (id: number, p: Partial<Sel>) =>
    setSel((s) => ({ ...s, [id]: { ...EMPTY_SEL, ...s[id], ...p } }));

  return (
    <div className="mt-8 grid gap-8 md:grid-cols-[1fr_20rem]">
      <div className="space-y-10">
        <section>
          <h2 className="font-serif text-2xl font-bold">1. 날짜 선택</h2>
          <p className="mb-3 mt-1 text-sm text-giwa">
            {checkIn ? `체크인 ${fmtDate(checkIn)}${checkOut ? ` → 체크아웃 ${fmtDate(checkOut)} (${nightDates.length}박)` : " · 체크아웃 날짜를 선택하세요"}` : "체크인 날짜를 선택하세요"}
            {" "}· 체크인 {SITE.checkIn} / 체크아웃 {SITE.checkOut}
          </p>
          {calErr && (
            <div role="alert" className="mb-3 rounded border border-red-800/30 bg-red-50 p-3 text-sm text-red-800">
              {calErr}
              <button type="button" onClick={() => reloadCalendar(month)} className="ml-2 underline">다시 시도</button>
            </div>
          )}
          <RangeCalendar month={month} minMonth={nowMonth} days={days} loading={loadingCal}
            checkIn={checkIn} checkOut={checkOut} clickable={clickable} onPick={pick} onMonth={setMonth} />
        </section>

        <section>
          <h2 className="font-serif text-2xl font-bold">2. 인원</h2>
          <div className="mt-3 flex items-center gap-4">
            <button type="button" aria-label="인원 줄이기" disabled={guests <= 1} onClick={() => setGuests(guests - 1)}
              className="h-10 w-10 rounded border border-line bg-white text-xl disabled:opacity-30">−</button>
            <span className="w-16 text-center text-lg">{guests}명</span>
            <button type="button" aria-label="인원 늘리기" disabled={guests >= SITE.maxGuests} onClick={() => setGuests(guests + 1)}
              className="h-10 w-10 rounded border border-line bg-white text-xl disabled:opacity-30">＋</button>
          </div>
          <p className="mt-2 text-sm text-giwa">
            기준 {SITE.baseGuests}명, 최대 {SITE.maxGuests}명. 기준 인원 초과 시 1인당 {won(SITE.extraPersonFee)}이 추가됩니다(1회 숙박당). 36개월 미만은 인원에서 제외됩니다.
          </p>
        </section>

        {optionList.length > 0 && (
          <section>
            <h2 className="font-serif text-2xl font-bold">3. 유료 옵션</h2>
            <div className="mt-3 space-y-3">
              {optionList.map((o) => {
                const s = sel[o.id];
                return (
                  <div key={o.id} className="rounded-lg border border-line bg-white/60 p-4">
                    <label className="flex items-start gap-3">
                      <input type="checkbox" className="mt-1.5" checked={!!s?.on} onChange={(e) => patch(o.id, { on: e.target.checked })} />
                      <span>
                        <span className="font-medium">{o.name}</span>{" "}
                        <span className="text-giwa">{won(o.price)}{o.unitType === "per_night" ? " / 박" : o.unitType === "per_person" ? " / 인" : ""}</span>
                        {o.description && <span className="block text-sm text-giwa">{o.description}</span>}
                        <span className="block text-xs text-giwa">이용 {o.deadlineDaysBefore}일 전 {o.deadlineTime}까지 신청 · 이후 취소·미사용 환불 불가</span>
                      </span>
                    </label>
                    {s?.on && (
                      <div className="mt-3 grid gap-3 sm:grid-cols-3">
                        {o.unitType === "per_use" && (
                          <label className="text-sm">이용 날짜
                            <select className={inputCls} value={nightDates.includes(s.useDate) ? s.useDate : ""} onChange={(e) => patch(o.id, { useDate: e.target.value })}>
                              <option value="">{nightDates.length ? "선택" : "먼저 날짜를 선택하세요"}</option>
                              {nightDates.map((d) => <option key={d} value={d}>{fmtDate(d)}</option>)}
                            </select>
                          </label>
                        )}
                        {o.timeSlots.length > 0 && (
                          <label className="text-sm">시작 시간
                            <select className={inputCls} value={s.useTime} onChange={(e) => patch(o.id, { useTime: e.target.value })}>
                              <option value="">선택</option>
                              {o.timeSlots.map((t) => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </label>
                        )}
                        {o.maxQty > 1 && (
                          <label className="text-sm">수량
                            <select className={inputCls} value={s.qty} onChange={(e) => patch(o.id, { qty: Number(e.target.value) })}>
                              {Array.from({ length: o.maxQty }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                            </select>
                          </label>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {incomplete && <p className="mt-2 text-sm text-red-800">선택한 옵션의 이용 날짜·시간을 골라 주세요.</p>}
          </section>
        )}

        <section>
          <h2 className="font-serif text-2xl font-bold">{optionList.length > 0 ? "4" : "3"}. 예약자 정보</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-sm">이름 *<input className={inputCls} value={name} maxLength={50} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
            <div className="text-sm">
              <label>휴대폰 번호 *
                <input className={inputCls} type="tel" inputMode="numeric" pattern="[0-9]*" maxLength={11}
                  placeholder="01012345678" value={phone} autoComplete="tel-national"
                  aria-invalid={phone.length > 0 && !phoneValid} aria-describedby="phone-help"
                  onChange={(e) => setPhone(sanitizePhone(e.target.value))} />
              </label>
              <p id="phone-help" className={`mt-1 text-xs ${
                phoneValid ? "text-green-800"
                : phone.length === 11 ? "text-red-800" : "text-giwa"}`}>
                {phoneValid ? "✓ 올바른 번호입니다"
                  : phone.length === 11 ? "010 등 휴대폰 번호로 시작해야 합니다"
                  : phone.length === 0 ? "하이픈(-) 없이 숫자 11자리만 입력해 주세요"
                  : `${phone.length}/11자리`}
              </p>
            </div>
            <label className="text-sm sm:col-span-2">이메일 (선택)<input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
            <label className="text-sm sm:col-span-2">요청사항 (선택)<textarea className={inputCls} rows={3} maxLength={500} value={memo} onChange={(e) => setMemo(e.target.value)} /></label>
          </div>
          <p className="mt-2 text-xs text-giwa">예약 확인과 안내 문자 발송에만 사용하며, 조회 시 예약번호와 함께 필요합니다.</p>
        </section>

        {policy && (
          <section>
            <h2 className="font-serif text-2xl font-bold">{optionList.length > 0 ? "5" : "4"}. 취소·환불 규정</h2>
            <div className="mt-3 rounded-lg border border-line bg-white/60 p-4"><RefundTable view={policy} /></div>
          </section>
        )}
      </div>

      <aside className="md:sticky md:top-20 md:self-start">
        <div className="rounded-lg border border-line bg-white p-5">
          <h2 className="font-serif text-xl font-bold">요금 안내</h2>
          {!checkIn || !checkOut ? (
            <p className="mt-3 text-sm text-giwa">날짜를 선택하면 요금이 표시됩니다.</p>
          ) : quoteErr ? (
            <p className="mt-3 text-sm text-red-800">{quoteErr}</p>
          ) : !q ? (
            <p className="mt-3 text-sm text-giwa">계산 중…</p>
          ) : (
            <div className={quoting ? "opacity-50" : ""}>
              <ul className="mt-3 space-y-1 text-sm">
                {q.nights.map((n) => <li key={n.date} className="flex justify-between"><span>{fmtDate(n.date)}</span><span>{won(n.price)}</span></li>)}
                {q.extraGuestFee > 0 && <li className="flex justify-between"><span>추가 인원 {guests - SITE.baseGuests}명</span><span>{won(q.extraGuestFee)}</span></li>}
                {q.options.map((o, i) => <li key={i} className="flex justify-between"><span>{o.name}{o.useDate ? ` ${fmtDate(o.useDate)}` : ""}{o.useTime ? ` ${o.useTime}` : ""}</span><span>{won(o.amount)}</span></li>)}
              </ul>
              <div className="mt-3 flex justify-between border-t border-line pt-3 font-bold"><span>합계</span><span>{won(q.totalAmount)}</span></div>
              {!quote?.available && <p className="mt-3 text-sm text-red-800">선택한 날짜는 예약이 불가합니다. 다른 날짜를 선택해 주세요.</p>}
            </div>
          )}

          <label className="mt-5 flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            <span>위 취소·환불 규정을 확인했으며 동의합니다.</span>
          </label>
          {submitErr && <p className="mt-3 text-sm text-red-800">{submitErr}</p>}
          <button type="button" onClick={submit} disabled={!canSubmit}
            className="mt-4 w-full rounded bg-wood px-4 py-3 text-hanji hover:bg-giwa disabled:cursor-not-allowed disabled:opacity-40">
            {submitting ? "처리 중…" : "예약 진행하기"}
          </button>
          <p className="mt-2 text-xs text-giwa">버튼을 누르면 날짜가 15분간 임시 확보됩니다.</p>
        </div>
      </aside>
    </div>
  );
}

function HeldView({ held, onRestart }: { held: Held; onRestart: () => void }) {
  const [left, setLeft] = useState(() => Math.max(0, Math.floor((Date.parse(held.holdExpiresAt) - Date.now()) / 1000)));
  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, Math.floor((Date.parse(held.holdExpiresAt) - Date.now()) / 1000))), 1000);
    return () => clearInterval(t);
  }, [held.holdExpiresAt]);
  const mm = String(Math.floor(left / 60)).padStart(2, "0"), ss = String(left % 60).padStart(2, "0");

  return (
    <div className="mt-8 max-w-lg rounded-lg border border-line bg-white p-6">
      {left > 0 ? (
        <>
          <h2 className="font-serif text-2xl font-bold text-wood">날짜를 확보했습니다</h2>
          <p className="mt-3">예약번호 <b className="tracking-wider">{held.bookingNo}</b></p>
          <p className="mt-1">결제 금액 <b>{won(held.payAmount)}</b></p>
          <p className="mt-1 text-giwa">남은 시간 <b className="text-red-800">{mm}:{ss}</b> · 이 시간 안에 결제를 마쳐야 예약이 확정됩니다.</p>
          {/* TODO(결제 단계): 이 버튼에서 결제창을 열고, 웹훅으로 confirmStay 를 호출한다 */}
          <button disabled className="mt-5 w-full rounded bg-wood px-4 py-3 text-hanji opacity-40">결제하기 (결제 연동 준비 중)</button>
        </>
      ) : (
        <>
          <h2 className="font-serif text-2xl font-bold">임시 확보 시간이 끝났습니다</h2>
          <p className="mt-2 text-giwa">날짜를 다시 선택해 주세요.</p>
          <button onClick={onRestart} className="mt-5 rounded bg-wood px-6 py-3 text-hanji hover:bg-giwa">다시 예약하기</button>
        </>
      )}
    </div>
  );
}
