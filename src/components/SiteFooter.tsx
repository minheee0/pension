import { SITE } from "@/lib/site";

// 전자상거래법상 사업자 정보 표기 영역. 실제 값으로 교체 필요.
export default function SiteFooter() {
  const b = SITE.business;
  return (
    <footer className="mt-24 bg-giwa text-sm text-hanji/80">
      <div className="mx-auto max-w-5xl space-y-1 px-5 py-10">
        <p className="font-serif text-lg text-hanji">{SITE.name}</p>
        <p>{SITE.address} · {SITE.phone}</p>
        <p>대표 {b.owner} · 사업자등록번호 {b.bizNo}</p>
        <p>통신판매업 {b.ecommerceNo} · 숙박업 등록 {b.lodgingNo}</p>
        <p className="pt-3 text-xs text-hanji/60">이용약관 · 개인정보처리방침 (준비 중)</p>
      </div>
    </footer>
  );
}
