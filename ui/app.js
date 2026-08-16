import { $, ech, ico, eur, dateFr, tampon, feuille, confirmer, telecharger } from './kit.js';
import {
  ouvrir, lireReglages, ecrireReglages, demanderPersistance, espaceUtilise,
  exporter, importer, documentsPar, journalNumeros,
} from '../core/db.js';
import { verifier, normaliser, nouvelIdentifiantAppareil } from '../core/activation.js';
import { vueClients, vueArticles, vueReglages } from './fiches.js';
import { vueDocuments, vueDocument } from './documents.js';
import { calculerTotaux, soldeFacture } from '../core/totals.js';

const racine = document.getElementById('app');
let reglages;

const ONGLETS = [
  ['devis', 'Devis', 'devis'],
  ['factures', 'Factures', 'facture'],
  ['clients', 'Clients', 'clients'],
  ['produits', 'Produits', 'produits'],
  ['reglages', 'Réglages', 'reglages'],
];

// ---------------------------------------------------------------- Démarrage

async function demarrer() {
  await ouvrir();
  reglages = await lireReglages();

  if (!reglages.activation) return ecranActivation();
  if (!reglages.configure) return ecranConfiguration();
  coquille();
  aller(location.hash.slice(1) || 'devis');
}

function ecranActivation() {
  racine.innerHTML = `
    <div class="accueil">
      <img src="./assets/icon-192.png" alt="">
      <h2>SoloApp</h2>
      <p>Vos devis et factures, dans votre téléphone.<br>Saisissez le code que vous avez reçu.</p>
      <input id="code" placeholder="SOLO-XXXX-XXXX-XXXX" autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength="24">
      <div class="erreur" id="err" hidden></div>
      <button class="btn btn-accent btn-large" id="ok" style="margin-top:14px">Activer</button>
    </div>`;

  const champ = $('#code');
  champ.oninput = () => {
    const n = normaliser(champ.value);
    if (n) champ.value = n;
    $('#err').hidden = true;
  };
  $('#ok').onclick = async () => {
    const err = $('#err');
    const r = await verifier(champ.value);
    if (!r.valide) {
      err.textContent = r.motif === 'format'
        ? 'Le code comporte 12 caractères après SOLO.'
        : 'Ce code n’est pas reconnu.';
      err.hidden = false;
      return;
    }
    await demanderPersistance();
    reglages = { ...reglages, activation: { code: r.code, le: new Date().toISOString() }, deviceId: nouvelIdentifiantAppareil() };
    await ecrireReglages(reglages);
    ecranConfiguration();
  };
}

function ecranConfiguration() {
  racine.innerHTML = `
    <div class="barre"><h1>Votre entreprise</h1></div>
    <div class="vue" id="vue"></div>`;
  vueReglages($('#vue'), {
    premierLancement: true,
    apres: async (r) => { reglages = r; coquille(); aller('devis'); },
  });
}

// ---------------------------------------------------------------- Coquille

function coquille() {
  racine.innerHTML = `
    <div class="barre">
      <button class="retour" id="retour" hidden aria-label="Retour">${ico('retour')}</button>
      <h1 id="titre">Devis</h1>
    </div>
    <div class="vue avec-onglets" id="vue"></div>
    <button class="fab" id="fab" aria-label="Nouveau">${ico('plus', 2.4)}</button>
    <nav class="onglets">
      ${ONGLETS.map(([id, libelle, icone]) =>
        `<button data-o="${id}">${ico(icone, 1.8)}<span>${libelle}</span></button>`).join('')}
    </nav>`;

  racine.querySelectorAll('[data-o]').forEach((b) => b.onclick = () => aller(b.dataset.o));
  $('#retour').onclick = () => history.back();
  $('#fab').onclick = () => {
    const v = etat.vue;
    if (v === 'clients') return import('./fiches.js').then((m) => m.ficheClient());
    if (v === 'produits') return import('./fiches.js').then((m) => m.ficheArticle());
    aller('document', { type: v === 'factures' ? 'facture' : 'devis' });
  };
}

