/** Halo's mark: a halo ring around the line, with two radio arcs. */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M45.8 10A26 26 0 0 1 58 31.1" stroke="currentColor" strokeWidth="4" strokeLinecap="round" opacity="0.5" />
      <path d="M18.2 54A26 26 0 0 1 6 32.9" stroke="currentColor" strokeWidth="4" strokeLinecap="round" opacity="0.5" />
      <circle cx="32" cy="32" r="15" stroke="currentColor" strokeWidth="5" />
      <circle cx="32" cy="32" r="6" fill="currentColor" />
    </svg>
  );
}
