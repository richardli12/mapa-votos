import { useState, type ReactNode } from 'react';
import { fmtPct } from '../../shared/format';

export const slotVar = (slot: number) => (slot >= 0 && slot < 8 ? `var(--s${slot})` : 'var(--other)');

export function initials(name: string): string {
  const parts = name.replace(/^(DOUTORA?|PROFESSORA?|CORONEL|DELEGADA?|SARGENTO|COMANDANTE|ENGENHEIRO|ENFERMEIRA|VEREADORA|ESCRITOR|PASTORA?|CAPIT[ÃA]O)\s+/i, '').split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function Avatar({ name, photo, color, size = 40, elected }: { name: string; photo?: string | null; color: number; size?: number; elected?: boolean }) {
  const [failed, setFailed] = useState(false);
  const show = photo && !failed;
  return (
    <span className={`avatar ${elected ? 'is-elected' : ''}`} style={{ width: size, height: size, ['--c' as string]: slotVar(color), fontSize: size * 0.36 }}>
      {show ? <img src={photo!} alt="" loading="lazy" onError={() => setFailed(true)} /> : <span aria-hidden>{initials(name)}</span>}
    </span>
  );
}

export function StatusBadge({ status, projected, size }: { status?: string; projected?: boolean; size?: 'sm' }) {
  if (!status && !projected) return null;
  if (!status && projected) return <span className={`badge projected ${size ?? ''}`} title="Estaria eleito se a apuração terminasse agora"><i>◔</i>Projeção</span>;
  const s = status!;
  const cls = s.startsWith('Eleito') ? 'elected' : s.includes('2º turno') ? 'runoff' : s === 'Suplente' ? 'sub' : 'out';
  const icon = cls === 'elected' ? '✓' : cls === 'runoff' ? '↻' : cls === 'sub' ? '·' : '×';
  return <span className={`badge ${cls} ${size ?? ''}`}><i>{icon}</i>{s}</span>;
}

export function Bar({ pct, max = 100, color, height = 6 }: { pct: number; max?: number; color: string; height?: number }) {
  return (
    <span className="bar" style={{ height }} aria-hidden>
      <span style={{ width: `${Math.max(0, Math.min(100, (pct / (max || 1)) * 100))}%`, background: color }} />
    </span>
  );
}

export function Seg<T extends string>({ value, options, onChange, size, label }: { value: T; options: { id: T; label: ReactNode; title?: string; disabled?: boolean }[]; onChange: (v: T) => void; size?: 'sm'; label: string }) {
  return (
    <div className={`seg ${size ?? ''}`} role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} role="tab" aria-selected={o.id === value} className={o.id === value ? 'on' : ''} disabled={o.disabled} title={o.title} onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'warn' }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function PctText({ v, digits = 2 }: { v: number; digits?: number }) {
  return <span className="num">{fmtPct(v, digits)}</span>;
}

export function Card({ title, actions, children, className, sub }: { title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className ?? ''}`}>
      {(title || actions) && (
        <header className="card-head">
          <div>{title && <h2>{title}</h2>}{sub && <p className="card-sub">{sub}</p>}</div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function downloadCsv(name: string, rows: (string | number)[][]) {
  const csv = '﻿' + rows.map((r) => r.map((c) => { const s = String(c); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(';')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
