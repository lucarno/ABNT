// Leitura de .pdf com pdf.js: linhas de texto com posição e tamanho de fonte por página.
// A formatação em PDF é estimada a partir da posição do texto, não lida do arquivo-fonte.

const PT_CM = 2.54 / 72;

// Nome real da fonte (ex.: "TimesNewRomanPSMT"), sem o prefixo de subconjunto "ABCDEF+".
async function nomesDasFontes(pagina, conteudo) {
  const nomes = new Map();
  try {
    await pagina.getOperatorList();
    for (const id of new Set(conteudo.items.map((it) => it.fontName))) {
      const f = pagina.commonObjs.has(id) ? pagina.commonObjs.get(id) : null;
      if (f && f.name) nomes.set(id, f.name.replace(/^[A-Z]{6}\+/, ''));
    }
  } catch {
    // Sem nomes de fonte: a checagem de família é omitida.
  }
  return nomes;
}

// Ligaduras ("ﬁ") e acentos compostos (LaTeX gera "ı́" para "í") viram caracteres simples.
const normalizarTexto = (s) => s.replace(/ı(?=[\u0300-\u036f])/g, 'i').normalize('NFKC');

export async function lerPdf(buffer, pdfjs, opcoes = {}) {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, ...opcoes }).promise;
  const paginas = [];
  const paragrafos = [];

  for (let n = 1; n <= pdf.numPages; n++) {
    const pagina = await pdf.getPage(n);
    const [x0, y0, x1, y1] = pagina.view;
    const largura = x1 - x0;
    const altura = y1 - y0;
    const conteudo = await pagina.getTextContent();
    const nomesFonte = await nomesDasFontes(pagina, conteudo);

    // Agrupa itens por linha de base (y), tolerando pequenas variações.
    const linhas = [];
    for (const it of conteudo.items) {
      if (!it.str || !it.str.trim()) continue;
      const [, , c, d, x, y] = it.transform;
      const tam = Math.hypot(c, d);
      let linha = linhas.find((l) => Math.abs(l.y - y) < tam * 0.4);
      if (!linha) linhas.push((linha = { y, itens: [] }));
      linha.itens.push({ x: x - x0, fim: x - x0 + it.width, tam, str: it.str, fonteNome: nomesFonte.get(it.fontName) });
    }
    linhas.sort((a, b) => b.y - a.y);

    const doPagina = linhas.map((l) => {
      l.itens.sort((a, b) => a.x - b.x);
      let texto = '';
      let fimAnterior = null;
      for (const it of l.itens) {
        if (fimAnterior !== null && it.x - fimAnterior > it.tam * 0.15 && !/\s$/.test(texto) && !/^\s/.test(it.str)) texto += ' ';
        texto += it.str;
        fimAnterior = it.fim;
      }
      const maior = l.itens.reduce((a, b) => (b.str.length > a.str.length ? b : a));
      return {
        texto: normalizarTexto(texto).replace(/\s+/g, ' ').trim(),
        pagina: n,
        x: Math.min(...l.itens.map((i) => i.x)),
        fim: Math.max(...l.itens.map((i) => i.fim)),
        topo: altura - (l.y - y0), // distância da borda superior até a linha de base
        tamanho: Math.round(maior.tam * 10) / 10,
        fonteNome: maior.fonteNome,
      };
    });

    paginas.push({ n, larguraCm: largura * PT_CM, alturaCm: altura * PT_CM, larguraPt: largura, alturaPt: altura, linhas: doPagina });
    for (const l of doPagina) paragrafos.push({ i: paragrafos.length, ...l });
  }

  return { tipo: 'pdf', paragrafos, paginas };
}
