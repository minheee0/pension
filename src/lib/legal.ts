// 약관·개인정보처리방침에 들어가는 값과 보유기간. ★ "(…입력 필요)" 는 사장님 정보로 교체하세요.
// 보유기간(RETENTION)은 방침 문구와 실제 파기 작업(src/server/privacy/purge.ts)이 같은 값을 쓰므로, 숫자를 바꾸면 둘 다 바뀝니다.
import { SITE } from "@/lib/site";

export const LEGAL = {
  termsVersion: "v1",                  // 약관을 바꿀 때 올립니다(v2…). 예약 시점에 동의한 버전이 예약에 기록됩니다.
  privacyVersion: "v1",
  effectiveDate: "(시행일 입력 필요)",    // 예: 2026년 11월 1일
  contactEmail: "(문의 이메일 입력 필요)",
  privacyOfficer: { name: "(보호책임자 성명 입력 필요)", title: "(직책 입력 필요)" },   // 소규모 사업자는 대표자가 겸할 수 있습니다
  hosting: { name: "(서버·DB 호스팅 업체명 입력 필요)" },
  overseas: "unknown" as "none" | "yes" | "unknown",   // 서버·DB·백업이 모두 국내면 "none", 해외면 "yes"
  overseasDetail: "(이전받는 자·국가·시기·항목 입력 필요)",
  sms: { name: "솔라피(SOLAPI)", company: "(운영 법인명 확인 필요)" },
  email: { name: "(이메일 발송 서비스명 입력 필요)" },
};

export const RETENTION = {
  bookingYears: 5,            // 결제가 완료된 예약·결제 기록: 전자상거래법 시행령 제6조(계약·결제 기록 5년)
  disputeYears: 3,            // 소비자 불만·분쟁 처리 기록: 같은 조(3년)
  unpaidDays: 30,             // 결제가 완료되지 않은 예약 정보
  accessLogDays: 30,          // 예약 조회 시도 기록(IP 등)
  notificationSentDays: 90,   // 알림 발송 기록
  notificationFailedDays: 180,
  adminLogYears: 1,           // 관리자 접속·처리 기록(개인정보 안전성 확보조치 기준: 1년 이상)
  paymentEventYears: 5,       // 결제사 통지 원문
} as const;

/** 아직 채워지지 않은 자리표시자 값인지 */
export const isPlaceholder = (v: string) => /^\(.*\)$/.test(v.trim()) || /입력 필요|확인 필요/.test(v);

/** 약관·방침 화면에 보이는 값 중 아직 채워지지 않은 항목 이름들 */
export function unresolvedPlaceholders(opts: { smsUsed?: boolean; emailUsed?: boolean } = {}): string[] {
  const out: string[] = [];
  const check = (label: string, v: string) => { if (isPlaceholder(v)) out.push(label); };
  check("주소", SITE.address); check("전화번호", SITE.phone);
  check("대표자명", SITE.business.owner); check("사업자등록번호", SITE.business.bizNo);
  check("통신판매업 신고번호", SITE.business.ecommerceNo); check("숙박업 등록번호", SITE.business.lodgingNo);
  check("시행일", LEGAL.effectiveDate); check("문의 이메일", LEGAL.contactEmail);
  check("개인정보 보호책임자 성명", LEGAL.privacyOfficer.name); check("개인정보 보호책임자 직책", LEGAL.privacyOfficer.title);
  check("호스팅 업체명", LEGAL.hosting.name);
  if (LEGAL.overseas === "unknown") out.push("국외 이전 여부");
  else if (LEGAL.overseas === "yes") check("국외 이전 내용", LEGAL.overseasDetail);
  if (opts.smsUsed) check("문자 발송 대행사 법인명", LEGAL.sms.company);
  if (opts.emailUsed) check("이메일 발송 서비스명", LEGAL.email.name);
  return out;
}

/** 환경변수 LEGAL_DOCS_CONFIRMED=true 로 확정하기 전에는 '임시 문안' 안내를 표시한다 */
export const legalDraft = () => process.env.LEGAL_DOCS_CONFIRMED !== "true";
