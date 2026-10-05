import type { CargoId } from '../../shared/types.ts';
import type { BoletimSecao, LocaisPayload, SecoesPayload, UrnaEstrutura } from '../../shared/urnas.ts';

/** Apuração por zona, local de votação e seção. */
export interface UrnasProvider {
  estrutura(uf: string, mu: string, round: number, t?: number): Promise<UrnaEstrutura>;
  secoes(cargo: CargoId, uf: string, mu: string, zona: number | null, focus: string[], round: number, t?: number): Promise<SecoesPayload>;
  /** soma por local de votação (escola) — zona `null` = município inteiro */
  locais(cargo: CargoId, uf: string, mu: string, zona: number | null, focus: string[], round: number, t?: number): Promise<LocaisPayload>;
  /** boletim completo de uma seção (todos os cargos); os nomes dos candidatos são preenchidos pela API */
  boletim(uf: string, mu: string, zona: number, secao: number, round: number, t?: number): Promise<BoletimSecao>;
}
