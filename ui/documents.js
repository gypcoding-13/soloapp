import {
  $, ech, ico, eur, dateFr, puce, tampon, feuille, confirmer, vide,
  partagerFichier, gabarit, LIBELLE_STATUT,
} from './kit.js';
import {
  tout, lire, ecrire, supprimer, lireReglages, emettreDocument, enregistrerPdf, documentsPar,
} from '../core/db.js';
import {
  nouvelId, horodatage, changerStatut, convertirEnFacture, creerAvoir,
  enregistrerReglement, dupliquer, apposerSignature, estFige,
} from '../core/documents.js';
import { calculerTotaux, soldeFacture } from '../core/totals.js';
import { parseAmount, parseQty, parsePercent, formatAmount, formatQty } from '../core/money.js';
import { genererPdf } from '../core/pdf.js';
import { ficheClient, ficheArticle } from './fiches.js';

function nouvelleLigneVide(reglages) {
  return {
    id: nouvelId(), type: 'prestation', designation: '', description: '',
    qte: 1000, pu: 0, unite: '', remise: 0, tva: reglages.tauxDefaut ?? 2000,
  };
}

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const LIBELLE = { devis: 'Devis', facture: 'Facture', avoir: 'Avoir' };
// Le francais n'accorde pas tout seul : on ecrit les articles a la main.
const ARTICLE = {
  devis: { defini: 'le devis', demonstratif: 'ce devis', nouveau: 'Nouveau devis' },
  facture: { defini: 'la facture', demonstratif: 'cette facture', nouveau: 'Nouvelle facture' },
  avoir: { defini: "l'avoir", demonstratif: 'cet avoir', nouveau: 'Nouvel avoir' },
};

// ---------------------------------------------------------------- LISTES

const FILTRES = {
  devis: [['tous', 'Tous'], ['brouillon', 'Brouillons'], ['emis', 'À suivre'], ['accepte', 'Acceptés'], ['refuse', 'Refusés']],
  facture: [['tous', 'Toutes'], ['brouillon', 'Brouillons'], ['impaye', 'Impayées'], ['soldee', 'Payées']],
};

export async function vueDocuments(app, type, aller) {
  const [docs, clients] = await Promise.all([documentsPar(type), tout('clients')]);
  const avoirs = type === 'facture' ? await documentsPar('avoir') : [];
  const nomClient = (id) => {
    const c = clients.find((x) => x.id === id);
    return c ? (c.societe || c.nom) : 'Client supprimé';
  };
  let filtre = 'tous', q = '';

  const correspond = (d) => {
    if (filtre === 'tous') return true;
    if (filtre === 'brouillon') return d.statut === 'brouillon';
    if (filtre === 'emis') return ['emis', 'envoye'].includes(d.statut);
    if (filtre === 'impaye') return ['emise', 'envoyee', 'partiellement_reglee'].includes(d.statut);
    return d.statut === filtre;
  };

  const liste = () => {
    const f = norm(q);
    const vus = [...docs, ...avoirs]
      .filter(correspond)
      .filter((d) => !f || norm(`${d.numero} ${nomClient(d.clientId)}`).includes(f))
      .sort((a, b) => (b.creeLe ?? '').localeCompare(a.creeLe ?? ''));

    if (!vus.length) {
      return q || filtre !== 'tous'
        ? vide('Aucun résultat', 'Changez de filtre ou de recherche.')
        : vide(type === 'devis' ? 'Aucun devis' : 'Aucune facture',
               type === 'devis' ? 'Créez votre premier devis avec le bouton +.' : 'Convertissez un devis accepté, ou créez une facture directe avec le bouton +.');
    }
    return vus.map((d) => {
      const t = d.totaux ?? calculerTotaux(d);
      const retard = enRetard(d);
      return `<button class="rangee" data-id="${d.id}">
        <div class="corps">
          <div class="titre">${ech(nomClient(d.clientId))}</div>
          <div class="sous"><span class="mono">${ech(d.numero ?? '—')}</span> · ${dateFr(d.emisLe ?? d.creeLe)}</div>
        </div>
        <div class="droite">
          <div class="montant">${eur(t.totalTTC)}</div>
          ${retard ? '<span class="puce p-retard">En retard</span>' : puce(d.statut)}
        </div>
      </button>`;
    }).join('');
  };

  app.innerHTML = `
    <div class="recherche">${ico('recherche')}<input placeholder="Numéro ou client" id="q"></div>
    <div class="filtres">${FILTRES[type].map(([k, l]) => `<button data-f="${k}" aria-pressed="${k === 'tous'}">${l}</button>`).join('')}</div>
    <div id="liste">${liste()}</div>`;

  const rafraichir = () => { $('#liste', app).innerHTML = liste(); brancher(); };
  const brancher = () => app.querySelectorAll('.rangee').forEach((b) => {
    b.onclick = () => aller('document', { id: b.dataset.id });
  });
  $('#q', app).oninput = (e) => { q = e.target.value; rafraichir(); };
  app.querySelectorAll('.filtres button').forEach((b) => b.onclick = () => {
    filtre = b.dataset.f;
    app.querySelectorAll('.filtres button').forEach((x) => x.setAttribute('aria-pressed', x === b));
    rafraichir();
  });
  brancher();
}

