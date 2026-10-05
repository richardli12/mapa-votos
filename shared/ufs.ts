export type Region = 'Norte' | 'Nordeste' | 'Centro-Oeste' | 'Sudeste' | 'Sul';

export interface UfInfo { uf: string; name: string; region: Region; capital: string }

export const UFS: UfInfo[] = [
  { uf: 'ac', name: 'Acre', region: 'Norte', capital: 'Rio Branco' },
  { uf: 'al', name: 'Alagoas', region: 'Nordeste', capital: 'Maceió' },
  { uf: 'am', name: 'Amazonas', region: 'Norte', capital: 'Manaus' },
  { uf: 'ap', name: 'Amapá', region: 'Norte', capital: 'Macapá' },
  { uf: 'ba', name: 'Bahia', region: 'Nordeste', capital: 'Salvador' },
  { uf: 'ce', name: 'Ceará', region: 'Nordeste', capital: 'Fortaleza' },
  { uf: 'df', name: 'Distrito Federal', region: 'Centro-Oeste', capital: 'Brasília' },
  { uf: 'es', name: 'Espírito Santo', region: 'Sudeste', capital: 'Vitória' },
  { uf: 'go', name: 'Goiás', region: 'Centro-Oeste', capital: 'Goiânia' },
  { uf: 'ma', name: 'Maranhão', region: 'Nordeste', capital: 'São Luís' },
  { uf: 'mg', name: 'Minas Gerais', region: 'Sudeste', capital: 'Belo Horizonte' },
  { uf: 'ms', name: 'Mato Grosso do Sul', region: 'Centro-Oeste', capital: 'Campo Grande' },
  { uf: 'mt', name: 'Mato Grosso', region: 'Centro-Oeste', capital: 'Cuiabá' },
  { uf: 'pa', name: 'Pará', region: 'Norte', capital: 'Belém' },
  { uf: 'pb', name: 'Paraíba', region: 'Nordeste', capital: 'João Pessoa' },
  { uf: 'pe', name: 'Pernambuco', region: 'Nordeste', capital: 'Recife' },
  { uf: 'pi', name: 'Piauí', region: 'Nordeste', capital: 'Teresina' },
  { uf: 'pr', name: 'Paraná', region: 'Sul', capital: 'Curitiba' },
  { uf: 'rj', name: 'Rio de Janeiro', region: 'Sudeste', capital: 'Rio de Janeiro' },
  { uf: 'rn', name: 'Rio Grande do Norte', region: 'Nordeste', capital: 'Natal' },
  { uf: 'ro', name: 'Rondônia', region: 'Norte', capital: 'Porto Velho' },
  { uf: 'rr', name: 'Roraima', region: 'Norte', capital: 'Boa Vista' },
  { uf: 'rs', name: 'Rio Grande do Sul', region: 'Sul', capital: 'Porto Alegre' },
  { uf: 'sc', name: 'Santa Catarina', region: 'Sul', capital: 'Florianópolis' },
  { uf: 'se', name: 'Sergipe', region: 'Nordeste', capital: 'Aracaju' },
  { uf: 'sp', name: 'São Paulo', region: 'Sudeste', capital: 'São Paulo' },
  { uf: 'to', name: 'Tocantins', region: 'Norte', capital: 'Palmas' },
];

export const REGIONS: Region[] = ['Norte', 'Nordeste', 'Centro-Oeste', 'Sudeste', 'Sul'];

export const ufInfo = (uf: string): UfInfo | undefined => UFS.find((u) => u.uf === uf.toLowerCase());
export const ufName = (uf: string): string => ufInfo(uf)?.name ?? uf.toUpperCase();
