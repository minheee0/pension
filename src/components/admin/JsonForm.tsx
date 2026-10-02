"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

/**
 * 관리자 폼 공통: 입력칸(name 속성)을 JSON 으로 /api/admin/* 에 보내고, 성공하면 화면을 새로고침한다.
 * 권한·검증은 전부 서버가 다시 확인하므로 이 컴포넌트는 입력 전달과 결과 표시만 한다.
 */
export default function JsonForm({ endpoint, op, extra, children, submitLabel = "저장", confirmMessage, resetOnSuccess, danger, inline }: {
  endpoint: string; op: string; extra?: Record<string, unknown>; children?: ReactNode; submitLabel?: string;
  confirmMessage?: string; resetOnSuccess?: boolean; danger?: boolean; inline?: boolean;
}) {
  const router = useRouter();
  const [st, setSt] = useState<{ busy: boolean; ok?: string; err?: string }>({ busy: false });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    const form = e.currentTarget;
    const body: Record<string, unknown> = { op, ...extra };
    new FormData(form).forEach((v, k) => { if (typeof v === "string") body[k] = v; });
    setSt({ busy: true });
    try {
      const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setSt({ busy: false, err: j.error?.message ?? "처리하지 못했습니다" }); return; }
      setSt({ busy: false, ok: "저장했습니다" });
      if (resetOnSuccess) form.reset();
      router.refresh();
    } catch {
      setSt({ busy: false, err: "네트워크 오류가 발생했습니다" });
    }
  }

  return (
    <form onSubmit={onSubmit} className={inline ? "flex flex-wrap items-end gap-2" : "space-y-3"}>
      {children}
      <div className="flex items-center gap-3">
        <button disabled={st.busy} className={`rounded px-4 py-2 text-sm text-white disabled:opacity-40 ${danger ? "bg-red-800 hover:bg-red-900" : "bg-wood hover:bg-giwa"}`}>
          {st.busy ? "처리 중…" : submitLabel}
        </button>
        {st.ok && <span className="text-sm text-green-800">{st.ok}</span>}
        {st.err && <span role="alert" className="text-sm text-red-800">{st.err}</span>}
      </div>
    </form>
  );
}
