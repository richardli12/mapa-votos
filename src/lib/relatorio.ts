// Relatório tabular exportável: a mesma descrição gera o CSV (planilha) e o PDF (impressão/envio).
import { fmtInt, fmtPct } from '../../shared/format';

export type Celula = string | number | null | undefined;

export interface ColunaRel {
  titulo: string;
  /** int: 1.234 · pct: 12,34% · num: decimal livre · cod: número sem separador (zona, seção, local) · texto (padrão) */
  tipo?: 'texto' | 'int' | 'pct' | 'num' | 'cod';
  /** no PDF, desenha uma barra proporcional ao valor (colunas numéricas) */
  barra?: boolean;
}

export interface Relatorio {
  /** nome do arquivo, sem extensão */
  arquivo: string;
  titulo: string;
  /** linha de contexto extra (abaixo do cargo/local) */
  subtitulo?: string;
  resumo?: { label: string; valor: string }[];
  colunas: ColunaRel[];
  linhas: Celula[][];
  /** cor das barras no PDF (hex) */
  cor?: string;
}

/** Contexto da tela no momento da exportação (cabeçalho e rodapé do PDF). */
export interface ContextoRel {
  cargo: string;
  local: string;
  turno: number;
  apurado: number | null;
  atualizado: string | null;
  fonte: string;
  demo: boolean;
}

export function formatarCelula(v: Celula, tipo: ColunaRel['tipo']): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'string') return v;
  if (tipo === 'int') return fmtInt(v);
  if (tipo === 'pct') return fmtPct(v, 2);
  if (tipo === 'num') return v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  if (tipo === 'cod') return String(v);
  return String(v);
}

/** Valores crus para planilha: números sem separador de milhar e com vírgula decimal (Excel em português). */
export function linhasCsv(rel: Relatorio): (string | number)[][] {
  const cel = (v: Celula, tipo: ColunaRel['tipo']): string | number => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return tipo === 'int' ? Math.round(v) : String(Number(v.toFixed(4))).replace('.', ',');
    return v;
  };
  return [rel.colunas.map((c) => c.titulo), ...rel.linhas.map((l) => rel.colunas.map((c, i) => cel(l[i], c.tipo)))];
}

export function nomeArquivo(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'relatorio';
}
