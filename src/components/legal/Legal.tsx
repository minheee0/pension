import type { ReactNode } from "react";
import { LEGAL, legalDraft, unresolvedPlaceholders } from "@/lib/legal";

/** 약관·방침 공통 틀: 제목, 버전·시행일, 목차, 임시 문안 안내 */
export function LegalShell({ title, version, toc, used, children }: {
  title: string; version: string; toc: [string, string][]; used?: { smsUsed?: boolean; emailUsed?: boolean }; children: ReactNode;
}) {
  const draft = legalDraft();
  const missing = unresolvedPlaceholders(used);
  return (
    <div className="mx-auto max-w-3xl px-5 py-16">
      <h1 className="font-serif text-4xl font-bold text-wood">{title}</h1>
      <p className="mt-2 text-sm text-giwa">버전 {version} · 시행일 {LEGAL.effectiveDate}</p>

      {(draft || missing.length > 0) && (
        <div role="note" className="mt-6 rounded border border-red-800/30 bg-red-50 p-3 text-sm text-red-800">
          {draft
            ? <p><b>임시 문안입니다.</b> 법률 전문가의 검토와 사업자 정보 입력이 끝난 뒤 환경변수 <code>LEGAL_DOCS_CONFIRMED=true</code> 로 확정하면 이 안내가 사라집니다. 오픈 전에 반드시 확정하세요.</p>
            : <p><b>아직 입력되지 않은 항목이 있습니다.</b></p>}
          {missing.length > 0 && <p className="mt-1">입력 필요: {missing.join(", ")} (<code>src/lib/site.ts</code>, <code>src/lib/legal.ts</code>)</p>}
        </div>
      )}

      <nav aria-label="목차" className="mt-8 rounded border border-line bg-white/60 p-4 text-sm">
        <ol className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {toc.map(([id, label]) => <li key={id}><a href={`#${id}`} className="underline underline-offset-2">{label}</a></li>)}
        </ol>
      </nav>
      {children}
    </div>
  );
}

export function Sec({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="mt-10 scroll-mt-20">
      <h2 className="font-serif text-xl font-bold text-wood">{title}</h2>
      <div className="mt-2 space-y-2 text-[15px] leading-7">{children}</div>
    </section>
  );
}

export const Ol = ({ children }: { children: ReactNode }) => <ol className="list-decimal space-y-1 pl-6">{children}</ol>;
export const Ul = ({ children }: { children: ReactNode }) => <ul className="list-disc space-y-1 pl-6">{children}</ul>;

export function LegalTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] border-collapse text-sm">
        <thead><tr className="bg-line/60">{head.map((h) => <th key={h} className="border border-line p-2 text-left font-medium">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="border border-line p-2 align-top">{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
