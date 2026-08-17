import { emettre } from './documents.js';
import { cleCompteur, fusionnerCompteurs, definirPointDeDepart } from './numbering.js';
import { nouvelId, horodatage } from './documents.js';

export const NOM_BASE = 'soloapp';
export const VERSION_SCHEMA = 1;

// Chaque migration transforme la base de la version n-1 vers n.
// On n'en supprime jamais une : une base ancienne doit pouvoir remonter
// jusqu'a la version courante en les enchainant.
const MIGRATIONS = [
  function v1(db) {
    db.createObjectStore('reglages', { keyPath: 'id' });
    const clients = db.createObjectStore('clients', { keyPath: 'id' });
    clients.createIndex('nom', 'nom');
    clients.createIndex('archive', 'archive');
    const articles = db.createObjectStore('articles', { keyPath: 'id' });
    articles.createIndex('designation', 'designation');
    articles.createIndex('archive', 'archive');
    const documents = db.createObjectStore('documents', { keyPath: 'id' });
    documents.createIndex('type', 'type');
    documents.createIndex('statut', 'statut');
    documents.createIndex('clientId', 'clientId');
    documents.createIndex('numero', 'numero', { unique: true });
    documents.createIndex('typeStatut', ['type', 'statut']);
    db.createObjectStore('pdfs', { keyPath: 'documentId' });
    db.createObjectStore('compteurs', { keyPath: 'cle' });
    const journal = db.createObjectStore('journal', { keyPath: 'id' });
    journal.createIndex('horodatage', 'horodatage');
  },
];

let _db = null;

export function ouvrir(indexedDB = globalThis.indexedDB) {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(NOM_BASE, VERSION_SCHEMA);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      for (let v = e.oldVersion; v < VERSION_SCHEMA; v++) MIGRATIONS[v](db, req.transaction);
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

export function fermer() {
  if (_db) { _db.close(); _db = null; }
}

function attendre(req) {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

function finTransaction(tx) {
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error ?? new Error('transaction annulee'));
  });
}

export async function lire(magasin, cle) {
  const db = await ouvrir();
  return attendre(db.transaction(magasin).objectStore(magasin).get(cle));
}

export async function tout(magasin) {
  const db = await ouvrir();
  return attendre(db.transaction(magasin).objectStore(magasin).getAll());
}

export async function ecrire(magasin, valeur) {
  const db = await ouvrir();
  const tx = db.transaction(magasin, 'readwrite');
  tx.objectStore(magasin).put(valeur);
  await finTransaction(tx);
  return valeur;
}

export async function supprimer(magasin, cle) {
  const db = await ouvrir();
  const tx = db.transaction(magasin, 'readwrite');
  tx.objectStore(magasin).delete(cle);
  await finTransaction(tx);
}

// --- Reglages ---

export const REGLAGES_DEFAUT = {
  id: 'unique',
  raisonSociale: '', formeJuridique: 'EI', adresse: '', codePostal: '', ville: '',
  siret: '', rcs: '', apeCode: '', regimeTva: 'assujetti', tvaIntra: '',
  tauxDefaut: 2000, telephone: '', email: '', logo: null,
  logoPosition: 'gauche', logoFiligrane: false,
  moyensPaiement: ['virement'], iban: '', titulaire: '',
  coordonneesPaiement: '', delaiPaiement: '30 jours',
  validiteDevis: 30, penalites: "3 × taux d'intérêt légal",
  indemniteRecouvrement: '40 €', assurance: '', mentionLibre: '', cgv: '',
  couleur: '#B85C38', typographie: 'technique',
  prefixes: { devis: 'DV-', facture: 'FA-', avoir: 'AV-' },
  objetMail: 'Devis {numero} — {societe}',
  corpsMail: 'Bonjour,\n\nVeuillez trouver ci-joint le devis {numero} d\'un montant de {montant}.\n\nCe devis est valable jusqu\'au {validite}.\n\nCordialement',
  deviceId: null, activation: null, configure: false,
};

export async function lireReglages() {
  const r = await lire('reglages', 'unique');
  return { ...REGLAGES_DEFAUT, ...(r ?? {}) };
}

export function ecrireReglages(r) {
  return ecrire('reglages', { ...r, id: 'unique' });
}

// --- Emission : document + compteur + journal dans UNE transaction ---
// Si quoi que ce soit echoue, la transaction est annulee et le compteur
// ne bouge pas. C'est ce qui garantit l'absence de trou dans la sequence.

