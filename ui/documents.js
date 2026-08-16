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

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const LIBELLE = { devis: 'Devis', facture: 'Facture', avoir: 'Avoir' };

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
               type === 'devis' ? 'Créez votre premier devis avec le bouton +.' : 'Les factures naissent d’un devis accepté.');
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
    creeLe: horodatage(), reglements: [],
  };
  if (!doc) { tampon('Document introuvable'); aller('devis'); return; }

  const clients = await tout('clients');
  const fige = estFige(doc);
  majTitre?.(doc.numero ?? `Nouveau ${LIBELLE[doc.type].toLowerCase()}`);

  const rendre = () => {
    const t = doc.totaux ?? calculerTotaux(doc);
    const client = clients.find((c) => c.id === doc.clientId);
    const solde = doc.type === 'facture' && doc.totaux ? soldeFacture(doc) : null;

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
        ${!fige ? ico('retour').replace('15 18l-6-6 6-6', '9 18l6-6-6-6') : ''}
      </button>

      <div class="section">Lignes</div>
      <div id="lignes">${doc.lignes.length ? doc.lignes.map(ligneHtml).join('')
        : vide('Aucune ligne', 'Ajoutez une prestation du catalogue ou une ligne libre.')}</div>

      ${!fige ? `<div class="actions" style="margin-top:4px">
        <button class="btn" id="ajCatalogue">Depuis le catalogue</button>
        <button class="btn" id="ajLibre">Ligne libre</button>
      </div>
      <div class="actions" style="margin-top:8px">
        <button class="btn" id="ajSection" style="flex:0 0 auto;padding:12px 14px">+ Titre</button>
        <button class="btn" id="ajTexte" style="flex:0 0 auto;padding:12px 14px">+ Note</button>
        <button class="btn" id="remise" style="flex:1">Remise globale${doc.remiseGlobale ? ` · ${(doc.remiseGlobale / 100).toString().replace('.', ',')} %` : ''}</button>
      </div>` : ''}

      <div class="totaux">
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
      </div>

      ${doc.signature ? `<div class="bandeau b-ok" style="margin-top:12px">${ico('check')}<div>Signé par ${ech(doc.signature.nomSignataire)} le ${dateFr(doc.signature.signeLe)}</div></div>` : ''}

      <div class="section">Notes internes</div>
      <div class="carte"><textarea id="notes" ${fige ? 'disabled' : ''} placeholder="Visible uniquement par vous">${ech(doc.notes)}</textarea></div>

      <div id="barreActions"></div>`;

    rendreActions();
    brancherEditeur();
  };

  const ligneHtml = (l, i) => {
    if (l.type === 'section') {
      return `<button class="rangee" data-l="${l.id}" style="background:var(--fond)">
        <div class="corps"><div class="titre" style="color:var(--cuivre)">${ech(l.designation)}</div></div></button>`;
    }
    if (l.type === 'texte') {
      return `<button class="rangee" data-l="${l.id}">
        <div class="corps"><div class="sous" style="white-space:normal">${ech(l.designation)}</div></div></button>`;
    }
    const ht = Math.round((l.qte * l.pu * (10000 - (l.remise ?? 0))) / (1000 * 10000));
    return `<button class="rangee" data-l="${l.id}">
      <div class="corps">
        <div class="titre">${ech(l.designation)}</div>
        <div class="sous"><span class="mono">${formatQty(l.qte)}</span>${l.unite ? ' ' + ech(l.unite) : ''} × <span class="mono">${formatAmount(l.pu)}</span>${l.remise ? ` · -${(l.remise / 100).toString().replace('.', ',')} %` : ''}</div>
      </div>
      <div class="droite"><div class="montant">${eur(ht)}</div></div>
    </button>`;
  };

  const enregistrer = async () => {
    doc.majLe = horodatage();
    await ecrire('documents', doc);
  };

  function rendreActions() {
    const b = $('#barreActions', app);
    const boutons = [];
    if (!fige) {
      boutons.push(`<button class="btn btn-plein btn-large" id="emettre">Émettre le ${LIBELLE[doc.type].toLowerCase()}</button>`);
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
    $('#notes', app).onchange = (e) => { doc.notes = e.target.value; enregistrer(); };
    app.querySelectorAll('[data-l]').forEach((b) => b.onclick = () => {
      if (fige) return;
      editerLigne(doc.lignes.find((l) => l.id === b.dataset.l));
    });
    $('#ajCatalogue', app)?.addEventListener('click', depuisCatalogue);
    $('#ajLibre', app)?.addEventListener('click', () => editerLigne(null, 'prestation'));
    $('#ajSection', app)?.addEventListener('click', () => editerLigne(null, 'section'));
    $('#ajTexte', app)?.addEventListener('click', () => editerLigne(null, 'texte'));
    $('#remise', app)?.addEventListener('click', remiseGlobale);
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
      doc.clientInstantane = { nom: c.nom, societe: c.societe, adresse: c.adresse, cp: c.cp, ville: c.ville, siret: c.siret, email: c.email };
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
      editerLigne({
        id: nouvelId(), type: 'prestation', designation: a.designation, description: a.description,
        qte: 1000, pu: a.pu, unite: a.unite, remise: 0, tva: a.tva, sourceArticleId: a.id,
      }, 'prestation', true);
    });
    v.querySelector('#qa').oninput = (e) => {
      const f = norm(e.target.value);
      v.querySelector('#la').innerHTML = articles.filter((a) => norm(a.designation).includes(f)).map(ligneArticle).join('');
      brancher();
    };
    v.querySelector('#nouvelArticle').onclick = () => {
      v.remove();
      ficheArticle(null, (a) => editerLigne({
        id: nouvelId(), type: 'prestation', designation: a.designation, description: a.description,
        qte: 1000, pu: a.pu, unite: a.unite, remise: 0, tva: a.tva, sourceArticleId: a.id,
      }, 'prestation', true));
    };
    brancher();
  }

  function editerLigne(ligne, typeLigne, nouvelle = false) {
    const l = ligne ?? {
      id: nouvelId(), type: typeLigne, designation: '', qte: 1000,
      pu: 0, unite: '', remise: 0, tva: reglages.tauxDefaut,
    };
    const estNouvelle = nouvelle || !doc.lignes.some((x) => x.id === l.id);
    const t = l.type ?? 'prestation';

    const v = feuille(estNouvelle ? 'Ajouter une ligne' : 'Modifier la ligne', `
      <div class="champ"><label>${t === 'section' ? 'Titre de section' : t === 'texte' ? 'Note' : 'Désignation'}</label>
        ${t === 'texte' ? `<textarea name="designation">${ech(l.designation)}</textarea>`
          : `<input name="designation" value="${ech(l.designation)}">`}</div>
      ${t === 'prestation' ? `
        <div class="duo">
          <div class="champ"><label>Quantité</label><input name="qte" inputmode="decimal" value="${formatQty(l.qte)}"></div>
          <div class="champ"><label>Unité</label><input name="unite" value="${ech(l.unite)}" placeholder="h, m, u"></div>
        </div>
        <div class="duo">
          <div class="champ"><label>Prix unitaire HT</label><input name="pu" inputmode="decimal" value="${formatAmount(l.pu)}"></div>
          <div class="champ"><label>Remise %</label><input name="remise" inputmode="decimal" value="${l.remise ? (l.remise / 100) : ''}" placeholder="0"></div>
        </div>
        <div class="champ"><label>TVA</label><select name="tva">
          ${[2000, 1000, 550, 0].map((x) => `<option value="${x}" ${l.tva === x ? 'selected' : ''}>${(x / 100).toString().replace('.', ',')} %</option>`).join('')}
        </select></div>` : ''}
      <div class="erreur" id="err" hidden></div>
      <div class="actions">
        ${estNouvelle ? '' : '<button class="btn btn-danger" data-suppr>Supprimer</button>'}
        <button class="btn btn-plein" data-ok>${estNouvelle ? 'Ajouter' : 'Enregistrer'}</button>
      </div>`);

    v.querySelector('[data-ok]').onclick = async () => {
      const d = { ...l };
      v.querySelectorAll('[name]').forEach((i) => { d[i.name] = i.value.trim(); });
      const err = v.querySelector('#err');
      if (!d.designation) { err.textContent = 'Le libellé est obligatoire.'; err.hidden = false; return; }
      if (t === 'prestation') {
        try {
          d.qte = parseQty(d.qte || '1');
          d.pu = parseAmount(d.pu || '0');
          d.remise = d.remise ? parsePercent(d.remise) : 0;
          d.tva = Number(d.tva);
        } catch { err.textContent = 'Chiffre illisible. Exemple : 18,50'; err.hidden = false; return; }
        if (d.remise > 10000) { err.textContent = 'La remise ne peut pas dépasser 100 %.'; err.hidden = false; return; }
      }
      const i = doc.lignes.findIndex((x) => x.id === d.id);
      if (i >= 0) doc.lignes[i] = d; else doc.lignes.push(d);
      await enregistrer(); v.remove(); rendre();
    };
    v.querySelector('[data-suppr]')?.addEventListener('click', async () => {
      doc.lignes = doc.lignes.filter((x) => x.id !== l.id);
      await enregistrer(); v.remove(); rendre();
    });
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
    if (!await confirmer(`Émettre ce ${LIBELLE[doc.type].toLowerCase()} ?`,
      'Un numéro définitif lui sera attribué et il ne pourra plus être modifié.', 'Émettre')) return;
    try {
      const bouton = $('#emettre', app);
      if (bouton) bouton.disabled = true;
      doc = await emettreDocument(doc, reglages);
      tampon(`${doc.numero} émis`);
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
    <label style="display:flex;gap:9px;align-items:flex-start;margin:12px 0;font-size:13.5px;color:var(--encre)">
      <input type="checkbox" id="cond" style="width:20px;height:20px;flex-shrink:0;margin:0">
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
