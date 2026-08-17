import { $, ech, ico, eur, tampon, feuille, confirmer, vide } from './kit.js';
import { tout, ecrire, lireReglages, ecrireReglages } from '../core/db.js';
import { nouvelId } from '../core/documents.js';
import { parseAmount, parsePercent, formatAmount } from '../core/money.js';

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// ---------------------------------------------------------------- CLIENTS

export async function vueClients(app) {
  const clients = (await tout('clients')).filter((c) => !c.archive)
    .sort((a, b) => (a.societe || a.nom).localeCompare(b.societe || b.nom));
  let filtre = '';

  const liste = () => {
    const f = norm(filtre);
    const vus = clients.filter((c) => !f || norm(`${c.societe} ${c.nom} ${c.ville}`).includes(f));
    if (!vus.length) {
      return filtre ? vide('Aucun résultat', 'Essayez un autre nom.')
        : vide('Aucun client', 'Ajoutez votre premier client avec le bouton +.');
    }
    return vus.map((c) => `
      <button class="rangee" data-id="${c.id}">
        <div class="corps">
          <div class="titre">${ech(c.societe || c.nom)}</div>
          <div class="sous">${ech([c.ville, c.email].filter(Boolean).join(' · ') || 'Aucune coordonnée')}</div>
        </div>
      </button>`).join('');
  };

  app.innerHTML = `
    <div class="recherche">${ico('recherche')}<input placeholder="Rechercher un client" id="q"></div>
    <div id="liste">${liste()}</div>`;

  $('#q', app).oninput = (e) => { filtre = e.target.value; $('#liste', app).innerHTML = liste(); brancher(); };
  const brancher = () => app.querySelectorAll('.rangee').forEach((b) => {
    b.onclick = () => ficheClient(clients.find((c) => c.id === b.dataset.id));
  });
  brancher();
}

export function ficheClient(client, apres) {
  const c = client ?? {
    id: nouvelId(), categorie: 'pro', nom: '', societe: '', siret: '',
    adresse: '', cp: '', ville: '', email: '', telephone: '', notes: '',
  };
  let categorie = c.categorie ?? (c.societe ? 'pro' : 'particulier');
  const champ = (cle, libelle, opts = '') =>
    `<div class="champ"><label>${libelle}</label><input name="${cle}" value="${ech(c[cle])}" ${opts}></div>`;

  const v = feuille(client ? 'Modifier le client' : 'Nouveau client', `
    <div class="segment" id="cat">
      <button data-k="pro" aria-pressed="${categorie === 'pro'}">Professionnel</button>
      <button data-k="particulier" aria-pressed="${categorie === 'particulier'}">Particulier</button>
    </div>
    <div id="blocPro">
      ${champ('societe', 'Raison sociale')}
      ${champ('siret', 'SIRET')}
    </div>
    ${champ('nom', 'Nom et prénom')}
    <div class="duo">${champ('email', 'E-mail', 'type="email" inputmode="email"')}${champ('telephone', 'Téléphone', 'inputmode="tel"')}</div>
    ${champ('adresse', 'Adresse')}
    <div class="duo">${champ('cp', 'Code postal', 'inputmode="numeric"')}${champ('ville', 'Ville')}</div>
    <div class="champ"><label>Notes</label><textarea name="notes">${ech(c.notes)}</textarea></div>
    <div class="erreur" id="err" hidden></div>
    <div class="actions">
      ${client ? '<button class="btn btn-danger" data-suppr>Archiver</button>' : ''}
      <button class="btn btn-plein" data-ok>Enregistrer</button>
    </div>`);

  const majCategorie = () => {
    v.querySelector('#blocPro').style.display = categorie === 'pro' ? 'block' : 'none';
    v.querySelector('[name=nom]').closest('.champ').querySelector('label').textContent =
      categorie === 'pro' ? 'Contact' : 'Nom et prénom';
    v.querySelectorAll('#cat button').forEach((b) =>
      b.setAttribute('aria-pressed', b.dataset.k === categorie));
  };
  v.querySelectorAll('#cat button').forEach((b) => b.onclick = () => {
    categorie = b.dataset.k; majCategorie();
  });
  majCategorie();

  v.querySelector('[data-ok]').onclick = async () => {
    const d = { ...c, categorie };
    v.querySelectorAll('[name]').forEach((i) => { d[i.name] = i.value.trim(); });
    if (categorie === 'particulier') { d.societe = ''; d.siret = ''; }
    const e = v.querySelector('#err');
    if (categorie === 'pro' && !d.societe) {
      e.textContent = 'La raison sociale est obligatoire pour un professionnel.'; e.hidden = false;
      return;
    }
    if (categorie === 'particulier' && !d.nom) {
      e.textContent = 'Le nom est obligatoire.'; e.hidden = false;
      return;
    }
    d.creeLe ??= new Date().toISOString();
    await ecrire('clients', d);
    v.remove(); tampon('Client enregistré'); apres ? apres(d) : vueClients($('#vue'));
  };
  v.querySelector('[data-suppr]')?.addEventListener('click', async () => {
    if (!await confirmer('Archiver ce client ?', 'Il disparaît des listes. Ses documents restent consultables.', 'Archiver', true)) return;
    await ecrire('clients', { ...c, archive: true });
    v.remove(); tampon('Client archivé'); vueClients($('#vue'));
  });
}

