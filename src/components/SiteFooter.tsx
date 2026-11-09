import Link from "next/link";
import Logo from "@/components/Logo";
import { isPlaceholder, LEGAL } from "@/lib/legal";
import { SHOW_PLACEHOLDERS, SITE } from "@/lib/site";

// 전자상거래법상 사업자 정보 표기 영역. 실제 값으로 교체 필요 (src/lib/site.ts, src/lib/legal.ts).
// 값이 아직 "(입력 필요)"인 항목은 배포 사이트에서 빼고, 남는 항목만 " · "로 잇는다. 한 줄이 통째로 비면 그 줄을 숨긴다.
const line = (items: [label: string, value: string][]) =>
  items.filter(([, v]) => v && (SHOW_PLACEHOLDERS || !isPlaceholder(v))).map(([k, v]) => (k ? `${k} ${v}` : v)).join(" · ");

export default function SiteFooter() {
  const b = SITE.business;
  const lines = [
    line([["", SITE.address], ["", SITE.phone], ["", LEGAL.contactEmail]]),
    line([["대표", b.owner], ["사업자등록번호", b.bizNo]]),
    line([["통신판매업", b.ecommerceNo], ["숙박업 등록", b.lodgingNo]]),
  ].filter(Boolean);
  return (
    <footer className="mt-24 bg-giwa text-sm text-hanji/80">
      <div className="mx-auto max-w-5xl space-y-1 px-5 py-10">
        <p className="pb-2"><Logo tone="light" /></p>
        {lines.map((l) => <p key={l}>{l}</p>)}
        <p className="flex gap-4 pt-3 text-xs">
          <Link href="/terms" className="inline-block py-2 underline underline-offset-2 hover:text-hanji">이용약관</Link>
          <Link href="/privacy" className="inline-block py-2 font-bold text-hanji underline underline-offset-2">개인정보처리방침</Link>
        </p>
      </div>
    </footer>
  );
}
