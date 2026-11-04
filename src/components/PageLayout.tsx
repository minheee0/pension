import type { ReactNode } from "react";

/**
 * 손님용 하위 페이지(소개·독채 안내·이용안내·후기·예약 조회·예약)의 공통 틀.
 * 폭·여백·제목·섹션 간격을 한곳에서 정해 페이지마다 모양이 달라지지 않게 한다.
 *  - 기본 폭 max-w-3xl, 두 단 화면(예약)만 wide 로 max-w-5xl
 */
export function PageShell({ title, lead, wide = false, children }: {
  title: string; lead?: ReactNode; wide?: boolean; children: ReactNode;
}) {
  return (
    <div className={`mx-auto ${wide ? "max-w-5xl" : "max-w-3xl"} px-5 py-16`}>
      <h1 className="font-serif text-4xl font-bold text-wood">{title}</h1>
      {lead && <p className="mt-2 text-giwa">{lead}</p>}
      {children}
    </div>
  );
}

/** 제목(h2) + 본문. 본문은 기본 글자색(text-giwa)과 문단 간격을 갖는다 */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="font-serif text-2xl font-bold">{title}</h2>
      <div className="mt-3 space-y-3 text-giwa">{children}</div>
    </section>
  );
}

/** 섹션 안 글머리표 목록 */
export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5">
      {items.map((it, i) => <li key={i}>{it}</li>)}
    </ul>
  );
}
