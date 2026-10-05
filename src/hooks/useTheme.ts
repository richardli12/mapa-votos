import { useCallback, useState } from 'react';

export type ThemePref = 'light' | 'dark';

/** Aplica o tema no <html> imediatamente — a paleta do mapa é lida logo em seguida, no mesmo render. */
function apply(t: ThemePref) {
  const el = document.documentElement;
  el.setAttribute('data-theme', t);
  el.dataset.resolvedTheme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#111720' : '#DBE2E9');
  try { localStorage.setItem('radar-theme', t); } catch { /* armazenamento indisponível */ }
}

/** Tema padrão: claro, no Blue-Grey #DBE2E9 da Triad3 (independe do tema do sistema operacional). */
export function useTheme(): [ThemePref, (t: ThemePref) => void, ThemePref] {
  const [pref, setPref] = useState<ThemePref>(() => {
    let t: ThemePref = 'light';
    try { if (localStorage.getItem('radar-theme') === 'dark') t = 'dark'; } catch { /* sem armazenamento */ }
    apply(t);
    return t;
  });
  const set = useCallback((t: ThemePref) => { apply(t); setPref(t); }, []);
  return [pref, set, pref];
}