function enRetard(d) {
  if (d.type !== 'facture' || !['emise', 'envoyee', 'partiellement_reglee'].includes(d.statut)) return false;
  const j = (Date.now() - new Date(d.emisLe ?? d.creeLe)) / 86400000;
  return j > 30;
}

// ---------------------------------------------------------------- ÉDITEUR

export async function vueDocument(app, { id, type, clientId }, aller, majTitre) {
  const reglages = await lireReglages();
  let doc = id ? await lire('documents', id) : {
    id: nouvelId(), type: type ?? 'devis', statut: 'brouillon',
    clientId: clientId ?? null, lignes: [], remiseGlobale: 0, notes: '',
    validite: reglages.validiteDevis ?? 30,
    delaiPaiement: reglages.delaiPaiement ?? '30 jours',
    chantier: { identique: true, adresse: '', cp: '', ville: '' },
    creeLe: horodatage(), reglements: [],
  };
  if (!doc) { tampon('Document introuvable'); aller('devis'); return; }

  const clients = await tout('clients');
  const fige = estFige(doc);

  // Un devis neuf s'ouvre avec une ligne prete a remplir : sans elle,
  // l'utilisateur doit d'abord chercher un bouton avant de pouvoir saisir.
  if (!fige && !id && doc.lignes.length === 0) {
    doc.lignes.push(nouvelleLigneVide(reglages));
  }
  majTitre?.(doc.numero ?? ARTICLE[doc.type].nouveau);

  const rendre = () => {
    const client = clients.find((c) => c.id === doc.clientId);

    app.innerHTML = `
      ${fige ? `<div class="bandeau b-info">${ico('info')}<div>${doc.type === 'facture'
        ? 'Facture émise : elle ne se modifie plus. Utilisez un avoir pour corriger.'
        : doc.statut === 'converti' ? 'Devis converti en facture : verrouillé.'
        : 'Document émis : il ne se modifie plus. Dupliquez-le pour repartir dessus.'}</div></div>` : ''}

      <button class="rangee" id="btnClient" ${fige ? 'disabled style="opacity:.7"' : ''}>
        <div class="corps">
          <div class="titre">${client ? ech(client.societe || client.nom) : 'Choisir un client'}</div>
          <div class="sous">${client ? ech([client.ville, client.email].filter(Boolean).join(' · ') || 'Aucune coordonnée') : 'Obligatoire pour émettre'}</div>
        </div>
        ${!fige ? ico('chevron', 2, 17) : ''}
      </button>

      ${!fige ? `
      <button class="rangee" id="btnConditions">
        <div class="corps">
          <div class="titre">Conditions et lieu</div>
          <div class="sous">${ech(resumeConditions())}</div>
        </div>
        ${ico('chevron', 2, 17)}
      </button>` : ''}

      <div class="section">Lignes</div>
      <div id="lignes">${doc.lignes.map(fige ? ligneFigee : ligneEditable).join('')}</div>

      ${!fige ? `
      <div class="actions" style="margin-top:0">
        <button class="btn" id="ajLigne">${ico('plus', 2, 17)} Ajouter une ligne</button>
        <button class="btn" id="ajCatalogue">Catalogue</button>
      </div>
      <button class="btn btn-large" id="remise" style="margin-top:8px">Remise globale${doc.remiseGlobale ? ` · ${(doc.remiseGlobale / 100).toString().replace('.', ',')} %` : ''}</button>` : ''}

      <div id="blocTotaux">${totauxHtml()}</div>

      ${doc.signature ? `<div class="bandeau b-ok" style="margin-top:12px">${ico('check')}<div>Signé par ${ech(doc.signature.nomSignataire)} le ${dateFr(doc.signature.signeLe)}</div></div>` : ''}

      <div class="section">Notes internes</div>
      <div class="carte"><textarea id="notes" ${fige ? 'disabled' : ''} placeholder="Visible uniquement par vous">${ech(doc.notes)}</textarea></div>

      <div id="barreActions"></div>`;

    rendreActions();
    brancherEditeur();
  };

  function totauxHtml() {
    const t = doc.totaux ?? calculerTotaux(doc);
    const solde = doc.type === 'facture' && doc.totaux ? soldeFacture(doc) : null;
    return `<div class="totaux">
      ${t.remiseGlobaleMontant ? `
        <div class="l"><span>Sous-total HT</span><span>${eur(t.brutHT)}</span></div>
        <div class="l"><span>Remise</span><span>-${eur(t.remiseGlobaleMontant)}</span></div>` : ''}
      <div class="l"><span>Total HT</span><span>${eur(t.totalHT)}</span></div>
      ${t.ventilation.filter((v) => v.taux > 0).map((v) =>
        `<div class="l"><span>TVA ${(v.taux / 100).toString().replace('.', ',')} % sur ${eur(v.base)}</span><span>${eur(v.tva)}</span></div>`).join('')}
      <div class="ttc"><span>Total TTC</span><span>${eur(t.totalTTC)}</span></div>
      ${solde && solde.regle ? `
        <div class="l" style="margin-top:8px"><span>Déjà réglé</span><span>${eur(solde.regle)}</span></div>
        <div class="l"><span style="font-weight:500;color:var(--encre)">Reste à payer</span><span style="font-weight:500">${eur(solde.restant)}</span></div>` : ''}
    </div>`;
  }

  function resumeConditions() {
    const bouts = [];
    if (doc.type === 'devis') bouts.push(`Validité ${doc.validite ?? reglages.validiteDevis ?? 30} jours`);
    bouts.push(`Règlement ${doc.delaiPaiement ?? reglages.delaiPaiement ?? '30 jours'}`);
    const ch = doc.chantier;
    if (ch && !ch.identique && (ch.ville || ch.adresse)) bouts.push(`Chantier : ${ch.ville || ch.adresse}`);
    return bouts.join(' · ');
  }

  function ecranConditions() {
    const ch = doc.chantier ?? { identique: true, adresse: '', cp: '', ville: '' };
    const v = feuille('Conditions et lieu', `
      ${doc.type === 'devis' ? `
      <div class="champ"><label>Validité du devis</label>
        <select id="validite">
          ${[15, 30, 60, 90].map((j) => `<option value="${j}" ${Number(doc.validite ?? reglages.validiteDevis) === j ? 'selected' : ''}>${j} jours</option>`).join('')}
        </select></div>` : ''}
      <div class="champ"><label>Délai de paiement</label>
        <select id="delai">
          ${['À réception', '15 jours', '30 jours', '45 jours', '45 jours fin de mois', '60 jours']
            .map((d) => `<option ${((doc.delaiPaiement ?? reglages.delaiPaiement) === d) ? 'selected' : ''}>${d}</option>`).join('')}
        </select></div>

      <label class="case" for="memeAdresse">
        <input type="checkbox" id="memeAdresse" ${ch.identique ? 'checked' : ''}>
        <span>Chantier à l'adresse de facturation</span>
      </label>
      <div id="blocChantier">
        <div class="champ"><label>Adresse du chantier</label><input id="chAdresse" value="${ech(ch.adresse)}"></div>
        <div class="duo">
          <div class="champ"><label>Code postal</label><input id="chCp" inputmode="numeric" value="${ech(ch.cp)}"></div>
          <div class="champ"><label>Ville</label><input id="chVille" value="${ech(ch.ville)}"></div>
        </div>
      </div>
      <button class="btn btn-plein btn-large" data-ok>Enregistrer</button>`);

    const maj = () => {
      v.querySelector('#blocChantier').style.display =
        v.querySelector('#memeAdresse').checked ? 'none' : 'block';
    };
    v.querySelector('#memeAdresse').addEventListener('change', maj); maj();

    v.querySelector('[data-ok]').onclick = async () => {
      if (doc.type === 'devis') doc.validite = Number(v.querySelector('#validite').value);
      doc.delaiPaiement = v.querySelector('#delai').value;
      doc.chantier = {
        identique: v.querySelector('#memeAdresse').checked,
        adresse: v.querySelector('#chAdresse').value.trim(),
        cp: v.querySelector('#chCp').value.trim(),
        ville: v.querySelector('#chVille').value.trim(),
      };
      await enregistrer(); v.remove(); rendre();
    };
  }

  const htLigne = (l) => Math.round((l.qte * l.pu * (10000 - (l.remise ?? 0))) / (1000 * 10000));

  // Saisie directe : chaque ligne est un petit formulaire, pas une fenetre a ouvrir.
  function ligneEditable(l) {
    if (l.type === 'section') {
      return `<div class="ligne" data-l="${l.id}">
        <div class="ligne-tete">
          <input data-f="designation" value="${ech(l.designation)}" placeholder="Titre de section" style="color:var(--cuivre)">
          <button class="l-suppr" data-suppr aria-label="Supprimer">&times;</button>
        </div></div>`;
    }
    if (l.type === 'texte') {
      return `<div class="ligne" data-l="${l.id}">
        <div class="ligne-tete">
          <input data-f="designation" value="${ech(l.designation)}" placeholder="Note libre" style="font-weight:400;color:var(--gris)">
          <button class="l-suppr" data-suppr aria-label="Supprimer">&times;</button>
        </div></div>`;
    }
    return `<div class="ligne" data-l="${l.id}">
      <div class="ligne-tete">
        <input data-f="designation" value="${ech(l.designation)}" placeholder="Désignation">
        <button class="l-suppr" data-suppr aria-label="Supprimer">&times;</button>
      </div>
      <textarea class="l-description" data-f="description" rows="3"
        placeholder="Description de la prestation">${ech(l.description)}</textarea>
      <div class="ligne-grille">
        <input data-f="qte" inputmode="decimal" value="${formatQty(l.qte)}" placeholder="Qté" aria-label="Quantité">
        <input data-f="unite" value="${ech(l.unite)}" placeholder="Unité" aria-label="Unité">
        <input data-f="pu" inputmode="decimal" value="${l.pu ? formatAmount(l.pu) : ''}" placeholder="Prix HT" aria-label="Prix unitaire HT">
      </div>
      <div class="ligne-pied">
        <div style="display:flex;align-items:center;gap:4px">
          <select data-f="tva" aria-label="TVA">
            ${[2000, 1000, 550, 0].map((x) => `<option value="${x}" ${l.tva === x ? 'selected' : ''}>TVA ${(x / 100).toString().replace('.', ',')} %</option>`).join('')}
          </select>
          <input data-f="remise" inputmode="decimal" class="l-remise" value="${l.remise ? (l.remise / 100).toString().replace('.', ',') : ''}" placeholder="Remise %" aria-label="Remise en pourcentage">
        </div>
        <span class="ligne-total" data-total>${eur(htLigne(l))}</span>
      </div></div>`;
  }

  function ligneFigee(l) {
    if (l.type === 'section') {
      return `<div class="rangee" style="background:var(--fond)"><div class="corps"><div class="titre" style="color:var(--cuivre)">${ech(l.designation)}</div></div></div>`;
    }
    if (l.type === 'texte') {
      return `<div class="rangee"><div class="corps"><div class="sous" style="white-space:normal">${ech(l.designation)}</div></div></div>`;
    }
    return `<div class="rangee">
      <div class="corps">
        <div class="titre">${ech(l.designation)}</div>
        <div class="sous"><span class="mono">${formatQty(l.qte)}</span>${l.unite ? ' ' + ech(l.unite) : ''} × <span class="mono">${formatAmount(l.pu)}</span>${l.remise ? ` · -${(l.remise / 100).toString().replace('.', ',')} %` : ''}</div>
      </div>
      <div class="droite"><div class="montant">${eur(htLigne(l))}</div></div>
    </div>`;
  }

  let minuteurSauvegarde;
  const enregistrer = async () => {
    doc.majLe = horodatage();
    await ecrire('documents', doc);
  };
  const enregistrerBientot = () => {
    clearTimeout(minuteurSauvegarde);
    minuteurSauvegarde = setTimeout(enregistrer, 600);
  };

  function rendreActions() {
    const b = $('#barreActions', app);
    const boutons = [];
    if (!fige) {
      boutons.push(`<button class="btn btn-plein btn-large" id="emettre">Émettre ${ARTICLE[doc.type].defini}</button>`);
    } else {
      boutons.push(`<div class="actions">
        <button class="btn" id="apercu">${ico('pdf')} Aperçu</button>
        <button class="btn btn-accent" id="envoyer">${ico('partage')} Envoyer</button>
      </div>`);
      if (doc.type === 'devis') {
        if (!doc.signature && ['emis', 'envoye'].includes(doc.statut)) {
          boutons.push(`<button class="btn btn-large" id="signer" style="margin-top:8px">${ico('signature')} Faire signer</button>`);
        }
        if (['emis', 'envoye', 'expire'].includes(doc.statut)) {
          boutons.push(`<div class="actions">
            <button class="btn" id="refuser">Refusé</button>
            <button class="btn btn-plein" id="accepter">Accepté</button>
          </div>`);
        }
        if (doc.statut === 'accepte') {
          boutons.push(`<button class="btn btn-plein btn-large" id="convertir" style="margin-top:8px">Convertir en facture</button>`);
        }
      }
      if (doc.type === 'facture' && ['emise', 'envoyee', 'partiellement_reglee'].includes(doc.statut)) {
        boutons.push(`<button class="btn btn-plein btn-large" id="regler" style="margin-top:8px">${ico('euro')} Enregistrer un règlement</button>`);
      }
      boutons.push(`<button class="btn btn-large" id="archiver" style="margin-top:8px">${ico('partage')} Archiver le PDF</button>`);
      if (doc.type === 'facture' && doc.statut !== 'annulee') {
        boutons.push(`<button class="btn btn-danger btn-large" id="avoir" style="margin-top:8px">Établir un avoir</button>`);
      }
      boutons.push(`<button class="btn btn-large" id="dupliquer" style="margin-top:8px">${ico('copier')} Dupliquer</button>`);
    }
    if (!fige && doc.numero === undefined && id) {
      boutons.push(`<button class="btn btn-danger btn-large" id="suppr" style="margin-top:8px">${ico('poubelle')} Supprimer le brouillon</button>`);
    }
    b.innerHTML = boutons.join('');
    brancherActions();
  }

  function brancherEditeur() {
    $('#btnClient', app).onclick = fige ? null : choisirClient;
    $('#btnConditions', app)?.addEventListener('click', ecranConditions);
    $('#notes', app).onchange = (e) => { doc.notes = e.target.value; enregistrer(); };
    if (fige) return;

    const zone = $('#lignes', app);

    // On ne reconstruit jamais la liste pendant la frappe : le champ perdrait
    // le focus a chaque caractere. On met a jour la ligne et les totaux.
    const majDepuisChamp = (champ) => {
      const bloc = champ.closest('.ligne');
      const l = doc.lignes.find((x) => x.id === bloc.dataset.l);
      if (!l) return;
      const f = champ.dataset.f;
      const v = champ.value.trim();
      try {
        if (f === 'designation' || f === 'unite' || f === 'description') l[f] = champ.value;
        else if (f === 'qte') l.qte = v ? parseQty(v) : 0;
        else if (f === 'pu') l.pu = v ? parseAmount(v) : 0;
        else if (f === 'remise') l.remise = v ? Math.min(10000, parsePercent(v)) : 0;
        else if (f === 'tva') l.tva = Number(v);
        champ.classList.remove('invalide');
      } catch {
        champ.classList.add('invalide');
        return;
      }
      const total = bloc.querySelector('[data-total]');
      if (total) total.textContent = eur(htLigne(l));
      $('#blocTotaux', app).innerHTML = totauxHtml();
      enregistrerBientot();
    };

    const ajusterHauteur = (zt) => {
      zt.style.height = 'auto';
      zt.style.height = zt.scrollHeight + 'px';
    };
    zone.querySelectorAll('.l-description').forEach(ajusterHauteur);

    zone.addEventListener('input', (e) => {
      if (!e.target.dataset.f) return;
      if (e.target.classList.contains('l-description')) ajusterHauteur(e.target);
      majDepuisChamp(e.target);
    });
    zone.addEventListener('change', (e) => {
      if (e.target.dataset.f === 'tva') majDepuisChamp(e.target);
    });
    zone.addEventListener('blur', (e) => {
      // A la sortie du champ, on reaffiche la valeur mise en forme.
      const champ = e.target;
      if (!champ.dataset) return;
      const bloc = champ.closest?.('.ligne');
      if (!bloc) return;
      const l = doc.lignes.find((x) => x.id === bloc.dataset.l);
      if (!l) return;
      if (champ.dataset.f === 'pu') champ.value = l.pu ? formatAmount(l.pu) : '';
      if (champ.dataset.f === 'qte') champ.value = formatQty(l.qte);
    }, true);

    zone.addEventListener('click', async (e) => {
      const bouton = e.target.closest('[data-suppr]');
      if (!bouton) return;
      const bloc = bouton.closest('.ligne');
      doc.lignes = doc.lignes.filter((x) => x.id !== bloc.dataset.l);
      bloc.remove();
      $('#blocTotaux', app).innerHTML = totauxHtml();
      await enregistrer();
    });

    $('#ajLigne', app)?.addEventListener('click', () => ajouterLigne('prestation'));
    $('#ajCatalogue', app)?.addEventListener('click', depuisCatalogue);
    $('#remise', app)?.addEventListener('click', remiseGlobale);
  }

  async function ajouterLigne(type, valeurs = {}) {
    const l = { ...nouvelleLigneVide(reglages), type, ...valeurs };
    doc.lignes.push(l);
    await enregistrer();
    const zone = $('#lignes', app);
    zone.insertAdjacentHTML('beforeend', ligneEditable(l));
    $('#blocTotaux', app).innerHTML = totauxHtml();
    const zt = zone.lastElementChild.querySelector('.l-description');
    if (zt) { zt.style.height = 'auto'; zt.style.height = zt.scrollHeight + 'px'; }
    const champ = zone.lastElementChild.querySelector('[data-f=designation]');
    champ?.focus();
    champ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function brancherActions() {
    const on = (sel, fn) => $(sel, app)?.addEventListener('click', fn);
    on('#emettre', emettre);
    on('#apercu', () => produirePdf(true));
    on('#envoyer', envoyer);
    on('#signer', signer);
    on('#accepter', () => transition('accepte', 'Devis accepté'));
    on('#refuser', () => transition('refuse', 'Devis refusé'));
    on('#convertir', convertir);
    on('#regler', reglement);
    on('#avoir', etablirAvoir);
    on('#archiver', archiver);
    on('#dupliquer', dupliquerDoc);
    on('#suppr', supprimerBrouillon);
  }

  // --- Actions ---

  function choisirClient() {
    const actifs = clients.filter((c) => !c.archive);
    const v = feuille('Choisir un client', `
      <div class="recherche">${ico('recherche')}<input id="qc" placeholder="Rechercher"></div>
      <button class="btn btn-large" id="nouveau" style="margin-bottom:12px">+ Nouveau client</button>
      <div id="lc">${actifs.map((c) => `<button class="rangee" data-c="${c.id}"><div class="corps"><div class="titre">${ech(c.societe || c.nom)}</div><div class="sous">${ech(c.ville || '')}</div></div></button>`).join('') || vide('Aucun client', 'Créez-en un.')}</div>`);
    const brancher = () => v.querySelectorAll('[data-c]').forEach((b) => b.onclick = async () => {
      doc.clientId = b.dataset.c;
      const c = clients.find((x) => x.id === doc.clientId);
      doc.clientInstantane = { nom: c.nom, societe: c.societe, categorie: c.categorie, adresse: c.adresse, cp: c.cp, ville: c.ville, siret: c.siret, email: c.email };
      await enregistrer(); v.remove(); rendre();
    });
    v.querySelector('#qc').oninput = (e) => {
      const f = norm(e.target.value);
      v.querySelector('#lc').innerHTML = actifs.filter((c) => norm(`${c.societe} ${c.nom}`).includes(f))
        .map((c) => `<button class="rangee" data-c="${c.id}"><div class="corps"><div class="titre">${ech(c.societe || c.nom)}</div><div class="sous">${ech(c.ville || '')}</div></div></button>`).join('');
      brancher();
    };
    v.querySelector('#nouveau').onclick = () => {
      v.remove();
      ficheClient(null, async (c) => { clients.push(c); doc.clientId = c.id; await enregistrer(); rendre(); });
    };
    brancher();
  }

  async function depuisCatalogue() {
    const articles = (await tout('articles')).filter((a) => !a.archive);
    const v = feuille('Catalogue', `
      <div class="recherche">${ico('recherche')}<input id="qa" placeholder="Rechercher une prestation"></div>
      <button class="btn btn-large" id="nouvelArticle" style="margin-bottom:12px">+ Nouvelle prestation</button>
      <div id="la">${articles.map(ligneArticle).join('') || vide('Catalogue vide', 'Ajoutez vos prestations.')}</div>`);
    function ligneArticle(a) {
      return `<button class="rangee" data-a="${a.id}"><div class="corps"><div class="titre">${ech(a.designation)}</div><div class="sous">${ech(a.unite || 'unité')}</div></div><div class="droite"><div class="montant">${eur(a.pu)}</div></div></button>`;
    }
    const brancher = () => v.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => {
      const a = articles.find((x) => x.id === b.dataset.a);
      v.remove();
      ajouterLigne('prestation', {
        designation: a.designation, description: a.description,
        pu: a.pu, unite: a.unite, tva: a.tva, sourceArticleId: a.id,
      });
    });
    v.querySelector('#qa').oninput = (e) => {
      const f = norm(e.target.value);
      v.querySelector('#la').innerHTML = articles.filter((a) => norm(a.designation).includes(f)).map(ligneArticle).join('');
      brancher();
    };
    v.querySelector('#nouvelArticle').onclick = () => {
      v.remove();
      ficheArticle(null, (a) => ajouterLigne('prestation', {
        designation: a.designation, description: a.description,
        pu: a.pu, unite: a.unite, tva: a.tva, sourceArticleId: a.id,
      }));
    };
    brancher();
  }

  function remiseGlobale() {
    const v = feuille('Remise globale', `
      <div class="champ"><label>Pourcentage appliqué au total</label>
        <input id="rg" inputmode="decimal" value="${doc.remiseGlobale ? doc.remiseGlobale / 100 : ''}" placeholder="0"></div>
      <div class="erreur" id="err" hidden></div>
      <div class="actions"><button class="btn" data-non>Retirer</button><button class="btn btn-plein" data-ok>Appliquer</button></div>`);
    v.querySelector('[data-ok]').onclick = async () => {
      try {
        const p = v.querySelector('#rg').value ? parsePercent(v.querySelector('#rg').value) : 0;
        if (p > 10000) throw new Error();
        doc.remiseGlobale = p;
      } catch {
        const e = v.querySelector('#err');
        e.textContent = 'Pourcentage invalide (0 à 100).'; e.hidden = false; return;
      }
      await enregistrer(); v.remove(); rendre();
    };
    v.querySelector('[data-non]').onclick = async () => {
      doc.remiseGlobale = 0; await enregistrer(); v.remove(); rendre();
    };
  }

  async function emettre() {
    if (!doc.clientId) { tampon('Choisissez un client'); return; }
    if (!doc.lignes.some((l) => !l.type || l.type === 'prestation')) { tampon('Ajoutez au moins une prestation'); return; }
    if (!await confirmer(`Émettre ${ARTICLE[doc.type].demonstratif} ?`,
      'Un numéro définitif lui sera attribué et il ne pourra plus être modifié.', 'Émettre')) return;
    try {
      const bouton = $('#emettre', app);
      if (bouton) bouton.disabled = true;
      doc = await emettreDocument(doc, reglages);
      tampon(`${doc.numero} ${doc.type === 'facture' ? 'émise' : 'émis'}`);
      aller('document', { id: doc.id });
    } catch (e) {
      tampon(e.message);
      const bouton = $('#emettre', app);
      if (bouton) bouton.disabled = false;
    }
  }

  async function produirePdf(ouvrirApres) {
    tampon('Génération du PDF…');
    const client = clients.find((c) => c.id === doc.clientId);
    const blob = await genererPdf(doc, client, reglages);
    if (doc.numero) await enregistrerPdf(doc.id, blob);
    if (ouvrirApres) {
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
    return blob;
  }

  async function envoyer() {
    const client = clients.find((c) => c.id === doc.clientId);
    const enregistre = await lire('pdfs', doc.id);
    const blob = enregistre?.blob ?? await produirePdf(false);
    const t = doc.totaux ?? calculerTotaux(doc);
    const valeurs = {
      numero: doc.numero, societe: reglages.raisonSociale, client: client?.societe || client?.nom || '',
      montant: eur(t.totalTTC),
      validite: new Date(Date.now() + (reglages.validiteDevis ?? 30) * 86400000).toLocaleDateString('fr-FR'),
    };
    const r = await partagerFichier(blob, `${doc.numero}.pdf`, {
      objet: gabarit(reglages.objetMail, valeurs),
      corps: gabarit(reglages.corpsMail, valeurs),
      destinataire: client?.email,
    });
    if (r === 'annule') return;
    if (['emis', 'emise'].includes(doc.statut)) {
      doc = changerStatut(doc, doc.type === 'facture' ? 'envoyee' : 'envoye');
      await enregistrer();
    }
    tampon(r === 'partage' ? 'Document partagé' : 'PDF téléchargé');
    rendre();
  }

  // Archivage : on partage le PDF seul, vers Drive ou ailleurs. Ce n'est pas
  // une sauvegarde — la base, les tarifs et les compteurs n'y sont pas.
  async function archiver() {
    const enregistre = await lire('pdfs', doc.id);
    const blob = enregistre?.blob ?? await produirePdf(false);
    const r = await partagerFichier(blob, `${doc.numero}.pdf`, {
      objet: `${doc.numero} — ${reglages.raisonSociale}`,
    });
    if (r === 'annule') return;
    tampon(r === 'partage' ? 'PDF envoyé' : 'PDF téléchargé');
  }

  async function transition(cible, message) {
    doc = changerStatut(doc, cible);
    await enregistrer(); tampon(message); rendre();
  }

  async function convertir() {
    if (!await confirmer('Convertir en facture ?', 'Le devis sera verrouillé définitivement et une facture sera créée.', 'Convertir')) return;
    const { facture, devis } = convertirEnFacture(doc);
    await ecrire('documents', devis);
    await ecrire('documents', facture);
    tampon('Facture créée');
    aller('document', { id: facture.id });
  }

  function reglement() {
    const solde = soldeFacture(doc);
    const v = feuille('Enregistrer un règlement', `
      <div class="bandeau b-info">${ico('info')}<div>Reste à payer : ${eur(solde.restant)}</div></div>
      <div class="champ"><label>Montant reçu</label><input id="m" inputmode="decimal" value="${formatAmount(solde.restant)}"></div>
      <div class="duo">
        <div class="champ"><label>Date</label><input id="d" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
        <div class="champ"><label>Moyen</label><select id="moyen">
          <option value="virement">Virement</option><option value="cheque">Chèque</option>
          <option value="especes">Espèces</option><option value="carte">Carte</option><option value="autre">Autre</option>
        </select></div>
      </div>
      <div class="erreur" id="err" hidden></div>
      <button class="btn btn-plein btn-large" data-ok>Enregistrer</button>`);
    v.querySelector('[data-ok]').onclick = async () => {
      const err = v.querySelector('#err');
      try {
        doc = enregistrerReglement(doc, {
          montant: parseAmount(v.querySelector('#m').value),
          date: v.querySelector('#d').value,
          moyen: v.querySelector('#moyen').value,
        });
      } catch (e) { err.textContent = e.message; err.hidden = false; return; }
      await enregistrer(); v.remove(); tampon('Règlement enregistré'); rendre();
    };
  }

  async function etablirAvoir() {
    const v = feuille('Établir un avoir', `
      <p style="margin:0 0 14px;color:var(--gris);font-size:14px;line-height:1.5">L'avoir annule tout ou partie de la facture ${ech(doc.numero)}. Il reprend les lignes en négatif.</p>
      <div class="champ"><label>Motif</label><input id="motif" placeholder="Erreur de quantité, geste commercial…"></div>
      <div class="erreur" id="err" hidden></div>
      <button class="btn btn-plein btn-large" data-ok>Créer l'avoir</button>`);
    v.querySelector('[data-ok]').onclick = async () => {
      const err = v.querySelector('#err');
      let avoir;
      try { avoir = creerAvoir(doc, { motif: v.querySelector('#motif').value }); }
      catch (e) { err.textContent = e.message; err.hidden = false; return; }
      await ecrire('documents', avoir);
      v.remove(); tampon('Avoir créé en brouillon');
      aller('document', { id: avoir.id });
    };
  }

  async function dupliquerDoc() {
    const copie = dupliquer(doc);
    await ecrire('documents', copie);
    tampon('Copie créée');
    aller('document', { id: copie.id });
  }

  async function supprimerBrouillon() {
    if (!await confirmer('Supprimer ce brouillon ?', 'Aucun numéro n’a été attribué, la suppression est sans conséquence.', 'Supprimer', true)) return;
    await supprimer('documents', doc.id);
    tampon('Brouillon supprimé');
    aller(doc.type === 'facture' ? 'factures' : 'devis');
  }

  function signer() {
    ecranSignature(async ({ trace, nom }) => {
      doc = apposerSignature(doc, { trace, nomSignataire: nom, accepteConditions: true });
      await enregistrer();
      await produirePdf(false);
      tampon('Devis signé et accepté');
      rendre();
    });
  }

  rendre();
}

// ---------------------------------------------------------------- SIGNATURE

function ecranSignature(valider) {
  const ecran = document.createElement('div');
  ecran.className = 'signature-plein';
  ecran.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
      <button class="btn" id="fermer" style="padding:9px 13px">Annuler</button>
      <div style="flex:1;text-align:center;font-weight:500;font-size:15px">Bon pour accord</div>
      <button class="btn" id="effacer" style="padding:9px 13px">Effacer</button>
    </div>
    <div class="champ" style="margin-bottom:8px"><input id="nom" placeholder="Nom du signataire"></div>
    <canvas id="toile"></canvas>
    <label class="case" for="cond">
      <input type="checkbox" id="cond">
      <span>J'accepte ce devis et les conditions qui y figurent.</span>
    </label>
    <div class="erreur" id="err" hidden></div>
    <button class="btn btn-plein btn-large" id="valider">Valider la signature</button>`;
  document.body.append(ecran);

  const toile = ecran.querySelector('#toile');
  const ctx = toile.getContext('2d');
  let trace = [], segment = null;

  const dimensionner = () => {
    const r = toile.getBoundingClientRect();
    const d = window.devicePixelRatio || 1;
    toile.width = r.width * d; toile.height = r.height * d;
    ctx.scale(d, d);
    ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = '#12163A';
    redessiner();
  };
  const point = (e) => {
    const r = toile.getBoundingClientRect();
    const t = e.touches?.[0] ?? e;
    return [t.clientX - r.left, t.clientY - r.top];
  };
  // Lissage : on relie les points par des courbes plutôt qu'en ligne brisée.
  const redessiner = () => {
    ctx.clearRect(0, 0, toile.width, toile.height);
    for (const s of trace) {
      if (s.length < 2) continue;
      ctx.beginPath(); ctx.moveTo(s[0][0], s[0][1]);
      for (let i = 1; i < s.length - 1; i++) {
        const mx = (s[i][0] + s[i + 1][0]) / 2, my = (s[i][1] + s[i + 1][1]) / 2;
        ctx.quadraticCurveTo(s[i][0], s[i][1], mx, my);
      }
      ctx.lineTo(s.at(-1)[0], s.at(-1)[1]);
      ctx.stroke();
    }
  };
  const debut = (e) => { e.preventDefault(); segment = [point(e)]; trace.push(segment); };
  const bouge = (e) => { if (!segment) return; e.preventDefault(); segment.push(point(e)); redessiner(); };
  const fin = () => { segment = null; };

  toile.addEventListener('pointerdown', debut);
  toile.addEventListener('pointermove', bouge);
  toile.addEventListener('pointerup', fin);
  toile.addEventListener('pointerleave', fin);
  requestAnimationFrame(dimensionner);
  window.addEventListener('resize', dimensionner);

  ecran.querySelector('#effacer').onclick = () => { trace = []; redessiner(); };
  ecran.querySelector('#fermer').onclick = () => ecran.remove();
  ecran.querySelector('#valider').onclick = () => {
    const err = ecran.querySelector('#err');
    const nom = ecran.querySelector('#nom').value.trim();
    if (!nom) { err.textContent = 'Indiquez le nom du signataire.'; err.hidden = false; return; }
    if (!ecran.querySelector('#cond').checked) { err.textContent = 'Cochez l’acceptation des conditions.'; err.hidden = false; return; }
    if (!trace.length) { err.textContent = 'La signature est vide.'; err.hidden = false; return; }
    ecran.remove();
    valider({ trace, nom });
  };
}