// ---------------------------------------------------------------- CATALOGUE

export async function vueArticles(app) {
  const articles = (await tout('articles')).filter((a) => !a.archive)
    .sort((a, b) => a.designation.localeCompare(b.designation));
  let filtre = '';

  const liste = () => {
    const f = norm(filtre);
    const vus = articles.filter((a) => !f || norm(a.designation).includes(f));
    if (!vus.length) {
      return filtre ? vide('Aucun résultat', 'Essayez un autre mot.')
        : vide('Catalogue vide', 'Enregistrez vos prestations une fois, réutilisez-les toujours.');
    }
    return vus.map((a) => `
      <button class="rangee" data-id="${a.id}">
        <div class="corps">
          <div class="titre">${ech(a.designation)}</div>
          <div class="sous">${ech(a.unite || 'unité')} · TVA ${(a.tva / 100).toString().replace('.', ',')} %</div>
        </div>
        <div class="droite"><div class="montant">${eur(a.pu)}</div></div>
      </button>`).join('');
  };

  app.innerHTML = `
    <div class="recherche">${ico('recherche')}<input placeholder="Rechercher une prestation" id="q"></div>
    <div id="liste">${liste()}</div>`;

  $('#q', app).oninput = (e) => { filtre = e.target.value; $('#liste', app).innerHTML = liste(); brancher(); };
  const brancher = () => app.querySelectorAll('.rangee').forEach((b) => {
    b.onclick = () => ficheArticle(articles.find((a) => a.id === b.dataset.id));
  });
  brancher();
}

export async function ficheArticle(article, apres) {
  const r = await lireReglages();
  const a = article ?? { id: nouvelId(), designation: '', description: '', pu: 0, unite: '', tva: r.tauxDefaut };
  const v = feuille(article ? 'Modifier la prestation' : 'Nouvelle prestation', `
    <div class="champ"><label>Désignation</label><input name="designation" value="${ech(a.designation)}"></div>
    <div class="champ"><label>Description</label><textarea name="description" style="min-height:60px">${ech(a.description)}</textarea></div>
    <div class="duo">
      <div class="champ"><label>Prix unitaire HT</label><input name="pu" inputmode="decimal" value="${a.pu ? formatAmount(a.pu) : ''}"></div>
      <div class="champ"><label>Unité</label><input name="unite" value="${ech(a.unite)}" placeholder="h, m, u"></div>
    </div>
    <div class="champ"><label>TVA</label><select name="tva">
      ${[2000, 1000, 550, 0].map((t) => `<option value="${t}" ${a.tva === t ? 'selected' : ''}>${(t / 100).toString().replace('.', ',')} %</option>`).join('')}
    </select></div>
    <div class="erreur" id="err" hidden></div>
    <div class="actions">
      ${article ? '<button class="btn btn-danger" data-suppr>Archiver</button>' : ''}
      <button class="btn btn-plein" data-ok>Enregistrer</button>
    </div>`);

  v.querySelector('[data-ok]').onclick = async () => {
    const d = { ...a };
    v.querySelectorAll('[name]').forEach((i) => { d[i.name] = i.value.trim(); });
    const e = v.querySelector('#err');
    if (!d.designation) { e.textContent = 'La désignation est obligatoire.'; e.hidden = false; return; }
    try { d.pu = parseAmount(d.pu || '0'); }
    catch { e.textContent = 'Prix illisible. Exemple : 52,00'; e.hidden = false; return; }
    d.tva = Number(d.tva);
    d.creeLe ??= new Date().toISOString();
    await ecrire('articles', d);
    v.remove(); tampon('Prestation enregistrée'); apres ? apres(d) : vueArticles($('#vue'));
  };
  v.querySelector('[data-suppr]')?.addEventListener('click', async () => {
    if (!await confirmer('Archiver cette prestation ?', 'Elle disparaît du catalogue. Les documents qui la contiennent ne changent pas.', 'Archiver', true)) return;
    await ecrire('articles', { ...a, archive: true });
    v.remove(); tampon('Prestation archivée'); vueArticles($('#vue'));
  });
}

