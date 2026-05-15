import { useEffect, useState } from 'react';

export type LandingTotals = {
  agencies: number;
  routes: number;
  busesLive: number;
  polls24h: number;
  errorRatePct: number | null;
  avgLatencyMs: number | null;
};

export type LandingAgency = {
  id: string;
  name: string;
  routes: number;
  busesLive: number;
  stale: boolean;
  errorRatePct: number | null;
  avgLatencyMs: number | null;
};

export type LandingData = { totals: LandingTotals; agencies: LandingAgency[] };

// Fetches /api/landing once on mount. Returns `null` until the response
// resolves so callers can show a loading skeleton vs. an empty state.
// A non-2xx response (or a parse failure) keeps `data` null so downstream
// callers never see a server-shaped error object as if it were
// LandingData.
export function useLandingData(refreshKey?: unknown): LandingData | null {
  const [data, setData] = useState<LandingData | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/landing')
      .then(async (r) => {
        if (!r.ok) throw new Error(`/api/landing → HTTP ${r.status}`);
        return (await r.json()) as LandingData;
      })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => console.error('landing data load failed', e));
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);
  return data;
}
