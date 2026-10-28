// 토스 테스트 키로 운영하는 동안(오픈 전) 모든 손님 화면 위에 표시한다. 실결제 키(live_)로 바꾸면 자동으로 사라진다.
export default function DemoBanner() {
  if (process.env.TOSS_CLIENT_KEY?.startsWith("live_")) return null;
  return (
    <div className="bg-giwa px-5 py-2 text-center text-xs text-hanji">
      오픈 준비 중인 펜션의 <b>테스트 운영</b> 사이트입니다 · 결제는 테스트 모드라 실제로 청구되지 않습니다
    </div>
  );
}
