/** エメラルド（ゲーム内通貨）のアイコンと所持数 */
export function EmeraldIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="emerald-icon">
      <path d="M7 3h10l5 6-10 12L2 9z" fill="#2ecc71" stroke="#0e6b3a" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M2 9h20M7 3l5 18M17 3l-5 18M7 3 9 9l3-6 3 6 2-6" fill="none" stroke="#0e6b3a" strokeWidth="1" strokeLinejoin="round" opacity="0.6" />
      <path d="M8 5h3l-1.5 3z" fill="#c8ffdf" opacity="0.8" />
    </svg>
  );
}

export function Emeralds({ n, size }: { n: number | string; size?: number }) {
  return (
    <span className="emeralds">
      <EmeraldIcon size={size} />
      <b>{n}</b>
    </span>
  );
}
