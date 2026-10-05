// Gera o PDF de um relatório no navegador (jsPDF + autotable), carregado só quando alguém pede o PDF.
// Fotos dos candidatos entram recortadas em círculo; o mapa de força é desenhado em vetor (nítido em qualquer zoom).
import { geoMercator, geoPath } from 'd3-geo';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { fmtPct } from '../../shared/format';
import { initials } from '../components/ui';
import { loadGeo } from './geo';
import { formatarCelula, nomeArquivo, type CapaCandidato, type ContextoRel, type MapaRel, type Pessoa, type Relatorio } from './relatorio';

type RGB = [number, number, number];
const INK: RGB = [24, 33, 46];
const MUTED: RGB = [100, 112, 128];
const LINE: RGB = [214, 221, 229];
const BAND: RGB = [219, 226, 233]; // Blue-Grey da marca (#DBE2E9)
const ZEBRA: RGB = [244, 247, 250];
const HEAD: RGB = [30, 42, 58];
const ALERTA: RGB = [190, 40, 40];
const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];
const SEM_VOTO: RGB = [228, 233, 239];
const SEM_DADO: RGB = [243, 245, 248];
const MM_PT = 72 / 25.4;

function rgb(cor: string | undefined, fallback: RGB): RGB {
  const s = cor?.trim() ?? '';
  const m = s.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) {
    const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
  }
  const r = s.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
  return r ? [Number(r[1]), Number(r[2]), Number(r[3])] : fallback;
}
const mix = (a: RGB, b: RGB, t: number): RGB => a.map((v, i) => Math.round(v + (b[i] - v) * Math.max(0, Math.min(1, t)))) as RGB;

/** As fontes padrão do PDF cobrem o Latin-1 (acentos do português); o resto vira equivalente simples. */
function pdfText(s: string): string {
  return s.replace(/[–—]/g, '-').replace(/…/g, '...').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/★/g, '*')
    .replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/g, '');
}

function quando(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
}

/** Ícone do radar (anéis + varredura), desenhado em vetor. */
function logo(doc: jsPDF, x: number, y: number, r: number) {
  doc.setFillColor(...HEAD); doc.circle(x, y, r, 'F');
  doc.setDrawColor(...BAND); doc.setLineWidth(0.35);
  doc.circle(x, y, r * 0.66, 'S'); doc.circle(x, y, r * 0.33, 'S');
  doc.setLineWidth(0.6); doc.line(x, y, x + r * 0.62, y - r * 0.5);
  doc.setFillColor(...BAND); doc.circle(x, y, r * 0.12, 'F');
}

// ——— Fotos ———

/** Baixa a foto e devolve um JPEG quadrado (enquadrado no rosto, para fotos 3×4 do TSE). */
async function carregarFoto(url: string, px: number): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) return null;
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = c.height = px;
    const g = c.getContext('2d');
    if (!g) return null;
    g.fillStyle = '#fff'; g.fillRect(0, 0, px, px);
    const s = Math.min(bmp.width, bmp.height);
    const sx = (bmp.width - s) / 2, sy = bmp.height > bmp.width ? (bmp.height - s) * 0.18 : (bmp.height - s) / 2;
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, sx, sy, s, s, 0, 0, px, px);
    bmp.close();
    return c.toDataURL('image/jpeg', 0.86);
  } catch {
    return null;
  }
}

async function carregarFotos(pedidos: { url: string; px: number }[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const fila = [...new Map(pedidos.map((p) => [p.url, p])).values()];
  let i = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (i < fila.length) {
      const p = fila[i++];
      const img = await carregarFoto(p.url, p.px);
      if (img) out.set(p.url, img);
    }
  }));
  return out;
}

