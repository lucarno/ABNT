// Verificação de existência das referências em bases abertas (Crossref e DataCite).
// Não depende de IA: compara título, autoria e ano da referência com os registros encontrados.
import { similaridadeTitulo, tokens, normalizar } from './texto.js';

const CROSSREF = 'https://api.crossref.org';
const DATACITE = 'https://api.datacite.org';

export const STATUS = {
  verificada: 'Verificada',
  divergente: 'Encontrada com divergências',
  doi_inexistente: 'DOI inexistente',
  doi_divergente: 'DOI de outra obra',
  nao_localizada: 'Não localizada',
  nao_aplicavel: 'Legislação/norma',
  erro: 'Falha na consulta',
};

const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function obterJson(fetchFn, url, tentativas = 4) {
  for (let k = 0; ; k++) {
    const r = await fetchFn(url, { headers: { Accept: 'application/json' } });
    if (r.status === 404) return null;
    if (r.ok) return r.json();
    if ((r.status === 429 || r.status >= 500) && k < tentativas - 1) {
      const pedido = r.headers.get('retry-after');
      await esperar((pedido !== null && !Number.isNaN(Number(pedido)) ? Number(pedido) : 2 ** k) * 1000);
      continue;
    }
    throw new Error(`HTTP ${r.status} em ${new URL(url).host}`);
  }
}

const limpar = (s) => (s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

function deCrossref(it) {
  const ano = (it.issued || it.published || it['published-print'] || {})['date-parts']?.[0]?.[0] ?? null;
  return {
    titulo: limpar([...(it.title || []), ...(it.subtitle || [])].join(': ')),
    sobrenomes: (it.author || []).map((a) => a.family || a.name || ''),
    ano,
    doi: it.DOI,
    url: `https://doi.org/${it.DOI}`,
    base: 'Crossref',
  };
}

function deDatacite(d) {
  const a = d.data.attributes;
  return {
    titulo: limpar(a.titles?.[0]?.title),
    sobrenomes: (a.creators || []).map((c) => c.familyName || c.name || ''),
    ano: a.publicationYear ?? null,
    doi: a.doi,
    url: `https://doi.org/${a.doi}`,
    base: 'DataCite',
  };
}

// Fração dos termos de `a` presentes em `b`.
function contido(a, b) {
  const ta = tokens(a);
  const tb = new Set(tokens(b));
  return ta.length ? ta.filter((t) => tb.has(t)).length / ta.length : 0;
}

export function comparar(ref, cand) {
  const tituloRef = ref.titulo || ref.texto;
  const sim = similaridadeTitulo(tituloRef, cand.titulo);
  const sobrenomes = new Set(cand.sobrenomes.flatMap((s) => normalizar(s).split(' ')));
  const autorOk = ref.institucional || !ref.autorTokens.length ? null : ref.autorTokens.some((t) => sobrenomes.has(t));
  const anoOk = cand.ano && ref.anos.length ? ref.anos.some((a) => Math.abs(a - cand.ano) <= 1) : null;
  // Resenha publicada da obra: o título do registro contém o título e o autor da referência.
  const resenha = sim < 0.75 && ref.titulo && contido(ref.titulo, cand.titulo) >= 0.9
    && ref.autorTokens.some((t) => tokens(cand.titulo).includes(t));

  let status = null;
  const notas = [];
  if (sim >= 0.75 && autorOk !== false && anoOk !== false) status = 'verificada';
  else if (resenha) {
    status = 'verificada';
    notas.push(`Existência confirmada por resenha publicada da obra (${cand.base}).`);
  } else if (sim >= 0.75) {
    status = 'divergente';
    if (autorOk === false) notas.push(`autoria não confere (registro: ${cand.sobrenomes.slice(0, 3).join(', ') || '—'})`);
    if (anoOk === false) notas.push(`ano diverge (registro: ${cand.ano})`);
  }
  return { status, sim, cand, notas };
}

const ORDEM = { verificada: 2, divergente: 1 };
const melhor = (cs) => cs.filter((c) => c.status).sort((a, b) => ORDEM[b.status] - ORDEM[a.status] || b.sim - a.sim)[0];

const resultado = (status, extra = {}) => ({ status, rotulo: STATUS[status], encontrado: null, nota: '', ...extra });

function descrever(c) {
  if (c.status === 'verificada') return c.notas[0] || `Localizada na ${c.cand.base}.`;
  return `Registro parecido na ${c.cand.base}, mas ${c.notas.join('; ')}.`;
}

export async function verificarReferencia(ref, { fetch: fetchFn = globalThis.fetch.bind(globalThis) } = {}) {
  try {
    if (ref.doi) {
      const doi = encodeURIComponent(ref.doi);
      const cr = await obterJson(fetchFn, `${CROSSREF}/works/${doi}`);
      const dc = cr ? null : await obterJson(fetchFn, `${DATACITE}/dois/${doi}`);
      const cand = cr ? deCrossref(cr.message) : dc ? deDatacite(dc) : null;
      if (!cand) {
        return resultado('doi_inexistente', { nota: `O DOI ${ref.doi} não existe na Crossref nem na DataCite. É um forte indício de referência incorreta ou inventada.` });
      }
      const c = comparar(ref, cand);
      if (c.status) return resultado(c.status, { encontrado: cand, nota: descrever(c) });
      return resultado('doi_divergente', { encontrado: cand, nota: `O DOI existe, mas pertence a outra obra: “${cand.titulo}”${cand.sobrenomes.length ? ` (${cand.sobrenomes.slice(0, 3).join(', ')})` : ''}.` });
    }

    if (ref.tipo === 'legislacao' || ref.tipo === 'norma') {
      return resultado('nao_aplicavel', { nota: 'Legislação ou norma técnica: confira na fonte oficial.' });
    }

    const consulta = ref.texto.replace(/Dispon[íi]vel em:?.*$/i, '').replace(/https?:\/\/\S+/g, '').slice(0, 300);
    const url = `${CROSSREF}/works?rows=5&select=DOI,title,subtitle,author,issued,published,type&query.bibliographic=${encodeURIComponent(consulta)}`;
    const dados = await obterJson(fetchFn, url);
    const cands = (dados?.message?.items || []).map((it) => comparar(ref, deCrossref(it)));
    const c = melhor(cands);
    if (c) return resultado(c.status, { encontrado: c.cand, nota: descrever(c) });
    return resultado('nao_localizada', { nota: 'Não localizada na Crossref (comum em livros, documentos nacionais e páginas da internet).' });
  } catch (e) {
    return resultado('erro', { nota: `Não foi possível consultar as bases: ${e.message}` });
  }
}

// Consultas em sequência: a Crossref limita requisições simultâneas de clientes anônimos.
export async function verificarTodas(refs, { fetch: fetchFn, aoProgredir } = {}) {
  const out = new Map();
  for (const [k, ref] of refs.entries()) {
    out.set(ref.n, await verificarReferencia(ref, { fetch: fetchFn }));
    aoProgredir?.(k + 1, refs.length);
  }
  return out;
}
