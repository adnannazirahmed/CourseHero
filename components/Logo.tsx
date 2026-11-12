export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`logo ${className}`}>
      <svg viewBox="0 0 32 32" aria-hidden="true" className="logo-mark">
        <rect x="1.5" y="1.5" width="29" height="29" rx="9" fill="currentColor" />
        <path d="M21.5 11.2a6.7 6.7 0 1 0 0 9.6" fill="none" stroke="var(--paper)" strokeWidth="3.2" strokeLinecap="round" />
        <path d="M16.4 20.2v-8.4M12.7 16h7.4" stroke="var(--paper)" strokeWidth="1.5" strokeLinecap="round" opacity="0.75" />
      </svg>
      <span className="logo-word">
        Course<span className="logo-accent">Hero</span>
      </span>
    </span>
  );
}
