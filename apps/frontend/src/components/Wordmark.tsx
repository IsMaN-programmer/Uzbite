import { useId } from 'react';

export function Wordmark({ withIcon = false, className = '' }: { withIcon?: boolean; className?: string }) {
  const maskId = useId();
  return <span className={`wordmark ${withIcon ? 'wordmark--with-icon' : ''} ${className}`}>
    {withIcon && <svg className="wordmark-symbol" viewBox="0 0 48 48" aria-hidden="true">
      <defs><mask id={maskId}><rect width="48" height="48" fill="white"/><circle cx="24" cy="24" r="13" fill="black"/><circle cx="34" cy="5" r="7" fill="black"/><circle cx="40" cy="13" r="5" fill="black"/><circle cx="45" cy="20" r="6" fill="black"/></mask></defs>
      <circle cx="24" cy="24" r="22" fill="currentColor" mask={`url(#${maskId})`}/>
    </svg>}
    <span>Uz<span className="wordmark-bite">Bite</span></span>
  </span>;
}
