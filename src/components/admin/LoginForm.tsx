"use client";

import { useState } from "react";

export default function LoginForm() {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/admin/login", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: fd.get("email"), password: fd.get("password") }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error?.message ?? "로그인하지 못했습니다"); setBusy(false); return; }
      window.location.href = "/admin";
    } catch { setErr("네트워크 오류가 발생했습니다"); setBusy(false); }
  }

  const cls = "mt-1 block w-full rounded border border-line bg-white px-3 py-2";
  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <label className="block text-sm">이메일<input name="email" type="email" required autoComplete="username" className={cls} /></label>
      <label className="block text-sm">비밀번호<input name="password" type="password" required autoComplete="current-password" className={cls} /></label>
      {err && <p role="alert" className="text-sm text-red-800">{err}</p>}
      <button disabled={busy} className="w-full rounded bg-wood px-4 py-3 text-hanji hover:bg-giwa disabled:opacity-40">{busy ? "확인 중…" : "로그인"}</button>
    </form>
  );
}
