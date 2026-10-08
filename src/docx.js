// Leitura de .docx: texto e formatação efetiva (com herança de estilos) de cada parágrafo,
// configuração de página de cada seção, numeração de páginas e notas de rodapé.

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const TWIP_CM = 567;

const filhos = (el, nome) =>
  el ? Array.from(el.childNodes).filter((n) => n.namespaceURI === W && n.localName === nome) : [];
const filho = (el, nome) => filhos(el, nome)[0] || null;
const attr = (el, nome) => (el && el.hasAttributeNS(W, nome) ? el.getAttributeNS(W, nome) : undefined);
const num = (v) => (v === undefined || v === '' ? undefined : Number(v));

function temAncestral(el, nomes) {
  for (let p = el.parentNode; p; p = p.parentNode) if (nomes.includes(p.localName)) return true;
  return false;
}

function lerPPr(pPr) {
  const sp = filho(pPr, 'spacing');
  const ind = filho(pPr, 'ind');
  return {
    line: num(attr(sp, 'line')),
    lineRule: attr(sp, 'lineRule'),
    before: num(attr(sp, 'before')),
    after: num(attr(sp, 'after')),
    left: num(attr(ind, 'left') ?? attr(ind, 'start')),
    jc: attr(filho(pPr, 'jc'), 'val'),
  };
}

function lerRPr(rPr) {
  const f = filho(rPr, 'rFonts');
  return {
    tema: attr(f, 'asciiTheme'),
    fonte: attr(f, 'ascii') ?? attr(f, 'hAnsi'),
    sz: num(attr(filho(rPr, 'sz'), 'val')),
  };
}

// O primeiro valor definido vence (ordem: direto -> estilos -> padrões do documento).
function mesclar(...objs) {
  const out = {};
  for (const o of objs) for (const [k, v] of Object.entries(o || {})) if (out[k] === undefined && v !== undefined) out[k] = v;
  return out;
}

function lerEstilos(xml) {
  const estilos = new Map();
  let padraoP = null;
  let defP = {};
  let defR = {};
  if (!xml) return { estilos, padraoP, defP, defR };
  const dd = xml.getElementsByTagNameNS(W, 'docDefaults')[0];
  if (dd) {
    defP = lerPPr(filho(filho(dd, 'pPrDefault'), 'pPr'));
    defR = lerRPr(filho(filho(dd, 'rPrDefault'), 'rPr'));
  }
  for (const s of Array.from(xml.getElementsByTagNameNS(W, 'style'))) {
    const id = attr(s, 'styleId');
    const tipo = attr(s, 'type');
    estilos.set(id, {
      nome: attr(filho(s, 'name'), 'val') || id,
      base: attr(filho(s, 'basedOn'), 'val'),
      p: lerPPr(filho(s, 'pPr')),
      r: lerRPr(filho(s, 'rPr')),
    });
    if (tipo === 'paragraph' && ['1', 'true'].includes(attr(s, 'default'))) padraoP = id;
  }
  return { estilos, padraoP, defP, defR };
}

function cadeia(estilos, id) {
  const out = [];
  for (let i = 0; id && estilos.has(id) && i < 15; i++) {
    const e = estilos.get(id);
    out.push(e);
    id = e.base;
  }
  return out;
}

function lerTema(xml) {
  if (!xml) return {};
  const fonte = (nome) => {
    const el = xml.getElementsByTagNameNS(A, nome)[0];
    const latin = el && Array.from(el.childNodes).find((n) => n.localName === 'latin');
    return latin ? latin.getAttribute('typeface') : undefined;
  };
  return { minor: fonte('minorFont'), major: fonte('majorFont') };
}

function resolverFonte(r, tema) {
  if (r.tema) return r.tema.startsWith('major') ? tema.major : tema.minor;
  return r.fonte;
}

function entrelinha(p, tamanho) {
  if (p.line === undefined) return 1.0;
  if (!p.lineRule || p.lineRule === 'auto') return p.line / 240;
  // Espaçamento "exato"/"pelo menos" em pontos: converte para múltiplo aproximado.
  return p.line / 20 / (1.15 * (tamanho || 12));
}

const ALINHAMENTO = { both: 'justificado', distribute: 'justificado', center: 'centralizado', right: 'direita', end: 'direita', left: 'esquerda', start: 'esquerda' };

function textoRun(r) {
  let s = '';
  for (const n of Array.from(r.childNodes)) {
    if (n.namespaceURI !== W) continue;
    if (n.localName === 't') s += n.textContent;
    else if (n.localName === 'tab') s += '\t';
    else if (n.localName === 'br' || n.localName === 'cr') s += ' ';
  }
  return s;
}

// Runs diretos do parágrafo, incluindo os dentro de hyperlink/inserção/campo simples.
function runsDoParagrafo(p) {
  const out = [];
  const visitar = (el) => {
    for (const n of Array.from(el.childNodes)) {
      if (n.namespaceURI !== W) continue;
      if (n.localName === 'r') out.push(n);
      else if (['hyperlink', 'ins', 'smartTag', 'fldSimple', 'sdt', 'sdtContent', 'customXml'].includes(n.localName)) visitar(n);
    }
  };
  visitar(p);
  return out;
}

