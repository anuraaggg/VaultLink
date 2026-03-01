type VaultMarkProps = {
  className?: string;
};

export default function VaultMark({ className = "h-9 w-9" }: VaultMarkProps) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex items-center justify-center rounded-xl border border-neutral-700 bg-black/70 text-neutral-100 ${className}`}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4.5 5.5L10.5 18.5C11.1 19.8 12.9 19.8 13.5 18.5L19.5 5.5" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8.75 5.5L12 12.75L15.25 5.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="opacity-70" />
      </svg>
    </span>
  );
}