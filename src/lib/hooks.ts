'use client';

/** Small client-side hooks that are about the UI, not about game rules. */
import { useEffect, useState } from 'react';

/**
 * Delay a rapidly-changing value.
 *
 * Used for quote requests and search fields: the server should see one call when the
 * player stops typing, not one per keystroke.
 */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Persist a UI preference (a sort order, a filter) for the session. */
export function useStickyState<T extends string>(key: string, initial: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return initial;
    const stored = window.sessionStorage.getItem(key);
    return (stored as T | null) ?? initial;
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(key, value);
  }, [key, value]);
  return [value, setValue];
}
