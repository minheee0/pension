"use client";

export default function LogoutButton() {
  return (
    <button className="underline" onClick={async () => { await fetch("/api/admin/logout", { method: "POST" }); window.location.href = "/admin/login"; }}>
      로그아웃
    </button>
  );
}
