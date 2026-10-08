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

// Similaridade de títulos entre 0 e 1. Compara o título inteiro e o título principal
// (antes de ":"), já que bases costumam omitir ou separar o subtítulo.
export function similaridadeTitulo(a, b) {
  const sim = (x, y) => {
    const tx = new Set(tokens(x));
    const ty = new Set(tokens(y));
    if (!tx.size || !ty.size) return 0;
    let comum = 0;
    for (const t of tx) if (ty.has(t)) comum++;
    return comum / Math.max(tx.size, ty.size);
  };
  const principal = (s) => (s || '').split(/[:?]/)[0];
  return Math.max(sim(a, b), sim(principal(a), principal(b)));
}

export function contarPalavras(s) {
  const m = (s || '').match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu);
  return m ? m.length : 0;
}

// Título de seção normalizado, sem numeração progressiva ("1 INTRODUÇÃO" -> "INTRODUÇÃO").
export function tituloSecao(texto) {
  return (texto || '')
    .replace(/^\s*\d+(\.\d+)*\.?\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}
