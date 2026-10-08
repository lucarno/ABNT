// Lista de referências, citações no texto e o cruzamento entre as duas
// (sistema autor-data e sistema numérico).
import { normalizar } from './texto.js';

const ANO = /\b(1[5-9]\d{2}|20\d{2})[a-z]?\b/g;
const TEM_ANO = /\b(1[5-9]\d{2}|20\d{2})[a-z]?\b/;
const ANO_MAXIMO = new Date().getFullYear() + 1;

// Anos de publicação: ignora links, DOIs, ISSN/ISBN e intervalos de páginas; a data de acesso
// só conta quando a referência não traz outra.
function anos(texto) {
  const extrair = (t) => [...new Set([...t.matchAll(ANO)].map((m) => Number(m[1])).filter((a) => a <= ANO_MAXIMO))];
  const limpo = texto
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\b10\.\d{4,9}\/\S+/g, ' ')
    .replace(/\bIS[BS]N\b[\s:]*[\dXx][\dXx\s\-–]{6,}/g, ' ')
    .replace(/\bp+\.\s*\d+\s*[-–]\s*\d+/g, ' ');
  const semAcesso = extrair(limpo.replace(/Acesso\s+em:?\s*[\d\s\/º°.\p{L}]{0,20}?\d{4}/giu, ' '));
  return semAcesso.length ? semAcesso : extrair(limpo);
}

// Fim do bloco de autoria: primeiro ". " que não seja de uma inicial ("J. P."), nem seguido
// de "et al." ou de "(org.)"/"(ed.)".
function fimAutoria(texto) {
  const re = /\.\s+/g;
  let m;
  while ((m = re.exec(texto))) {
    const antes = texto.slice(0, m.index).match(/(\S+)$/)?.[1] || '';
    const depois = texto.slice(m.index + m[0].length);
    if (/^[\p{Lu}](-[\p{Lu}])?$/u.test(antes)) {
      if (/^(\p{Lu}\.|\()/u.test(depois)) continue;
      // "PETER, J. Paul. Marketing: criando valor": depois da inicial vem mais um nome se o
      // trecho seguinte só tem palavras com maiúscula e o próximo já parece um título.
      const [seg1, seg2 = ''] = depois.split(/\.\s+/);
      const soNome = /^(\p{Lu}[\p{L}'’\-]*|de|da|do|dos|das)( (\p{Lu}[\p{L}'’\-]*|de|da|do|dos|das)){0,2}$/u.test(seg1);
      if (soNome && /\s\p{Ll}{3,}/u.test(seg2)) continue;
    }
    if (/^et\s+al\./i.test(depois)) continue; // "FRITZ, Susan. et al. Título"
    if (/^\(/.test(depois) && /^\([^)]{1,12}\)\./.test(depois)) continue;
    return m.index + 1;
  }
  return -1;
}

// Título do documento jurídico logo após a jurisdição ("BRASIL. Lei nº ...").
const JURIDICO = /^(Constitui[çc][ãa]o|Lei|Decreto|Medida Provis[óo]ria|Resolu[çc][ãa]o|Portaria|Instru[çc][ãa]o Normativa|Emenda Constitucional|S[úu]mula|Supremo|Superior|Tribunal|Ac[óo]rd[ãa]o|C[óo]digo)\b/;

