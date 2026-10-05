import { useEffect, useState } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';

export function useTheme(): [ThemePref, (t: ThemePref) => void, 'light' | 'dark'] {
  const [pref, setPref] = useState<ThemePref>(() => { try { return (localStorage.getItem('agora-theme') as ThemePref) || 'system'; } catch { return 'system'; } });
  const [sys, setSys] = useState<'light' | 'dark'>(() => (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSys(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const resolved = pref === 'system' ? sys : pref;
  useEffect(() => {
    const el = document.documentElement;
    if (pref === 'system') el.removeAttribute('data-theme'); else el.setAttribute('data-theme', pref);
    el.dataset.resolvedTheme = resolved;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#0f0f0e' : '#f2f1ec');
    try { localStorage.setItem('agora-theme', pref); } catch { /* armazenamento indisponível */ }
  }, [pref, resolved]);
  return [pref, setPref, resolved];
}
