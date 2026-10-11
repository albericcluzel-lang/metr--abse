import { describe, expect, it } from 'vitest';
import {
  aireMur,
  classerBord,
  couperBande,
  decouperMur,
  grilleMur,
  trapezeMur,
  type MorceauMur,
} from './murs';

// Mur de 4 m × 2,50 m, cloison de 9,8 cm, angles en onglet à 90° des deux côtés :
// le nu extérieur déborde de 9,8 cm à chaque bout.
const L = 400;
const H = 250;
const E = 9.8;

function resume(m: readonly MorceauMur[]) {
  return m.map((x) => `${x.nature} ${x.debut}→${x.fin} [${x.bas}–${x.haut}]`);
}

describe('découpage d’un côté de mur autour des ouvertures', () => {
  it('mur sans ouverture : un seul morceau, onglets compris', () => {
    expect(resume(decouperMur(-E, L + E, L, H, []))).toEqual([`plein ${-E}→${L + E} [0–250]`]);
  });

  it('fenêtre au milieu : deux trumeaux, une allège, un linteau', () => {
    // Fenêtre de 100 × 125 cm à 150 cm du début, allège 95 cm.
    const m = decouperMur(-E, L + E, L, H, [{ debut: 150, largeur: 100, allege: 95, hauteur: 125 }]);
    expect(resume(m)).toEqual([
      `plein ${-E}→150 [0–250]`,
      'allege 150→250 [0–95]',
      'linteau 150→250 [220–250]',
      `plein 250→${L + E} [0–250]`,
    ]);
  });

  it('porte : linteau au-dessus, rien en dessous (le seuil reste ouvert)', () => {
    const m = decouperMur(-E, L + E, L, H, [{ debut: 50, largeur: 83, allege: 0, hauteur: 204 }]);
    expect(resume(m)).toEqual([`plein ${-E}→50 [0–250]`, 'linteau 50→133 [204–250]', `plein 133→${L + E} [0–250]`]);
  });

  it('ouverture plus haute que le mur : aucun linteau', () => {
    const m = decouperMur(-E, L + E, L, H, [{ debut: 100, largeur: 240, allege: 0, hauteur: 300 }]);
    expect(resume(m)).toEqual([`plein ${-E}→100 [0–250]`, `plein 340→${L + E} [0–250]`]);
  });

  it('ouverture contre l’angle : le retour d’angle (onglet) reste plein', () => {
    const m = decouperMur(-E, L + E, L, H, [{ debut: 0, largeur: 83, allege: 0, hauteur: 204 }]);
    expect(resume(m)).toEqual([`plein ${-E}→0 [0–250]`, 'linteau 0→83 [204–250]', `plein 83→${L + E} [0–250]`]);
  });

  it('ouverture qui déborde du côté : bornée au côté intérieur', () => {
    const m = decouperMur(-E, L + E, L, H, [{ debut: 350, largeur: 100, allege: 0, hauteur: 204 }]);
    expect(resume(m)).toEqual([`plein ${-E}→350 [0–250]`, 'linteau 350→400 [204–250]', `plein 400→${L + E} [0–250]`]);
  });

  it('ouvertures qui se chevauchent (même porte vue des deux pièces) : réunion sans doublon', () => {
    const porte = { debut: 50, largeur: 83, allege: 0, hauteur: 204 };
    const m = decouperMur(-E, L + E, L, H, [porte, { ...porte, debut: 50.05 }]);
    expect(resume(m)).toEqual([`plein ${-E}→50 [0–250]`, 'linteau 50→133 [204–250]', `plein 133→${L + E} [0–250]`]);
  });

  it('ouvertures superposées : morceau entre-deux', () => {
    const m = decouperMur(0, L, L, H, [
      { debut: 100, largeur: 100, allege: 0, hauteur: 100 },
      { debut: 100, largeur: 100, allege: 150, hauteur: 50 },
    ]);
    expect(resume(m)).toEqual([
      'plein 0→100 [0–250]',
      'entre-deux 100→200 [100–150]',
      'linteau 100→200 [200–250]',
      'plein 200→400 [0–250]',
    ]);
  });

  it('la surface pleine vaut la surface du mur moins les ouvertures', () => {
    const m = decouperMur(0, L, L, H, [
      { debut: 150, largeur: 100, allege: 95, hauteur: 125 },
      { debut: 20, largeur: 83, allege: 0, hauteur: 204 },
    ]);
    const surface = m.reduce((s, x) => s + (x.fin - x.debut) * (x.haut - x.bas), 0);
    expect(surface).toBeCloseTo(L * H - 100 * 125 - 83 * 204, 6);
  });

  it('ignore les ouvertures de largeur ou de hauteur nulle', () => {
    const g = grilleMur(0, L, L, H, [
      { debut: 100, largeur: 0, allege: 0, hauteur: 200 },
      { debut: 100, largeur: 50, allege: 0, hauteur: 0 },
    ]);
    expect(g.colonnes).toEqual([0, L]);
    expect(g.bandes).toEqual([0, H]);
    expect(g.plein).toEqual([[true]]);
  });

  it('quadrillage : cellules vides exactement à l’emplacement des ouvertures', () => {
    const g = grilleMur(-E, L + E, L, H, [{ debut: 150, largeur: 100, allege: 95, hauteur: 125 }]);
    expect(g.colonnes).toEqual([-E, 0, 150, 250, 400, L + E]);
    expect(g.bandes).toEqual([0, 95, 220, 250]);
    expect(g.plein.map((c) => c.map((p) => (p ? 'X' : '.')).join(''))).toEqual(['XXX', 'XXX', 'X.X', 'XXX', 'XXX']);
  });
});

