import type { Metadata } from "next";
import { pool } from "@/server/db";
import { getPricing } from "@/server/admin/pricing";
import { requireAdminPage } from "@/server/admin/session";
import JsonForm from "@/components/admin/JsonForm";
import { Banner, inputCls, th, td, won } from "@/components/admin/ui";

export const metadata: Metadata = { title: "요금·옵션" };
const EP = "/api/admin/pricing";

export default async function PricingPage() {
  const admin = await requireAdminPage();
  const p = await getPricing(pool);
  const owner = admin.role === "owner";
  const L = ({ t, children }: { t: string; children: React.ReactNode }) => <label className="block text-xs">{t}{children}</label>;

  return (
    <div className="space-y-8">
      <h1 className="font-serif text-2xl font-bold text-wood">요금 · 성수기 · 옵션</h1>
      <Banner>변경한 요금은 <b>새 예약부터</b> 적용됩니다. 이미 만들어진 예약의 금액은 바뀌지 않습니다.{!owner && " (직원 계정은 조회만 가능합니다)"}</Banner>

      <section className="rounded border border-line bg-white p-4"><h2 className="mb-2 font-bold">기본 요금 (1박, 기준 인원)</h2>
        {owner ? (
          <JsonForm endpoint={EP} op="base" inline>
            <L t="평일(일~목 밤)"><input name="weekday" defaultValue={p.base.weekday} inputMode="numeric" required className={inputCls} /></L>
            <L t="주말(금·토 밤)"><input name="weekend" defaultValue={p.base.weekend} inputMode="numeric" required className={inputCls} /></L>
          </JsonForm>
        ) : <p>평일 {won(p.base.weekday)} / 주말 {won(p.base.weekend)}</p>}
        <p className="mt-2 text-xs text-giwa">주말로 보는 요일은 [환불 규정·설정]에서 바꿀 수 있습니다. 추가 인원 요금: 1인당 {won(p.extraPersonFee)} (설정에서 변경)</p>
      </section>

      <section className="rounded border border-line bg-white p-4"><h2 className="mb-2 font-bold">성수기</h2>
        <p className="mb-3 text-xs text-giwa">성수기를 등록하면 요금·환불 등급(성수기 규정)·최소 숙박일이 함께 적용됩니다. 기간이 겹칠 수 없습니다.</p>
        <div className="space-y-3">
          {p.seasons.map((s: any) => (
            <div key={s.id} className="flex flex-wrap items-end gap-2 rounded border border-line/60 p-2">
              {owner ? (<>
                <JsonForm endpoint={EP} op="season_save" extra={{ id: s.id }} inline>
                  <L t="이름"><input name="name" defaultValue={s.name} required className={inputCls} /></L>
                  <L t="시작"><input type="date" name="dateFrom" defaultValue={s.date_from} required className={inputCls} /></L>
                  <L t="종료(포함)"><input type="date" name="dateTo" defaultValue={s.date_to} required className={inputCls} /></L>
                  <L t="평일"><input name="priceWeekday" defaultValue={s.price_weekday} inputMode="numeric" required className={`${inputCls} w-28`} /></L>
                  <L t="주말"><input name="priceWeekend" defaultValue={s.price_weekend} inputMode="numeric" required className={`${inputCls} w-28`} /></L>
                  <L t="최소 박"><input name="minNights" defaultValue={s.min_nights} inputMode="numeric" required className={`${inputCls} w-16`} /></L>
                  <label className="flex items-center gap-1 pb-2 text-xs"><input type="checkbox" name="active" defaultChecked={s.active} />사용</label>
                </JsonForm>
                <JsonForm endpoint={EP} op="season_delete" extra={{ id: s.id }} submitLabel="삭제" danger confirmMessage={`'${s.name}' 성수기를 삭제할까요?`} />
              </>) : <span>{s.name}: {s.date_from} ~ {s.date_to} · 평일 {won(s.price_weekday)} / 주말 {won(s.price_weekend)} · 최소 {s.min_nights}박 {s.active ? "" : "(미사용)"}</span>}
            </div>
          ))}
          {p.seasons.length === 0 && <p className="text-giwa">등록된 성수기가 없습니다. 지금은 모든 날짜가 기본 요금으로 계산됩니다.</p>}
        </div>
        {owner && (
          <div className="mt-4 border-t border-line pt-3"><h3 className="mb-2 font-medium">성수기 추가</h3>
            <JsonForm endpoint={EP} op="season_save" submitLabel="추가" resetOnSuccess inline>
              <L t="이름"><input name="name" required placeholder="여름 성수기" className={inputCls} /></L>
              <L t="시작"><input type="date" name="dateFrom" required className={inputCls} /></L>
              <L t="종료(포함)"><input type="date" name="dateTo" required className={inputCls} /></L>
              <L t="평일"><input name="priceWeekday" required inputMode="numeric" placeholder="700000" className={`${inputCls} w-28`} /></L>
              <L t="주말"><input name="priceWeekend" required inputMode="numeric" placeholder="800000" className={`${inputCls} w-28`} /></L>
              <L t="최소 박"><input name="minNights" defaultValue="1" inputMode="numeric" required className={`${inputCls} w-16`} /></L>
              <label className="flex items-center gap-1 pb-2 text-xs"><input type="checkbox" name="active" defaultChecked />사용</label>
            </JsonForm>
          </div>
        )}
      </section>

      <section className="rounded border border-line bg-white p-4"><h2 className="mb-2 font-bold">특정일 요금 (명절·연휴, 성수기보다 우선)</h2>
        <div className="space-y-2">
          {p.overrides.map((o: any) => (
            <div key={o.date} className="flex flex-wrap items-end gap-2">
              {owner ? (<>
                <JsonForm endpoint={EP} op="override_save" extra={{ date: o.date, dayType: o.day_type, refundTier: o.refund_tier }} inline>
                  <span className="pb-2 font-medium">{o.date}</span>
                  <L t="요금"><input name="price" defaultValue={o.price} inputMode="numeric" required className={`${inputCls} w-28`} /></L>
                  <L t="최소 박"><input name="minNights" defaultValue={o.min_nights} inputMode="numeric" required className={`${inputCls} w-16`} /></L>
                  <L t="메모"><input name="memo" defaultValue={o.memo ?? ""} className={inputCls} /></L>
                </JsonForm>
                <JsonForm endpoint={EP} op="override_delete" extra={{ date: o.date }} submitLabel="삭제" danger />
              </>) : <span>{o.date}: {won(o.price)} · {o.memo}</span>}
            </div>
          ))}
          {p.overrides.length === 0 && <p className="text-giwa">등록된 특정일 요금이 없습니다.</p>}
        </div>
        {owner && (
          <div className="mt-4 border-t border-line pt-3"><h3 className="mb-2 font-medium">특정일 추가</h3>
            <JsonForm endpoint={EP} op="override_save" submitLabel="추가" resetOnSuccess inline>
              <L t="날짜"><input type="date" name="date" required className={inputCls} /></L>
              <L t="요금"><input name="price" required inputMode="numeric" placeholder="900000" className={`${inputCls} w-28`} /></L>
              <L t="최소 박"><input name="minNights" defaultValue="1" inputMode="numeric" required className={`${inputCls} w-16`} /></L>
              <L t="메모"><input name="memo" placeholder="설 연휴" className={inputCls} /></L>
            </JsonForm>
            <p className="mt-1 text-xs text-giwa">특정일은 "주말·성수기 환불 등급"으로 처리됩니다.</p>
          </div>
        )}
      </section>

      <section className="rounded border border-line bg-white p-4"><h2 className="mb-2 font-bold">유료 옵션</h2>
        <div className="space-y-3">
          {p.options.map((o: any) => (
            <div key={o.id} className="rounded border border-line/60 p-2">
              <b>{o.name}</b> <span className="text-xs text-giwa">({o.code}) · {o.unit_type === "per_use" ? "1회당" : o.unit_type}</span> {!o.active && <span className="text-xs text-red-800">미사용 — 예약 화면에 보이지 않음</span>}
              {owner ? (
                <JsonForm endpoint={EP} op="option_save" extra={{ id: o.id }} inline>
                  <L t="가격"><input name="price" defaultValue={o.price} inputMode="numeric" required className={`${inputCls} w-28`} /></L>
                  <L t="시작 시간(쉼표)"><input name="timeSlots" defaultValue={(o.time_slots ?? []).join(",")} className={`${inputCls} w-48`} /></L>
                  <L t="최대 수량"><input name="maxQty" defaultValue={o.max_qty} inputMode="numeric" className={`${inputCls} w-16`} /></L>
                  <L t="신청 마감(일 전)"><input name="deadlineDays" defaultValue={o.deadline_days} inputMode="numeric" className={`${inputCls} w-16`} /></L>
                  <L t="마감 시각"><input name="deadlineTime" defaultValue={o.deadline_time} className={`${inputCls} w-20`} /></L>
                  <label className="flex items-center gap-1 pb-2 text-xs"><input type="checkbox" name="active" defaultChecked={o.active} />예약 화면에 표시</label>
                </JsonForm>
              ) : <div className="text-giwa">{won(o.price)}</div>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
