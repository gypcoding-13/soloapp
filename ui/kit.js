export const $ = (s, r = document) => r.querySelector(s);
export const ech = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const P = {
  devis: 'M9 2h6l4 4v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM8 11h8M8 15h5',
  facture: 'M6 2h12v20l-3-2-3 2-3-2-3 2V2zM9 8h6M9 12h6M9 16h3',
  clients: 'M16 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M9.5 8.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6M21 20v-2a4 4 0 0 0-3-3.85',
  produits: 'M20 7.5v9l-8 4.5-8-4.5v-9L12 3l8 4.5zM4 7.5l8 4.5 8-4.5M12 12v9',
  reglages: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  plus: 'M12 5v14M5 12h14',
  retour: 'M15 18l-6-6 6-6',
  chevron: 'M9 18l6-6-6-6',
  recherche: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  partage: 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v14',
  poubelle: 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6',
  copier: 'M9 9h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2zM5 15H4a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v1',
  signature: 'M3 17c3-6 6 3 9-3s5 2 9-3M3 21h18',
  check: 'M20 6L9 17l-5-5',
  alerte: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
  euro: 'M18 7a7 7 0 1 0 0 10M3 11h9M3 15h9',
  pdf: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM14 2v6h6',
  vide: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
};

// La taille est ecrite dans l'element : un SVG sans dimension explicite
// se dessine a 300x150 par defaut et devore la mise en page.
export const ico = (n, t = 2, taille = 20) =>
  `<svg viewBox="0 0 24 24" width="${taille}" height="${taille}" fill="none" stroke="currentColor" stroke-width="${t}" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="${P[n]}"/></svg>`;

export const nfEuro = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const eur = (c) => nfEuro.format((c ?? 0) / 100) + ' €';
export const dateFr = (iso) => iso ? new Date(iso).toLocaleDateString('fr-FR') : '';
export const dateCourte = (iso) => iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '';

export const LIBELLE_STATUT = {
  brouillon: 'Brouillon', emis: 'Émis', emise: 'Émise', envoye: 'Envoyé', envoyee: 'Envoyée',
  accepte: 'Accepté', refuse: 'Refusé', expire: 'Expiré', converti: 'Converti',
  partiellement_reglee: 'Partiel', soldee: 'Payée', annulee: 'Annulée',
};

export function puce(statut) {
  return `<span class="puce p-${statut}">${LIBELLE_STATUT[statut] ?? statut}</span>`;
}

let minuteurTampon;
export function tampon(message) {
  document.querySelector('.tampon')?.remove();
  const el = document.createElement('div');
  el.className = 'tampon';
  el.textContent = message;
  document.body.append(el);
  clearTimeout(minuteurTampon);
  minuteurTampon = setTimeout(() => el.remove(), 2600);
}

export function feuille(titre, html, apres) {
  const voile = document.createElement('div');
  voile.className = 'voile';
  voile.innerHTML = `<div class="feuille"><div class="poignee"></div>
    ${titre ? `<h2 style="margin:0 0 14px;font-size:17px;font-weight:500">${ech(titre)}</h2>` : ''}
    ${html}</div>`;
  voile.addEventListener('click', (e) => { if (e.target === voile) voile.remove(); });
  document.body.append(voile);
  apres?.(voile);
  return voile;
}

export function confirmer(titre, texte, libelleOk = 'Confirmer', danger = false) {
  return new Promise((res) => {
    const v = feuille(titre, `
      <p style="margin:0 0 16px;color:var(--gris);font-size:14px;line-height:1.55">${ech(texte)}</p>
      <div class="actions">
        <button class="btn" data-non>Annuler</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-plein'}" data-oui>${ech(libelleOk)}</button>
      </div>`);
    v.querySelector('[data-non]').onclick = () => { v.remove(); res(false); };
    v.querySelector('[data-oui]').onclick = () => { v.remove(); res(true); };
  });
}

export function vide(titre, sous) {
  return `<div class="vide">${ico('vide', 1.4)}<p>${ech(titre)}</p><small>${ech(sous)}</small></div>`;
}

export async function partagerFichier(blob, nomFichier, { objet, corps, destinataire, type } = {}) {
  const fichier = new File([blob], nomFichier, { type: type ?? blob.type ?? 'application/pdf' });
  if (navigator.canShare?.({ files: [fichier] })) {
    try {
      await navigator.share({ files: [fichier], title: objet, text: corps });
      return 'partage';
    } catch (e) {
      if (e.name === 'AbortError') return 'annule';
    }
  }
  telecharger(blob, nomFichier);
  if (destinataire) {
    const lien = `mailto:${encodeURIComponent(destinataire)}?subject=${encodeURIComponent(objet ?? '')}&body=${encodeURIComponent(corps ?? '')}`;
    setTimeout(() => { location.href = lien; }, 400);
    return 'mailto';
  }
  return 'telechargement';
}

export function telecharger(blob, nom) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nom;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function gabarit(modele, valeurs) {
  return String(modele ?? '').replace(/\{(\w+)\}/g, (_, c) => valeurs[c] ?? '');
}
