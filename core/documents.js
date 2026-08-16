import { figerTotaux, soldeFacture } from './totals.js';
import { SEQUENCES, cleCompteur, prochainRang, formaterNumero } from './numbering.js';

export const STATUTS = {
  devis: ['brouillon', 'emis', 'envoye', 'accepte', 'refuse', 'expire', 'converti'],
  facture: ['brouillon', 'emise', 'envoyee', 'partiellement_reglee', 'soldee', 'annulee'],
  avoir: ['brouillon', 'emis', 'envoye'],
};

// Un document dans l'un de ces statuts ne se modifie plus et ne se supprime plus.
const FIGES = new Set([
  'emis', 'envoye', 'accepte', 'refuse', 'expire', 'converti',
  'emise', 'envoyee', 'partiellement_reglee', 'soldee', 'annulee',
]);

const TRANSITIONS = {
  devis: {
    brouillon: ['emis'],
    emis: ['envoye', 'accepte', 'refuse', 'expire'],
    envoye: ['accepte', 'refuse', 'expire'],
    accepte: ['converti'],
    refuse: [],
    expire: ['accepte'],
    converti: [],
  },
  facture: {
    brouillon: ['emise'],
    emise: ['envoyee', 'partiellement_reglee', 'soldee', 'annulee'],
    envoyee: ['partiellement_reglee', 'soldee', 'annulee'],
    partiellement_reglee: ['soldee', 'annulee'],
    soldee: ['annulee'],
    annulee: [],
  },
  avoir: {
    brouillon: ['emis'],
    emis: ['envoye'],
    envoye: [],
  },
};

export function estFige(doc) {
  return FIGES.has(doc.statut);
}

export function estModifiable(doc) {
  return !estFige(doc);
}

export function assertModifiable(doc) {
  if (estFige(doc)) {
    throw new Error(
      `document ${doc.numero ?? doc.id} au statut "${doc.statut}" : non modifiable. ` +
      (doc.type === 'facture'
        ? 'Emettre un avoir pour corriger.'
        : 'Dupliquer pour repartir de ce document.')
    );
  }
}

export function transitionAutorisee(doc, cible) {
  const table = TRANSITIONS[doc.type];
  if (!table) throw new RangeError(`type inconnu: ${doc.type}`);
  return (table[doc.statut] ?? []).includes(cible);
}

export function changerStatut(doc, cible) {
  if (!transitionAutorisee(doc, cible)) {
    throw new Error(`transition interdite: ${doc.statut} -> ${cible}`);
  }
  return { ...doc, statut: cible, majLe: horodatage() };
}

// EMISSION : le seul endroit ou un numero est attribue.
// L'appelant DOIT executer ceci dans une transaction IndexedDB unique
// couvrant le document et le compteur.
export function emettre(doc, compteur, reglages, maintenant = new Date()) {
  if (doc.statut !== 'brouillon') {
    throw new Error(`seul un brouillon peut etre emis (statut actuel: ${doc.statut})`);
  }
  if (doc.numero) throw new Error('ce document porte deja un numero');
  const lignes = (doc.lignes ?? []).filter((l) => !l.type || l.type === 'prestation');
  if (lignes.length === 0) throw new Error('un document emis doit comporter au moins une prestation');
  if (!doc.clientId) throw new Error('aucun client rattache');

  const annee = maintenant.getFullYear();
  const cle = cleCompteur(doc.type, annee);
  if (compteur.cle !== cle) throw new Error(`compteur inadapte: attendu ${cle}, recu ${compteur.cle}`);

  const { rang, compteur: compteurMaj } = prochainRang(compteur);
  const prefixe = reglages?.prefixes?.[doc.type] ?? SEQUENCES[doc.type].prefixeDefaut;
  const numero = formaterNumero(prefixe, annee, rang);

  const docEmis = {
    ...doc,
    numero,
    rang,
    annee,
    statut: doc.type === 'facture' ? 'emise' : 'emis',
    emisLe: horodatage(maintenant),
    majLe: horodatage(maintenant),
    // Instantane : mentions, conditions et identite figees a l'emission.
    // Un changement de reglages ne doit jamais alterer un document emis.
    empreinteEmetteur: instantaneEmetteur(reglages),
    totaux: figerTotaux(doc),
  };

  return {
    document: docEmis,
    compteur: { ...compteurMaj, verrouille: true },
  };
}

// CONVERSION : le devis source est verrouille definitivement (decision 3).
export function convertirEnFacture(devis, maintenant = new Date()) {
  if (devis.type !== 'devis') throw new Error('seul un devis se convertit en facture');
  if (devis.statut !== 'accepte') {
    throw new Error(`le devis doit etre accepte avant conversion (statut: ${devis.statut})`);
  }
  const facture = {
    id: nouvelId(),
    type: 'facture',
    statut: 'brouillon',
    clientId: devis.clientId,
    // Copie autonome des lignes (decision 2) : aucun lien vers le catalogue.
    lignes: devis.lignes.map((l) => ({ ...l, id: nouvelId() })),
    remiseGlobale: devis.remiseGlobale ?? 0,
    notes: devis.notes ?? '',
    devisSourceId: devis.id,
    devisSourceNumero: devis.numero,
    creeLe: horodatage(maintenant),
    majLe: horodatage(maintenant),
    reglements: [],
  };
  return {
    facture,
    devis: { ...devis, statut: 'converti', factureId: facture.id, majLe: horodatage(maintenant) },
  };
}

