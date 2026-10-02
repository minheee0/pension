// 휴대폰 번호 입력 보조 (브라우저·서버 공용). 예약 화면과 같은 규칙: 숫자만, 최대 11개, 하이픈 자동.
export const sanitizePhone = (raw: string) => {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("82")) d = "0" + d.slice(2);
  return d.slice(0, 11);
};
export const formatPhone = (raw: string) => {
  const d = sanitizePhone(raw);
  if (d.length <= 3) return d;
  if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
};
export const PHONE_OK = /^01[016789]\d{8}$/;