function lerParagrafo(p, ctx) {
  const pPr = filho(p, 'pPr');
  const direto = lerPPr(pPr);
  const idEstilo = attr(filho(pPr, 'pStyle'), 'val') || ctx.padraoP;
  const cad = cadeia(ctx.estilos, idEstilo);
  const pp = mesclar(direto, ...cad.map((e) => e.p), ctx.defP);
  const rParagrafo = mesclar(...cad.map((e) => e.r), ctx.defR);

  let texto = '';
  const pesoFonte = new Map();
  const pesoTam = new Map();
  for (const r of runsDoParagrafo(p)) {
    const t = textoRun(r);
    texto += t;
    const rPr = filho(r, 'rPr');
    const cadR = cadeia(ctx.estilos, attr(filho(rPr, 'rStyle'), 'val'));
    const rp = mesclar(lerRPr(rPr), ...cadR.map((e) => e.r), rParagrafo);
    const peso = t.replace(/\s/g, '').length;
    if (!peso) continue;
    const fonte = resolverFonte(rp, ctx.tema) || '(padrão)';
    const tam = (rp.sz ?? 20) / 2;
    pesoFonte.set(fonte, (pesoFonte.get(fonte) || 0) + peso);
    pesoTam.set(tam, (pesoTam.get(tam) || 0) + peso);
  }
  const dominante = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const tamanho = dominante(pesoTam) ?? (rParagrafo.sz ?? 20) / 2;
  const nomeEstilo = cad[0]?.nome || '';

  return {
    texto: texto.replace(/[  ]+/g, ' ').trim(),
    estilo: nomeEstilo,
    ehTituloEstilo: /^(heading|t[ií]tulo)\s*\d/i.test(nomeEstilo),
    fonte: dominante(pesoFonte) ?? resolverFonte(rParagrafo, ctx.tema),
    fontes: [...pesoFonte.keys()],
    tamanho,
    entrelinha: entrelinha(pp, tamanho),
    recuoEsqCm: (pp.left || 0) / TWIP_CM,
    alinhamento: ALINHAMENTO[pp.jc] || 'esquerda',
    espacoAntesPt: (pp.before || 0) / 20,
    espacoDepoisPt: (pp.after || 0) / 20,
    emTabela: temAncestral(p, ['tbl']),
  };
}

function lerSecao(sectPr) {
  const sz = filho(sectPr, 'pgSz');
  const mar = filho(sectPr, 'pgMar');
  const w = num(attr(sz, 'w'));
  const h = num(attr(sz, 'h'));
  const cm = (v) => (v === undefined ? undefined : Math.abs(v) / TWIP_CM);
  return {
    larguraCm: cm(w),
    alturaCm: cm(h),
    paisagem: w > h,
    margens: {
      sup: cm(num(attr(mar, 'top'))),
      inf: cm(num(attr(mar, 'bottom'))),
      esq: cm((num(attr(mar, 'left')) || 0) + (num(attr(mar, 'gutter')) || 0)),
      dir: cm(num(attr(mar, 'right'))),
    },
  };
}

function campoPagina(xml) {
  for (const p of Array.from(xml.getElementsByTagNameNS(W, 'p'))) {
    const simples = Array.from(p.getElementsByTagNameNS(W, 'fldSimple')).some((f) => /\bPAGE\b/.test(attr(f, 'instr') || ''));
    const instr = Array.from(p.getElementsByTagNameNS(W, 'instrText')).some((t) => /\bPAGE\b/.test(t.textContent));
    if (simples || instr) return p;
  }
  return null;
}

function lerNumeracao(cabecalhos, rodapes, ctx) {
  for (const [local, xmls] of [['cabecalho', cabecalhos], ['rodape', rodapes]]) {
    for (const xml of xmls) {
      const p = campoPagina(xml);
      if (!p) continue;
      const info = lerParagrafo(p, ctx);
      const temTab = p.getElementsByTagNameNS(W, 'tab').length > 0;
      const alinhamento = info.alinhamento === 'direita' ? 'direita' : temTab ? 'tabulacao' : info.alinhamento;
      return { local, alinhamento };
    }
  }
  return { local: null, alinhamento: null };
}

export async function lerDocx(buffer, { JSZip = globalThis.JSZip, DOMParser = globalThis.DOMParser } = {}) {
  const zip = await JSZip.loadAsync(buffer);
  const parser = new DOMParser();
  const xml = async (caminho) => {
    const f = zip.file(caminho);
    return f ? parser.parseFromString(await f.async('string'), 'application/xml') : null;
  };
  const doc = await xml('word/document.xml');
  if (!doc) throw new Error('Arquivo .docx inválido: word/document.xml não encontrado.');

  const ctx = { ...lerEstilos(await xml('word/styles.xml')), tema: lerTema(await xml('word/theme/theme1.xml')) };
  const corpo = doc.getElementsByTagNameNS(W, 'body')[0];

  const paragrafos = Array.from(corpo.getElementsByTagNameNS(W, 'p'))
    .filter((p) => !temAncestral(p, ['Fallback']))
    .map((p, i) => ({ i, ...lerParagrafo(p, ctx) }));

  const secoes = Array.from(doc.getElementsByTagNameNS(W, 'sectPr')).map(lerSecao);

  const arquivos = (re) => Object.keys(zip.files).filter((n) => re.test(n)).sort();
  const cabecalhos = await Promise.all(arquivos(/^word\/header\d*\.xml$/).map(xml));
  const rodapes = await Promise.all(arquivos(/^word\/footer\d*\.xml$/).map(xml));
  const numeracao = lerNumeracao(cabecalhos, rodapes, ctx);

  const notasXml = await xml('word/footnotes.xml');
  const notas = notasXml
    ? Array.from(notasXml.getElementsByTagNameNS(W, 'footnote'))
        .filter((f) => !['separator', 'continuationSeparator', 'continuationNotice'].includes(attr(f, 'type')))
        .flatMap((f) => filhos(f, 'p').map((p) => lerParagrafo(p, ctx)))
        .filter((p) => p.texto)
    : [];

  return { tipo: 'docx', paragrafos, secoes, numeracao, notas };
}