export function analisarReferencia(texto, anterior) {
  const repetido = /^_{3,}/.test(texto);
  const corte = fimAutoria(texto);
  const bloco = corte > 0 ? texto.slice(0, corte - 1) : texto;
  // Entrada pelo título ("A HISTÓRIA da arte. ..."): bloco sem vírgula e com minúsculas.
  const entradaPorTitulo = !repetido && !bloco.includes(',') && /\p{Ll}{2,}/u.test(bloco.replace(/\([^)]*\)/g, ''));

  let autor;
  if (repetido) autor = anterior?.autor || '';
  else autor = texto.split(/,|\.\s/)[0].trim();

  let titulo;
  if (entradaPorTitulo) titulo = bloco;
  else if (corte > 0) titulo = texto.slice(corte).trim().split(/\.\s|\?\s/)[0];
  titulo = (titulo || '').replace(/\s+In:.*$/, '').trim();

  const doiM = texto.match(/\b(10\.\d{4,9}\/[^\s"]+)/i);
  const doi = doiM ? doiM[1].replace(/[.,;)\]>]+$/, '') : null;
  const urls = [...texto.matchAll(/https?:\/\/[^\s<>]+/g)]
    .map((m) => m[0].replace(/[.,;)\]>]+$/, ''))
    .filter((u) => !/doi\.org\//i.test(u));

  let tipo = 'outro';
  const jurisdicao = corte > 0 && /^[\p{Lu}\s.\-]+$/u.test(bloco.replace(/\([^)]*\)/g, ''));
  if (/\bNBR\s*\d|ASSOCIA[ÇC][ÃA]O BRASILEIRA DE NORMAS/i.test(texto)) tipo = 'norma';
  else if (jurisdicao && JURIDICO.test(texto.slice(corte).trim())) tipo = 'legislacao';
  else if (/\bIn:\s/.test(texto)) tipo = 'capitulo';
  else if (/\b(Tese|Disserta[çc][ãa]o|Trabalho de Conclus[ãa]o|Monografia)\b/i.test(texto)) tipo = 'academico';
  else if (/\bv\.\s*\d|\bn\.\s*\d/.test(texto)) tipo = 'artigo';
  else if (/:\s*[^,:]+,\s*\[?\d{4}/.test(texto)) tipo = 'livro';

  return {
    texto,
    // Entrada usada na ordenação alfabética; nula quando o autor foi substituído por traço.
    entrada: repetido ? null : bloco,
    autor,
    autorTokens: normalizar(autor).split(' ').filter(Boolean),
    institucional: !repetido && !texto.split('.')[0].includes(','),
    titulo,
    anos: anos(texto),
    doi,
    urls,
    tipo,
  };
}

// Marcador do sistema numérico: "[1] ", "[ 12 ] ", "1. " ou "1) ".
const MARCADOR = /^\s*(?:\[\s*(\d{1,3})\s*\]|(\d{1,3})[.)])\s+/;
const INICIO_REF = /^(_{3,}|\[\s*\d{1,3}\s*\]|\d{1,3}[.)]\s+\p{Lu}|[\p{Lu}][\p{Lu}'’\-]+(\s+[\p{Lu}'’\-]+)*\s*[,.])/u;

// Divide as linhas de um PDF em referências: linha em branco (salto vertical) entre
// referências ou, na falta dela, linha que começa com SOBRENOME (ou [n]) após linha terminada em ponto.
export function agruparLinhasPdf(linhas) {
  if (!linhas.length) return [];
  const passos = [];
  for (let k = 1; k < linhas.length; k++) {
    const a = linhas[k - 1];
    const b = linhas[k];
    if (a.pagina === b.pagina) passos.push(b.topo - a.topo);
  }
  passos.sort((x, y) => x - y);
  const base = passos.length ? passos[Math.floor(passos.length * 0.25)] : 0;

  const refs = [];
  let atual = [];
  linhas.forEach((l, k) => {
    const ant = linhas[k - 1];
    const salto = ant && ant.pagina === l.pagina && base > 0 && l.topo - ant.topo > base * 1.5;
    const pareceInicio = ant && INICIO_REF.test(l.texto) && /[.\]]\s*$/.test(ant.texto);
    if (atual.length && (salto || pareceInicio)) {
      refs.push(atual);
      atual = [];
    }
    atual.push(l);
  });
  if (atual.length) refs.push(atual);
  return refs.map((g) => g.map((l) => l.texto).join(' ').replace(/(\w)- (\w)/g, '$1$2'));
}

