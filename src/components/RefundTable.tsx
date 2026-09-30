import type { PolicyView } from "@/server/refund/table";

const fmt = (d: string) => d.replace(/-/g, ".");

export default function RefundTable({ view }: { view: PolicyView }) {
  const { table } = view;
  return (
    <div className="text-sm">
      {!view.confirmed && (
        <p className="mb-3 rounded border border-red-800/30 bg-red-50 p-2 text-red-800">
          ※ 개발 중 임시 규정입니다. 오픈 전에 확정 후 게시됩니다.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] border-collapse text-center">
          <caption className="pb-2 text-left text-giwa">체크인 날짜 기준 취소 시점별 환불 비율(객실 요금)</caption>
          <thead>
            <tr className="bg-line/60">
              <th className="border border-line p-2">취소 시점</th>
              {table.columns.map((c) => <th key={c.label} className="border border-line p-2">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r, i) => (
              <tr key={r.minDays}>
                <th className="border border-line p-2 font-medium">{r.label}</th>
                {table.columns.map((c) => (
                  <td key={c.label} className="border border-line p-2">
                    {c.refundRates[i] === null ? "확인 필요" : `${c.refundRates[i]}%`}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="mt-3 list-disc space-y-1 pl-5 text-giwa">
        <li>체크인 {view.checkInTime} / 체크아웃 {view.checkOutTime}. 취소 시점은 한국시간 날짜(자정) 기준으로 계산합니다.</li>
        <li>연박이 요금 유형이 다른 날(주중·주말·성수기)에 걸치면 박별 요금에 각각의 환불 비율을 적용합니다.</li>
        <li>추가 인원 요금은 객실 요금과 같은 비율로 환불됩니다.</li>
        <li>체크인 당일 {view.noShowTime}까지 연락 없이 오지 않으면 당일 취소로 처리합니다.</li>
        {view.options.length > 0 && (
          <li>
            유료 옵션({view.options.map((o) => o.name).join(", ")})은 이용 {view.options[0].deadlineDaysBefore}일 전 {view.options[0].deadlineTime}까지
            취소하면 전액 환불되며, 이후 취소·미사용은 환불되지 않습니다.
          </li>
        )}
        <li>사업자 사정으로 예약을 이행하지 못하는 경우 전액 환불됩니다.</li>
        <li>날짜 변경은 비수기 {view.freeChangeDaysOff}일 전, 성수기 {view.freeChangeDaysPeak}일 전까지 1회 무료입니다(예약 가능 시).</li>
      </ul>

      <p className="mt-3 font-medium">성수기 기간</p>
      {view.seasons.length === 0 ? (
        <p className="text-giwa">현재 등록된 성수기 기간이 없습니다.</p>
      ) : (
        <ul className="list-disc pl-5 text-giwa">
          {view.seasons.map((s) => <li key={s.name + s.dateFrom}>{s.name}: {fmt(s.dateFrom)} ~ {fmt(s.dateTo)}</li>)}
        </ul>
      )}
    </div>
  );
}
