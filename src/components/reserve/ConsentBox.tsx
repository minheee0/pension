"use client";

export interface Consent { terms: boolean; privacy: boolean; refund: boolean }
export const isAllAgreed = (c: Consent) => c.terms && c.privacy && c.refund;

const link = "underline underline-offset-2 text-wood";

/** 예약 동의: 이용약관 · 개인정보 수집·이용 · 취소·환불 규정 (모두 필수). '전체 동의'로 한 번에 선택할 수 있다. */
export default function ConsentBox({ value, onChange }: { value: Consent; onChange: (c: Consent) => void }) {
  const all = isAllAgreed(value);
  const box = "mt-1";
  return (
    <fieldset className="mt-5 space-y-2 text-sm">
      <legend className="sr-only">약관 동의</legend>
      <label className="flex items-start gap-2 font-medium">
        <input type="checkbox" className={box} checked={all} onChange={(e) => onChange({ terms: e.target.checked, privacy: e.target.checked, refund: e.target.checked })} />
        <span>전체 동의</span>
      </label>
      <div className="space-y-2 border-t border-line pt-2">
        <label className="flex items-start gap-2">
          <input type="checkbox" className={box} checked={value.terms} onChange={(e) => onChange({ ...value, terms: e.target.checked })} />
          <span>(필수) <a href="/terms" target="_blank" rel="noopener noreferrer" className={link}>이용약관</a>에 동의합니다.</span>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" className={box} checked={value.privacy} onChange={(e) => onChange({ ...value, privacy: e.target.checked })} />
          <span>(필수) <a href="/privacy" target="_blank" rel="noopener noreferrer" className={link}>개인정보 수집·이용</a>에 동의합니다. 이름·휴대폰 번호 등을 예약 처리와 결제, 이용 안내를 위해 사용합니다.</span>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" className={box} checked={value.refund} onChange={(e) => onChange({ ...value, refund: e.target.checked })} />
          <span>(필수) 위 취소·환불 규정을 확인했으며 동의합니다.</span>
        </label>
      </div>
    </fieldset>
  );
}