export function extrairReferencias(paragrafosDaSecao, tipoDoc) {
  const textos = tipoDoc === 'pdf'
    ? agruparLinhasPdf(paragrafosDaSecao)
    : paragrafosDaSecao.map((p) => p.texto).filter((t) => t.length > 0);
  const refs = [];
  for (const t of textos) {
    const m = t.match(MARCADOR);
    const numero = m ? Number(m[1] ?? m[2]) : null;
    refs.push({ n: refs.length + 1, ...analisarReferencia(m ? t.slice(m[0].length) : t, refs[refs.length - 1]), texto: t, numero });
  }
  return refs;
}

// Lista numerada: a maior parte das referências começa com [n] ou n.
export function listaNumerada(refs) {
  return refs.length >= 3 && refs.filter((r) => r.numero !== null).length >= refs.length * 0.6;
}

// ---------- Citações (autor-data) ----------

const NAO_AUTOR = new Set(['lei', 'art', 'arts', 'decreto', 'figura', 'tabela', 'grafico', 'quadro', 'anexo', 'apendice',
  'secao', 'capitulo', 'em', 'no', 'na', 'de', 'ate', 'desde', 'entre', 'ver', 'cf', 'p', 'fonte', 'nota', 'ano', 'censo']);

function autorValido(autor) {
  const a = autor.trim();
  if (!/^[\p{Lu}]/u.test(a) || a.split(/\s+/).length > 8) return false;
  return !NAO_AUTOR.has(normalizar(a).split(' ')[0]);
}

// "(SILVA, 2020, p. 3)", "(Silva; Souza, 2019)", "(SILVA, 2019, 2020; LIMA, 2021)",
// "(Simon, 1960 citado por Lima, 2010)", "(ORIGENS... 2007)". O ano vem depois de vírgula ou
// reticências; isso descarta "(Res. 4.657/2018)" e "(maio de 2020)".
function citacoesParenteticas(texto) {
  const out = [];
  for (const m of texto.matchAll(/\(([^()]{2,400})\)/g)) {
    const dentro = m[1];
    if (!TEM_ANO.test(dentro)) continue;
    let pendente = null;
    for (let parte of dentro.split(';')) {
      parte = parte.split(/\s+(?:apud|citado por)\s+/i).pop();
      const primeiroAno = parte.search(TEM_ANO);
      if (primeiroAno < 0) {
        if (!pendente && /[\p{L}]/u.test(parte)) pendente = parte.trim();
        continue;
      }
      const antes = parte.slice(0, primeiroAno);
      if (!/(,|\.\.\.|…|\[\.\.\.\])\s*$/.test(antes)) { pendente = null; continue; }
      let autor = pendente || antes.replace(/[,\s]+$/, '').trim();
      pendente = null;
      autor = autor.replace(/\s+et\s+al\.?$/i, '').replace(/(\.\.\.|…|\[\.\.\.\])$/, '').trim();
      if (!autor || !autorValido(autor)) continue;
      for (const a of anos(parte.slice(primeiroAno))) out.push({ autor, ano: a, trecho: m[0], tipo: 'parentetica' });
    }
  }
  return out;
}

// "Silva (2020)", "Silva e Souza (2019, p. 4)", "Silva et al. (2020)"
const NOME = "[\\p{Lu}][\\p{L}'’\\-]+";
const NARRATIVA = new RegExp(`((?:${NOME}[ ,]+(?:e +|and +|& +)?){0,3}${NOME})(?: +et +al\\.?)? *\\(((?:1[5-9]|20)\\d{2})[a-z]?(?:[,;][^)]*)?\\)`, 'gu');

const INICIO_FRASE = new Set(('segundo conforme para como em de na no nas nos assim tambem ja ainda porem contudo logo portanto '
  + 'ademais alem desse dessa nesse nessa neste nesta este esta esse essa os as o a um uma por pelo pela mas e enquanto').split(' '));

