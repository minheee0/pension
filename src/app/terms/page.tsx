import type { Metadata } from "next";
import RefundTable from "@/components/RefundTable";
import { LegalShell, Ol, Sec } from "@/components/legal/Legal";
import { LEGAL } from "@/lib/legal";
import { SITE } from "@/lib/site";
import { getPolicyView } from "@/server/booking/policy";
import { pool } from "@/server/db";

export const metadata: Metadata = { title: "이용약관" };
export const dynamic = "force-dynamic";   // 요금·인원·환불 규정은 관리자 설정(DB)을 그대로 보여준다

async function loadSettings(): Promise<Map<string, string>> {
  try { return new Map((await pool.query(`select key, value from policy_settings`)).rows.map((r) => [r.key as string, r.value as string])); }
  catch { return new Map(); }
}
const num = (m: Map<string, string>, k: string, d: number) => { const n = Number(m.get(k)); return Number.isFinite(n) && n > 0 ? n : d; };
const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

const TOC: [string, string][] = [
  ["a1", "제1조 목적"], ["a2", "제2조 정의"], ["a3", "제3조 약관의 게시와 개정"], ["a4", "제4조 서비스의 내용"], ["a5", "제5조 예약의 성립"],
  ["a6", "제6조 요금"], ["a7", "제7조 결제"], ["a8", "제8조 이용 조건"], ["a9", "제9조 예약 취소와 환불"], ["a10", "제10조 이용자의 의무"],
  ["a11", "제11조 사업자의 의무"], ["a12", "제12조 면책"], ["a13", "제13조 후기"], ["a14", "제14조 개인정보 보호"], ["a15", "제15조 분쟁 해결"], ["biz", "사업자 정보"],
];

