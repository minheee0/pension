import type { Metadata } from "next";
import { pool } from "@/server/db";
import { getRefundRules, getSettings } from "@/server/admin/policy";
import { requireAdminPage } from "@/server/admin/session";
import JsonForm from "@/components/admin/JsonForm";
import { Banner, inputCls } from "@/components/admin/ui";

export const metadata: Metadata = { title: "환불 규정·설정" };
const EP = "/api/admin/policy";

export default async function PolicyPage() {
  const admin = await requireAdminPage();
  const [rules, settings] = await Promise.all([getRefundRules(pool), getSettings(pool)]);
  const owner = admin.role === "owner";
  const groups: [string, string, typeof rules][] = [
    ["off", "weekday", []], ["off", "weekend", []], ["peak", "weekday", []], ["peak", "weekend", []],
  ].map(([t, d]) => [t as string, d as string, rules.filter((r) => r.tier === t && r.day_type === d)]);
  const TITLE: Record<string, string> = { "off/weekday": "비수기 주중", "off/weekend": "비수기 주말", "peak/weekday": "성수기 주중", "peak/weekend": "성수기 주말·연휴" };
  const label = (m: number) => (m === 0 ? "당일·노쇼" : `${m}일 전부터`);

  return (
    <div className="space-y-8">
      <h1 className="font-serif text-2xl font-bold text-wood">환불 규정 · 운영 설정</h1>
      <Banner tone="warn">환불 공제율은 <b>새 예약부터</b> 적용됩니다(기존 예약은 예약 당시 규정 유지). 오픈 전에 소비자분쟁해결기준과 대조해 확정하세요. 확정한 뒤에는 서버 환경변수 <code>REFUND_POLICY_CONFIRMED=true</code>를 켜면 손님 화면의 "임시 규정" 안내가 사라집니다.</Banner>

      <section className="rounded border border-line bg-white p-4"><h2 className="mb-2 font-bold">환불 공제율 (%)</h2>
        <p className="mb-3 text-xs text-giwa">체크인 며칠 전에 취소하느냐에 따라 객실 요금에서 공제하는 비율입니다. 체크인이 가까울수록 공제율이 같거나 커야 저장됩니다. 환불은 (100 − 공제율)%입니다.</p>
        {owner ? (
          <JsonForm endpoint={EP} op="refund" submitLabel="공제율 저장">
            <div className="grid gap-4 md:grid-cols-4">
              {groups.map(([t, d, rs]) => (
                <div key={`${t}/${d}`} className="rounded border border-line/60 p-2"><div className="mb-1 font-medium">{TITLE[`${t}/${d}`]}</div>
                  {rs.map((r) => <label key={r.id} className="mb-1 flex items-center justify-between gap-2 text-xs">{label(r.days_before_min)}
                    <span><input name={`rate_${r.id}`} defaultValue={r.deduct_rate} inputMode="numeric" className={`${inputCls} inline w-16`} /> %</span></label>)}
                </div>
              ))}
            </div>
          </JsonForm>
        ) : (
          <div className="grid gap-4 md:grid-cols-4">{groups.map(([t, d, rs]) => <div key={`${t}/${d}`}><b>{TITLE[`${t}/${d}`]}</b>{rs.map((r) => <div key={r.id}>{label(r.days_before_min)}: {r.deduct_rate}%</div>)}</div>)}</div>
        )}
      </section>

      <section className="rounded border border-line bg-white p-4"><h2 className="mb-2 font-bold">운영 설정</h2>
        {owner ? (
          <JsonForm endpoint={EP} op="settings" submitLabel="설정 저장">
            <div className="grid gap-3 md:grid-cols-2">
              {settings.map((s) => <label key={s.key} className="block text-xs"><span className="font-medium text-ink">{s.label}</span> <span className="text-giwa">— {s.hint}</span>
                <input name={`s_${s.key}`} defaultValue={s.value} className={inputCls} /></label>)}
            </div>
          </JsonForm>
        ) : <dl>{settings.map((s) => <div key={s.key} className="flex justify-between border-b border-line/60 py-1"><dt>{s.label}</dt><dd>{s.value}</dd></div>)}</dl>}
        <p className="mt-3 text-xs text-giwa">체크인·체크아웃·노쇼 시각은 이용안내 화면에 표시되는 값입니다. 사이트 소개 문구(예: 홈 화면의 "체크인 16:00")는 <code>src/lib/site.ts</code>의 값이라 같이 맞춰 주세요.</p>
      </section>
    </div>
  );
}
