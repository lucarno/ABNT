// Verificação de existência das referências em bases abertas (Crossref e DataCite).
// Não depende de IA: compara título, autoria e ano da referência com os registros encontrados.
import { similaridadeTitulo, tokens, normalizar } from './texto.js';

const CROSSREF = 'https://api.crossref.org';
const DATACITE = 'https://api.datacite.org';

export const STATUS = {
  verificada: 'Verificada',
  divergente: 'Encontrada com divergências',
  doi_incorreto: 'DOI incorreto',
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
  // Ano: a data mais antiga entre as registradas (publicação online costuma vir antes da impressa).
  const anos = ['issued', 'published', 'published-online', 'published-print']
    .map((k) => it[k]?.['date-parts']?.[0]?.[0]).filter((a) => Number.isInteger(a));
  // DOIs de artigos no prelo trazem o ano da publicação online ("10.1016/j.x.2024.102").
  const anoDoi = Number((it.DOI || '').match(/[./]((?:19|20)\d{2})\./)?.[1]);
  return {
    titulo: limpar([...(it.title || []), ...(it.subtitle || [])].join(': ')),
    sobrenomes: (it.author || []).map((a) => a.family || a.name || ''),
    ano: anos.length ? Math.min(...anos) : null,
    anos: [...anos, ...(anoDoi ? [anoDoi] : [])],
    livro: /book|monograph/.test(it.type || ''),
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
    livro: /book/i.test(a.types?.resourceTypeGeneral || ''),
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

// Sobrenomes da referência, na ordem: "SILVA, João; SOUZA, M." -> ["silva", "souza"].
function autoresDaRef(ref) {
  if (ref.institucional) return [];
  if (!ref.entrada) return ref.autorTokens.length ? [ref.autorTokens.join(' ')] : [];
  return ref.entrada.split(';').map((a) => normalizar(a.split(',')[0])).filter((a) => a && !/^et al/.test(a));
}

const PARTICULAS = new Set(['de', 'da', 'do', 'dos', 'das', 'e', 'van', 'von', 'der', 'del', 'la', 'le', 'y', 'junior', 'jr', 'filho', 'neto']);

function mesmoSobrenome(a, b) {
  if (a.replace(/ /g, '') === b.replace(/ /g, '')) return true;
  const ta = a.split(' ').filter((t) => t.length > 1 && !PARTICULAS.has(t));
  const tb = new Set(b.split(' ').filter((t) => t.length > 1 && !PARTICULAS.has(t)));
  return ta.some((t) => tb.has(t));
}

export function comparar(ref, cand) {
  const tituloRef = ref.titulo || ref.texto;
  const simTitulo = similaridadeTitulo(tituloRef, cand.titulo);
  // Título do registro contido no texto da referência: recupera subtítulos que a heurística
  // cortou, mas só vale junto com autoria confirmada (o texto também traz revista e instituição).
  const noTexto = tokens(cand.titulo).length >= 4 ? contido(cand.titulo, ref.texto) : 0;
  const sim = Math.max(simTitulo, noTexto);

  const autores = autoresDaRef(ref);
  const doRegistro = cand.sobrenomes.map(normalizar).filter(Boolean);
  const achados = autores.map((a) => doRegistro.some((c) => mesmoSobrenome(a, c)));
  const autorOk = !autores.length || !doRegistro.length ? null : achados.some(Boolean);
  // Coautores: com dois ou mais autores dos dois lados, ao menos um coautor deve aparecer.
  const coautoresOk = autorOk && autores.length >= 2 && doRegistro.length >= 2 ? achados.slice(1).some(Boolean) || !achados[0] : null;
  const anosCand = cand.anos?.length ? cand.anos : cand.ano ? [cand.ano] : [];
  const anoOk = anosCand.length && ref.anos.length ? ref.anos.some((a) => anosCand.some((b) => Math.abs(a - b) <= 1)) : null;
  const livro = cand.livro || ['livro', 'capitulo'].includes(ref.tipo);
  // Resenha publicada da obra: o título do registro contém o título e o autor da referência.
  const resenha = ref.titulo && contido(ref.titulo, cand.titulo) >= 0.9 && autores.some((a) => tokens(cand.titulo).some((t) => mesmoSobrenome(a, t)));

  let status = null;
  const notas = [];
  const registro = cand.sobrenomes.slice(0, 4).join(', ') || '—';
  if (sim >= 0.85 && autorOk === true && coautoresOk !== false && (anoOk !== false || livro)) {
    status = 'verificada';
    if (anoOk === false) notas.push(`Localizada na ${cand.base} em outra edição ou ano (${cand.ano}).`);
  } else if (simTitulo >= 0.95 && autorOk === null && anoOk !== false) {
    status = 'verificada';
  } else if (resenha && autorOk !== true) {
    status = 'verificada';
    notas.push(`Existência confirmada por resenha publicada da obra (${cand.base}).`);
  } else if (simTitulo >= 0.92 && autorOk === false) {
    status = 'divergente';
    notas.push(`existe obra com este título, mas de outra autoria (registro: ${registro})`);
  } else if (sim >= 0.85 && autorOk === true && coautoresOk === false) {
    status = 'divergente';
    notas.push(`os coautores não conferem (registro: ${registro})`);
  } else if (sim >= 0.85 && autorOk === true && anoOk === false) {
    status = 'divergente';
    notas.push(`o ano diverge (registro: ${cand.ano})`);
  }
  return { status, sim, cand, notas, autorOk };
}

const ORDEM = { verificada: 2, divergente: 1 };
const melhor = (cs) => cs.filter((c) => c.status).sort((a, b) => ORDEM[b.status] - ORDEM[a.status] || b.sim - a.sim)[0];

const resultado = (status, extra = {}) => ({ status, rotulo: STATUS[status], encontrado: null, nota: '', ...extra });

function descrever(c) {
  if (c.status === 'verificada') return c.notas[0] || `Localizada na ${c.cand.base}.`;
  return `Registro parecido na ${c.cand.base}, mas ${c.notas.join('; ')}.`;
}

async function buscaBibliografica(ref, fetchFn) {
  const consulta = ref.texto.replace(/Dispon[íi]vel\s+em:?.*$/i, '').replace(/https?:\/\/\S+/g, '').replace(/\bDOI:?\s*\S+/gi, '').slice(0, 300);
  const url = `${CROSSREF}/works?rows=5&select=DOI,title,subtitle,author,issued,published,published-online,published-print,type&query.bibliographic=${encodeURIComponent(consulta)}`;
  const dados = await obterJson(fetchFn, url);
  return melhor((dados?.message?.items || []).map((it) => comparar(ref, deCrossref(it))));
}

export async function verificarReferencia(ref, { fetch: fetchFn = globalThis.fetch.bind(globalThis) } = {}) {
  try {
    if (ref.doi) {
      const doi = encodeURIComponent(ref.doi);
      const cr = await obterJson(fetchFn, `${CROSSREF}/works/${doi}`);
      const dc = cr ? null : await obterJson(fetchFn, `${DATACITE}/dois/${doi}`);
      const cand = cr ? deCrossref(cr.message) : dc ? deDatacite(dc) : null;
      const c = cand ? comparar(ref, cand) : null;
      if (c?.status) return resultado(c.status, { encontrado: cand, nota: descrever(c) });
      // DOI do mesmo autor com título um pouco diferente: o DOI identifica a obra.
      if (c && c.autorOk && c.sim >= 0.6) return resultado('verificada', { encontrado: cand, nota: `Localizada na ${cand.base} pelo DOI; o título no registro é “${cand.titulo}”.` });
      // DOI inexistente ou de outra obra: pode ser só erro de digitação; procura a obra.
      const obra = await buscaBibliografica(ref, fetchFn);
      if (obra?.status === 'verificada' && obra.cand.doi && obra.cand.doi.toLowerCase() !== ref.doi.toLowerCase()) {
        return resultado('doi_incorreto', { encontrado: obra.cand, nota: `A obra existe, mas o DOI informado (${ref.doi}) ${cand ? 'é de outra obra' : 'não existe'}. O DOI correto parece ser ${obra.cand.doi}.` });
      }
      if (!cand) {
        return resultado('doi_inexistente', { nota: `O DOI ${ref.doi} não existe na Crossref nem na DataCite, e a obra não foi localizada pelo título. É um forte indício de referência incorreta ou inventada.` });
      }
      return resultado('doi_divergente', { encontrado: cand, nota: `O DOI existe, mas pertence a outra obra: “${cand.titulo}”${cand.sobrenomes.length ? ` (${cand.sobrenomes.slice(0, 3).join(', ')})` : ''}.` });
    }

    if (ref.tipo === 'legislacao' || ref.tipo === 'norma') {
      return resultado('nao_aplicavel', { nota: 'Legislação ou norma técnica: confira na fonte oficial.' });
    }

    const c = await buscaBibliografica(ref, fetchFn);
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