/** Avatar redondo: foto recortada em círculo ou iniciais na cor do partido, com anel colorido. */
function avatar(doc: jsPDF, cx: number, cy: number, r: number, p: Pessoa, img: string | undefined, anel = true) {
  const cor = rgb(p.cor, [120, 132, 148]);
  if (img) {
    doc.saveGraphicsState();
    doc.circle(cx, cy, r, null);
    doc.clip();
    doc.discardPath();
    doc.addImage(img, 'JPEG', cx - r, cy - r, 2 * r, 2 * r, undefined, 'FAST');
    doc.restoreGraphicsState();
  } else {
    doc.setFillColor(...cor); doc.circle(cx, cy, r, 'F');
    doc.setTextColor(...WHITE); doc.setFont('helvetica', 'bold'); doc.setFontSize(r * MM_PT * 0.82);
    doc.text(pdfText(initials(p.nome)), cx, cy, { align: 'center', baseline: 'middle' });
  }
  if (anel) { doc.setDrawColor(...cor); doc.setLineWidth(Math.max(0.3, r * 0.075)); doc.circle(cx, cy, r, 'S'); }
}

// ——— Mapa de força ———

function classesForca(valores: number[], cor: RGB) {
  const max = Math.max(0.01, ...valores);
  const passos = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25];
  const passo = passos.find((s) => max / s <= 5) ?? 25;
  const quebras: number[] = [];
  for (let b = passo; b < max - 1e-9 && quebras.length < 5; b += passo) quebras.push(Number(b.toFixed(2)));
  const n = quebras.length + 1;
  const cores = Array.from({ length: n }, (_, i) => { const t = (i + 1) / n; return t <= 0.8 ? mix(WHITE, cor, 0.16 + (t / 0.8) * 0.84) : mix(cor, BLACK, (t - 0.8) * 1.3); });
  const classe = (v: number) => { let i = 0; while (i < quebras.length && v >= quebras[i]) i++; return i; };
  const f = (x: number) => fmtPct(x, x < 1 ? 1 : 0);
  const legenda = cores.map((c, i) => ({ cor: c, label: i === 0 ? `até ${f(quebras[0] ?? max)}` : i === quebras.length ? `${f(quebras[i - 1])}+` : `${f(quebras[i - 1])}–${f(quebras[i])}` }));
  return { cor: (v: number) => cores[classe(v)], legenda };
}

/** Desenha o mapa dentro da caixa (x, y, w, h); devolve a legenda. */
async function desenharMapa(doc: jsPDF, m: MapaRel, cor: RGB, x: number, y: number, w: number, h: number) {
  const feats = await loadGeo(m.geoKey);
  const fc = { type: 'FeatureCollection' as const, features: feats };
  const proj = geoMercator().fitExtent([[x, y], [x + w, y + h]], fc);
  const { cor: corDe, legenda } = classesForca(Object.values(m.valores).filter((v): v is number => v !== null && v > 0), cor);
  // contexto de desenho do d3 → operações de caminho do PDF (pontos muito próximos são descartados: arquivo leve)
  const tol = feats.length > 1500 ? 0.22 : 0.07;
  let ops: { op: string; c: number[] }[] = [];
  let lx = 0, ly = 0;
  const ctx = {
    moveTo(a: number, b: number) { ops.push({ op: 'm', c: [a, b] }); lx = a; ly = b; },
    lineTo(a: number, b: number) { if (Math.abs(a - lx) + Math.abs(b - ly) < tol) return; ops.push({ op: 'l', c: [a, b] }); lx = a; ly = b; },
    closePath() { ops.push({ op: 'h', c: [] }); },
    arc() { /* pontos não são desenhados */ },
  };
  const path = geoPath(proj, ctx as unknown as CanvasRenderingContext2D);
  doc.setDrawColor(...WHITE); doc.setLineWidth(feats.length > 1500 ? 0.04 : feats.length > 60 ? 0.1 : 0.25);
  for (const f of feats) {
    ops = [];
    path(f);
    if (ops.length < 3) continue;
    const v = m.valores[f.properties.code];
    doc.setFillColor(...(v === undefined || v === null ? SEM_DADO : v <= 0 ? SEM_VOTO : corDe(v)));
    doc.path(ops);
    doc.fillStroke();
  }
  return [{ cor: SEM_VOTO, label: 'sem votos' }, ...legenda];
}