// ---------------------------------------------------------------- RÉGLAGES

const COULEURS = [
  ['#B85C38', 'Cuivre'], ['#185FA5', 'Bleu'], ['#0F6E56', 'Vert'], ['#5F5E5A', 'Graphite'],
];
const TYPOS = [['technique', 'Technique'], ['institutionnel', 'Institutionnel'], ['moderne', 'Moderne'], ['compact', 'Compact']];

export async function vueReglages(app, { premierLancement = false, apres } = {}) {
  const r = await lireReglages();
  const ch = (cle, libelle, opts = '') =>
    `<div class="champ"><label>${libelle}</label><input name="${cle}" value="${ech(r[cle])}" ${opts}></div>`;

  app.innerHTML = `
    ${premierLancement ? `<div class="bandeau b-info">${ico('info')}<div>Ces informations apparaîtront sur vos devis et factures. Vous pourrez les modifier à tout moment.</div></div>` : ''}

    <div class="section">Logo</div>
    <div class="carte" style="display:flex;gap:14px;align-items:center">
      <div id="apercuLogo" style="width:96px;height:60px;border:1px dashed var(--trait);border-radius:var(--r-s);display:grid;place-items:center;overflow:hidden;flex-shrink:0;background:#fff">
        ${r.logo ? `<img src="${r.logo}" style="max-width:100%;max-height:100%">` : `<span style="font-size:11px;color:var(--gris-clair)">Aucun</span>`}
      </div>
      <div style="flex:1">
        <button class="btn" id="choisirLogo" style="width:100%">Choisir une image</button>
        <p style="font-size:11.5px;color:var(--gris);margin:7px 0 0;line-height:1.45">Cadre de 40 × 20 mm en haut du document. Redimensionné automatiquement.</p>
      </div>
      <input type="file" id="fLogo" accept="image/png,image/jpeg" hidden>
    </div>

    <div class="section">Identité</div>
    <div class="carte">
      ${ch('raisonSociale', 'Raison sociale')}
      <div class="duo">
        <div class="champ"><label>Forme juridique</label><select name="formeJuridique">
          ${['EI', 'Micro-entreprise', 'EURL', 'SASU', 'SARL', 'SAS', 'SCI', 'Association'].map((f) => `<option ${r.formeJuridique === f ? 'selected' : ''}>${f}</option>`).join('')}
        </select></div>
        ${ch('apeCode', 'Code APE')}
      </div>
      ${ch('siret', 'SIRET', 'inputmode="numeric"')}
      ${ch('rcs', 'RCS ou RM')}
    </div>

    <div class="section">Coordonnées</div>
    <div class="carte">
      ${ch('adresse', 'Adresse')}
      <div class="duo">${ch('codePostal', 'Code postal', 'inputmode="numeric"')}${ch('ville', 'Ville')}</div>
      <div class="duo">${ch('telephone', 'Téléphone', 'inputmode="tel"')}${ch('email', 'E-mail', 'type="email"')}</div>
    </div>

    <div class="section">TVA</div>
    <div class="carte">
      <div class="champ"><label>Régime</label><select name="regimeTva" id="regime">
        <option value="assujetti" ${r.regimeTva === 'assujetti' ? 'selected' : ''}>Assujetti à la TVA</option>
        <option value="franchise" ${r.regimeTva === 'franchise' ? 'selected' : ''}>Franchise en base</option>
      </select></div>
      <div id="blocTva">
        ${ch('tvaIntra', 'N° TVA intracommunautaire')}
        <div class="champ"><label>Taux par défaut</label><select name="tauxDefaut">
          ${[2000, 1000, 550, 0].map((t) => `<option value="${t}" ${r.tauxDefaut === t ? 'selected' : ''}>${(t / 100).toString().replace('.', ',')} %</option>`).join('')}
        </select></div>
      </div>
      <div class="bandeau b-info" id="mention" style="margin:0">${ico('info')}<div></div></div>
    </div>

    <div class="section">Conditions</div>
    <div class="carte">
      <div class="duo">
        ${ch('delaiPaiement', 'Délai de paiement')}
        <div class="champ"><label>Validité du devis</label><select name="validiteDevis">
          ${[15, 30, 60, 90].map((j) => `<option value="${j}" ${Number(r.validiteDevis) === j ? 'selected' : ''}>${j} jours</option>`).join('')}
        </select></div>
      </div>
      ${ch('penalites', 'Pénalités de retard')}
      ${ch('indemniteRecouvrement', 'Indemnité de recouvrement')}
      ${ch('assurance', 'Assurance professionnelle')}
      <div class="champ"><label>Coordonnées de paiement</label><textarea name="coordonneesPaiement" style="min-height:64px" placeholder="Mode de règlement accepté">${ech(r.coordonneesPaiement)}</textarea></div>
      ${ch('mentionLibre', 'Mention libre en pied de page')}
      <div class="champ" style="margin:0"><label>Conditions générales (page annexe)</label><textarea name="cgv" placeholder="Laissez vide pour ne pas ajouter de page">${ech(r.cgv)}</textarea></div>
    </div>

    <div class="section">Apparence des documents</div>
    <div class="carte">
      <label>Couleur</label>
      <div style="display:flex;gap:10px;margin-bottom:16px" id="couleurs">
        ${COULEURS.map(([hex, nom]) => `<button data-c="${hex}" title="${nom}" style="width:40px;height:40px;border-radius:50%;background:${hex};border:${r.couleur === hex ? '3px solid var(--encre)' : '1px solid var(--trait)'}"></button>`).join('')}
      </div>
      <label>Typographie</label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px" id="typos">
        ${TYPOS.map(([id, nom]) => `<button data-t="${id}" class="btn" style="${r.typographie === id ? 'background:var(--marine);color:#fff;border-color:var(--marine)' : ''}">${nom}</button>`).join('')}
      </div>
    </div>

    <div class="section">Numérotation</div>
    <div class="carte">
      <div class="duo">
        <div class="champ"><label>Préfixe devis</label><input name="prefixeDevis" value="${ech(r.prefixes.devis)}"></div>
        <div class="champ" style="margin:0"><label>Préfixe facture</label><input name="prefixeFacture" value="${ech(r.prefixes.facture)}"></div>
      </div>
    </div>

    <button class="btn btn-plein btn-large" id="ok" style="margin-top:18px">${premierLancement ? 'Commencer' : 'Enregistrer'}</button>
    <p style="text-align:center;font-size:11.5px;color:var(--gris-clair);margin:16px 0 0">SoloApp · version 1.0</p>`;

  const majMention = () => {
    const f = $('#regime', app).value === 'franchise';
    $('#blocTva', app).style.display = f ? 'none' : 'block';
    $('#mention div', app).textContent = f
      ? 'Mention ajoutée : TVA non applicable, art. 293 B du CGI'
      : 'Aucune mention de TVA supplémentaire.';
  };
  $('#regime', app).onchange = majMention; majMention();

  let couleur = r.couleur, typo = r.typographie;
  app.querySelectorAll('#couleurs button').forEach((b) => b.onclick = () => {
    couleur = b.dataset.c;
    app.querySelectorAll('#couleurs button').forEach((x) =>
      x.style.border = x.dataset.c === couleur ? '3px solid var(--encre)' : '1px solid var(--trait)');
  });
  app.querySelectorAll('#typos button').forEach((b) => b.onclick = () => {
    typo = b.dataset.t;
    app.querySelectorAll('#typos button').forEach((x) =>
      x.style.cssText = x.dataset.t === typo ? 'background:var(--marine);color:#fff;border-color:var(--marine)' : '');
  });

  let logo = r.logo;
  $('#choisirLogo', app).onclick = () => $('#fLogo', app).click();
  $('#fLogo', app).onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    logo = await redimensionner(f, 600);
    $('#apercuLogo', app).innerHTML = `<img src="${logo}" style="max-width:100%;max-height:100%">`;
  };

  $('#ok', app).onclick = async () => {
    const d = { ...r, couleur, typographie: typo, logo, configure: true };
    app.querySelectorAll('[name]').forEach((i) => { d[i.name] = i.value.trim(); });
    d.tauxDefaut = Number(d.tauxDefaut ?? r.tauxDefaut);
    d.validiteDevis = Number(d.validiteDevis);
    d.prefixes = { ...r.prefixes, devis: d.prefixeDevis || 'DV-', facture: d.prefixeFacture || 'FA-' };
    delete d.prefixeDevis; delete d.prefixeFacture;
    if (!d.raisonSociale) { tampon('La raison sociale est obligatoire'); return; }
    await ecrireReglages(d);
    tampon('Réglages enregistrés');
    apres?.(d);
  };
}

function redimensionner(fichier, largeurMax) {
  return new Promise((res, rej) => {
    const lecteur = new FileReader();
    lecteur.onload = () => {
      const img = new Image();
      img.onload = () => {
        const ech = Math.min(1, largeurMax / img.width);
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * ech); c.height = Math.round(img.height * ech);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL(fichier.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.9));
      };
      img.onerror = rej; img.src = lecteur.result;
    };
    lecteur.onerror = rej;
    lecteur.readAsDataURL(fichier);
  });
}
