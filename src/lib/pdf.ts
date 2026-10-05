// Gera o PDF de um relatório no navegador (jsPDF + autotable), carregado só quando alguém pede o PDF.
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { fmtPct } from '../../shared/format';
import { formatarCelula, nomeArquivo, type ContextoRel, type Relatorio } from './relatorio';

type RGB = [number, number, number];
const INK: RGB = [24, 33, 46];
const MUTED: RGB = [100, 112, 128];
const LINE: RGB = [214, 221, 229];
const BAND: RGB = [219, 226, 233]; // Blue-Grey da marca (#DBE2E9)
const ZEBRA: RGB = [244, 247, 250];
const HEAD: RGB = [30, 42, 58];
const ALERTA: RGB = [190, 40, 40];

function rgb(hex: string | undefined, fallback: RGB): RGB {
  const m = hex?.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return fallback;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
}

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
  doc.setDrawColor(219, 226, 233); doc.setLineWidth(0.35);
  doc.circle(x, y, r * 0.66, 'S'); doc.circle(x, y, r * 0.33, 'S');
  doc.setLineWidth(0.6); doc.line(x, y, x + r * 0.62, y - r * 0.5);
  doc.setFillColor(219, 226, 233); doc.circle(x, y, r * 0.12, 'F');
}

export async function baixarPdf(rel: Relatorio, ctx: ContextoRel): Promise<void> {
  const paisagem = rel.colunas.length > 7;
  const doc = new jsPDF({ orientation: paisagem ? 'landscape' : 'portrait', unit: 'mm', format: 'a4', compress: true });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const M = 12;
  const cor = rgb(rel.cor, [74, 106, 138]);
  doc.setProperties({ title: pdfText(rel.titulo), subject: pdfText(`${ctx.cargo} · ${ctx.local}`), creator: 'Radar Eleições - Triad3', author: 'Radar Eleições - Triad3' });

  // ——— Cabeçalho da primeira página ———
  doc.setFillColor(...BAND); doc.rect(0, 0, W, 24, 'F');
  logo(doc, M + 5, 12, 5);
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  doc.text(pdfText('Radar Eleições'), M + 13, 11.2);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(...MUTED);
  doc.text('BY TRIAD3', M + 13, 15.4, { charSpace: 0.6 });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  doc.text(pdfText(`Eleições 2026 · ${ctx.turno}º turno`), W - M, 10.5, { align: 'right' });
  doc.text(pdfText(`Gerado em ${quando(null)}`), W - M, 15, { align: 'right' });

  let y = 33;
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
  for (const l of doc.splitTextToSize(pdfText(rel.titulo), W - 2 * M) as string[]) { doc.text(l, M, y); y += 6.6; }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...MUTED);
  const contexto = [
    `${ctx.cargo} · ${ctx.local}`,
    ctx.apurado !== null ? `${fmtPct(ctx.apurado, 2)} das seções totalizadas` : null,
    ctx.atualizado ? `dados de ${quando(ctx.atualizado)}` : null,
  ].filter(Boolean).join('  ·  ');
  for (const l of doc.splitTextToSize(pdfText(contexto), W - 2 * M) as string[]) { doc.text(l, M, y); y += 4.6; }
  if (rel.subtitulo) for (const l of doc.splitTextToSize(pdfText(rel.subtitulo), W - 2 * M) as string[]) { doc.text(l, M, y); y += 4.6; }
  if (ctx.demo) {
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...ALERTA); doc.setFontSize(8.5);
    doc.text(pdfText('SIMULAÇÃO — dados fictícios, gerados para demonstração'), M, y); y += 4.6;
  }
  y += 2;

  // ——— Resumo em caixas ———
  if (rel.resumo?.length) {
    const porLinha = Math.min(rel.resumo.length, paisagem ? 6 : 4);
    const gap = 3, bw = (W - 2 * M - gap * (porLinha - 1)) / porLinha, bh = 14;
    rel.resumo.forEach((r, i) => {
      const cx = M + (i % porLinha) * (bw + gap), cy = y + Math.floor(i / porLinha) * (bh + gap);
      doc.setFillColor(...ZEBRA); doc.setDrawColor(...LINE); doc.setLineWidth(0.2);
      doc.roundedRect(cx, cy, bw, bh, 2, 2, 'FD');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(...MUTED);
      doc.text(pdfText(r.label.toUpperCase()), cx + 3, cy + 5, { maxWidth: bw - 6 });
      doc.setFontSize(11.5); doc.setTextColor(...INK);
      doc.text(pdfText(r.valor), cx + 3, cy + 11, { maxWidth: bw - 6 });
    });
    y += Math.ceil(rel.resumo.length / porLinha) * (bh + gap) + 2;
  }

  // ——— Tabela ———
  const maxBarra = rel.colunas.map((c, i) => (c.barra ? Math.max(...rel.linhas.map((l) => (typeof l[i] === 'number' ? (l[i] as number) : 0)), 0) : 0));
  const direita = (t: string | undefined) => t === 'int' || t === 'pct' || t === 'num' || t === 'cod';
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M, top: 20, bottom: 16 },
    head: [rel.colunas.map((c) => pdfText(c.titulo))],
    body: rel.linhas.map((l) => rel.colunas.map((c, i) => pdfText(formatarCelula(l[i], c.tipo)))),
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: rel.colunas.length > 9 ? 7 : 8, cellPadding: { top: 1.8, bottom: 1.8, left: 2, right: 2 }, textColor: INK, lineColor: LINE, overflow: 'linebreak', valign: 'middle' },
    headStyles: { fillColor: HEAD, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: rel.colunas.length > 9 ? 7 : 7.8 },
    alternateRowStyles: { fillColor: ZEBRA },
    bodyStyles: { lineWidth: { bottom: 0.15 } },
    columnStyles: Object.fromEntries(rel.colunas.map((c, i) => [i, { halign: direita(c.tipo) ? 'right' : 'left', ...(c.barra ? { minCellWidth: 34 } : {}) }])),
    didParseCell: (d) => { if (d.section === 'head' && direita(rel.colunas[d.column.index]?.tipo)) d.cell.styles.halign = 'right'; },
    didDrawCell: (d) => {
      const c = rel.colunas[d.column.index];
      if (d.section !== 'body' || !c?.barra) return;
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

  // ——— Rodapé com fonte e paginação ———
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setDrawColor(...LINE); doc.setLineWidth(0.2); doc.line(M, H - 10, W - M, H - 10);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...MUTED);
    doc.text(pdfText(`Radar Eleições - Triad3 · Fonte: ${ctx.fonte}${ctx.demo && !/simula/i.test(ctx.fonte) ? ' (simulação)' : ''}`), M, H - 6);
    doc.text(`Página ${i} de ${n}`, W - M, H - 6, { align: 'right' });
  }
  doc.save(`${nomeArquivo(rel.arquivo)}.pdf`);
}
