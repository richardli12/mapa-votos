import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo JS do script de build
import { agruparLocais, parseCsvLine } from '../scripts/locais-lib.mjs';

const CSV = [
  'DT_GERACAO;SG_UF;CD_MUNICIPIO;NM_MUNICIPIO;NR_ZONA;NR_SECAO;NR_LOCAL_VOTACAO;NM_LOCAL_VOTACAO;DS_ENDERECO;NM_BAIRRO;NR_LATITUDE;NR_LONGITUDE;QT_ELEITOR_SECAO',
  '"01/09/2026";"SP";"71072";"SÃO PAULO";"1";"10";"1015";"EMEF DESEMBARGADOR AMORIM LIMA";"RUA CORREIA DE MELO, 84";"BOM RETIRO";"-23,5272";"-46,6390";"350"',
  '"01/09/2026";"SP";"71072";"SÃO PAULO";"1";"11";"1015";"EMEF DESEMBARGADOR AMORIM LIMA";"RUA CORREIA DE MELO, 84";"BOM RETIRO";"-23,5272";"-46,6390";"340"',
  '"01/09/2026";"SP";"71072";"SÃO PAULO";"1";"12";"1023";"ESCOLA ""NOVA""; ANEXO";"AV. X";"SÉ";"-1";"-1";"300"',
  '"01/09/2026";"ZZ";"29955";"LISBOA";"1";"1";"1001";"CONSULADO";"";"";"";"";"100"',
].join('\n');

describe('locais de votação (dados abertos do TSE)', () => {
  it('lê campos entre aspas com ; e aspas escapadas', () => {
    expect(parseCsvLine('"a";"b ""c"";d";e')).toEqual(['a', 'b "c";d', 'e']);
  });
  it('agrupa seções por local, com coordenadas e eleitores', () => {
    const m = agruparLocais(CSV);
    expect([...m.keys()]).toEqual(['sp:71072']);
    const [a, b] = m.get('sp:71072');
    expect(a).toMatchObject({ id: '1-1015', nome: 'EMEF DESEMBARGADOR AMORIM LIMA', bairro: 'BOM RETIRO', lat: -23.5272, lon: -46.639, secoes: [10, 11], eleitores: 690 });
    expect(b).toMatchObject({ id: '1-1023', nome: 'ESCOLA "NOVA"; ANEXO', lat: null, lon: null, secoes: [12] });
  });
});
