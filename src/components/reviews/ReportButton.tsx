"use client";

import { useState } from "react";

const REASONS: [string, string][] = [["abuse", "욕설·비방"], ["false", "허위 사실"], ["privacy", "개인정보 노출"], ["spam", "광고·스팸"], ["other", "기타"]];

/** 부적절한 후기 신고. 신고만으로 후기가 숨겨지지는 않고, 사장님이 확인한 뒤 처리합니다. */
export default function ReportButton({ reviewId }: { reviewId: number }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("abuse");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function send() {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/reviews/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reviewId, reason, detail: detail || undefined }) });
      const j = await r.json().catch(() => ({}));
      setMsg(r.ok ? { ok: true, text: j.duplicate ? "이미 신고하셨습니다. 확인 후 처리하겠습니다." : "신고가 접수되었습니다. 확인 후 처리하겠습니다." } : { ok: false, text: j.error?.message ?? "신고하지 못했습니다" });
      if (r.ok) setOpen(false);
    } catch { setMsg({ ok: false, text: "네트워크 오류가 발생했습니다" }); }
    setBusy(false);
  }

  if (msg?.ok) return <span className="text-xs text-giwa">{msg.text}</span>;
  return (
    <span className="text-xs">
      {!open && <button type="button" onClick={() => setOpen(true)} className="text-giwa underline">신고</button>}
      {open && (
        <span className="mt-2 block space-y-2 rounded border border-line bg-white p-3">
          <label className="block">사유
            <select value={reason} onChange={(e) => setReason(e.target.value)} className="ml-2 rounded border border-line px-2 py-1">{REASONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <textarea aria-label="신고 내용" value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={300} rows={2} placeholder="자세한 내용 (선택)" className="block w-full rounded border border-line px-2 py-1" />
          <span className="flex gap-2">
            <button type="button" onClick={send} disabled={busy} className="rounded bg-wood px-3 py-1 text-hanji disabled:opacity-40">{busy ? "접수 중…" : "신고하기"}</button>
            <button type="button" onClick={() => setOpen(false)} className="px-2 underline">닫기</button>
          </span>
        </span>
      )}
      {msg && !msg.ok && <span role="alert" className="ml-2 text-red-800">{msg.text}</span>}
    </span>
  );
}
