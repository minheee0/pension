// 사이트 공통 값. ★ "(입력 필요)" 표시는 사장님 정보로 교체하세요.
// 요금·인원 규칙은 나중에 DB(policy_settings)에서 읽도록 바꿉니다. 지금은 안내 문구용 값입니다.
export const SITE = {
  name: "만복",
  tagline: "한옥 한 채, 오직 한 팀만을 위한 온전한 쉼",
  region: "",                       // 비워 두면 홈 화면에 지역을 표시하지 않습니다
  address: "(주소 입력 필요)",
  phone: "(전화번호 입력 필요)",
  checkIn: "16:00",
  checkOut: "12:00",
  baseGuests: 4,
  maxGuests: 6,
  extraPersonFee: 10000,
  business: {
    owner: "(대표자명)",
    bizNo: "(사업자등록번호)",
    ecommerceNo: "(통신판매업 신고번호)",
    lodgingNo: "(숙박업 등록번호)",
  },
};

/**
 * 빈 칸("사진 자리", "영상 자리", "(입력 필요)", 후기 0개 안내)을 보여 줄지.
 * 내 컴퓨터(npm run dev)에서는 어디에 무엇을 채워야 하는지 보이도록 표시하고,
 * 배포된 사이트(production)에서는 손님에게 미완성처럼 보이지 않게 숨긴다.
 */
export const SHOW_PLACEHOLDERS = process.env.NODE_ENV !== "production";
