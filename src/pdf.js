// Leitura de .pdf com pdf.js: linhas de texto com posição e tamanho de fonte por página.
// A formatação em PDF é estimada a partir da posição do texto, não lida do arquivo-fonte.

const PT_CM = 2.54 / 72;

export async function lerPdf(buffer, pdfjs) {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false }).promise;
  const paginas = [];
  const paragrafos = [];

  for (let n = 1; n <= pdf.numPages; n++) {
    const pagina = await pdf.getPage(n);
    const [x0, y0, x1, y1] = pagina.view;
    const largura = x1 - x0;
    const altura = y1 - y0;
    const conteudo = await pagina.getTextContent();

    // Agrupa itens por linha de base (y), tolerando pequenas variações.
    const linhas = [];
    for (const it of conteudo.items) {
      if (!it.str || !it.str.trim()) continue;
      const [, , c, d, x, y] = it.transform;
      const tam = Math.hypot(c, d);
      let linha = linhas.find((l) => Math.abs(l.y - y) < tam * 0.4);
      if (!linha) linhas.push((linha = { y, itens: [] }));
      linha.itens.push({ x: x - x0, fim: x - x0 + it.width, tam, str: it.str, familia: conteudo.styles[it.fontName]?.fontFamily });
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
        texto: texto.replace(/\s+/g, ' ').trim(),
        pagina: n,
        x: Math.min(...l.itens.map((i) => i.x)),
        fim: Math.max(...l.itens.map((i) => i.fim)),
        topo: altura - (l.y - y0), // distância da borda superior até a linha de base
        tamanho: Math.round(maior.tam * 10) / 10,
        familia: maior.familia,
      };
    });

    paginas.push({ n, larguraCm: largura * PT_CM, alturaCm: altura * PT_CM, larguraPt: largura, alturaPt: altura, linhas: doPagina });
    for (const l of doPagina) paragrafos.push({ i: paragrafos.length, ...l });
  }

  return { tipo: 'pdf', paragrafos, paginas };
}
