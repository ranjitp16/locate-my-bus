import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const get = () => (typeof window === 'undefined' ? false : window.matchMedia(query).matches);
  const [matches, setMatches] = useState(get);

  useEffect(() => {
    const mql = window.matchMedia(query);
    // Sync once in case the SSR-safe initializer was wrong, then listen.
    setMatches(mql.matches);
    const onChange = () => setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

export const DESKTOP_BREAKPOINT = '(min-width: 900px)';

export function useIsDesktop(): boolean {
  return useMediaQuery(DESKTOP_BREAKPOINT);
}
