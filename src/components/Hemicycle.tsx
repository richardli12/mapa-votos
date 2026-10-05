import { useState } from 'react';
import { fmtPct } from '../../shared/format';

export interface HemiPart { key: string; label: string; seats: number; color: string }

/** Hemiciclo parlamentar: cada ponto é uma cadeira, preenchido da esquerda para a direita. */
export function Hemicycle({ parts, total, majority = true, otherColor }: { parts: HemiPart[]; total: number; majority?: boolean; otherColor?: string }) {
  const [hover, setHover] = useState<string | null>(null);
  if (!total) return null;
  const W = 520, H = 280, cx = W / 2, cy = H - 14, R = 250, r0 = total > 300 ? 72 : total > 60 ? 88 : 110;
  // número de fileiras proporcional à quantidade de cadeiras
  const rows = Math.max(2, Math.min(18, Math.round(Math.sqrt(total / 2.6))));
  const ring = (R - r0) / rows;
  const radii = Array.from({ length: rows }, (_, i) => r0 + ring * (i + 0.5));
  const circ = radii.reduce((s, r) => s + r, 0);
  const perRow = radii.map((r) => Math.round((r / circ) * total));
  perRow[rows - 1] += total - perRow.reduce((s, n) => s + n, 0);
  const seats: { a: number; x: number; y: number }[] = [];
  radii.forEach((r, i) => {
    const n = perRow[i];
    for (let j = 0; j < n; j++) {
      const a = Math.PI - (n === 1 ? Math.PI / 2 : (j / (n - 1)) * Math.PI);
      seats.push({ a, x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) });
    }
  });
  seats.sort((p, q) => q.a - p.a);
  // Partidos sem cor própria (cinza = "outros") ficam juntos no fim do arco.
  const other = (p: HemiPart) => /other/.test(p.color) || p.color === otherColor;
  const ordered = [...parts.filter((p) => !other(p)), ...parts.filter(other)];
  const owner: HemiPart[] = [];
  for (const p of ordered) for (let i = 0; i < p.seats; i++) owner.push(p);
  const dot = Math.max(2.2, Math.min(9, ring * 0.42));
  const hp = parts.find((p) => p.key === hover);
  return (
    <div className="hemi">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Hemiciclo com ${total} cadeiras`}>
        {seats.map((s, i) => {
          const o = owner[i];
          return <circle key={i} cx={s.x} cy={s.y} r={dot} fill={o?.color ?? 'var(--map-empty)'} opacity={hover && o?.key !== hover ? 0.18 : 1}
            onPointerEnter={() => o && setHover(o.key)} onPointerLeave={() => setHover(null)} />;
        })}
        <text x={cx} y={cy - 26} textAnchor="middle" className="hemi-total">{hp ? hp.seats : total}</text>
        <text x={cx} y={cy - 6} textAnchor="middle" className="hemi-sub">{hp ? `${hp.label} · ${fmtPct((hp.seats / total) * 100, 1)}` : majority ? `maioria: ${Math.floor(total / 2) + 1}` : 'cadeiras'}</text>
      </svg>
    </div>
  );
}
