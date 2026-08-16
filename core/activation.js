import { SEL, EMPREINTES } from './codes.js';

async function empreinte(code) {
  const donnees = new TextEncoder().encode(SEL + '|' + code.trim().toUpperCase());
  const digest = await crypto.subtle.digest('SHA-256', donnees);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

export function normaliser(saisie) {
  const brut = String(saisie).toUpperCase().replace(/[^0-9A-Z]/g, '');
  const corps = brut.startsWith('SOLO') ? brut.slice(4) : brut;
  if (corps.length !== 12) return null;
  return 'SOLO-' + corps.slice(0, 4) + '-' + corps.slice(4, 8) + '-' + corps.slice(8, 12);
}

export async function verifier(saisie) {
  const code = normaliser(saisie);
  if (!code) return { valide: false, motif: 'format' };
  const valide = EMPREINTES.has(await empreinte(code));
  return valide ? { valide: true, code } : { valide: false, motif: 'inconnu' };
}

export function nouvelIdentifiantAppareil() {
  return crypto.randomUUID();
}
