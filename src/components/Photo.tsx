import Image from "next/image";

/**
 * 사진 칸. src 가 있으면 실제 사진(숙소 사진은 public/images/stay/…)을 칸 크기에 맞게 잘라 보여 주고,
 * 없으면 "(사진 자리)" 자리표시를 보여 준다. 칸의 크기·비율은 className(aspect-* 등)으로 정한다.
 */
export default function Photo({ label, src, className = "", sizes = "(max-width: 768px) 100vw, 50vw", priority = false }: {
  label: string; src?: string; className?: string; sizes?: string; priority?: boolean;
}) {
  if (src) {
    return (
      <div className={`relative overflow-hidden rounded-lg bg-line ${className}`}>
        <Image src={src} alt={label} fill sizes={sizes} priority={priority} className="object-cover" />
      </div>
    );
  }
  return (
    <div className={`flex items-center justify-center rounded-lg bg-gradient-to-br from-line to-[#c9b898] text-sm text-giwa/70 ${className}`}>
      {label} (사진 자리)
    </div>
  );
}
