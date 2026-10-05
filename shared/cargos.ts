import type { CargoId } from './types';

export interface CargoInfo {
  id: CargoId;
  code: number; // código TSE do cargo
  label: string;
  short: string;
  national: boolean; // disputado no nível Brasil
  proportional: boolean;
}

export const CARGOS: CargoInfo[] = [
  { id: 'presidente', code: 1, label: 'Presidente', short: 'Pres.', national: true, proportional: false },
  { id: 'governador', code: 3, label: 'Governador', short: 'Gov.', national: false, proportional: false },
  { id: 'senador', code: 5, label: 'Senador', short: 'Sen.', national: false, proportional: false },
  { id: 'depfederal', code: 6, label: 'Deputado Federal', short: 'Dep. Fed.', national: false, proportional: true },
  { id: 'depestadual', code: 7, label: 'Deputado Estadual', short: 'Dep. Est.', national: false, proportional: true },
];

export const cargoInfo = (id: CargoId): CargoInfo => CARGOS.find((c) => c.id === id)!;

/** No DF o cargo estadual é Deputado Distrital (código 8). */
export function cargoCode(id: CargoId, uf?: string): number {
  return id === 'depestadual' && uf?.toLowerCase() === 'df' ? 8 : cargoInfo(id).code;
}

export function cargoLabel(id: CargoId, uf?: string): string {
  return id === 'depestadual' && uf?.toLowerCase() === 'df' ? 'Deputado Distrital' : cargoInfo(id).label;
}

export function cargoFromCode(code: number): CargoId | undefined {
  if (code === 8) return 'depestadual';
  return CARGOS.find((c) => c.code === code)?.id;
}
