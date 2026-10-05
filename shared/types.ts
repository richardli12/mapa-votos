// Modelo normalizado compartilhado entre servidor e interface.
// Todos os provedores (BP, TSE oficial, simulação) entregam exatamente estes formatos.

export type CargoId = 'presidente' | 'governador' | 'senador' | 'depfederal' | 'depestadual';
export type Level = 'br' | 'uf' | 'mu';
export type CountStatus = 'aguardando' | 'apurando' | 'encerrada';
export type SourceKind = 'bp' | 'tse' | 'demo';

export interface Scope {
  level: Level;
  /** sigla minúscula da UF (ausente no nível Brasil) */
  uf?: string;
  /** código TSE do município (5 dígitos) */
  mu?: string;
}

export interface Running {
  name: string;
  party: string;
  /** 'v' vice, 's1'/'s2' suplentes de senador */
  role: string;
}

export interface Candidate {
  id: string; // sqcand
  number: string;
  name: string; // nome de urna
  fullName: string;
  party: string; // sigla
  partyName: string;
  federation?: string;
  coalition?: string; // nome da coligação/federação (agregação)
  coalitionParties?: string;
  votes: number;
  pct: number; // % dos votos válidos
  elected: boolean;
  /** proporcionais em apuração: estaria eleito se a contagem terminasse agora */
  projected?: boolean;
  status: string; // texto oficial: "Eleito", "2º turno", "Eleito por QP", "Suplente"...
  valid: boolean;
  runningMates: Running[];
  birth?: string;
  photo: string | null;
  /** posição de cor (0..7) na paleta categórica; -1 = "outros" */
  color: number;
}

export interface Totals {
  sections: number;
  sectionsCounted: number;
  pctCounted: number;
  electorate: number;
  turnout: number;
  turnoutPct: number;
  abstention: number;
  abstentionPct: number;
  totalVotes: number;
  valid: number;
  nominal: number;
  legend: number;
  blank: number;
  blankPct: number;
  nulls: number;
  nullPct: number;
}

export interface PartyResult {
  party: string;
  name: string;
  federation?: string;
  votes: number; // nominais + legenda
  legend: number;
  pct: number;
  candidates: number;
  elected: number;
  /** cadeiras da agregação (federação/partido) — proporcionais */
  seats?: number;
  color: number;
}

export interface Result {
  cargo: CargoId;
  cargoLabel: string;
  scope: Scope;
  scopeName: string;
  seats: number;
  quotient?: number;
  status: CountStatus;
  mathDefined: boolean;
  updatedAt: string | null;
  totals: Totals;
  candidates: Candidate[];
  parties: PartyResult[];
  source: SourceKind;
  verified: boolean | null;
  /** número de turno (1 ou 2) */
  round: number;
}

/** Resumo por área (UF ou município) para pintar o mapa. */
export interface MapArea {
  code: string; // sigla UF ou código TSE do município
  pctCounted: number;
  turnoutPct: number;
  abstentionPct: number;
  blankPct: number;
  nullPct: number;
  valid: number;
  electorate: number;
  /** votos por candidato (todos quando ≤ 30 candidatos; senão top + foco) */
  votes: Record<string, number>;
  /** votos por partido (proporcionais) */
  partyVotes?: Record<string, number>;
  /** cadeiras (eleitas ou projetadas) por partido — só no nível UF de proporcionais */
  partySeats?: Record<string, number>;
  /** situação oficial dos candidatos que têm alguma (eleito, 2º turno…) */
  statuses?: Record<string, string>;
  /** candidatos eleitos ou projetados */
  winners?: string[];
  status: CountStatus;
}

export interface CandidateLite {
  id: string;
  name: string;
  number: string;
  party: string;
  color: number;
  photo: string | null;
}

export interface MapPayload {
  cargo: CargoId;
  parent: Scope; // br => áreas são UFs; uf => áreas são municípios
  areas: MapArea[];
  candidates: CandidateLite[];
  /** áreas ainda carregando na fonte (modo ao vivo) */
  pending: number;
  total: number;
  updatedAt: string | null;
  source: SourceKind;
}

export interface Municipality {
  code: string; // TSE
  ibge: string;
  name: string;
  uf: string;
  capital: boolean;
  lon: number | null;
  lat: number | null;
}

export interface MetaPayload {
  name: string;
  source: SourceKind;
  sourceLabel: string;
  sourceUrl: string;
  round: number;
  rounds: number[];
  electionDate: string;
  cargos: { id: CargoId; label: string; levels: Level[] }[];
  warnings: string[];
  refreshSeconds: number;
}

export interface ProgressRow {
  uf: string;
  pctCounted: number;
  turnoutPct: number;
  status: CountStatus;
  updatedAt: string | null;
}
