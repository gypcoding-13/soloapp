// Tous les montants sont des entiers en centimes.
// Toutes les quantites sont des entiers en milliemes.
// Tous les pourcentages sont des entiers en centiemes de pourcent (bps/100).
//   20 %   -> 2000
//   5,5 %  -> 550
//   10 %   -> 1000

export const PCT = 10000; // 100,00 % exprime en centiemes de pourcent
export const QTY = 1000;  // 1 unite exprimee en milliemes

// Arrondi commercial : au plus proche, les demis s'eloignent de zero.
// Math.round() en JS arrondit -0.5 vers 0, ce qui est faux pour un avoir.
export function roundHalfAwayFromZero(x) {
  if (!Number.isFinite(x)) throw new TypeError('valeur non finie');
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

// Division entiere arrondie. Toute conversion en centimes passe par ici.
export function divRound(numerator, denominator) {
  if (denominator === 0) throw new RangeError('division par zero');
  return roundHalfAwayFromZero(numerator / denominator);
}

export function assertInt(value, nom) {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${nom} doit etre un entier sur (recu: ${value})`);
  }
  return value;
}

// Saisie utilisateur "1 234,56" -> 123456
export function parseAmount(saisie) {
  if (typeof saisie === 'number') return roundHalfAwayFromZero(saisie * 100);
  const nettoye = String(saisie).replace(/\s|\u00a0/g, '').replace(',', '.');
  if (!/^-?\d*\.?\d*$/.test(nettoye) || nettoye === '' || nettoye === '.') {
    throw new TypeError(`montant illisible: ${saisie}`);
  }
  return roundHalfAwayFromZero(parseFloat(nettoye) * 100);
}

export function parseQty(saisie) {
  if (typeof saisie === 'number') return roundHalfAwayFromZero(saisie * QTY);
  const nettoye = String(saisie).replace(/\s|\u00a0/g, '').replace(',', '.');
  if (!/^-?\d*\.?\d*$/.test(nettoye) || nettoye === '' || nettoye === '.') {
    throw new TypeError(`quantite illisible: ${saisie}`);
  }
  return roundHalfAwayFromZero(parseFloat(nettoye) * QTY);
}

export function parsePercent(saisie) {
  if (typeof saisie === 'number') return roundHalfAwayFromZero(saisie * 100);
  const nettoye = String(saisie).replace(/\s|\u00a0|%/g, '').replace(',', '.');
  if (!/^\d*\.?\d*$/.test(nettoye) || nettoye === '' || nettoye === '.') {
    throw new TypeError(`pourcentage illisible: ${saisie}`);
  }
  return roundHalfAwayFromZero(parseFloat(nettoye) * 100);
}

const nfAmount = new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatAmount(centimes) {
  assertInt(centimes, 'montant');
  return nfAmount.format(centimes / 100);
}

export function formatAmountEUR(centimes) {
  return formatAmount(centimes) + '\u00a0€';
}

// Une quantite s'affiche sans decimales inutiles : 24 et non 24,000
export function formatQty(milliemes) {
  assertInt(milliemes, 'quantite');
  const v = milliemes / QTY;
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(v);
}

export function formatPercent(centiemes) {
  assertInt(centiemes, 'pourcentage');
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 })
    .format(centiemes / 100) + '\u00a0%';
}
