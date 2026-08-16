// Sequences independantes. Le compteur ne redescend JAMAIS.
// Un numero n'est attribue qu'a l'emission, jamais sur un brouillon.

export const SEQUENCES = {
  devis: { prefixeDefaut: 'DV-', cle: 'devis' },
  facture: { prefixeDefaut: 'FA-', cle: 'facture' },
  avoir: { prefixeDefaut: 'AV-', cle: 'avoir' },
};

export function cleCompteur(type, annee) {
  if (!SEQUENCES[type]) throw new RangeError(`type de document inconnu: ${type}`);
  if (!Number.isInteger(annee) || annee < 2000 || annee > 2999) {
    throw new RangeError(`annee invalide: ${annee}`);
  }
  return `${type}:${annee}`;
}

export function formaterNumero(prefixe, annee, rang) {
  if (!Number.isInteger(rang) || rang < 1) throw new RangeError('rang invalide');
  if (rang > 9999) return `${prefixe}${annee}-${String(rang)}`;
  return `${prefixe}${annee}-${String(rang).padStart(4, '0')}`;
}

// Reserve le rang suivant. A appeler DANS la meme transaction que
// l'enregistrement du document. Si l'enregistrement echoue, la transaction
// est annulee et le compteur ne bouge pas : pas de trou possible.
export function prochainRang(compteur) {
  const rang = (compteur?.dernierRang ?? 0) + 1;
  return { rang, compteur: { ...compteur, dernierRang: rang } };
}

// Regle d'import (decision du chef) : le compteur ne redescend jamais.
export function fusionnerCompteurs(local, importe) {
  const fusion = new Map();
  for (const c of [...(local ?? []), ...(importe ?? [])]) {
    const existant = fusion.get(c.cle);
    if (!existant || c.dernierRang > existant.dernierRang) {
      fusion.set(c.cle, { ...c });
    }
  }
  return [...fusion.values()].sort((a, b) => a.cle.localeCompare(b.cle));
}

// Verrouillage du point de depart : modifiable tant que rien n'est emis.
export function definirPointDeDepart(compteur, rangInitial) {
  if (compteur?.verrouille) {
    throw new Error('le point de depart est verrouille : des documents ont deja ete emis');
  }
  if (!Number.isInteger(rangInitial) || rangInitial < 0) {
    throw new RangeError('rang initial invalide');
  }
  return { ...compteur, dernierRang: rangInitial };
}

// Detection de trou dans une sequence : ce qu'on montre en cas de controle.
export function verifierSequence(numerosEmis) {
  const rangs = numerosEmis
    .map((n) => n.rang)
    .sort((a, b) => a - b);
  const trous = [];
  const doublons = [];
  for (let i = 0; i < rangs.length; i++) {
    if (i > 0 && rangs[i] === rangs[i - 1]) doublons.push(rangs[i]);
    const attendu = i === 0 ? rangs[0] : rangs[i - 1] + 1;
    if (i > 0 && rangs[i] > attendu) {
      for (let r = attendu; r < rangs[i]; r++) trous.push(r);
    }
  }
  return { conforme: trous.length === 0 && doublons.length === 0, trous, doublons };
}