// ——— Capa da ficha do candidato ———

async function desenharCapa(doc: jsPDF, cap: CapaCandidato, foto: string | undefined, W: number, M: number, y0: number): Promise<number> {
  const cor = rgb(cap.pessoa.cor, [74, 106, 138]);
  const H = 84;
  const mapW = cap.mapa ? 78 : 0;
  const mapX = W - M - mapW - 4;
  // fundo com a cor do partido bem clara e um filete forte à esquerda
  doc.setFillColor(...mix(WHITE, cor, 0.08)); doc.roundedRect(M, y0, W - 2 * M, H, 3, 3, 'F');
  doc.setFillColor(...cor); doc.roundedRect(M, y0, 2.2, H, 1.1, 1.1, 'F');

  // foto grande
  const r = 19;
  const cx = M + 8 + r, cy = y0 + 8 + r;
  doc.setFillColor(...WHITE); doc.circle(cx, cy, r + 1.6, 'F');
  avatar(doc, cx, cy, r, cap.pessoa, foto);
  if (cap.situacao) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
    const t = pdfText(cap.situacao.toUpperCase());
    const tw = doc.getTextWidth(t) + 6;
    doc.setFillColor(...cor); doc.roundedRect(cx - tw / 2, cy + r - 1.5, tw, 5.4, 2.7, 2.7, 'F');
    doc.setTextColor(...WHITE); doc.text(t, cx, cy + r + 1.2, { align: 'center', baseline: 'middle' });
  }

  // identificação
  const tx = cx + r + 8, tw = (cap.mapa ? mapX : W - M) - tx - 4;
  let y = y0 + 15;
  doc.setTextColor(...cor); doc.setFont('helvetica', 'bold'); doc.setFontSize(26);
  doc.text(pdfText(cap.numero), tx, y);
  y += 9;
  doc.setTextColor(...INK); doc.setFontSize(18);
  for (const l of (doc.splitTextToSize(pdfText(cap.pessoa.nome), tw) as string[]).slice(0, 2)) { doc.text(l, tx, y); y += 7; }
  if (cap.nomeCompleto) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED);
    doc.text((doc.splitTextToSize(pdfText(cap.nomeCompleto), tw) as string[])[0], tx, y - 2); y += 3.5;
  }
  // sigla em destaque; o nome do partido segue na mesma linha e quebra para as próximas
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...INK);
  const sigla = pdfText(cap.partido);
  doc.text(sigla, tx, y);
  if (cap.partidoNome) {
    const sw = doc.getTextWidth(`${sigla} `);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...MUTED);
    const linhas = doc.splitTextToSize(pdfText(`· ${cap.partidoNome}`), tw - sw) as string[];
    doc.text(linhas[0], tx + sw, y);
    const resto = linhas.slice(1).join(' ');
    if (resto) for (const l of (doc.splitTextToSize(resto, tw) as string[]).slice(0, 2)) { y += 4.4; doc.text(l, tx, y); }
  }
  y += 5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED);
  for (const extra of [cap.coligacao, ...(cap.chapa ?? [])].filter((x): x is string => !!x)) {
    for (const l of (doc.splitTextToSize(pdfText(extra), tw) as string[]).slice(0, 2)) { if (y > y0 + H - 4) break; doc.text(l, tx, y); y += 3.8; }
  }

  // mapa de força
  if (cap.mapa) {
    doc.setFillColor(...WHITE); doc.roundedRect(mapX, y0 + 4, mapW, H - 8, 2.5, 2.5, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(...MUTED);
    doc.text(pdfText(cap.mapa.titulo.toUpperCase()), mapX + 3, y0 + 8.6, { charSpace: 0.3 });
    try {
      const leg = await desenharMapa(doc, cap.mapa, cor, mapX + 3, y0 + 11, mapW - 6, H - 30);
      // legenda em duas linhas de quadradinhos
      const ly = y0 + H - 16.5, por = Math.ceil(leg.length / 2), lw = (mapW - 6) / por;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(5.8);
      leg.forEach((it, i) => {
        const lx = mapX + 3 + (i % por) * lw, yy = ly + Math.floor(i / por) * 4.6;
        doc.setFillColor(...it.cor); doc.setDrawColor(...LINE); doc.setLineWidth(0.1); doc.rect(lx, yy, 3, 3, 'FD');
        doc.setTextColor(...MUTED); doc.text(pdfText(it.label), lx + 4, yy + 2.4, { maxWidth: lw - 4.5 });
      });
    } catch {
      doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(...MUTED);
      doc.text('Mapa indisponível', mapX + mapW / 2, y0 + H / 2, { align: 'center' });
    }
  }
  y = y0 + H + 4;

  // números principais
  if (cap.kpis.length) {
    const n = cap.kpis.length, gap = 3, bw = (W - 2 * M - gap * (n - 1)) / n, bh = cap.kpis.some((k) => k.sub) ? 20 : 17;
    cap.kpis.forEach((k, i) => {
      const bx = M + i * (bw + gap);
      doc.setFillColor(...WHITE); doc.setDrawColor(...LINE); doc.setLineWidth(0.25); doc.roundedRect(bx, y, bw, bh, 2, 2, 'FD');
      doc.setFillColor(...cor); doc.rect(bx + 3, y + 3, 6, 0.8, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(6.3); doc.setTextColor(...MUTED);
      doc.text(pdfText(k.label.toUpperCase()), bx + 3, y + 7.2, { maxWidth: bw - 6 });
      doc.setFontSize(13); doc.setTextColor(...INK);
      doc.text(pdfText(k.valor), bx + 3, y + 13.2, { maxWidth: bw - 6 });
      if (k.sub) { doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...MUTED); doc.text(pdfText(k.sub), bx + 3, y + 17, { maxWidth: bw - 6 }); }
    });
    y += bh + 6;
  }
  if (cap.destaques?.length) {
    doc.setFontSize(8.5);
    let x = M;
    for (const d of cap.destaques) {
      const a = pdfText(`${d.label}: `), b = pdfText(d.valor);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...MUTED);
      const wa = doc.getTextWidth(a);
      doc.setFont('helvetica', 'bold');
      const wb = doc.getTextWidth(b);
      if (x + wa + wb > W - M && x > M) { x = M; y += 4.6; }
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...MUTED); doc.text(a, x, y);
      doc.setFont('helvetica', 'bold'); doc.setTextColor(...INK); doc.text(b, x + wa, y);
      x += wa + wb + 7;
    }
    y += 6;
  }
  return y;
}

