// pdf-lib et fontkit sont charges en UMD depuis index.html : les builds ESM
// contiennent un import nu de "pako" que le navigateur ne sait pas resoudre.
const { PDFDocument, rgb } = globalThis.PDFLib;
const fontkit = globalThis.fontkit;
import { calculerTotaux } from './totals.js';
import { formatAmount, formatQty, formatPercent } from './money.js';

const MM = 72 / 25.4;
const A4 = [210 * MM, 297 * MM];
const MARGE = 15 * MM;
const LARGEUR = A4[0] - 2 * MARGE;

export const TYPOS = {
  technique: { titre: 'archivo', corps: 'archivo', chiffres: 'mono' },
  institutionnel: { titre: 'archivo-bold', corps: 'archivo', chiffres: 'mono' },
  moderne: { titre: 'archivo-bold', corps: 'archivo', chiffres: 'mono' },
  compact: { titre: 'archivo', corps: 'archivo', chiffres: 'mono' },
};

const cachePolices = new Map();
async function chargerPolice(nom) {
  if (!cachePolices.has(nom)) {
    const r = await fetch(`./assets/fonts/${nom}.ttf`);
    if (!r.ok) throw new Error(`police introuvable: ${nom}`);
    cachePolices.set(nom, new Uint8Array(await r.arrayBuffer()));
  }
  return cachePolices.get(nom);
}

function hexRgb(hex) {
  const h = hex.replace('#', '');
  return rgb(
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  );
}

const NOIR = rgb(0.07, 0.09, 0.11);
const GRIS = rgb(0.42, 0.45, 0.48);
const TRAIT = rgb(0.85, 0.87, 0.89);
const FOND = rgb(0.965, 0.972, 0.976);

const LIBELLES = { devis: 'DEVIS', facture: 'FACTURE', avoir: 'AVOIR' };

// Intl.NumberFormat('fr-FR') separe les milliers par une espace fine insecable
// (U+202F) absente des polices embarquees : elle se dessinait en carre vide.
const lisible = (t) => String(t ?? '').replace(/[\u202F\u00A0]/g, ' ');

// Coupe un texte a la largeur disponible, en respectant les mots.
function decouper(texte, police, taille, largeur) {
  const lignes = [];
  for (const paragraphe of String(texte ?? '').split('\n')) {
    let courante = '';
    for (const mot of paragraphe.split(/\s+/)) {
      const essai = courante ? courante + ' ' + mot : mot;
      if (police.widthOfTextAtSize(essai, taille) > largeur && courante) {
        lignes.push(courante);
        courante = mot;
      } else {
        courante = essai;
      }
    }
    lignes.push(courante);
  }
  return lignes;
}

