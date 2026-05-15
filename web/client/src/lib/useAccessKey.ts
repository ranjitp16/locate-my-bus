import { useEffect, useState } from 'react';

const STORAGE_KEY = 'dash-access-key';

// Persists the dashboard access key in sessionStorage so it survives
// navigation between /dash/* pages within the same tab session.
export function useAccessKey(): [string, (v: string) => void] {
  const [accessKey, setAccessKey] = useState<string>(() =>
    typeof window === 'undefined' ? '' : window.sessionStorage.getItem(STORAGE_KEY) ?? ''
  );
  useEffect(() => {
    if (accessKey) window.sessionStorage.setItem(STORAGE_KEY, accessKey);
    else window.sessionStorage.removeItem(STORAGE_KEY);
  }, [accessKey]);
  return [accessKey, setAccessKey];
}
