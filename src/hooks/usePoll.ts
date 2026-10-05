import { useCallback, useEffect, useRef, useState } from 'react';
import { getJson } from '../lib/api';

export interface Poll<T> { data: T | null; error: string | null; loading: boolean; stale: boolean; refresh: () => void; fetchedAt: number | null }

/** Busca uma URL e repete a cada `intervalMs`. Mantém o último dado enquanto carrega o próximo. */
export function usePoll<T>(url: string | null, intervalMs: number | null): Poll<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean; url: string | null; fetchedAt: number | null }>({ data: null, error: null, loading: false, url: null, fetchedAt: null });
  const [tick, setTick] = useState(0);
  const urlRef = useRef(url);
  urlRef.current = url;

  useEffect(() => {
    if (!url) { setState((s) => ({ ...s, data: null, url: null })); return; }
    const ctl = new AbortController();
    setState((s) => ({ ...s, loading: true }));
    getJson<T>(url, ctl.signal)
      .then((data) => { if (urlRef.current === url) setState({ data, error: null, loading: false, url, fetchedAt: Date.now() }); })
      .catch((e: Error) => { if (e.name !== 'AbortError' && urlRef.current === url) setState((s) => ({ ...s, error: e.message, loading: false })); });
    return () => ctl.abort();
  }, [url, tick]);

  useEffect(() => {
    if (!url || !intervalMs) return;
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') setTick((x) => x + 1); }, intervalMs);
    return () => window.clearInterval(id);
  }, [url, intervalMs]);

  const refresh = useCallback(() => setTick((x) => x + 1), []);
  return { data: state.data, error: state.error, loading: state.loading, stale: state.url !== url, refresh, fetchedAt: state.fetchedAt };
}