export default async function Terms() {
  const [view, s] = await Promise.all([getPolicyView(pool).catch(() => null), loadSettings()]);
  const base = num(s, "base_guests", SITE.baseGuests), max = num(s, "max_guests", SITE.maxGuests), extra = num(s, "extra_person_fee", SITE.extraPersonFee);
  const perNight = s.get("extra_fee_mode") === "per_night";
  const hold = num(s, "hold_minutes", 15), reviewDays = num(s, "member_review_days", 30);
  const inT = s.get("check_in_time") ?? SITE.checkIn, outT = s.get("check_out_time") ?? SITE.checkOut;
  const b = SITE.business;

  return (
    <LegalShell title="이용약관" version={LEGAL.termsVersion} toc={TOC}>
      <Sec id="a1" title="제1조 (목적)">
        <p>이 약관은 {SITE.name}(이하 “사업자”)이 운영하는 웹사이트(이하 “사이트”)에서 제공하는 독채 한옥 숙박의 예약·결제, 예약 조회·취소, 이용 후기 등의 서비스(이하 “서비스”)를 이용함에 있어 사업자와 이용자의 권리, 의무 및 책임사항을 정함을 목적으로 합니다.</p>
      </Sec>

      <Sec id="a2" title="제2조 (정의)">
        <Ol>
          <li>“이용자”란 이 약관에 따라 사이트에서 예약을 신청하거나 서비스를 이용하는 사람을 말합니다. 사이트는 회원가입 없이 이용하는 비회원 방식입니다.</li>
          <li>“예약”이란 이용자가 숙박 일정·인원·옵션을 선택하고 결제(또는 가상계좌 입금)를 완료하여 사업자가 확정하는 숙박 이용계약을 말합니다.</li>
          <li>“예약번호”란 예약 시 발급되는 번호로, 예약자의 휴대폰 번호와 함께 예약 조회·취소에 사용됩니다.</li>
          <li>“옵션”이란 바비큐, 찜질방 등 숙박과 함께 신청하는 유료 부가서비스를 말합니다.</li>
        </Ol>
      </Sec>

      <Sec id="a3" title="제3조 (약관의 게시와 개정)">
        <Ol>
          <li>사업자는 이 약관을 사이트 하단 등 이용자가 쉽게 볼 수 있는 곳에 게시합니다.</li>
          <li>사업자는 관련 법령을 위반하지 않는 범위에서 약관을 개정할 수 있으며, 개정 시 적용일자와 개정 사유를 밝혀 적용일 7일 전(이용자에게 불리하거나 중요한 변경은 30일 전)부터 사이트에 공지합니다.</li>
          <li>개정 약관은 적용일 이후 새로 체결하는 예약부터 적용합니다. 이미 확정된 예약에는 예약 당시의 약관과 환불 규정이 적용됩니다.</li>
          <li>이 약관에서 정하지 않은 사항은 관련 법령과 일반 상관례에 따릅니다.</li>
        </Ol>
      </Sec>

      <Sec id="a4" title="제4조 (서비스의 내용)">
        <Ol>
          <li>사업자는 다음 서비스를 제공합니다: ① 예약 가능 일정·요금 안내 ② 예약 신청과 결제 ③ 예약 조회·취소·환불 ④ 이용 후 후기 작성 ⑤ 그 밖에 사업자가 정하는 서비스</li>
          <li>숙소는 독채 1동이며, 예약하신 한 팀만 이용합니다. 다른 팀과 공유하지 않습니다.</li>
        </Ol>
      </Sec>

      <Sec id="a5" title="제5조 (예약의 성립)">
        <Ol>
          <li>이용자가 예약 정보를 입력하고 이 약관, 개인정보 수집·이용 안내, 취소·환불 규정에 동의한 뒤 결제를 완료하면 예약이 성립합니다.</li>
          <li>카드 등 즉시 결제 수단은 결제 승인이 완료된 때, 가상계좌는 입금이 확인된 때 예약이 확정됩니다.</li>
          <li>결제를 진행하는 동안 선택한 일정은 일정 시간(현재 {hold}분) 임시로 확보되며, 그 시간 안에 결제가 완료되지 않으면 해제됩니다. 가상계좌는 발급 후 안내된 입금 기한까지 입금해야 하며, 기한이 지나면 예약이 자동으로 취소됩니다.</li>
          <li>결제 도중 같은 일정에 다른 예약이 먼저 확정되는 등 예약을 완료할 수 없게 된 경우, 결제하신 금액은 전액 자동으로 환불됩니다.</li>
        </Ol>
      </Sec>

      <Sec id="a6" title="제6조 (요금)">
        <Ol>
          <li>요금은 예약 화면에 표시되는 금액으로, 평일·주말·성수기·특정일 요금과 기준 인원({base}명) 초과 시 1인당 {won(extra)}의 추가 요금({perNight ? "1박마다" : "1회 숙박당 1회"}), 선택한 옵션 요금으로 구성됩니다. 결제 전 화면에 표시된 합계가 최종 결제 금액입니다.</li>
          <li>요금은 결제 시점의 금액으로 확정되며, 이후 요금이 변경되더라도 이미 확정된 예약의 금액에는 영향이 없습니다.</li>
        </Ol>
      </Sec>

      <Sec id="a7" title="제7조 (결제)">
        <Ol>
          <li>결제는 토스페이먼츠(주)가 제공하는 결제창을 통해 신용·체크카드, 간편결제, 가상계좌로 할 수 있습니다.</li>
          <li>가상계좌로 결제하는 경우 현금영수증(소득공제 또는 지출증빙)을 선택할 수 있으며, 발급에 필요한 번호는 결제창에서 입력합니다.</li>
          <li>카드번호 등 결제수단 정보는 결제창에서 결제대행사가 직접 처리하며, 사업자는 카드번호 전체 등을 수집·저장하지 않습니다.</li>
        </Ol>
      </Sec>

      <Sec id="a8" title="제8조 (이용 조건)">
        <Ol>
          <li>체크인은 {inT} 이후, 체크아웃은 {outT}까지입니다.</li>
          <li>기준 인원은 {base}명, 최대 인원은 {max}명입니다. 36개월 미만 영유아는 인원에 포함하지 않습니다. 안전과 시설 보호를 위해 최대 인원을 초과하여 입실할 수 없습니다.</li>
          <li>예약은 만 19세 이상의 성인만 할 수 있습니다.</li>
          <li>금연, 소음, 반려동물, 화기 사용 등 구체적인 이용 규칙은 사이트의 ‘이용안내’에 따르며, 이용자는 이를 지켜야 합니다.</li>
          <li>예약 변경(일정·인원 등)은 현재 문의를 통해 처리하며, 변경 가능 여부와 비용은 예약 상황과 제9조에 따라 안내합니다.</li>
        </Ol>
      </Sec>

      <Sec id="a9" title="제9조 (예약 취소와 환불)">
        <Ol>
          <li>이용자는 사이트의 ‘예약 조회’에서 예약번호와 휴대폰 번호로 본인 확인을 한 뒤 예약을 취소할 수 있습니다. 이용이 시작된 이후의 예약은 온라인으로 취소할 수 없으며 문의해 주셔야 합니다.</li>
          <li>환불 금액은 체크인 날짜를 기준으로 취소 시점에 따라 아래 표의 비율로 계산합니다. 예약 당시 안내된 환불 규정이 그 예약에 적용되며, 이후 규정이 바뀌어도 이미 확정된 예약에는 영향이 없습니다.</li>
        </Ol>
        <div className="rounded-lg border border-line bg-white/60 p-4">
          {view ? <RefundTable view={view} /> : <p className="text-giwa">환불 규정을 불러오지 못했습니다. 이용안내 페이지에서 확인해 주세요.</p>}
        </div>
        <Ol>
          <li>사업자의 사정(시설 문제 등)으로 이용이 불가능하거나 사업자가 예약을 취소하는 경우에는 결제 금액 전액을 환불합니다.</li>
          <li>환불은 결제하신 수단으로 처리합니다. 카드는 승인 취소로 처리되며 카드사에 따라 반영에 며칠 걸릴 수 있고, 가상계좌로 결제하신 경우에는 이용자가 알려 주신 환불 계좌로 입금합니다.</li>
          <li>천재지변, 감염병 확산 등으로 숙박이 불가능한 경우에는 관련 법령 및 소비자분쟁해결기준에 따라 처리합니다.</li>
        </Ol>
      </Sec>

      <Sec id="a10" title="제10조 (이용자의 의무)">
        <Ol>
          <li>이용자는 허위 정보로 예약하거나 타인의 정보를 도용해서는 안 됩니다.</li>
          <li>이용자는 시설과 비품을 소중히 사용해야 하며, 이용자의 고의 또는 과실로 시설·비품이 훼손된 경우 그 손해를 배상해야 합니다.</li>
          <li>이용자가 이용 규칙을 중대하게 위반하여 다른 이용자나 이웃, 시설의 안전을 해치는 경우 사업자는 이용 중단을 요청할 수 있으며, 이 경우 환불은 관련 법령 및 소비자분쟁해결기준에 따릅니다.</li>
        </Ol>
      </Sec>

      <Sec id="a11" title="제11조 (사업자의 의무)">
        <Ol>
          <li>사업자는 안전하고 쾌적한 숙박 시설을 제공하고 예약된 서비스를 성실히 이행합니다.</li>
          <li>사업자는 이용자의 개인정보를 개인정보처리방침에 따라 보호합니다.</li>
          <li>사업자는 이용자의 정당한 의견이나 불만을 신속하게 처리합니다.</li>
        </Ol>
      </Sec>

      <Sec id="a12" title="제12조 (면책)">
        <Ol>
          <li>사업자는 천재지변, 정전, 통신 장애 등 불가항력으로 인하여 서비스를 제공할 수 없는 경우 그에 대한 책임이 면제됩니다. 다만 환불은 제9조에 따릅니다.</li>
          <li>사업자는 이용자의 귀책사유로 인한 서비스 이용의 장애에 대해 책임지지 않습니다. 다만 사업자의 고의 또는 과실이 있는 경우에는 그러하지 아니합니다.</li>
        </Ol>
      </Sec>

      <Sec id="a13" title="제13조 (후기)">
        <Ol>
          <li>후기는 예약번호와 휴대폰 번호로 본인 확인이 된, 숙박 이용을 마친 예약자가 체크아웃 후 {reviewDays}일 이내에 예약 1건당 1개 작성할 수 있습니다. 작성 후 7일 이내에는 수정할 수 있고, 삭제할 수 있습니다.</li>
          <li>후기에는 작성자 이름이 일부만 표시됩니다(예: 홍*동).</li>
          <li>다음에 해당하는 내용은 후기에 쓸 수 없으며, 전화번호·이메일·링크는 입력되지 않습니다: 욕설·비방, 허위 사실, 개인정보 노출, 광고·스팸, 타인의 저작권 침해.</li>
          <li>누구나 부적절한 후기를 신고할 수 있습니다. 신고가 접수되어도 후기가 자동으로 비공개되지는 않으며, 사업자가 내용을 확인해 위 기준에 해당하면 비공개 처리하고 그 사유를 기록합니다. 비공개 처리에 이의가 있으면 문의할 수 있습니다.</li>
          <li>비공개 처리된 후기는 분쟁 대응을 위해 사업자가 보관하며, 삭제를 원하시면 문의해 주세요.</li>
          <li>후기의 저작권은 작성자에게 있으며, 작성자는 사이트에 게시하는 데 필요한 범위에서 사업자에게 무상으로 이용을 허락합니다.</li>
        </Ol>
      </Sec>

      <Sec id="a14" title="제14조 (개인정보 보호)">
        <p>사업자는 이용자의 개인정보를 <a href="/privacy" className="underline">개인정보처리방침</a>에 따라 처리합니다.</p>
      </Sec>

      <Sec id="a15" title="제15조 (분쟁 해결)">
        <Ol>
          <li>사업자와 이용자 사이에 분쟁이 생기면 서로 협의하여 해결하도록 노력합니다. 문의: {SITE.phone}{LEGAL.contactEmail ? ` / ${LEGAL.contactEmail}` : ""}</li>
          <li>협의로 해결되지 않는 분쟁은 소비자분쟁해결기준(공정거래위원회 고시) 및 관련 법령에 따라 처리하며, 한국소비자원(국번 없이 1372) 등 분쟁조정기관의 도움을 받을 수 있습니다.</li>
          <li>사업자와 이용자 사이에 제기되는 소송은 민사소송법에서 정한 관할 법원에 제기합니다.</li>
        </Ol>
      </Sec>

      <Sec id="biz" title="사업자 정보">
        <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
          <dt className="text-giwa">상호</dt><dd>{SITE.name}</dd>
          <dt className="text-giwa">대표자</dt><dd>{b.owner}</dd>
          <dt className="text-giwa">주소</dt><dd>{SITE.address}</dd>
          <dt className="text-giwa">전화</dt><dd>{SITE.phone}</dd>
          <dt className="text-giwa">이메일</dt><dd>{LEGAL.contactEmail}</dd>
          <dt className="text-giwa">사업자등록번호</dt><dd>{b.bizNo}</dd>
          <dt className="text-giwa">통신판매업 신고번호</dt><dd>{b.ecommerceNo}</dd>
          <dt className="text-giwa">숙박업 등록번호</dt><dd>{b.lodgingNo}</dd>
        </dl>
        <p className="pt-3 text-sm text-giwa">부칙: 이 약관은 {LEGAL.effectiveDate}부터 시행합니다.</p>
      </Sec>
    </LegalShell>
  );
}
