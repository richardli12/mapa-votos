import { describe, expect, it } from 'vitest';
import { mix } from '../src/lib/palette.ts';

describe('mistura de cores', () => {
  it('aceita hexadecimal curto (como sai do CSS minificado)', () => {
    expect(mix('#fff', '#2a78d6', 0.5)).toBe(mix('#ffffff', '#2a78d6', 0.5));
    expect(mix('#fff', '#2a78d6', 0.5)).not.toContain('NaN');
  });
  it('extremos devolvem as próprias cores', () => {
    expect(mix('#ffffff', '#e34948', 1)).toBe('#e34948');
    expect(mix('#dbe2e9', '#000000', 0)).toBe('#dbe2e9');
  });
});