const etat = { vue: 'devis', params: {} };

export async function aller(vue, params = {}) {
  etat.vue = vue; etat.params = params;
  const app = $('#vue');
  const barre = $('#titre');
  const retour = $('#retour');
  const fab = $('#fab');
  if (!app) return;

  app.scrollTop = 0;
  const principale = ONGLETS.some(([id]) => id === vue);
  retour.hidden = principale;
  fab.hidden = !['devis', 'factures', 'clients', 'produits'].includes(vue);
  app.classList.toggle('avec-onglets', principale);
  document.querySelector('.onglets').style.display = principale ? '' : 'none';
  racine.querySelectorAll('[data-o]').forEach((b) =>
    b.setAttribute('aria-current', b.dataset.o === vue ? 'page' : 'false'));

  if (principale) history.replaceState({}, '', '#' + vue);

  switch (vue) {
    case 'devis': barre.textContent = 'Devis'; return vueDocuments(app, 'devis', aller);
    case 'factures': barre.textContent = 'Factures'; return vueDocuments(app, 'facture', aller);
    case 'clients': barre.textContent = 'Clients'; return vueClients(app);
    case 'produits': barre.textContent = 'Prestations'; return vueClients && vueArticles(app);
    case 'reglages': barre.textContent = 'Réglages'; return vueReglagesEtendus(app);
    case 'document':
      return vueDocument(app, params, aller, (t) => { barre.textContent = t; });
    case 'sauvegarde': barre.textContent = 'Sauvegarde'; return vueSauvegarde(app);
    case 'journal': barre.textContent = 'Journal des numéros'; return vueJournal(app);
    default: return aller('devis');
  }
}

async function vueReglagesEtendus(app) {
  await vueReglages(app, { apres: async (r) => { reglages = r; } });
  const extra = document.createElement('div');
  extra.innerHTML = `
    <div class="section">Données</div>
    <button class="rangee" id="sauv"><div class="corps"><div class="titre">Sauvegarde et restauration</div><div class="sous">Exporter, importer, espace utilisé</div></div></button>
    <button class="rangee" id="jour"><div class="corps"><div class="titre">Journal des numéros</div><div class="sous">Séquences émises, contrôle de continuité</div></div></button>`;
  app.insertBefore(extra, app.lastElementChild);
  extra.querySelector('#sauv').onclick = () => aller('sauvegarde');
  extra.querySelector('#jour').onclick = () => aller('journal');
}

// ---------------------------------------------------------------- Sauvegarde

