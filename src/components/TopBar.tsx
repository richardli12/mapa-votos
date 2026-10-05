import { useEffect, useMemo, useRef, useState } from 'react';
import { normalizeText, titleCase } from '../../shared/format';
import { UFS } from '../../shared/ufs';
import type { ThemePref } from '../hooks/useTheme';
import { useApp } from '../state';
import { Avatar } from './ui';

export function Logo() {
  return (
    <a className="logo" href="#/" aria-label="ÁGORA 26 — início">
      <svg viewBox="0 0 64 64" width="30" height="30" aria-hidden>
        <defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="var(--brand-a)" /><stop offset="1" stopColor="var(--brand-b)" /></linearGradient></defs>
        <path d="M32 6 L58 56 H45 L32 30 L19 56 H6 Z" fill="url(#lg)" />
        <rect x="23" y="44" width="18" height="6" rx="3" fill="currentColor" />
      </svg>
      <span className="logo-word">ÁGORA<b>26</b></span>
    </a>
  );
}

interface Hit { kind: 'uf' | 'mu' | 'cand'; key: string; label: string; sub: string; act: () => void; color?: number; photo?: string | null }

function Search() {
  const { muniList, cands, go } = useApp();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if ((e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) { e.preventDefault(); ref.current?.focus(); setOpen(true); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  const hits = useMemo<Hit[]>(() => {
    const n = normalizeText(q);
    if (n.length < 2) return [];
    const out: Hit[] = [];
    for (const u of UFS) if (normalizeText(u.name).includes(n) || u.uf === n) out.push({ kind: 'uf', key: u.uf, label: u.name, sub: `Estado · ${u.uf.toUpperCase()}`, act: () => go({ uf: u.uf, mu: undefined, det: undefined }) });
    for (const c of cands.values()) if (normalizeText(c.name).includes(n) || c.number === q.trim()) out.push({ kind: 'cand', key: c.id, label: titleCase(c.name), sub: `${c.party} · ${c.number}`, color: c.color, photo: c.photo, act: () => go({ cand: c.id }) });
    const mus = muniList
      .map((mu) => { const nm = normalizeText(mu.name); return { mu, nm, score: nm === n ? 0 : nm.startsWith(n) ? 1 : n.length > 3 && nm.includes(n) ? 2 : 9 }; })
      .filter((x) => x.score < 9)
      .sort((a, b) => a.score - b.score || Number(b.mu.capital) - Number(a.mu.capital) || a.nm.length - b.nm.length || a.nm.localeCompare(b.nm))
      .slice(0, 12);
    for (const { mu } of mus) {
      out.push({ kind: 'mu', key: mu.code, label: titleCase(mu.name), sub: `Município · ${mu.uf.toUpperCase()}${mu.capital ? ' · capital' : ''}`, act: () => go({ uf: mu.uf, mu: mu.code, det: undefined }) });
    }
    return out.slice(0, 18);
  }, [q, muniList, cands, go]);

  const choose = (h: Hit) => { h.act(); setQ(''); setOpen(false); ref.current?.blur(); };

  return (
    <div className="search">
      <span className="search-icon" aria-hidden>⌕</span>
      <input ref={ref} value={q} placeholder="Buscar município, estado ou candidato…" aria-label="Buscar"
        onChange={(e) => { setQ(e.target.value); setOpen(true); setIdx(0); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(hits.length - 1, i + 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
          if (e.key === 'Enter' && hits[idx]) choose(hits[idx]);
          if (e.key === 'Escape') { setOpen(false); ref.current?.blur(); }
        }} />
      <kbd className="search-kbd">/</kbd>
      {open && hits.length > 0 && (
        <ul className="search-pop" role="listbox">
          {hits.map((h, i) => (
            <li key={h.kind + h.key} role="option" aria-selected={i === idx} className={i === idx ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); choose(h); }} onMouseEnter={() => setIdx(i)}>
              {h.kind === 'cand' ? <Avatar name={h.label} photo={h.photo} color={h.color ?? -1} size={26} /> : <span className={`search-kind ${h.kind}`}>{h.kind === 'uf' ? 'UF' : 'MUN'}</span>}
              <span className="search-label">{h.label}<small>{h.sub}</small></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TopBar({ theme, setTheme }: { theme: ThemePref; setTheme: (t: ThemePref) => void }) {
  const { meta, isDemo, result } = useApp();
  const verified = result.data?.verified;
  return (
    <header className="topbar">
      <Logo />
      <Search />
      <div className="topbar-right">
        {meta && (
          <span className={`source-pill ${isDemo ? 'demo' : 'live'}`} title={meta.sourceLabel}>
            <i className="dot" />{isDemo ? 'SIMULAÇÃO' : 'AO VIVO'}
            <small>{isDemo ? 'dados fictícios' : result.data?.source === 'tse' ? 'TSE' : result.data?.source === 'bp' ? 'Brasil Paralelo' : meta.sourceLabel}</small>
            {!isDemo && verified && <b className="verified" title="Assinatura digital do TSE verificada">✓ assinado</b>}
          </span>
        )}
        <button className="icon-btn" aria-label="Alternar tema" title="Tema: sistema → claro → escuro"
          onClick={() => setTheme(theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system')}>
          {theme === 'system' ? '◐' : theme === 'light' ? '☀' : '☾'}
        </button>
      </div>
    </header>
  );
}
