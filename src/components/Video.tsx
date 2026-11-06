/**
 * 영상 칸. src 가 있으면 재생 버튼으로 보는 영상(소리 포함)을, 없으면 "(영상 자리)" 자리표시를 보여 준다.
 *  - 영상 파일은 public/videos/ 에 둔다. 웹용으로 줄인 mp4(H.264, 가로 1280px 안팎, 10MB 이하)를 권장
 *  - poster: 재생 전에 보일 사진 (예: /images/stay/living.webp). 없으면 영상 첫 장면
 */
export default function Video({ label, src, poster, className = "" }: {
  label: string; src?: string; poster?: string; className?: string;
}) {
  if (src) {
    return (
      <video controls playsInline preload="metadata" poster={poster} aria-label={label}
        className={`w-full rounded-lg bg-ink object-cover ${className}`}>
        <source src={src} type="video/mp4" />
        영상을 재생할 수 없는 브라우저입니다.
      </video>
    );
  }
  return (
    <div className={`flex flex-col items-center justify-center gap-2 rounded-lg bg-gradient-to-br from-line to-[#c9b898] text-sm text-giwa/70 ${className}`}>
      <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-full bg-hanji/70 text-lg text-giwa">▶</span>
      {label} (영상 자리)
    </div>
  );
}