async function vueSauvegarde(app) {
  const espace = await espaceUtilise();
  const persistant = navigator.storage?.persisted ? await navigator.storage.persisted() : false;

  app.innerHTML = `
    ${!persistant ? `<div class="bandeau b-alerte">${ico('alerte')}<div>Le stockage n’est pas marqué comme permanent. Installez l’application sur l’écran d’accueil et exportez régulièrement.</div></div>` : ''}
    <div class="carte">
      <div style="font-weight:500;margin-bottom:6px">Exporter</div>
      <p style="font-size:13px;color:var(--gris);margin:0 0 12px;line-height:1.5">Un fichier contenant tout : clients, prestations, documents, compteurs et réglages. Rangez-le hors du téléphone.</p>
      <button class="btn btn-plein btn-large" id="exp">Télécharger la sauvegarde</button>
    </div>
    <div class="carte">
      <div style="font-weight:500;margin-bottom:6px">Importer</div>
      <p style="font-size:13px;color:var(--gris);margin:0 0 12px;line-height:1.5">Fusionner ajoute ce qui manque. Remplacer écrase tout. Dans les deux cas, la numérotation ne recule jamais.</p>
      <div class="actions" style="margin:0">
        <button class="btn" id="fus">Fusionner</button>
        <button class="btn btn-danger" id="rem">Remplacer</button>
      </div>
      <input type="file" id="f" accept="application/json,.json" hidden>
    </div>
    ${espace ? `<div class="carte">
      <div style="font-weight:500;margin-bottom:8px">Espace utilisé</div>
      <div style="height:7px;background:var(--fond);border-radius:99px;overflow:hidden;margin-bottom:8px">
        <div style="height:100%;width:${Math.min(100, espace.ratio * 100).toFixed(1)}%;background:${espace.ratio > 0.8 ? 'var(--danger)' : 'var(--marine)'}"></div>
      </div>
      <div style="font-size:12.5px;color:var(--gris)" class="mono">${(espace.usage / 1048576).toFixed(1)} Mo sur ${(espace.quota / 1048576).toFixed(0)} Mo</div>
    </div>` : ''}`;

  $('#exp', app).onclick = async () => {
    const paquet = await exporter();
    telecharger(new Blob([JSON.stringify(paquet)], { type: 'application/json' }),
      `soloapp-${new Date().toISOString().slice(0, 10)}.json`);
    tampon('Sauvegarde téléchargée');
  };

  let mode = 'fusionner';
  $('#fus', app).onclick = () => { mode = 'fusionner'; $('#f', app).click(); };
  $('#rem', app).onclick = async () => {
    if (!await confirmer('Remplacer toutes les données ?',
      'Tout le contenu actuel sera écrasé par la sauvegarde. Les compteurs de numérotation seront conservés au plus haut.',
      'Remplacer', true)) return;
    mode = 'remplacer'; $('#f', app).click();
  };
  $('#f', app).onchange = async (e) => {
    const fichier = e.target.files[0]; if (!fichier) return;
    try {
      await importer(JSON.parse(await fichier.text()), mode);
      tampon('Sauvegarde importée');
      location.reload();
    } catch (err) { tampon(err.message); }
  };
}

async function vueJournal(app) {
  const annee = new Date().getFullYear();
  const blocs = [];
  for (const [type, libelle] of [['devis', 'Devis'], ['facture', 'Factures'], ['avoir', 'Avoirs']]) {
    const nums = await journalNumeros(type, annee);
    if (!nums.length) continue;
    const rangs = nums.map((n) => n.rang);
    const trous = [];
    for (let r = rangs[0]; r <= rangs.at(-1); r++) if (!rangs.includes(r)) trous.push(r);
    blocs.push(`
      <div class="section">${libelle} ${annee}</div>
      ${trous.length
        ? `<div class="bandeau b-alerte">${ico('alerte')}<div>Rangs manquants : ${trous.join(', ')}</div></div>`
        : `<div class="bandeau b-ok">${ico('check')}<div>Séquence continue, ${nums.length} document${nums.length > 1 ? 's' : ''}.</div></div>`}
      <div class="carte">${nums.map((n) =>
        `<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13.5px;border-bottom:1px solid var(--fond)">
          <span class="mono">${ech(n.numero)}</span><span style="color:var(--gris)">${dateFr(n.emisLe)}</span></div>`).join('')}</div>`);
  }
  app.innerHTML = blocs.join('') || `<div class="bandeau b-info">${ico('info')}<div>Aucun document émis cette année.</div></div>`;
}

// ---------------------------------------------------------------- Divers

window.addEventListener('hashchange', () => {
  const v = location.hash.slice(1);
  if (v && v !== etat.vue && ONGLETS.some(([id]) => id === v)) aller(v);
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const nouveau = reg.installing;
      nouveau?.addEventListener('statechange', () => {
        if (nouveau.state === 'installed' && navigator.serviceWorker.controller) {
          const v = feuille('Nouvelle version', `
            <p style="margin:0 0 14px;color:var(--gris);font-size:14px">Une mise à jour de SoloApp est prête.</p>
            <button class="btn btn-plein btn-large" id="maj">Redémarrer</button>`);
          v.querySelector('#maj').onclick = () => location.reload();
        }
      });
    });
  }).catch(() => {});
}

demarrer().catch((e) => {
  racine.innerHTML = `<div class="vue"><div class="bandeau b-alerte">${ico('alerte')}<div>${ech(e.message)}</div></div></div>`;
});
