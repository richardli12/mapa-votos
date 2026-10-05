// Modelo da apuração por zona eleitoral, local de votação (escola) e seção.
import type { CargoId, SourceKind } from './types';

export type SecaoStatus = 'totalizada' | 'aguardando' | 'agregada' | 'erro';

export interface UrnaSecao {
  s: number; // número da seção
  /** seção principal, quando esta seção foi agregada a outra */
  principal?: number;
  local?: number;
  aptos?: number;
}

export interface UrnaZona { zona: number; secoes: UrnaSecao[] }

/** Local de votação (escola, faculdade, ginásio…). */
export interface UrnaLocal {
  id: string; // `${zona}-${local}`
  zona: number;
  local: number;
  nome: string;
  endereco?: string;
  bairro?: string;
  lat?: number | null;
  lon?: number | null;
  secoes: number[];
  eleitores?: number;
}

export interface UrnaEstrutura {
  uf: string;
  mu: string;
  nome: string;
  zonas: UrnaZona[];
  /** locais de votação, quando a fonte informa (simulação) — ao vivo vêm do arquivo estático /locais */
  locais: UrnaLocal[] | null;
  totalSecoes: number;
  /** a soma do município inteiro está liberada (limite de requisições à fonte) */
  municipioInteiro: boolean;
  source: SourceKind;
}

/** Resumo de uma seção para um cargo — o suficiente para mapa, tabelas e somas. */
export interface SecaoResumo {
  z: number;
  s: number;
  l: number | null; // local de votação
  st: SecaoStatus;
  apt: number; // eleitores aptos
  comp: number; // comparecimento
  nom: number;
  leg: number;
  bra: number;
  nul: number;
  /** votos por número do candidato (todos quando poucos; senão os 10 mais votados + foco) */
  v: Record<string, number>;
  /** votos por número do partido (nominais + legenda) — proporcionais */
  p?: Record<string, number>;
}

export interface SecoesPayload {
  cargo: CargoId;
  uf: string;
  mu: string;
  zona: number | null;
  secoes: SecaoResumo[];
  pending: number;
  total: number;
  source: SourceKind;
}

export interface BoletimVoto {
  tipo: 'nominal' | 'legenda';
  numero: number;
  partido: number;
  qtd: number;
  nome?: string;
  sigla?: string;
  id?: string;
  cor?: number;
  foto?: string | null;
}

export interface BoletimCargo {
  cargo: CargoId | null;
  codigo: number;
  label: string;
  tipo: 'majoritario' | 'proporcional' | 'consulta';
  aptos: number;
  comparecimento: number;
  nominal: number;
  legenda: number;
  brancos: number;
  nulos: number;
  votos: BoletimVoto[];
}

export interface BoletimSecao {
  uf: string;
  mu: string;
  zona: number;
  secao: number;
  local: number | null;
  status: SecaoStatus;
  fase: string;
  aptos: number;
  comparecimento: number;
  emissao: string | null;
  abertura: string | null;
  encerramento: string | null;
  urna: { tipo: string; versao: string | null; numeroInterno: number | null; codigoCarga: string | null; serieFlash: string | null } | null;
  biometria: number | null;
  liberadosCodigo: number | null;
  apuracaoSA: boolean;
  hash?: string;
  arquivo?: string;
  cargos: BoletimCargo[];
  source: SourceKind;
}
