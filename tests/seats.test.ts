import { describe, expect, it } from 'vitest';
import { allocateSeats, electoralQuotient } from '../shared/seats.ts';

describe('distribuição de cadeiras', () => {
  it('quociente eleitoral arredonda fração > 0,5 para cima', () => {
    expect(electoralQuotient(1000, 3)).toBe(333);
    expect(electoralQuotient(1003, 6)).toBe(167); // 167,17
    expect(electoralQuotient(1005, 6)).toBe(167); // 167,5: fração igual a 0,5 é desprezada
    expect(electoralQuotient(1006, 6)).toBe(168); // 167,67
  });

  it('QP, cláusula de 10% e sobras pelas maiores médias', () => {
    const out = allocateSeats([
      { id: 'A', legend: 0, cands: [{ id: 'a1', votes: 5000 }, { id: 'a2', votes: 2600 }, { id: 'a3', votes: 50 }] },
      { id: 'B', legend: 100, cands: [{ id: 'b1', votes: 2000 }, { id: 'b2', votes: 900 }] },
      { id: 'C', legend: 0, cands: [{ id: 'c1', votes: 350 }] },
    ], 4);
    // válidos 11000, QE 2750: A tem QP 2, B tem QP 1 → sobra 1 vaga
    expect(out.quotient).toBe(2750);
    expect(out.seatsByGroup.get('A')! + out.seatsByGroup.get('B')!).toBe(4);
    expect(out.elected.get('a1')).toBe('QP');
    expect(out.elected.get('b1')).toBe('QP');
    expect(out.elected.has('c1')).toBe(false); // C não chega a 80% do QE
    expect(out.elected.size).toBe(4);
  });

  it('candidato abaixo de 10% do QE não entra pelo quociente partidário', () => {
    const out = allocateSeats([
      { id: 'A', legend: 9000, cands: [{ id: 'a1', votes: 1500 }, { id: 'a2', votes: 10 }] },
      { id: 'B', legend: 0, cands: [{ id: 'b1', votes: 9500 }] },
    ], 2);
    // válidos 20010, QE 10005: A tem QP 1 (só a1 passa dos 10%); B entra pelas médias
    expect(out.elected.get('a1')).toBe('QP');
    expect(out.elected.has('a2')).toBe(false);
    expect(out.elected.get('b1')).toBe('média');
  });
});
