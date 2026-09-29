// 사진 자리표시. 실제 사진은 public/images 에 넣고 next/image 로 교체하세요.
export default function Photo({ label, className = "" }: { label: string; className?: string }) {
  return (
    <div className={`flex items-center justify-center rounded-lg bg-gradient-to-br from-line to-[#c9b898] text-sm text-giwa/70 ${className}`}>
      {label} (사진 자리)
    </div>
  );
}
