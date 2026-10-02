// 은행 코드: 토스는 요청·응답에 두 자리 코드를 권장하고, 응답에는 세 자리(금융결제원) 코드가 올 수도 있다.
export interface Bank { code: string; official: string; name: string }
export const BANKS: Bank[] = [
  { code: "06", official: "004", name: "KB국민은행" }, { code: "88", official: "088", name: "신한은행" },
  { code: "20", official: "020", name: "우리은행" }, { code: "81", official: "081", name: "하나은행" },
  { code: "11", official: "011", name: "NH농협은행" }, { code: "03", official: "003", name: "IBK기업은행" },
  { code: "90", official: "090", name: "카카오뱅크" }, { code: "92", official: "092", name: "토스뱅크" },
  { code: "89", official: "089", name: "케이뱅크" }, { code: "31", official: "031", name: "iM뱅크(대구)" },
  { code: "32", official: "032", name: "부산은행" }, { code: "34", official: "034", name: "광주은행" },
  { code: "37", official: "037", name: "전북은행" }, { code: "35", official: "035", name: "제주은행" },
  { code: "39", official: "039", name: "경남은행" }, { code: "07", official: "007", name: "Sh수협은행" },
  { code: "71", official: "071", name: "우체국예금보험" }, { code: "45", official: "045", name: "새마을금고" },
  { code: "48", official: "048", name: "신협" }, { code: "23", official: "023", name: "SC제일은행" },
  { code: "27", official: "027", name: "씨티은행" }, { code: "02", official: "002", name: "KDB산업은행" },
  { code: "64", official: "064", name: "산림조합" }, { code: "12", official: "012", name: "단위농협(지역농축협)" },
];
export const bankName = (code?: string | null) =>
  BANKS.find((b) => b.code === code || b.official === code)?.name ?? (code ? `은행(${code})` : "");
