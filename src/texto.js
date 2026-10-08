// Utilidades de texto compartilhadas.

export function normalizar(s) {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const VAZIAS = new Set(('a o as os de da do das dos e em no na nos nas um uma por para com ' +
  'the of and in on for to an at by from with')
  .split(' '));

export function tokens(s) {
  return normalizar(s).split(' ').filter((t) => t.length > 1 && !VAZIAS.has(t));
}

function levenshtein(a, b) {
  let ant = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const atual = [i];
    for (let j = 1; j <= b.length; j++) {
      atual[j] = Math.min(ant[j] + 1, atual[j - 1] + 1, ant[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    ant = atual;
  }
  return ant[b.length];
}

// Similaridade de títulos entre 0 e 1: termos em comum no título inteiro, ou título principal
// (antes de ":") praticamente idêntico, já que bases costumam omitir o subtítulo.
export function similaridadeTitulo(a, b) {
  const tx = new Set(tokens(a));
  const ty = new Set(tokens(b));
  let comum = 0;
  for (const t of tx) if (ty.has(t)) comum++;
  const termos = tx.size && ty.size ? comum / Math.max(tx.size, ty.size) : 0;
  const pa = normalizar((a || '').split(/[:?]/)[0]);
  const pb = normalizar((b || '').split(/[:?]/)[0]);
  const principal = pa && pb ? 1 - levenshtein(pa, pb) / Math.max(pa.length, pb.length) : 0;
  return Math.max(termos, principal);
}

export function contarPalavras(s) {
  const m = (s || '').match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu);
  return m ? m.length : 0;
}

// Título de seção normalizado, sem numeração progressiva ("1 INTRODUÇÃO", "5.Conclusão").
export function tituloSecao(texto) {
  return (texto || '')
    .replace(/^\s*\d+(\.\d+)*(\.?\s+|\.(?=\p{L}))/u, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}