function citacoesNarrativas(texto) {
  const out = [];
  for (const m of texto.matchAll(NARRATIVA)) {
    // Remove título em caixa alta e palavras de início de frase ("INTRODUÇÃO Segundo Silva",
    // "Complementarmente, Silva").
    const palavras = m[1].replace(/[ ,]+$/, '').replace(/^(?:[\p{Lu}]{2,} +)+(?=\p{Lu}\p{Ll})/u, '').split(' ');
    while (palavras.length > 1 && (INICIO_FRASE.has(normalizar(palavras[0])) || /mente,$/.test(palavras[0]))) palavras.shift();
    const autor = palavras.join(' ');
    if (autorValido(autor.split(/[ ,]+/).pop())) out.push({ autor, ano: Number(m[2]), trecho: m[0], tipo: 'narrativa' });
  }
  return out;
}

export function extrairCitacoes(texto) {
  return [...citacoesParenteticas(texto), ...citacoesNarrativas(texto)];
}

const PARTICULAS = new Set(['de', 'da', 'do', 'dos', 'das', 'e', 'et', 'al', 'and', 'van', 'von', 'der', 'del', 'la', 'le', 'y']);
const junto = (s) => normalizar(s).replace(/ /g, '');

function casa(citacao, ref) {
  if (!ref.anos.includes(citacao.ano)) return false;
  const toks = normalizar(citacao.autor).split(' ').filter((t) => t.length > 1 && !PARTICULAS.has(t));
  if (toks.some((t) => ref.autorTokens.includes(t))) return true;
  // Grafias com e sem espaço: "MacKinlay" e "MAC KINLAY".
  const [c, r] = [junto(citacao.autor), junto(ref.autor)];
  return r.length >= 5 && c.length >= 5 && (c.includes(r) || r.includes(c));
}

export function cruzar(citacoes, refs) {
  const usadas = new Set();
  const semReferencia = new Map();
  for (const c of citacoes) {
    const alvo = refs.filter((r) => casa(c, r));
    if (alvo.length) alvo.forEach((r) => usadas.add(r.n));
    else {
      // "Andreff (2020)" e "Wladimir Andreff (2020)" contam uma vez.
      const chave = `${normalizar(c.autor).split(' ').pop()}|${c.ano}`;
      const atual = semReferencia.get(chave);
      if (!atual || (atual.tipo === 'narrativa' && c.tipo === 'parentetica')) semReferencia.set(chave, c);
    }
  }
  return {
    semReferencia: [...semReferencia.values()],
    naoCitadas: refs.filter((r) => !usadas.has(r.n)),
    citadas: usadas,
  };
}

// ---------- Citações (sistema numérico) ----------

// "[3]", "[1, 4]", "[2-5]", "[2–5; 8]"
export function extrairCitacoesNumericas(texto) {
  const nums = new Set();
  for (const m of texto.matchAll(/\[(\d{1,3}(?:\s*[-–,;]\s*\d{1,3})*)\]/g)) {
    for (const parte of m[1].split(/[,;]/)) {
      const [a, b] = parte.split(/[-–]/).map((x) => Number(x.trim()));
      if (b && b >= a && b - a < 100) for (let k = a; k <= b; k++) nums.add(k);
      else if (a > 0) nums.add(a);
    }
  }
  return nums;
}

export function cruzarNumerico(numeros, refs) {
  const existentes = new Set(refs.map((r) => r.numero));
  return {
    semReferencia: [...numeros].filter((k) => !existentes.has(k)).sort((a, b) => a - b).map((k) => ({ autor: `[${k}]`, ano: '', trecho: `[${k}]`, tipo: 'parentetica' })),
    naoCitadas: refs.filter((r) => !numeros.has(r.numero)),
    citadas: new Set(refs.filter((r) => numeros.has(r.numero)).map((r) => r.n)),
  };
}
