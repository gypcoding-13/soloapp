import { PCT, QTY, divRound, assertInt } from './money.js';

// REGLE D'ARRONDI FIGEE (decision 1)
//   1. Chaque ligne est arrondie au centime, remise de ligne incluse.
//   2. Les lignes sont sommees exactement, groupees par taux de TVA.
//   3. La remise globale s'applique a chaque base de taux, arrondie au centime.
//   4. La TVA est calculee sur la base arrondie de chaque taux.
//   5. Le TTC est la somme exacte des bases et des TVA.
// Aucune autre etape n'arrondit. Cette regle ne doit jamais changer :
// elle est figee dans les documents deja emis.

export const TYPES_LIGNE = ['prestation', 'section', 'texte'];

export function ligneHT(ligne) {
  if (ligne.type && ligne.type !== 'prestation') return 0;
  assertInt(ligne.qte, 'qte');
  assertInt(ligne.pu, 'pu');
  const remise = ligne.remise ?? 0;
  assertInt(remise, 'remise');
  if (remise < 0 || remise > PCT) throw new RangeError('remise de ligne hors bornes');
  // qte (milliemes) x pu (centimes) x (100% - remise) -> centimes
  return divRound(ligne.qte * ligne.pu * (PCT - remise), QTY * PCT);
}

export function calculerTotaux(doc) {
  const lignes = doc.lignes ?? [];
  const remiseGlobale = doc.remiseGlobale ?? 0;
  assertInt(remiseGlobale, 'remiseGlobale');
  if (remiseGlobale < 0 || remiseGlobale > PCT) {
    throw new RangeError('remise globale hors bornes');
  }

  const parTaux = new Map();
  let brutHT = 0;

  for (const ligne of lignes) {
    if (ligne.type && ligne.type !== 'prestation') continue;
    const taux = ligne.tva ?? 0;
    assertInt(taux, 'tva');
    if (taux < 0 || taux > PCT) throw new RangeError('taux de TVA hors bornes');
    const ht = ligneHT(ligne);
    brutHT += ht;
    parTaux.set(taux, (parTaux.get(taux) ?? 0) + ht);
  }

  const ventilation = [];
  let totalHT = 0;
  let totalTVA = 0;

  for (const taux of [...parTaux.keys()].sort((a, b) => b - a)) {
    const brut = parTaux.get(taux);
    const base = remiseGlobale === 0
      ? brut
      : divRound(brut * (PCT - remiseGlobale), PCT);
    const tva = divRound(base * taux, PCT);
    ventilation.push({ taux, base, tva });
    totalHT += base;
    totalTVA += tva;
  }

  return {
    brutHT,
    remiseGlobaleMontant: brutHT - totalHT,
    ventilation,
    totalHT,
    totalTVA,
    totalTTC: totalHT + totalTVA,
  };
}

// Un document emis fige ses totaux. On ne recalcule jamais un document emis :
// on relit ce qui a ete stocke. Cette fonction sert a produire l'instantane.
export function figerTotaux(doc) {
  const t = calculerTotaux(doc);
  return Object.freeze({
    ...t,
    ventilation: Object.freeze(t.ventilation.map(Object.freeze)),
  });
}

// Solde restant du sur une facture, d'apres ses reglements enregistres.
export function soldeFacture(facture) {
  const regle = (facture.reglements ?? [])
    .reduce((somme, r) => somme + assertInt(r.montant, 'reglement'), 0);
  const avoirs = (facture.avoirsMontant ?? 0);
  return {
    regle,
    avoirs,
    restant: facture.totaux.totalTTC - regle - avoirs,
  };
}