export async function genererPdf(doc, client, reglages) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  const typo = TYPOS[reglages.typographie] ?? TYPOS.technique;
  const [fTitre, fCorps, fChiffres] = await Promise.all([
    pdf.embedFont(await chargerPolice(typo.titre), { subset: true }),
    pdf.embedFont(await chargerPolice(typo.corps), { subset: true }),
    pdf.embedFont(await chargerPolice(typo.chiffres), { subset: true }),
  ]);
  const accent = hexRgb(reglages.couleur ?? '#B85C38');

  let logo = null;
  if (reglages.logo) {
    try {
      const octets = Uint8Array.from(atob(reglages.logo.split(',')[1]), (c) => c.charCodeAt(0));
      logo = reglages.logo.includes('image/png')
        ? await pdf.embedPng(octets)
        : await pdf.embedJpg(octets);
    } catch { logo = null; }
  }

  const totaux = doc.totaux ?? calculerTotaux(doc);
  const emetteur = doc.empreinteEmetteur ?? reglages;
  const cli = doc.clientInstantane ?? client ?? {};

  const COLS = [
    { x: 0, w: LARGEUR - 42 * MM, libelle: 'Désignation', align: 'left' },
    { x: LARGEUR - 42 * MM, w: 12 * MM, libelle: 'Qté', align: 'center' },
    { x: LARGEUR - 30 * MM, w: 14 * MM, libelle: 'P.U. HT', align: 'right' },
    { x: LARGEUR - 16 * MM, w: 16 * MM, libelle: 'Total HT', align: 'right' },
  ];

  const pages = [];
  let page, y;

  const texte = (t, x, yy, { police = fCorps, taille = 8.5, couleur = NOIR, align = 'left', largeur = 0 } = {}) => {
    const s = lisible(t);
    let px = MARGE + x;
    if (align === 'right') px = MARGE + x + largeur - police.widthOfTextAtSize(s, taille);
    if (align === 'center') px = MARGE + x + (largeur - police.widthOfTextAtSize(s, taille)) / 2;
    page.drawText(s, { x: px, y: yy, size: taille, font: police, color: couleur });
  };

  function nouvellePage() {
    page = pdf.addPage(A4);
    pages.push(page);
    y = A4[1] - MARGE;
    enTete();
    enTeteTableau();
  }

  function enTete() {
    const haut = y;

    // Colonne gauche : logo ou raison sociale, puis identite.
    let yg = haut;
    if (logo) {
      const cadreL = 40 * MM, cadreH = 20 * MM;
      const ech = Math.min(cadreL / logo.width, cadreH / logo.height);
      page.drawImage(logo, {
        x: MARGE, y: haut - cadreH, width: logo.width * ech, height: logo.height * ech,
      });
      yg = haut - cadreH - 4 * MM;
    } else {
      texte(emetteur.raisonSociale, 0, haut - 5 * MM, { police: fTitre, taille: 13, couleur: accent });
      yg = haut - 10 * MM;
    }

    const identite = [
      logo ? emetteur.raisonSociale : '',
      emetteur.adresse,
      `${emetteur.codePostal ?? ''} ${emetteur.ville ?? ''}`.trim(),
      emetteur.telephone, emetteur.email,
      emetteur.siret ? `SIRET ${emetteur.siret}` : '',
      emetteur.regimeTva === 'assujetti' && emetteur.tvaIntra ? `TVA ${emetteur.tvaIntra}` : '',
    ].filter(Boolean);
    for (const l of identite) { texte(l, 0, yg, { taille: 7.5, couleur: GRIS }); yg -= 3.6 * MM; }

    // Colonne droite : type de document, numero, cadre client.
    texte(LIBELLES[doc.type], 0, haut - 5 * MM, {
      police: fTitre, taille: 16, couleur: accent, align: 'right', largeur: LARGEUR,
    });
    texte(doc.numero ?? 'BROUILLON', 0, haut - 10 * MM, {
      police: fChiffres, taille: 9, couleur: GRIS, align: 'right', largeur: LARGEUR,
    });

    const cadreL = 64 * MM;
    const lignesClient = [
      cli.societe || cli.nom,
      cli.societe && cli.nom ? cli.nom : '',
      cli.adresse,
      `${cli.cp ?? ''} ${cli.ville ?? ''}`.trim(),
      cli.siret ? `SIRET ${cli.siret}` : '',
    ].filter(Boolean);
    const cadreH = 8 * MM + lignesClient.length * 3.8 * MM;
    const yCadre = haut - 16 * MM;
    page.drawRectangle({
      x: MARGE + LARGEUR - cadreL, y: yCadre - cadreH, width: cadreL, height: cadreH, color: FOND,
    });
    texte('CLIENT', LARGEUR - cadreL + 3 * MM, yCadre - 4.5 * MM, { taille: 6.5, couleur: GRIS });
    let yc = yCadre - 9 * MM;
    for (const l of lignesClient) {
      texte(l, LARGEUR - cadreL + 3 * MM, yc, { taille: 8, police: l === lignesClient[0] ? fTitre : fCorps });
      yc -= 3.8 * MM;
    }

    // Bloc dates, place SOUS l'identite : c'est ce chevauchement qui cassait la page.
    let yd = Math.min(yg, yCadre - cadreH - 1 * MM) - 2 * MM;
    const dates = [`Date : ${dateFr(doc.emisLe ?? doc.creeLe)}`];
    if (doc.type === 'devis') {
      dates.push(`Valable jusqu'au ${dateFr(doc.emisLe ?? doc.creeLe, doc.validite ?? emetteur.validiteDevis ?? 30)}`);
    }
    if (doc.type === 'facture') {
      dates.push(`Règlement : ${doc.delaiPaiement ?? emetteur.delaiPaiement ?? ''}`);
    }
    if (doc.type === 'avoir' && doc.factureSourceNumero) dates.push(`Facture ${doc.factureSourceNumero}`);
    if (doc.type === 'facture' && doc.devisSourceNumero) dates.push(`Devis ${doc.devisSourceNumero}`);
    for (const l of dates) { texte(l, 0, yd, { taille: 8, couleur: GRIS }); yd -= 4 * MM; }

    // Adresse de chantier, quand elle differe de l'adresse de facturation.
    const ch = doc.chantier;
    if (ch && !ch.identique && (ch.adresse || ch.ville)) {
      yd -= 1.5 * MM;
      texte("LIEU D'INTERVENTION", 0, yd, { taille: 6.5, couleur: GRIS });
      yd -= 4 * MM;
      for (const l of [ch.adresse, `${ch.cp ?? ''} ${ch.ville ?? ''}`.trim()].filter(Boolean)) {
        texte(l, 0, yd, { taille: 8 });
        yd -= 3.8 * MM;
      }
    }

    y = yd - 5 * MM;
  }

  function enTeteTableau() {
    page.drawRectangle({ x: MARGE, y: y - 6 * MM, width: LARGEUR, height: 6 * MM, color: accent });
    for (const c of COLS) {
      texte(c.libelle, c.x + 1.5 * MM, y - 4.2 * MM, {
        taille: 6.5, couleur: rgb(1, 1, 1), align: c.align, largeur: c.w - 3 * MM,
      });
    }
    y -= 6 * MM;
  }

  const RESERVE = 60 * MM; // place gardee pour totaux, mentions et signature

  nouvellePage();

  for (const ligne of doc.lignes ?? []) {
    const estPrestation = !ligne.type || ligne.type === 'prestation';
    const lignesTexte = decouper(ligne.designation, fCorps, 8.5, COLS[0].w - 3 * MM);
    const sousTitre = ligne.description ? decouper(ligne.description, fCorps, 7, COLS[0].w - 3 * MM) : [];
    const lignesRemise = estPrestation && ligne.remise ? 1 : 0;
    const hauteur = Math.max(
      6.5 * MM,
      (lignesTexte.length + sousTitre.length) * 3.9 * MM + lignesRemise * 3.2 * MM + 2.6 * MM,
    );

    if (y - hauteur < MARGE + RESERVE) nouvellePage();

    if (ligne.type === 'section') {
      page.drawRectangle({ x: MARGE, y: y - hauteur, width: LARGEUR, height: hauteur, color: FOND });
      texte(ligne.designation, 1.5 * MM, y - 4.6 * MM, { police: fTitre, taille: 8.5, couleur: accent });
    } else {
      let yl = y - 4.6 * MM;
      for (const l of lignesTexte) { texte(l, 1.5 * MM, yl, { taille: 8.5 }); yl -= 3.9 * MM; }
      for (const l of sousTitre) { texte(l, 1.5 * MM, yl, { taille: 7, couleur: GRIS }); yl -= 3.4 * MM; }

      if (estPrestation) {
        const ht = ligneHTLocal(ligne);
        texte(formatQty(ligne.qte) + (ligne.unite ? ' ' + ligne.unite : ''), COLS[1].x, y - 4.6 * MM, { police: fChiffres, taille: 8, align: 'center', largeur: COLS[1].w });
        texte(formatAmount(ligne.pu), COLS[2].x, y - 4.6 * MM, { police: fChiffres, taille: 8, align: 'right', largeur: COLS[2].w - 1.5 * MM });
        texte(formatAmount(ht), COLS[3].x, y - 4.6 * MM, { police: fChiffres, taille: 8, align: 'right', largeur: COLS[3].w - 1.5 * MM });
        if (ligne.remise) {
          texte(`remise ${formatPercent(ligne.remise)}`, 1.5 * MM, yl, { taille: 6.5, couleur: GRIS });
        }
      }
      page.drawLine({
        start: { x: MARGE, y: y - hauteur }, end: { x: MARGE + LARGEUR, y: y - hauteur },
        thickness: 0.4, color: TRAIT,
      });
    }
    y -= hauteur;
  }

  // --- Totaux ---
  y -= 5 * MM;
  const boxL = 68 * MM;
  const boxX = LARGEUR - boxL;
  const ligneTotal = (libelle, valeur, { gras = false, fond = null } = {}) => {
    if (fond) {
      page.drawRectangle({ x: MARGE + boxX, y: y - 6.5 * MM, width: boxL, height: 6.5 * MM, color: fond });
    }
    const couleur = fond ? rgb(1, 1, 1) : GRIS;
    texte(libelle, boxX + 2.5 * MM, y - 4.5 * MM, { taille: gras ? 8.5 : 8, couleur, police: gras ? fTitre : fCorps });
    texte(valeur, boxX, y - 4.5 * MM, {
      police: fChiffres, taille: gras ? 9.5 : 8,
      couleur: fond ? rgb(1, 1, 1) : NOIR, align: 'right', largeur: boxL - 2.5 * MM,
    });
    y -= 6.5 * MM;
  };

  if (totaux.remiseGlobaleMontant) {
    ligneTotal('Sous-total HT', formatAmount(totaux.brutHT));
    ligneTotal('Remise', '-' + formatAmount(totaux.remiseGlobaleMontant));
  }
  ligneTotal('Total HT', formatAmount(totaux.totalHT));
  for (const v of totaux.ventilation) {
    if (v.taux > 0) ligneTotal(`TVA ${formatPercent(v.taux)} sur ${formatAmount(v.base)}`, formatAmount(v.tva));
  }
  ligneTotal('Total TTC', formatAmount(totaux.totalTTC) + ' €', { gras: true, fond: accent });

  if (doc.reglements?.length) {
    const regle = doc.reglements.reduce((s, r) => s + r.montant, 0);
    ligneTotal('Déjà réglé', formatAmount(regle));
    ligneTotal('Reste à payer', formatAmount(totaux.totalTTC - regle) + ' €', { gras: true });
  }

  // --- Signature ---
  if (doc.signature) {
    const sy = y - 2 * MM;
    const sl = 60 * MM, sh = 26 * MM;
    page.drawRectangle({
      x: MARGE, y: sy - sh, width: sl, height: sh,
      borderColor: TRAIT, borderWidth: 0.5, color: rgb(1, 1, 1),
    });
    texte('Bon pour accord', 2.5 * MM, sy - 4.5 * MM, { taille: 7, couleur: GRIS });
    dessinerTrace(page, doc.signature.trace, MARGE + 3 * MM, sy - sh + 6 * MM, sl - 6 * MM, sh - 11 * MM);
    texte(
      `${doc.signature.nomSignataire} — ${dateFr(doc.signature.signeLe)} à ${heureFr(doc.signature.signeLe)}`,
      2.5 * MM, sy - sh + 2.5 * MM, { taille: 6.5, couleur: GRIS },
    );
  } else if (doc.type === 'devis') {
    const sy = y - 2 * MM;
    const sl = 60 * MM, sh = 26 * MM;
    page.drawRectangle({
      x: MARGE, y: sy - sh, width: sl, height: sh,
      borderColor: TRAIT, borderWidth: 0.5, borderDashArray: [2, 2],
    });
    texte('Bon pour accord — date et signature', 2.5 * MM, sy - 4.5 * MM, { taille: 7, couleur: GRIS });
  }

  // --- Pied de page sur chaque page ---
  const NOM_MOYEN = {
    virement: 'virement', cheque: 'chèque', especes: 'espèces',
    carte: 'carte bancaire', lien: 'lien de paiement',
  };
  const moyens = (emetteur.moyensPaiement ?? []).map((m) => NOM_MOYEN[m] ?? m);
  const reglement = [
    moyens.length ? `Règlement par ${moyens.join(', ')}` : '',
    moyens.includes('virement') && emetteur.iban
      ? `IBAN ${formaterIban(emetteur.iban)}${emetteur.titulaire ? ' — ' + emetteur.titulaire : ''}`
      : '',
  ].filter(Boolean).join('. ');

  const mentions = [
    reglement,
    doc.type !== 'devis' && emetteur.penalites
      ? `Pénalités de retard : ${emetteur.penalites}. Indemnité forfaitaire de recouvrement : ${emetteur.indemniteRecouvrement}`
      : '',
    emetteur.regimeTva === 'franchise' ? 'TVA non applicable, art. 293 B du CGI' : '',
    emetteur.assurance, emetteur.mentionLibre,
  ].filter(Boolean).join('. ') + '.';

  pages.forEach((p, i) => {
    const lignesM = decouper(mentions, fCorps, 6, LARGEUR);
    let ym = MARGE + 6 * MM + lignesM.length * 2.6 * MM;
    p.drawLine({
      start: { x: MARGE, y: ym + 2 * MM }, end: { x: MARGE + LARGEUR, y: ym + 2 * MM },
      thickness: 0.4, color: TRAIT,
    });
    for (const l of lignesM) {
      p.drawText(lisible(l), { x: MARGE, y: ym, size: 6, font: fCorps, color: GRIS });
      ym -= 2.6 * MM;
    }
    const num = lisible(`Page ${i + 1} / ${pages.length}`);
    p.drawText(num, {
      x: MARGE + LARGEUR - fChiffres.widthOfTextAtSize(num, 6.5),
      y: MARGE, size: 6.5, font: fChiffres, color: GRIS,
    });
    if (doc.numero) {
      p.drawText(doc.numero, { x: MARGE, y: MARGE, size: 6.5, font: fChiffres, color: GRIS });
    }
  });

  if (reglages.cgv?.trim()) {
    const p = pdf.addPage(A4);
    p.drawText('Conditions générales de vente', {
      x: MARGE, y: A4[1] - MARGE, size: 11, font: fTitre, color: accent,
    });
    let yc = A4[1] - MARGE - 8 * MM;
    for (const l of decouper(reglages.cgv, fCorps, 7, LARGEUR)) {
      if (yc < MARGE) break;
      p.drawText(lisible(l), { x: MARGE, y: yc, size: 7, font: fCorps, color: NOIR });
      yc -= 3.2 * MM;
    }
  }

  pdf.setTitle(`${LIBELLES[doc.type]} ${doc.numero ?? ''}`.trim());
  pdf.setProducer('SoloApp');
  return new Blob([await pdf.save({ useObjectStreams: true })], { type: 'application/pdf' });
}

function dessinerTrace(page, trace, x, y, largeur, hauteur) {
  if (!trace?.length) return;
  const pts = trace.flat();
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const ech = Math.min(largeur / (maxX - minX || 1), hauteur / (maxY - minY || 1));
  for (const segment of trace) {
    for (let i = 1; i < segment.length; i++) {
      page.drawLine({
        start: { x: x + (segment[i - 1][0] - minX) * ech, y: y + (maxY - segment[i - 1][1]) * ech },
        end: { x: x + (segment[i][0] - minX) * ech, y: y + (maxY - segment[i][1]) * ech },
        thickness: 0.9, color: rgb(0.05, 0.05, 0.2),
      });
    }
  }
}

export function formaterIban(iban) {
  return String(iban ?? '').replace(/\s/g, '').toUpperCase().replace(/(.{4})/g, '$1 ').trim();
}

function ligneHTLocal(l) {
  return Math.round((l.qte * l.pu * (10000 - (l.remise ?? 0))) / (1000 * 10000));
}

function dateFr(iso, ajoutJours = 0) {
  const d = new Date(iso ?? Date.now());
  if (ajoutJours) d.setDate(d.getDate() + ajoutJours);
  return d.toLocaleDateString('fr-FR');
}

function heureFr(iso) {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