export async function emettreDocument(doc, reglages, maintenant = new Date()) {
  const db = await ouvrir();
  const annee = maintenant.getFullYear();
  const cle = cleCompteur(doc.type, annee);
  const tx = db.transaction(['documents', 'compteurs', 'journal'], 'readwrite');

  const compteurExistant = await attendre(tx.objectStore('compteurs').get(cle));
  const compteur = compteurExistant ?? { cle, dernierRang: 0, verrouille: false };

  let resultat;
  try {
    resultat = emettre(doc, compteur, reglages, maintenant);
  } catch (err) {
    tx.abort();
    throw err;
  }

  tx.objectStore('documents').put(resultat.document);
  tx.objectStore('compteurs').put(resultat.compteur);
  tx.objectStore('journal').put({
    id: nouvelId(), horodatage: horodatage(maintenant), action: 'emission',
    documentId: resultat.document.id, numero: resultat.document.numero,
    detail: `${doc.type} — ${resultat.document.totaux.totalTTC} c TTC`,
  });

  await finTransaction(tx);
  return resultat.document;
}

// Point de depart des sequences : modifiable tant que rien n'est emis.
export async function lireCompteur(type, annee = new Date().getFullYear()) {
  const cle = cleCompteur(type, annee);
  return (await lire('compteurs', cle)) ?? { cle, dernierRang: 0, verrouille: false };
}

export async function definirDepart(type, rangInitial, annee = new Date().getFullYear()) {
  const compteur = await lireCompteur(type, annee);
  return ecrire('compteurs', definirPointDeDepart(compteur, rangInitial));
}

export async function enregistrerPdf(documentId, blob) {
  return ecrire('pdfs', { documentId, blob, genereLe: horodatage() });
}

export async function documentsPar(type) {
  const db = await ouvrir();
  const idx = db.transaction('documents').objectStore('documents').index('type');
  const liste = await attendre(idx.getAll(type));
  return liste.sort((a, b) => (b.creeLe ?? '').localeCompare(a.creeLe ?? ''));
}

export async function journalNumeros(type, annee) {
  const docs = await documentsPar(type);
  return docs
    .filter((d) => d.numero && d.annee === annee)
    .map((d) => ({ rang: d.rang, numero: d.numero, emisLe: d.emisLe }))
    .sort((a, b) => a.rang - b.rang);
}

// --- Export / import ---

const MAGASINS_DONNEES = ['reglages', 'clients', 'articles', 'documents', 'compteurs', 'journal'];

// Les PDF archives representent l'essentiel du poids et se regenerent depuis
// les documents : la sauvegarde ne les embarque pas.
export async function exporter() {
  const paquet = { format: 'soloapp', version: VERSION_SCHEMA, exporteLe: horodatage(), donnees: {} };
  for (const m of MAGASINS_DONNEES) paquet.donnees[m] = await tout(m);
  return paquet;
}

export async function poidsSauvegarde() {
  const paquet = await exporter();
  const donnees = new Blob([JSON.stringify(paquet)]).size;
  const pdfs = await tout('pdfs');
  const poidsPdfs = pdfs.reduce((somme, p) => somme + (p.blob?.size ?? 0), 0);
  return { donnees, pdfs: poidsPdfs, nbPdfs: pdfs.length };
}

// mode 'remplacer' : on ecrase tout.
// mode 'fusionner' : on ajoute ce qui manque sans toucher a l'existant.
// Dans les deux cas les compteurs ne redescendent jamais.
export async function importer(paquet, mode = 'fusionner') {
  if (paquet?.format !== 'soloapp') throw new Error('fichier de sauvegarde non reconnu');
  if (paquet.version > VERSION_SCHEMA) {
    throw new Error('sauvegarde produite par une version plus recente de SoloApp');
  }
  const db = await ouvrir();
  const compteursLocaux = await tout('compteurs');
  const tx = db.transaction(MAGASINS_DONNEES, 'readwrite');

  for (const m of MAGASINS_DONNEES) {
    const store = tx.objectStore(m);
    if (mode === 'remplacer' && m !== 'compteurs') store.clear();
    for (const item of paquet.donnees[m] ?? []) {
      if (m === 'compteurs') continue;
      if (mode === 'fusionner') {
        const cle = m === 'reglages' ? 'unique' : item.id;
        const existant = await attendre(store.get(cle));
        if (existant) continue;
      }
      store.put(item);
    }
  }

  const compteurs = tx.objectStore('compteurs');
  compteurs.clear();
  for (const c of fusionnerCompteurs(compteursLocaux, paquet.donnees.compteurs)) {
    compteurs.put(c);
  }

  await finTransaction(tx);
}

export async function espaceUtilise() {
  if (!navigator.storage?.estimate) return null;
  const { usage, quota } = await navigator.storage.estimate();
  return { usage, quota, ratio: quota ? usage / quota : 0 };
}

export async function demanderPersistance() {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}
