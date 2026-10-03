import type { Metadata } from "next";
import Link from "next/link";
import { pool } from "@/server/db";
import { getSales, kstMonth, MONTH_RE, type SalesTab } from "@/server/admin/sales";
import { requireAdminPage } from "@/server/admin/session";
import { Badge, PAY_KO, td, th, won } from "@/components/admin/ui";

export const metadata: Metadata = { title: "매출 내역" };

const TABS: SalesTab[] = ["payments", "refunds", "net", "nights"];
const shift = (m: string, n: number) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7); };
const when = (v: Date | string) => new Date(v).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" });

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ m?: string; tab?: string }> }) {
  await requireAdminPage();
  const sp = await searchParams;
  const thisMonth = await kstMonth(pool);
  const month = MONTH_RE.test(sp.m ?? "") ? sp.m! : thisMonth;
  const tab = (TABS as string[]).includes(sp.tab ?? "") ? (sp.tab as SalesTab) : "payments";
  const d = await getSales(pool, month, tab);
  const t = d.totals;
  const href = (m: string, tb: SalesTab) => `/admin/sales?m=${m}&tab=${tb}`;

  const Tab = ({ id, label, value, sub }: { id: SalesTab; label: string; value: string; sub?: string }) => (
    <Link href={href(month, id)} className={`block rounded border p-4 ${tab === id ? "border-wood bg-white ring-2 ring-wood/30" : "border-line bg-white/60 hover:border-wood"}`} aria-current={tab === id ? "page" : undefined}>
      <div className="text-giwa">{label}</div><div className="mt-1 text-xl font-bold">{value}</div>{sub && <div className="text-xs text-giwa">{sub}</div>}
    </Link>
  );

  // 순매출 탭: 결제(+)와 환불(−)을 시간순으로 한 줄로 합쳐 보여 준다
  const ledger = [
    ...d.payments.map((p: any) => ({ at: p.at, kind: "결제", sign: 1, amount: p.amount, no: p.booking_no, name: p.guest_name, memo: `${p.method ?? ""} · ${PAY_KO[p.status] ?? p.status}` })),
    ...d.refunds.map((r: any) => ({ at: r.at, kind: "환불", sign: -1, amount: r.amount, no: r.booking_no, name: r.guest_name, memo: r.reason ?? "" })),
  ].sort((a, b) => +new Date(b.at) - +new Date(a.at));

  return (
    <div className="space-y-5">
      <h1 className="font-serif text-2xl font-bold text-wood">매출 내역</h1>
      <div className="flex items-center gap-4">
        <Link className="underline" href={href(shift(month, -1), tab)}>← 이전 달</Link>
        <b className="text-lg">{month}</b>
        {month < thisMonth ? <Link className="underline" href={href(shift(month, 1), tab)}>다음 달 →</Link> : <span className="text-giwa">(이번 달)</span>}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tab id="payments" label="결제 금액" value={won(t.paid)} sub={`${t.paidCount}건`} />
        <Tab id="refunds" label="환불 금액" value={won(t.refunded)} sub={`${t.refundedCount}건`} />
        <Tab id="net" label="순매출" value={won(t.net)} sub="결제 − 환불" />
        <Tab id="nights" label="예약된 박 수" value={`${t.bookedNights}박`} />
      </div>

      {tab === "payments" && (<>
        <p className="text-xs text-giwa">이 달에 결제된 내역입니다. 나중에 환불된 건도 결제 당시 금액으로 포함됩니다(환불은 [환불 금액]에서 차감).</p>
        <Table head={["결제 시각", "예약번호", "예약자", "수단", "상태", "금액"]} empty="이 달에 결제된 내역이 없습니다."
          rows={d.payments.map((p: any) => [when(p.at), <Link key="n" className="underline" href={`/admin/bookings/${p.booking_no}`}>{p.booking_no}</Link>, p.guest_name, p.method ?? "-", PAY_KO[p.status] ?? p.status, won(p.amount)])}
          foot={["합계", "", "", "", "", won(t.paid)]} />
      </>)}

      {tab === "refunds" && (<>
        <p className="text-xs text-giwa">이 달에 환불이 <b>완료된</b> 내역입니다. 지난달에 결제한 건의 환불도 환불이 완료된 달에 들어갑니다.</p>
        <Table head={["환불 시각", "예약번호", "예약자", "공제", "사유", "환불액"]} empty="이 달에 완료된 환불이 없습니다."
          rows={d.refunds.map((r: any) => [when(r.at), <Link key="n" className="underline" href={`/admin/bookings/${r.booking_no}`}>{r.booking_no}</Link>, r.guest_name, won(r.deduct_amount), r.reason ?? "-", won(r.amount)])}
          foot={["합계", "", "", "", "", won(t.refunded)]} />
      </>)}

      {tab === "net" && (<>
        <p className="text-xs text-giwa">결제(+)와 환불(−)을 시간순으로 합쳐 보여 줍니다. 합계가 순매출입니다.</p>
        <Table head={["시각", "구분", "예약번호", "예약자", "내용", "금액"]} empty="이 달 거래 내역이 없습니다."
          rows={ledger.map((x) => [when(x.at), <span key="k" className={x.sign < 0 ? "text-red-800" : ""}>{x.kind}</span>, <Link key="n" className="underline" href={`/admin/bookings/${x.no}`}>{x.no}</Link>, x.name, x.memo, <span key="a" className={x.sign < 0 ? "text-red-800" : ""}>{x.sign < 0 ? "−" : "+"}{won(x.amount)}</span>])}
          foot={["순매출", "", "", `결제 ${won(t.paid)}`, `환불 ${won(t.refunded)}`, won(t.net)]} />
      </>)}

      {tab === "nights" && (<>
        <p className="text-xs text-giwa">이 달에 걸쳐 있는 예약 확정 박(밤)입니다. 이용이 끝난 박도 포함합니다. 달력에서 보려면 <Link className="underline" href={`/admin/calendar?m=${month}`}>달력·차단</Link>으로 이동하세요.</p>
        <Table head={["날짜(밤)", "예약번호", "예약자", "상태", "박 요금"]} empty="이 달에 예약된 박이 없습니다."
          rows={d.nights.map((n: any) => [n.date, <Link key="n" className="underline" href={`/admin/bookings/${n.booking_no}`}>{n.booking_no}</Link>, n.guest_name, <Badge key="b" status={n.status} />, n.price != null ? won(n.price) : "-"])}
          foot={[`${t.bookedNights}박`, "", "", "", won(d.nights.reduce((s: number, n: any) => s + (n.price ?? 0), 0))]} />
      </>)}
    </div>
  );
}

function Table({ head, rows, foot, empty }: { head: string[]; rows: React.ReactNode[][]; foot: React.ReactNode[]; empty: string }) {
  if (rows.length === 0) return <p className="rounded border border-line bg-white p-4 text-giwa">{empty}</p>;
  return (
    <div className="overflow-x-auto"><table className="w-full min-w-[40rem] bg-white">
      <thead><tr>{head.map((h, i) => <th key={i} className={`${th} ${i === head.length - 1 ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={`${td} ${j === r.length - 1 ? "text-right" : ""}`}>{c}</td>)}</tr>)}</tbody>
      <tfoot><tr className="font-bold">{foot.map((c, i) => <td key={i} className={`border-t-2 border-line px-2 py-2 ${i === foot.length - 1 ? "text-right" : ""}`}>{c}</td>)}</tr></tfoot>
    </table></div>
  );
}
