import type { reviewSummary } from "@/server/reviews/service";
import Stars from "./Stars";

type Summary = Awaited<ReturnType<typeof reviewSummary>>;

export default function ReviewSummaryCard({ s }: { s: Summary }) {
  if (s.count === 0) return null;
  return (
    <div className="grid gap-6 rounded-lg border border-line bg-white/70 p-5 md:grid-cols-[10rem_1fr_1fr]">
      <div className="text-center">
        <div className="font-serif text-5xl font-bold text-wood">{s.average.toFixed(1)}</div>
        <Stars value={s.average} className="text-xl" />
        <div className="mt-1 text-xs text-giwa">후기 {s.count}개</div>
      </div>
      <div className="space-y-1 text-xs">
        {[5, 4, 3, 2, 1].map((n) => (
          <div key={n} className="flex items-center gap-2">
            <span className="w-6 text-giwa">{n}점</span>
            <span className="h-2 flex-1 overflow-hidden rounded bg-line"><span className="block h-full bg-amber-600" style={{ width: `${(s.distribution[n] / s.count) * 100}%` }} /></span>
            <span className="w-6 text-right text-giwa">{s.distribution[n]}</span>
          </div>
        ))}
      </div>
      {s.details.length > 0 && (
        <dl className="grid grid-cols-2 content-start gap-x-4 gap-y-1 text-sm">
          {s.details.map((d) => <div key={d.key} className="flex justify-between"><dt className="text-giwa">{d.label}</dt><dd className="font-medium">{d.average.toFixed(1)}</dd></div>)}
        </dl>
      )}
    </div>
  );
}
