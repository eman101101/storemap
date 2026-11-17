/** Tests for the shared place-glyph lookup (2D canvas + 3D renderer). */
import { describe, expect, it } from 'vitest';
import { placeGlyph } from './placeSymbols';

describe('placeGlyph — symbols for common places', () => {
  it('maps the everyday fixtures, whatever the label capitalisation', () => {
    expect(placeGlyph('checkout', 'Checkouts')).toBe('🛒');
    expect(placeGlyph('poi', 'WASHROOMS')).toBe('🚻');
    expect(placeGlyph('poi', 'Customer Service')).toBe('🛎');
    expect(placeGlyph('poi', 'Pharmacy')).toBe('💊');
    expect(placeGlyph('poi', 'Elevator')).toBe('🛗');
    expect(placeGlyph('entrance', 'Main Entrance')).toBe('⬆');
    expect(placeGlyph('exit', 'East Exit')).toBe('⬇');
  });
  it('matches on type alone when the label is empty', () => {
    expect(placeGlyph('entrance', '')).toBe('⬆');
    expect(placeGlyph('exit', null)).toBe('⬇');
  });
  it('leaves unknown places unnamed-symbol-free', () => {
    expect(placeGlyph('poi', 'Garden Centre')).toBeNull();
    expect(placeGlyph('poi', '')).toBeNull();
  });
  it('entrance beats exit-ish words in the same label', () => {
    expect(placeGlyph('poi', 'Entrance to exit route')).toBe('⬆');
  });
});