// AVOIR : seule facon de corriger ou d'annuler une facture emise.
export function creerAvoir(facture, { motif, partiel = null }, maintenant = new Date()) {
  if (facture.type !== 'facture') throw new Error('un avoir se rattache a une facture');
  if (facture.statut === 'brouillon') throw new Error('une facture non emise se modifie directement');
  if (facture.statut === 'annulee') throw new Error('cette facture est deja annulee');
  if (!motif || !String(motif).trim()) throw new Error('le motif de l avoir est obligatoire');

  const lignes = (partiel ?? facture.lignes).map((l) => ({
    ...l,
    id: nouvelId(),
    qte: -Math.abs(l.qte),
  }));

  return {
    id: nouvelId(),
    type: 'avoir',
    statut: 'brouillon',
    clientId: facture.clientId,
    lignes,
    remiseGlobale: facture.remiseGlobale ?? 0,
    factureSourceId: facture.id,
    factureSourceNumero: facture.numero,
    motif: String(motif).trim(),
    total: partiel === null,
    creeLe: horodatage(maintenant),
    majLe: horodatage(maintenant),
  };
}

// REGLEMENTS : partiels autorises, statut deduit du solde.
export function enregistrerReglement(facture, { montant, date, moyen, note }) {
  if (!['emise', 'envoyee', 'partiellement_reglee'].includes(facture.statut)) {
    throw new Error(`aucun reglement possible sur une facture ${facture.statut}`);
  }
  if (!Number.isSafeInteger(montant) || montant === 0) {
    throw new RangeError('montant de reglement invalide');
  }
  const reglements = [
    ...(facture.reglements ?? []),
    { id: nouvelId(), montant, date, moyen: moyen ?? 'virement', note: note ?? '' },
  ];
  const provisoire = { ...facture, reglements };
  const { restant } = soldeFacture(provisoire);
  if (restant < 0) throw new RangeError('le total regle depasse le montant de la facture');
  return { ...provisoire, statut: restant === 0 ? 'soldee' : 'partiellement_reglee' };
}

// DUPLICATION : le geste le plus frequent. Repart d'un brouillon propre.
export function dupliquer(doc, maintenant = new Date()) {
  return {
    id: nouvelId(),
    type: doc.type === 'avoir' ? 'devis' : doc.type,
    statut: 'brouillon',
    clientId: doc.clientId,
    lignes: (doc.lignes ?? []).map((l) => ({ ...l, id: nouvelId() })),
    remiseGlobale: doc.remiseGlobale ?? 0,
    notes: doc.notes ?? '',
    creeLe: horodatage(maintenant),
    majLe: horodatage(maintenant),
    reglements: [],
  };
}

// SIGNATURE : uniquement sur un devis emis, jamais sur un brouillon.
export function apposerSignature(devis, { trace, nomSignataire, accepteConditions }, maintenant = new Date()) {
  if (devis.type !== 'devis') throw new Error('seul un devis se fait signer');
  if (devis.statut === 'brouillon') throw new Error('le devis doit etre emis avant signature');
  if (devis.signature) throw new Error('ce devis est deja signe');
  if (!nomSignataire || !String(nomSignataire).trim()) {
    throw new Error('le nom du signataire est obligatoire');
  }
  if (!accepteConditions) throw new Error('les conditions doivent etre acceptees');
  if (!trace || !trace.length) throw new Error('signature vide');

  return {
    ...devis,
    statut: 'accepte',
    signature: {
      trace,
      nomSignataire: String(nomSignataire).trim(),
      signeLe: horodatage(maintenant),
    },
    majLe: horodatage(maintenant),
  };
}

function instantaneEmetteur(reglages) {
  const r = reglages ?? {};
  return {
    raisonSociale: r.raisonSociale ?? '',
    formeJuridique: r.formeJuridique ?? '',
    adresse: r.adresse ?? '',
    codePostal: r.codePostal ?? '',
    ville: r.ville ?? '',
    siret: r.siret ?? '',
    rcs: r.rcs ?? '',
    apeCode: r.apeCode ?? '',
    tvaIntra: r.tvaIntra ?? '',
    regimeTva: r.regimeTva ?? 'assujetti',
    telephone: r.telephone ?? '',
    email: r.email ?? '',
    logo: r.logo ?? null,
    coordonneesPaiement: r.coordonneesPaiement ?? '',
    delaiPaiement: r.delaiPaiement ?? '',
    penalites: r.penalites ?? '',
    indemniteRecouvrement: r.indemniteRecouvrement ?? '',
    assurance: r.assurance ?? '',
    mentionLibre: r.mentionLibre ?? '',
    cgv: r.cgv ?? '',
    couleur: r.couleur ?? '#B85C38',
    typographie: r.typographie ?? 'technique',
  };
}

export function horodatage(d = new Date()) {
  return d.toISOString();
}

export function nouvelId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
