// Relatório tabular exportável: a mesma descrição gera o CSV (planilha) e o PDF (impressão/envio).
import { fmtInt, fmtPct } from '../../shared/format';

export type Celula = string | number | null | undefined;

export interface ColunaRel {
  titulo: string;
  /** int: 1.234 · pct: 12,34% · num: decimal livre · cod: número sem separador (zona, seção, local) · texto (padrão)
   *  foto: miniatura redonda da pessoa da linha (`Relatorio.pessoas`), só no PDF */
  tipo?: 'texto' | 'int' | 'pct' | 'num' | 'cod' | 'foto';
  /** no PDF, desenha uma barra proporcional ao valor (colunas numéricas) */
  barra?: boolean;
}

/** Pessoa com foto (ou iniciais na cor do partido, quando não há foto). */
export interface Pessoa { nome: string; foto?: string | null; cor?: string }

/** Mapa de força para a capa: % do candidato em cada área, desenhado em vetor no PDF. */
export interface MapaRel {
  geoKey: string;
  valores: Record<string, number | null>;
  titulo: string;
}

/** Capa da ficha do candidato: foto grande, identificação, números e mapa. */
export interface CapaCandidato {
  pessoa: Pessoa;
  numero: string;
  partido: string;
  partidoNome?: string;
  nomeCompleto?: string;
  coligacao?: string;
  situacao?: string;
  chapa?: string[];
  kpis: { label: string; valor: string; sub?: string }[];
  destaques?: { label: string; valor: string }[];
  mapa?: MapaRel;
}

export interface Relatorio {
  /** nome do arquivo, sem extensão */
  arquivo: string;
  titulo: string;
  /** linha de contexto extra (abaixo do cargo/local) */
  subtitulo?: string;
  resumo?: { label: string; valor: string; pessoa?: Pessoa }[];
  /** pessoa de cada linha (colunas do tipo foto) */
  pessoas?: (Pessoa | null)[];
  capa?: CapaCandidato;
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
  const cols = rel.colunas.map((c, i) => [c, i] as const).filter(([c]) => c.tipo !== 'foto');
  return [cols.map(([c]) => c.titulo), ...rel.linhas.map((l) => cols.map(([c, i]) => cel(l[i], c.tipo)))];
}

export function nomeArquivo(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'relatorio';
}