describe('emprise d’une colonne de mur', () => {
  const trapeze = trapezeMur(L, { s: -E, t: E }, { s: L + E, t: E });

  it('les colonnes recouvrent exactement le trapèze', () => {
    const g = grilleMur(-E, L + E, L, H, [{ debut: 150, largeur: 100, allege: 95, hauteur: 125 }]);
    let total = 0;
    for (let c = 0; c + 1 < g.colonnes.length; c++) {
      total += Math.abs(aireMur(couperBande(trapeze, g.colonnes[c], g.colonnes[c + 1])));
    }
    expect(total).toBeCloseTo(Math.abs(aireMur(trapeze)), 6);
    // (400 + 419,6) / 2 × 9,8
    expect(Math.abs(aireMur(trapeze))).toBeCloseTo(((L + L + 2 * E) / 2) * E, 6);
  });

  it('les points de coupe tombent exactement sur la borne et gardent les sommets d’origine', () => {
    const p = couperBande(trapeze, 0, 150);
    expect(p.filter((x) => x.origine === undefined).every((x) => x.s === 0 || x.s === 150)).toBe(true);
    expect(p.some((x) => x.origine === 0)).toBe(true);
  });

  it('classe les bords : nus intérieur / extérieur, onglets, coupes', () => {
    const premiere = couperBande(trapeze, -E, 150);
    const bords = premiere.map((a, i) => classerBord(a, premiere[(i + 1) % premiere.length], -E, 150, trapeze));
    expect(new Set(bords)).toEqual(new Set(['interieur', 'exterieur', 'debut', 'droite']));
    const milieu = couperBande(trapeze, 150, 250);
    const bordsMilieu = milieu.map((a, i) => classerBord(a, milieu[(i + 1) % milieu.length], 150, 250, trapeze));
    expect(new Set(bordsMilieu)).toEqual(new Set(['interieur', 'exterieur', 'gauche', 'droite']));
  });

  it('angle rentrant : l’onglet entre dans la colonne sans la retourner', () => {
    // Nu extérieur plus court que le nu intérieur (angle rentrant au départ).
    const t = trapezeMur(L, { s: E, t: E }, { s: L + E, t: E });
    const p = couperBande(t, 0, 5);
    expect(aireMur(p)).toBeGreaterThan(0);
    const bords = p.map((a, i) => classerBord(a, p[(i + 1) % p.length], 0, 5, t));
    expect(bords).toContain('debut');
  });
});
