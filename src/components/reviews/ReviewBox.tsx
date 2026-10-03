"use client";

import { useCallback, useEffect, useState } from "react";
import Stars from "./Stars";

const DETAILS: [string, string][] = [["cleanliness", "청결"], ["facilities", "시설"], ["location", "위치"], ["atmosphere", "한옥 분위기"], ["service", "응대"]];
const MIN = 10, MAX = 1000;

interface Review {
  id: number; rating: number; details: Record<string, number>; content: string; status: string;
  editable: boolean; deletable: boolean; edited: boolean; reply: string | null;
}
type St = { state: "loading" } | { state: "not_yet" | "unavailable" } | { state: "expired" | "eligible"; windowEndsAt: string } | { state: "written"; review: Review; windowEndsAt: string } | { state: "error"; message: string };

function StarInput({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${label} ${n}점`} onClick={() => onChange(value === n ? 0 : n)}
          className={`text-2xl leading-none ${n <= value ? "text-amber-600" : "text-line"}`}>★</button>
      ))}
    </div>
  );
}

/** 예약 조회 화면 안의 후기 영역: 이용 완료 후 작성 → 7일 안에 수정 → 삭제. 서버가 매번 예약번호·휴대폰으로 본인 확인을 다시 한다. */
export default function ReviewBox({ bookingNo, phone }: { bookingNo: string; phone: string }) {
  const [st, setSt] = useState<St>({ state: "loading" });
  const [editing, setEditing] = useState(false);
  const [rating, setRating] = useState(0);
  const [details, setDetails] = useState<Record<string, number>>({});
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const call = useCallback(async (url: string, body: object) => {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookingNo, phone, ...body }) });
    return { ok: r.ok, json: await r.json().catch(() => ({})) };
  }, [bookingNo, phone]);

  const load = useCallback(async () => {
    try {
      const r = await call("/api/reviews/status", {});
      setSt(r.ok ? r.json : { state: "error", message: r.json.error?.message ?? "후기 정보를 불러오지 못했습니다" });
    } catch { setSt({ state: "error", message: "후기 정보를 불러오지 못했습니다" }); }
  }, [call]);
  useEffect(() => { load(); }, [load]);

  const len = [...content.trim()].length;
  const ok = rating >= 1 && len >= MIN && len <= MAX;

  async function submit(op: "create" | "update") {
    setBusy(true); setErr(null);
    const r = await call("/api/reviews", { op, rating, details, content });
    setBusy(false);
    if (!r.ok) { setErr(r.json.error?.message ?? "저장하지 못했습니다"); return; }
    setEditing(false); await load();
  }
  async function remove() {
    if (!window.confirm("후기를 삭제할까요? 삭제 후에도 기간 안에는 다시 작성할 수 있습니다.")) return;
    setBusy(true); setErr(null);
    const r = await call("/api/reviews", { op: "delete" });
    setBusy(false);
    if (!r.ok) { setErr(r.json.error?.message ?? "삭제하지 못했습니다"); return; }
    setEditing(false); await load();
  }
  function startEdit(r: Review) { setRating(r.rating); setDetails(r.details); setContent(r.content); setEditing(true); setErr(null); }

  const box = "rounded-lg border border-line bg-white p-5";
  if (st.state === "loading" || st.state === "not_yet" || st.state === "unavailable") return null;
  if (st.state === "error") return <p className={`${box} text-sm text-giwa`}>{st.message}</p>;
  if (st.state === "expired") return <p className={`${box} text-sm text-giwa`}>후기 작성 기간({st.windowEndsAt}까지)이 지났습니다.</p>;

  const form = (mode: "create" | "update") => (
    <div className="mt-3 space-y-4">
      <div><div className="mb-1 text-sm font-medium">전체 만족도 *</div><StarInput value={rating} onChange={setRating} label="전체 만족도" /></div>
      <details className="rounded border border-line p-3">
        <summary className="cursor-pointer text-sm">항목별로도 평가하기 (선택)</summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {DETAILS.map(([k, label]) => <div key={k} className="flex items-center justify-between gap-2 text-sm"><span>{label}</span><StarInput value={details[k] ?? 0} onChange={(n) => setDetails((d) => { const x = { ...d }; if (n) x[k] = n; else delete x[k]; return x; })} label={label} /></div>)}
        </div>
      </details>
      <label className="block text-sm">후기 *
        <textarea value={content} onChange={(e) => setContent(e.target.value.slice(0, MAX))} rows={5} className="mt-1 block w-full rounded border border-line px-3 py-2"
          placeholder="머무르신 경험을 자유롭게 남겨 주세요 (10자 이상)" />
        <span className={`mt-1 block text-right text-xs ${len > 0 && len < MIN ? "text-red-800" : "text-giwa"}`}>{len} / {MAX}</span>
      </label>
      <p className="text-xs text-giwa">전화번호·이메일·링크는 쓸 수 없습니다. 이름은 홍*동처럼 일부만 표시됩니다. 부적절한 내용은 확인 후 비공개 처리될 수 있습니다.</p>
      {err && <p role="alert" className="text-sm text-red-800">{err}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={!ok || busy} onClick={() => submit(mode)} className="rounded bg-wood px-5 py-2 text-hanji hover:bg-giwa disabled:cursor-not-allowed disabled:opacity-40">{busy ? "저장 중…" : mode === "create" ? "후기 등록" : "수정 저장"}</button>
        {mode === "update" && <button type="button" onClick={() => setEditing(false)} className="px-3 underline">취소</button>}
      </div>
    </div>
  );

  if (st.state === "eligible") {
    return <section className={box}><h2 className="font-serif text-2xl font-bold">후기 남기기</h2><p className="text-sm text-giwa">{st.windowEndsAt}까지 작성할 수 있습니다.</p>{form("create")}</section>;
  }
  if (st.state !== "written") return null;
  const rv = st.review;
  return (
    <section className={box}>
      <h2 className="font-serif text-2xl font-bold">내가 남긴 후기</h2>
      {editing ? form("update") : (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2"><Stars value={rv.rating} className="text-xl" />{rv.edited && <span className="text-xs text-giwa">(수정됨)</span>}
            {rv.status === "hidden" && <span className="rounded bg-line px-2 py-0.5 text-xs">비공개 처리됨</span>}</div>
          <p className="whitespace-pre-wrap text-sm">{rv.content}</p>
          {rv.reply && <div className="rounded bg-hanji p-3 text-sm"><b className="text-wood">사장님 답글</b><p className="mt-1 whitespace-pre-wrap">{rv.reply}</p></div>}
          {rv.status === "hidden" && <p className="text-xs text-giwa">이 후기는 비공개로 처리되어 수정·삭제할 수 없습니다. 문의해 주세요.</p>}
          {err && <p role="alert" className="text-sm text-red-800">{err}</p>}
          <div className="flex gap-3 text-sm">
            {rv.editable && <button type="button" className="underline" onClick={() => startEdit(rv)}>수정</button>}
            {rv.deletable && <button type="button" className="text-red-800 underline" onClick={remove} disabled={busy}>삭제</button>}
            {!rv.editable && rv.status !== "hidden" && <span className="text-xs text-giwa">작성 후 7일이 지나 수정할 수 없습니다.</span>}
          </div>
        </div>
      )}
    </section>
  );
}