// ——— Documento ———

export async function baixarPdf(rel: Relatorio, ctx: ContextoRel): Promise<void> {
  const colsPdf = rel.colunas;
  const paisagem = colsPdf.filter((c) => c.tipo !== 'foto').length > 7;
  const doc = new jsPDF({ orientation: paisagem ? 'landscape' : 'portrait', unit: 'mm', format: 'a4', compress: true });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const M = 12;
  const cor = rgb(rel.cor ?? rel.capa?.pessoa.cor, [74, 106, 138]);
  doc.setProperties({ title: pdfText(rel.titulo), subject: pdfText(`${ctx.cargo} · ${ctx.local}`), creator: 'Radar Eleições - Triad3', author: 'Radar Eleições - Triad3' });

  // fotos: capa em alta, resumo e tabela em miniatura (tabelas enormes: só as primeiras linhas)
  const temFoto = colsPdf.some((c) => c.tipo === 'foto');
  const pedidos = [
    ...(rel.capa?.pessoa.foto ? [{ url: rel.capa.pessoa.foto, px: 520 }] : []),
    ...(rel.resumo ?? []).flatMap((r) => (r.pessoa?.foto ? [{ url: r.pessoa.foto, px: 200 }] : [])),
    ...(temFoto ? (rel.pessoas ?? []).slice(0, 120).flatMap((p) => (p?.foto ? [{ url: p.foto, px: 140 }] : [])) : []),
  ];
  const fotos = pedidos.length ? await carregarFotos(pedidos) : new Map<string, string>();

  // ——— Cabeçalho da primeira página ———
  doc.setFillColor(...BAND); doc.rect(0, 0, W, 24, 'F');
  logo(doc, M + 5, 12, 5);
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  doc.text(pdfText('Radar Eleições'), M + 13, 11.2);
  doc.setFontSize(6.5); doc.setTextColor(...MUTED);
  doc.text('BY TRIAD3', M + 13, 15.4, { charSpace: 0.6 });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  doc.text(pdfText(`Eleições 2026 · ${ctx.turno}º turno`), W - M, 10.5, { align: 'right' });
  doc.text(pdfText(`Gerado em ${quando(null)}`), W - M, 15, { align: 'right' });

  let y = 32;
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(rel.capa ? 12 : 16);
  for (const l of doc.splitTextToSize(pdfText(rel.titulo), W - 2 * M) as string[]) { doc.text(l, M, y); y += rel.capa ? 5.4 : 6.6; }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...MUTED);
  const contexto = [
    `${ctx.cargo} · ${ctx.local}`,
    ctx.apurado !== null ? `${fmtPct(ctx.apurado, 2)} das seções totalizadas` : null,
    ctx.atualizado ? `dados de ${quando(ctx.atualizado)}` : null,
  ].filter(Boolean).join('  ·  ');
  for (const l of doc.splitTextToSize(pdfText(contexto), W - 2 * M) as string[]) { doc.text(l, M, y); y += 4.4; }
  if (rel.subtitulo) for (const l of doc.splitTextToSize(pdfText(rel.subtitulo), W - 2 * M) as string[]) { doc.text(l, M, y); y += 4.4; }
  if (ctx.demo) {
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...ALERTA); doc.setFontSize(8.5);
    doc.text(pdfText('SIMULAÇÃO — dados fictícios, gerados para demonstração'), M, y); y += 4.4;
  }
  y += 2;

  if (rel.capa) y = await desenharCapa(doc, rel.capa, rel.capa.pessoa.foto ? fotos.get(rel.capa.pessoa.foto) : undefined, W, M, y);

  // ——— Resumo em caixas (com foto quando a caixa é de uma pessoa) ———
  if (rel.resumo?.length) {
    const porLinha = Math.min(rel.resumo.length, paisagem ? 6 : 4);
    const gap = 3, bw = (W - 2 * M - gap * (porLinha - 1)) / porLinha;
    const comPessoa = rel.resumo.some((r) => r.pessoa);
    const bh = comPessoa ? 17 : 14;
    rel.resumo.forEach((r, i) => {
      const cx = M + (i % porLinha) * (bw + gap), cy = y + Math.floor(i / porLinha) * (bh + gap);
      doc.setFillColor(...ZEBRA); doc.setDrawColor(...LINE); doc.setLineWidth(0.2);
      doc.roundedRect(cx, cy, bw, bh, 2, 2, 'FD');
      let tx = cx + 3;
      if (r.pessoa) { avatar(doc, cx + 8.5, cy + bh / 2, 5.6, r.pessoa, r.pessoa.foto ? fotos.get(r.pessoa.foto) : undefined); tx = cx + 17; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(...MUTED);
      doc.text((doc.splitTextToSize(pdfText(r.label.toUpperCase()), cx + bw - tx - 2) as string[])[0], tx, cy + bh / 2 - 2.2);
      doc.setFontSize(comPessoa ? 10.5 : 11.5); doc.setTextColor(...INK);
      doc.text((doc.splitTextToSize(pdfText(r.valor), cx + bw - tx - 2) as string[])[0], tx, cy + bh / 2 + 3.6);
    });
    y += Math.ceil(rel.resumo.length / porLinha) * (bh + gap) + 2;
  }

  // ——— Tabela ———
  const maxBarra = colsPdf.map((c, i) => (c.barra ? Math.max(...rel.linhas.map((l) => (typeof l[i] === 'number' ? (l[i] as number) : 0)), 0) : 0));
  const direita = (t: string | undefined) => t === 'int' || t === 'pct' || t === 'num' || t === 'cod';
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M, top: 20, bottom: 14 },
    head: [colsPdf.map((c) => pdfText(c.titulo))],
    body: rel.linhas.map((l) => colsPdf.map((c, i) => (c.tipo === 'foto' ? '' : pdfText(formatarCelula(l[i], c.tipo))))),
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: colsPdf.length > 9 ? 7 : 8, cellPadding: { top: 1.8, bottom: 1.8, left: 2, right: 2 }, textColor: INK, lineColor: LINE, overflow: 'linebreak', valign: 'middle' },
    headStyles: { fillColor: HEAD, textColor: WHITE, fontStyle: 'bold', fontSize: colsPdf.length > 9 ? 7 : 7.8 },
    alternateRowStyles: { fillColor: ZEBRA },
    bodyStyles: { lineWidth: { bottom: 0.15 } },
    columnStyles: Object.fromEntries(colsPdf.map((c, i) => [i, c.tipo === 'foto'
      ? { cellWidth: 10, minCellHeight: 9 }
      : { halign: direita(c.tipo) ? 'right' : 'left', ...(c.barra ? { minCellWidth: 34 } : {}) }])),
    didParseCell: (d) => { if (d.section === 'head' && direita(colsPdf[d.column.index]?.tipo)) d.cell.styles.halign = 'right'; },
    didDrawCell: (d) => {
      const c = colsPdf[d.column.index];
      if (d.section !== 'body' || !c) return;
      if (c.tipo === 'foto') {
        const p = rel.pessoas?.[d.row.index];
        if (p) avatar(doc, d.cell.x + d.cell.width / 2, d.cell.y + d.cell.height / 2, Math.min(3.4, d.cell.height / 2 - 0.8), p, p.foto ? fotos.get(p.foto) : undefined, true);
        return;
      }
      if (!c.barra) return;
      const v = rel.linhas[d.row.index]?.[d.column.index];
      if (typeof v !== 'number' || v < 0 || !maxBarra[d.column.index]) return;
      const textoW = doc.getTextWidth(d.cell.text.join(' ')) + 4;
      const livre = d.cell.width - textoW - 4;
      if (livre < 6) return;
      const bx = d.cell.x + 2, by = d.cell.y + d.cell.height / 2 - 1.1;
      doc.setFillColor(...LINE); doc.rect(bx, by, livre, 2.2, 'F');
      if (v > 0) { doc.setFillColor(...cor); doc.rect(bx, by, Math.max(0.4, (livre * v) / maxBarra[d.column.index]), 2.2, 'F'); }
    },
    didDrawPage: (d) => {
      if (d.pageNumber === 1) return;
      // páginas seguintes: faixa fina com a marca e o título
      doc.setFillColor(...BAND); doc.rect(0, 0, W, 13, 'F');
      logo(doc, M + 3, 6.5, 3);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...INK);
      doc.text(pdfText('Radar Eleições'), M + 8, 7.8);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED);
      doc.text(doc.splitTextToSize(pdfText(rel.titulo), W / 2)[0], W - M, 7.8, { align: 'right' });
    },
  });
  if (!rel.linhas.length) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(...MUTED);
    doc.text('Sem dados para exibir.', M, ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 8);
  }

  // ——— Paginação ———
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setDrawColor(...LINE); doc.setLineWidth(0.2); doc.line(M, H - 9, W - M, H - 9);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...MUTED);
    doc.text(`Página ${i} de ${n}`, W - M, H - 5.5, { align: 'right' });
  }
  doc.save(`${nomeArquivo(rel.arquivo)}.pdf`);
}
