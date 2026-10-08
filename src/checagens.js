// Checagens determinísticas de estrutura, página, texto, resumo, citações e forma das referências.
import { REGRAS } from './regras.js';
import { tituloSecao, contarPalavras, normalizar } from './texto.js';
import { extrairReferencias, extrairCitacoes, cruzar, listaNumerada, extrairCitacoesNumericas, cruzarNumerico } from './referencias.js';

const PT_CM = 2.54 / 72;
const achado = (grupo, item, status, detalhe = '') => ({ grupo, item, status, detalhe });
const fmt = (x, casas = 1) => (x === undefined || x === null || Number.isNaN(x) ? '?' : x.toFixed(casas).replace('.', ','));
const trecho = (t, n = 70) => `“${t.length > n ? t.slice(0, n).trim() + '…' : t}”`;
const mediana = (xs) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const semAcento = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const ehNumeroIsolado = (t) => /^\d{1,4}$/.test(t);

// ---------- Estrutura ----------

export function localizarSecoes(paragrafos, regras = REGRAS) {
  const chave = (p) => semAcento(tituloSecao(p.texto));
  const ocorrencias = (titulos) => {
    const alvo = titulos.map(semAcento);
    return paragrafos.filter((p) => alvo.includes(chave(p))).map((p) => p.i);
  };
  const brutas = Object.fromEntries(regras.elementos.map((el) => [el.id, ocorrencias(el.titulos)]));
  const sumario = brutas.sumario?.[0] ?? -1;
  // Em PDF, uma linha do sumário pode ser idêntica ao título; prefere ocorrências em páginas
  // posteriores à do sumário.
  const paginaSumario = sumario >= 0 ? paragrafos[sumario].pagina : undefined;
  const secoes = {};
  for (const el of regras.elementos) {
    const lista = brutas[el.id];
    let escolhido = lista[0];
    if (['introducao', 'conclusao', 'referencias'].includes(el.id)) {
      const apos = lista.filter((i) => i > sumario);
      const emOutraPagina = paginaSumario === undefined ? undefined : apos.find((i) => paragrafos[i].pagina > paginaSumario);
      escolhido = emOutraPagina ?? apos[0];
    }
    secoes[el.id] = escolhido ?? null;
  }
  const ini = secoes.referencias;
  if (ini !== null) {
    const fim = paragrafos.find((p) => p.i > ini && regras.titulosPosReferencias.some((t) => semAcento(tituloSecao(p.texto)).startsWith(semAcento(t))));
    secoes.fimReferencias = fim ? fim.i : paragrafos.length;
  }
  return secoes;
}

function checarEstrutura(doc, secoes, regras) {
  const out = [];
  const ps = doc.paragrafos;
  for (const el of regras.elementos) {
    if (secoes[el.id] !== null) out.push(achado('Estrutura', el.nome, 'ok', 'Encontrado.'));
    else if (el.obrigatorio) out.push(achado('Estrutura', el.nome, 'erro', `Título “${el.titulos[0]}” não encontrado. Elemento obrigatório.`));
    else out.push(achado('Estrutura', el.nome, 'alerta', 'Não encontrada. É obrigatória quando o trabalho é avaliado por banca.'));
  }
  if (secoes.referencias !== null && semAcento(tituloSecao(ps[secoes.referencias].texto)) !== 'REFERENCIAS') {
    out.push(achado('Estrutura', 'Título das referências', 'alerta', `O título é ${trecho(ps[secoes.referencias].texto, 40)}; o manual usa apenas “Referências”.`));
  }

  const presentes = regras.elementos.filter((el) => secoes[el.id] !== null);
  for (let k = 1; k < presentes.length; k++) {
    const a = presentes[k - 1];
    const b = presentes[k];
    if (secoes[a.id] > secoes[b.id]) out.push(achado('Estrutura', 'Ordem dos elementos', 'erro', `“${b.nome}” aparece antes de “${a.nome}”.`));
  }

  const limite = secoes.resumo ?? secoes.sumario ?? Math.min(ps.length, 60);
  const pre = ps.slice(0, limite).map((p) => p.texto).join('\n');
  const itens = [
    ['natureza do trabalho (“apresentado ... como requisito parcial ...”)', /apresentad[oa]|requisito parcial/i],
    ['orientador', /orientador/i],
    ['local', /s[ãa]o paulo/i],
    ['ano', /\b20\d{2}\b/],
  ];
  const faltam = itens.filter(([, re]) => !re.test(pre)).map(([n]) => n);
  if (faltam.length) out.push(achado('Estrutura', 'Capa e folha de rosto', 'alerta', `Não encontrado antes do resumo: ${faltam.join('; ')}.`));
  else out.push(achado('Estrutura', 'Capa e folha de rosto', 'ok', 'Natureza do trabalho, orientador, local e ano presentes.'));
  // O nome da instituição costuma estar no logotipo (imagem), que não é lido.
  if (!/insper/i.test(pre)) out.push(achado('Estrutura', 'Nome da instituição na capa', 'info', 'Não encontramos “Insper” em texto antes do resumo. Se o nome estiver só no logotipo, desconsidere.'));
  return out;
}

// ---------- Página ----------

function dentro(valor, alvo, tol) {
  return valor !== undefined && Math.abs(valor - alvo) <= tol;
}

function checarPaginaDocx(doc, secoesDoc, regras) {
  const out = [];
  const { papel, margens } = regras;
  if (!doc.secoes.length) return [achado('Página', 'Configuração de página', 'alerta', 'Configuração de página não encontrada no arquivo.')];
  // A capa costuma ter seção própria com margens de design; avalia a partir do Resumo.
  const inicio = secoesDoc.resumo ?? secoesDoc.introducao ?? 0;
  const usadas = new Set(doc.paragrafos.filter((p) => p.i >= inicio).map((p) => p.secao));
  const secoes = doc.secoes.filter((_, k) => usadas.has(k));

  const naoA4 = secoes.filter((s) => {
    const [l, a] = s.paisagem ? [s.alturaCm, s.larguraCm] : [s.larguraCm, s.alturaCm];
    return !dentro(l, papel.larguraCm, papel.toleranciaCm) || !dentro(a, papel.alturaCm, papel.toleranciaCm);
  });
  out.push(naoA4.length
    ? achado('Página', 'Papel A4', 'erro', `Tamanho encontrado: ${fmt(naoA4[0].larguraCm)} × ${fmt(naoA4[0].alturaCm)} cm.`)
    : achado('Página', 'Papel A4', 'ok', '21 × 29,7 cm.'));

  const retrato = secoes.filter((s) => !s.paisagem);
  const erradas = [];
  for (const [lado, nome] of [['sup', 'superior'], ['esq', 'esquerda'], ['inf', 'inferior'], ['dir', 'direita']]) {
    const fora = retrato.find((s) => !dentro(s.margens[lado], margens[lado], margens.toleranciaCm));
    if (fora) erradas.push(`${nome} ${fmt(fora.margens[lado])} cm (esperado ${fmt(margens[lado])})`);
  }
  out.push(erradas.length
    ? achado('Página', 'Margens', 'erro', erradas.join('; ') + '.')
    : achado('Página', 'Margens', 'ok', 'Superior e esquerda 3 cm; inferior e direita 2 cm.'));

  const n = doc.numeracao;
  if (!n.local) out.push(achado('Página', 'Numeração de páginas', 'erro', 'Nenhum campo de número de página encontrado no cabeçalho.'));
  else if (n.local === 'rodape') out.push(achado('Página', 'Numeração de páginas', 'erro', 'A numeração está no rodapé; deve ficar no canto superior direito.'));
  else if (n.alinhamento === 'tabulacao') out.push(achado('Página', 'Numeração de páginas', 'alerta', 'Número no cabeçalho posicionado por tabulação; confira se está no canto direito.'));
  else if (n.alinhamento !== 'direita') out.push(achado('Página', 'Numeração de páginas', 'erro', `Número no cabeçalho alinhado à ${n.alinhamento}; deve ficar à direita.`));
  else out.push(achado('Página', 'Numeração de páginas', 'ok', 'No cabeçalho, à direita.'));
  if (n.local && n.tamanho !== regras.tamanhoMenor) out.push(achado('Página', 'Tamanho do número de página', 'alerta', `Tamanho ${fmt(n.tamanho, 0)}; o manual pede ${regras.tamanhoMenor}.`));
  out.push(achado('Página', 'Páginas pré-textuais sem número', 'info', 'Confira no Word: a numeração deve aparecer só a partir da Introdução, contando as folhas desde a folha de rosto.'));
  return out;
}

// Posição do número de página: "sd" (superior direito), "se", "sc", "rodape" ou null.
// Números maiores que o total de folhas (como o ano na capa) não contam.
function posicaoNumero(pag, totalPaginas) {
  for (const l of pag.linhas) {
    if (!ehNumeroIsolado(l.texto) || Number(l.texto) > totalPaginas + 20) continue;
    if (l.topo * PT_CM < 3.5) return { pos: l.x > pag.larguraPt * 0.6 ? 'sd' : l.x < pag.larguraPt * 0.4 ? 'se' : 'sc', linha: l };
    // No rodapé; à esquerda ficam as chamadas das notas, não o número da página.
    if ((pag.alturaPt - l.topo) * PT_CM < 3.5 && l.x > pag.larguraPt * 0.35) return { pos: 'rodape', linha: l };
  }
  return { pos: null, linha: null };
}

function ehNumeroNaMargem(l, pag) {
  return ehNumeroIsolado(l.texto) && (l.topo * PT_CM < 3.5 || (pag.alturaPt - l.topo) * PT_CM < 3.5);
}

function paginasDoTexto(doc, secoes) {
  const ps = doc.paragrafos;
  const ini = secoes.introducao !== null ? ps[secoes.introducao].pagina : 1;
  const fim = secoes.referencias !== null ? ps[secoes.referencias].pagina - 1 : doc.paginas.length;
  return doc.paginas.filter((p) => p.n >= ini && p.n <= Math.max(ini, fim));
}

// Texto justificado: as linhas longas terminam, em sua maioria, na mesma coordenada à direita.
function pareceJustificado(paginas) {
  let longas = 0;
  let noLimite = 0;
  for (const p of paginas) {
    const ls = p.linhas.filter((l) => l.texto.length > 50 && !ehNumeroNaMargem(l, p));
    if (ls.length < 5) continue;
    const limite = Math.max(...ls.map((l) => l.fim));
    longas += ls.length;
    noLimite += ls.filter((l) => l.fim >= limite - 3).length;
  }
  return longas ? noLimite / longas >= 0.55 : null;
}

function checarPaginaPdf(doc, secoes, regras) {
  const out = [];
  const { papel, margens } = regras;
  const naoA4 = doc.paginas.filter((p) => !(dentro(Math.min(p.larguraCm, p.alturaCm), papel.larguraCm, 0.2) && dentro(Math.max(p.larguraCm, p.alturaCm), papel.alturaCm, 0.2)));
  out.push(naoA4.length
    ? achado('Página', 'Papel A4', 'erro', `${naoA4.length} página(s) fora do A4 (ex.: p. ${naoA4[0].n}, ${fmt(naoA4[0].larguraCm)} × ${fmt(naoA4[0].alturaCm)} cm).`)
    : achado('Página', 'Papel A4', 'ok', '21 × 29,7 cm.'));

  const textuais = paginasDoTexto(doc, secoes).filter((p) => p.alturaPt > p.larguraPt && p.linhas.length >= 8);
  const justificado = pareceJustificado(textuais);
  if (textuais.length) {
    const corpo = (p) => p.linhas.filter((l) => !ehNumeroNaMargem(l, p));
    const est = {
      esq: mediana(textuais.map((p) => Math.min(...corpo(p).map((l) => l.x)))),
      dir: mediana(textuais.map((p) => p.larguraPt - Math.max(...corpo(p).map((l) => l.fim)))),
      sup: mediana(textuais.map((p) => Math.min(...corpo(p).map((l) => l.topo - l.tamanho * 0.75)))),
      inf: mediana(textuais.map((p) => p.alturaPt - Math.max(...corpo(p).map((l) => l.topo + l.tamanho * 0.25)))),
    };
    const cm = Object.fromEntries(Object.entries(est).map(([k, v]) => [k, v * PT_CM]));
    // O início das linhas marca a margem esquerda com precisão; a superior depende da altura da
    // fonte; a direita só é medível com texto justificado; embaixo o texto não deve passar da margem.
    const problemas = [];
    if (!dentro(cm.esq, margens.esq, 0.2)) problemas.push(`esquerda ≈ ${fmt(cm.esq)} cm`);
    if (!dentro(cm.sup, margens.sup, 0.35)) problemas.push(`superior ≈ ${fmt(cm.sup)} cm`);
    if (justificado && (cm.dir < margens.dir - 0.2 || cm.dir > margens.dir + 0.4)) problemas.push(`direita ≈ ${fmt(cm.dir)} cm`);
    if (cm.inf < margens.inf - 0.2) problemas.push(`inferior ≈ ${fmt(cm.inf)} cm`);
    out.push(problemas.length
      ? achado('Página', 'Margens (estimadas)', 'alerta', `Pela posição do texto: ${problemas.join('; ')}. Esperado: superior e esquerda 3 cm; inferior e direita 2 cm. Confira no arquivo original.`)
      : achado('Página', 'Margens (estimadas)', 'ok', `Esquerda ≈ ${fmt(cm.esq)}, superior ≈ ${fmt(cm.sup)}${justificado ? `, direita ≈ ${fmt(cm.dir)}` : ''} cm.`));
  }

  // Numeração: a partir da Introdução, no canto superior direito, contando desde a folha de rosto.
  const ini = secoes.introducao !== null ? doc.paragrafos[secoes.introducao].pagina : null;
  if (ini) {
    const depois = doc.paginas.filter((p) => p.n >= ini).map((p) => ({ p, ...posicaoNumero(p, doc.paginas.length) }));
    const conta = (pos) => depois.filter((d) => d.pos === pos).length;
    const sd = depois.filter((d) => d.pos === 'sd');
    if (sd.length < depois.length * 0.8) {
      const partes = [['no canto superior direito', 'sd'], ['no canto superior esquerdo', 'se'], ['no alto, ao centro', 'sc'], ['no rodapé', 'rodape'], ['sem número visível', null]]
        .map(([rotulo, pos]) => [rotulo, conta(pos)]).filter(([, k]) => k).map(([rotulo, k]) => `${k} ${rotulo}`);
      out.push(achado('Página', 'Numeração de páginas', 'erro', `Das ${depois.length} páginas a partir da Introdução: ${partes.join('; ')}. O número deve ficar no canto superior direito.`));
    } else {
      // Deslocamento entre o número impresso e a posição da folha no arquivo (esperado: −1, capa não contada).
      const desloc = new Map();
      for (const d of sd) { const k = Number(d.linha.texto) - d.p.n; desloc.set(k, (desloc.get(k) || 0) + 1); }
      const [comum] = [...desloc.entries()].sort((a, b) => b[1] - a[1])[0];
      const ex = sd.find((d) => Number(d.linha.texto) - d.p.n === comum);
      out.push(comum === -1
        ? achado('Página', 'Numeração de páginas', 'ok', 'Canto superior direito, contando a partir da folha de rosto.')
        : achado('Página', 'Numeração de páginas', 'alerta', `A ${ex.p.n}ª folha do arquivo mostra o número ${ex.linha.texto}. Se a capa é a 1ª folha, o esperado é ${ex.p.n - 1}: a contagem começa na folha de rosto.`));
      const tam = mediana(sd.map((d) => d.linha.tamanho));
      if (Math.abs(tam - regras.tamanhoMenor) > 0.5) out.push(achado('Página', 'Tamanho do número de página', 'alerta', `≈ ${fmt(tam, 0)} pt; o manual pede ${regras.tamanhoMenor}.`));
    }
    const pre = doc.paginas.filter((p) => p.n < ini && posicaoNumero(p, doc.paginas.length).pos);
    if (pre.length) out.push(achado('Página', 'Páginas pré-textuais sem número', 'alerta', `Páginas antes da Introdução com número visível: ${pre.map((p) => p.n).join(', ')}.`));
  }
  return out;
}

// ---------- Texto ----------

const LEGENDA = /^(figura|quadro|tabela|gr[áa]fico|ilustra[çc][ãa]o|fluxograma|imagem|mapa|desenho)\s*\d+/i;
const FONTE = /^fonte\s*:/i;
const ALINEA = /^([a-z]\)|[-–•▪◦])\s/;

function ehTitulo(p, regras) {
  const t = semAcento(tituloSecao(p.texto));
  if (p.ehTituloEstilo) return true;
  if (regras.elementos.some((el) => el.titulos.map(semAcento).includes(t))) return true;
  if (/^\d+(\.\d+)*\.?\s*\S/.test(p.texto) && p.texto.length < 120 && !/[.;:,]$/.test(p.texto)) return true;
  // Título digitado sem estilo: frase curta sem pontuação final.
  return p.texto.split(/\s+/).length <= 12 && !/[.;:?!)”"]$/.test(p.texto);
}

function fonteAceita(nome, regras) {
  return !!nome && regras.fontes.some((f) => nome.toLowerCase().startsWith(f.toLowerCase()));
}

function resumoConformidade(grupo, item, total, falhas, regras, okMsg, exemplo) {
  if (!total) return null;
  const taxa = 1 - falhas.length / total;
  const status = taxa >= regras.limiarOk ? 'ok' : taxa >= regras.limiarAlerta ? 'alerta' : 'erro';
  const detalhe = falhas.length
    ? `${falhas.length} de ${total} parágrafos fora do padrão. Ex.: ${falhas.slice(0, 3).map(exemplo).join('; ')}.`
    : okMsg;
  return achado(grupo, item, status, detalhe);
}

function checarTextoDocx(doc, secoes, regras) {
  const out = [];
  const ini = secoes.introducao ?? (secoes.sumario !== null ? secoes.sumario + 1 : 0);
  const fim = secoes.referencias ?? doc.paragrafos.length;
  const base = doc.paragrafos.slice(ini, fim).filter((p) => p.texto && !p.emTabela);
  const legendas = base.filter((p) => LEGENDA.test(p.texto));
  const fontes = base.filter((p) => FONTE.test(p.texto));
  const restante = base.filter((p) => !LEGENDA.test(p.texto) && !FONTE.test(p.texto) && !ehTitulo(p, regras) && p.texto.split(/\s+/).length >= 4);
  const listas = restante.filter((p) => p.emLista || ALINEA.test(p.texto) || /list|lista/i.test(p.estilo));
  const longas = restante.filter((p) => p.recuoEsqCm >= 2.5 && !listas.includes(p));
  const normais = restante.filter((p) => p.recuoEsqCm < 2.5 && !listas.includes(p));
  const ex = (extra) => (p) => `${trecho(p.texto, 40)} (${extra(p)})`;
  const add = (x) => x && out.push(x);
  const texto = [...normais, ...listas];

  add(resumoConformidade('Texto', 'Fonte (Arial ou Times New Roman)', texto.length + longas.length,
    [...texto, ...longas].filter((p) => !fonteAceita(p.fonte, regras)), regras, 'Arial ou Times New Roman.', ex((p) => p.fonte)));
  add(resumoConformidade('Texto', 'Tamanho 12 no texto', texto.length,
    texto.filter((p) => p.tamanho !== regras.tamanhoTexto), regras, 'Tamanho 12.', ex((p) => `${fmt(p.tamanho, 0)} pt`)));
  add(resumoConformidade('Texto', 'Entrelinha 1,5', texto.length,
    texto.filter((p) => Math.abs(p.entrelinha - regras.entrelinhaTexto) > 0.08), regras, 'Espaçamento 1,5.', ex((p) => `entrelinha ${fmt(p.entrelinha, 2)}`)));
  add(resumoConformidade('Texto', 'Alinhamento justificado', normais.length,
    normais.filter((p) => p.alinhamento !== 'justificado'), regras, 'Justificado.', ex((p) => p.alinhamento)));
  add(resumoConformidade('Texto', 'Recuo de 1,25 cm na primeira linha', normais.length,
    normais.filter((p) => Math.abs(p.recuoPrimeiraCm - regras.recuoParagrafoCm) > 0.15), regras, 'Recuo de 1,25 cm.', ex((p) => `recuo ${fmt(p.recuoPrimeiraCm, 2)} cm`)));
  add(resumoConformidade('Texto', 'Sem espaço entre parágrafos', normais.length,
    normais.filter((p) => p.espacoAntesPt > 0.5 || p.espacoDepoisPt > 0.5), regras, 'Sem espaçamento antes/depois.', ex((p) => `antes ${fmt(p.espacoAntesPt, 0)} pt, depois ${fmt(p.espacoDepoisPt, 0)} pt`)));

  if (longas.length) {
    add(resumoConformidade('Citações longas', 'Tamanho 10', longas.length,
      longas.filter((p) => p.tamanho !== regras.tamanhoMenor), regras, 'Tamanho 10.', ex((p) => `${fmt(p.tamanho, 0)} pt`)));
    add(resumoConformidade('Citações longas', 'Espaçamento simples', longas.length,
      longas.filter((p) => p.entrelinha > 1.1), regras, 'Espaçamento simples.', ex((p) => `entrelinha ${fmt(p.entrelinha, 2)}`)));
    const recuo = resumoConformidade('Citações longas', 'Recuo de 4 cm', longas.length,
      longas.filter((p) => Math.abs(p.recuoEsqCm - regras.recuoCitacaoLongaCm) > 0.3), regras, 'Recuo de 4 cm.', ex((p) => `recuo ${fmt(p.recuoEsqCm)} cm`));
    if (recuo && recuo.status === 'erro') recuo.status = 'alerta'; // recomendação do manual, não obrigação
    add(recuo);
  }

  if (doc.notas.length) {
    add(resumoConformidade('Notas de rodapé', 'Tamanho 10 e espaçamento simples', doc.notas.length,
      doc.notas.filter((p) => p.tamanho !== regras.tamanhoMenor || p.entrelinha > 1.1), regras, 'Tamanho 10, espaçamento simples.', ex((p) => `${fmt(p.tamanho, 0)} pt, entrelinha ${fmt(p.entrelinha, 2)}`)));
  }

  if (fontes.length) {
    add(resumoConformidade('Ilustrações e tabelas', 'Fonte das ilustrações em tamanho 10', fontes.length,
      fontes.filter((p) => p.tamanho !== regras.tamanhoMenor), regras, 'Tamanho 10.', ex((p) => `${fmt(p.tamanho, 0)} pt`)));
  }
  if (legendas.length) {
    // Após cada legenda, a próxima linha "Fonte:" deve vir antes da próxima legenda.
    const ordem = doc.paragrafos.slice(ini, fim).filter((p) => p.texto && (LEGENDA.test(p.texto) || FONTE.test(p.texto)));
    const semFonte = ordem.filter((p, k) => LEGENDA.test(p.texto) && !(ordem[k + 1] && FONTE.test(ordem[k + 1].texto)));
    out.push(semFonte.length
      ? achado('Ilustrações e tabelas', 'Indicação de “Fonte:”', 'erro', `Sem “Fonte:” logo abaixo: ${semFonte.slice(0, 5).map((p) => trecho(p.texto, 40)).join('; ')}.`)
      : achado('Ilustrações e tabelas', 'Indicação de “Fonte:”', 'ok', `${legendas.length} ilustração(ões)/tabela(s) com fonte indicada.`));
  }

  // Títulos sem indicativo numérico centralizados.
  const titulos = doc.paragrafos.filter((p) => p.texto.length < 150 && !p.emTabela && regras.titulosCentralizados.some((t) => semAcento(tituloSecao(p.texto)).startsWith(semAcento(t)))
    && ([secoes.resumo, secoes.abstract, secoes.sumario, secoes.referencias].includes(p.i) || (secoes.referencias !== null && p.i > secoes.referencias)));
  const naoCentr = titulos.filter((p) => p.alinhamento !== 'centralizado' && (ehTitulo(p, regras) || /^(AP[ÊE]NDICE|ANEXO)\b/i.test(p.texto)));
  if (titulos.length) {
    out.push(naoCentr.length
      ? achado('Texto', 'Títulos sem número centralizados', 'alerta', `Não centralizados: ${naoCentr.map((p) => trecho(p.texto, 30)).join('; ')}.`)
      : achado('Texto', 'Títulos sem número centralizados', 'ok', 'Resumo, Abstract, Sumário, Referências etc. centralizados.'));
  }
  return out;
}

const FONTES_PDF = {
  Arial: /arial|helvetica|liberation ?sans|arimo|nimbus ?sans/i,
  'Times New Roman': /times|liberation ?serif|tinos|nimbus ?rom|termes/i,
};
// Nomes genéricos que não identificam a família ("CIDFont+F1", "F2", "T1_0").
const FONTE_GENERICA = /^(CIDFont|F\d|T\d|TT\d|Font\d|g_d\d)/i;

function checarTextoPdf(doc, secoes, regras) {
  const out = [];
  const paginas = paginasDoTexto(doc, secoes);
  const linhas = paginas.flatMap((p) => p.linhas.filter((l) => !ehNumeroNaMargem(l, p) && l.texto.length > 20));
  if (!linhas.length) return out;

  const peso = new Map();
  for (const l of linhas) peso.set(l.tamanho, (peso.get(l.tamanho) || 0) + l.texto.length);
  const tam = [...peso.entries()].sort((a, b) => b[1] - a[1])[0][0];
  out.push(Math.abs(tam - regras.tamanhoTexto) <= 0.3
    ? achado('Texto', 'Tamanho 12 no texto', 'ok', `Tamanho predominante: ${fmt(tam, 1)} pt.`)
    : achado('Texto', 'Tamanho 12 no texto', 'erro', `Tamanho predominante: ${fmt(tam, 1)} pt.`));

  const nomes = new Map();
  for (const l of linhas) if (l.fonteNome) nomes.set(l.fonteNome, (nomes.get(l.fonteNome) || 0) + l.texto.length);
  const fonte = [...nomes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (fonte && !FONTE_GENERICA.test(fonte)) {
    const aceita = Object.entries(FONTES_PDF).find(([, re]) => re.test(fonte));
    out.push(aceita
      ? achado('Texto', 'Fonte (Arial ou Times New Roman)', 'ok', `Fonte predominante: ${fonte}${!fonte.toLowerCase().includes(aceita[0].split(' ')[0].toLowerCase()) ? ` (equivalente a ${aceita[0]})` : ''}.`)
      : achado('Texto', 'Fonte (Arial ou Times New Roman)', 'erro', `Fonte predominante: ${fonte}.`));
  } else {
    out.push(achado('Texto', 'Fonte (Arial ou Times New Roman)', 'info', 'O PDF não informa o nome da fonte. Confira no arquivo original.'));
  }

  const passos = [];
  for (const p of paginas) {
    const ls = p.linhas.filter((l) => Math.abs(l.tamanho - tam) < 0.5);
    for (let k = 1; k < ls.length; k++) {
      const d = ls[k].topo - ls[k - 1].topo;
      if (d > 0 && d < tam * 2.6) passos.push(d / tam);
    }
  }
  const razao = mediana(passos);
  if (!Number.isNaN(razao)) {
    const rotulo = razao < 1.38 ? 'simples' : razao <= 2.0 ? '1,5' : 'duplo';
    out.push(rotulo === '1,5'
      ? achado('Texto', 'Entrelinha 1,5 (estimada)', 'ok', `Distância entre linhas ≈ ${fmt(razao, 2)} × o tamanho da fonte.`)
      : achado('Texto', 'Entrelinha 1,5 (estimada)', 'erro', `O espaçamento parece ${rotulo} (distância entre linhas ≈ ${fmt(razao, 2)} × o tamanho da fonte).`));
  }
  const justificado = pareceJustificado(paginas);
  if (justificado === false) out.push(achado('Texto', 'Alinhamento justificado (estimado)', 'erro', 'As linhas não terminam alinhadas à direita: o texto parece alinhado à esquerda, e o manual pede justificado.'));
  else if (justificado) out.push(achado('Texto', 'Alinhamento justificado (estimado)', 'ok', 'Linhas alinhadas às duas margens.'));
  out.push(achado('Texto', 'Recuo de parágrafo, citações longas e notas', 'info', 'Em PDF não é possível medir com precisão. Envie o .docx para checar esses itens.'));
  return out;
}

// ---------- Resumo e Abstract ----------

function checarResumo(doc, secoes, id, nome, reChave, regras) {
  const out = [];
  const ini = secoes[id];
  if (ini === null) return out;
  const proximos = Object.values(secoes).filter((i) => i !== null && i > ini);
  const fim = proximos.length ? Math.min(...proximos) : Math.min(doc.paragrafos.length, ini + 80);
  const bloco = doc.paragrafos.slice(ini + 1, fim).filter((p) => p.texto);
  const kChave = bloco.findIndex((p) => reChave.test(p.texto));
  const texto = (kChave >= 0 ? bloco.slice(0, kChave) : bloco).filter((p) => !(doc.tipo === 'pdf' && ehNumeroIsolado(p.texto)));
  const palavras = contarPalavras(texto.map((p) => p.texto).join(' '));
  const { palavrasMin, palavrasMax, palavrasChaveMin, palavrasChaveMax } = regras.resumo;

  out.push(palavras >= palavrasMin && palavras <= palavrasMax
    ? achado(nome, 'Extensão', 'ok', `${palavras} palavras.`)
    : achado(nome, 'Extensão', 'alerta', `${palavras} palavras; o manual recomenda de ${palavrasMin} a ${palavrasMax}.`));

  if (doc.tipo === 'docx' && texto.length) {
    if (texto.length > 1) out.push(achado(nome, 'Parágrafo único', 'alerta', `${texto.length} parágrafos; deve ser um parágrafo único.`));
    const p = texto[0];
    if (p.alinhamento !== 'justificado' || Math.abs(p.recuoPrimeiraCm) > 0.1) {
      out.push(achado(nome, 'Justificado e sem recuo', 'alerta', `Alinhamento ${p.alinhamento}, recuo de primeira linha ${fmt(p.recuoPrimeiraCm, 2)} cm.`));
    }
  }

  const rotulo = id === 'resumo' ? 'Palavras-chave' : 'Keywords';
  if (kChave < 0) {
    out.push(achado(nome, rotulo, 'erro', `Linha “${rotulo}:” não encontrada.`));
    return out;
  }
  const linhas = [bloco[kChave].texto];
  for (const p of bloco.slice(kChave + 1, kChave + 3)) if (!/[.]$/.test(linhas[linhas.length - 1])) linhas.push(p.texto);
  const completo = linhas.join(' ');
  const valor = completo.replace(reChave, '').trim();
  const problemas = [];
  if (!/^[^:]{0,20}:/.test(completo)) problemas.push(`use dois-pontos depois de “${rotulo}”`);
  let termos;
  if (valor.includes(';')) termos = valor.replace(/\.$/, '').split(';');
  else if (valor.includes(',')) { termos = valor.replace(/\.$/, '').split(','); problemas.push('separe os termos com ponto e vírgula'); }
  else { termos = valor.replace(/\.$/, '').split(/\.\s+/); if (termos.length > 1) problemas.push('separe os termos com ponto e vírgula, não com ponto'); }
  termos = termos.map((t) => t.trim()).filter(Boolean);
  if (!/\.$/.test(valor)) problemas.push('termine com ponto final');
  if (termos.length < palavrasChaveMin || termos.length > palavrasChaveMax) problemas.push(`${termos.length} termos (recomendado ${palavrasChaveMin} a ${palavrasChaveMax})`);
  out.push(problemas.length
    ? achado(nome, rotulo, 'alerta', `${problemas.join('; ')}.`)
    : achado(nome, rotulo, 'ok', `${termos.length} termos.`));
  return out;
}

// ---------- Citações e referências ----------

function textoCorpo(doc, secoes) {
  const ini = secoes.introducao ?? 0;
  const fim = secoes.referencias ?? doc.paragrafos.length;
  const ps = doc.paragrafos.slice(ini, fim).map((p) => p.texto);
  const notas = (doc.notas || []).map((p) => p.texto);
  const sep = doc.tipo === 'pdf' ? ' ' : '\n';
  return [...ps, ...notas].join(sep).replace(/(\p{L})-\s+(\p{Ll})/gu, '$1$2');
}

function checarCitacoes(citacoes, refs, cruzamento, numerico) {
  const out = [];
  if (!refs.length) return out;
  const { semReferencia, naoCitadas } = cruzamento;
  const lista = (cs) => `${cs.slice(0, 12).map((c) => (numerico ? c.autor : `${c.autor} (${c.ano})`)).join('; ')}${cs.length > 12 ? '…' : ''}`;
  const certas = semReferencia.filter((c) => c.tipo === 'parentetica');
  const possiveis = semReferencia.filter((c) => c.tipo === 'narrativa');
  out.push(certas.length
    ? achado('Citações', 'Toda citação tem referência', 'erro', `Sem referência correspondente (confira autor e ano): ${lista(certas)}.`)
    : achado('Citações', 'Toda citação tem referência', 'ok', `${numerico ? cruzamento.citadas.size : citacoes.length} chamadas de citação conferidas.`));
  if (possiveis.length) {
    out.push(achado('Citações', 'Possíveis citações sem referência', 'alerta', `Nome seguido de ano entre parênteses, sem referência correspondente. Confira se são citações: ${lista(possiveis)}.`));
  }
  out.push(naoCitadas.length
    ? achado('Citações', 'Toda referência é citada', 'alerta', `Não encontramos citação no texto para: ${naoCitadas.slice(0, 12).map((r) => `#${r.n} ${r.autor || trecho(r.texto, 30)}`).join('; ')}${naoCitadas.length > 12 ? '…' : ''}.`)
    : achado('Citações', 'Toda referência é citada', 'ok', 'Todas as referências aparecem citadas no texto.'));

  if (numerico) {
    out.push(achado('Citações', 'Sistema de chamada', 'info', 'Sistema numérico ([1], [2]...). O manual da biblioteca apresenta o sistema autor-data; confirme com o orientador.'));
    return out;
  }
  const caixaAlta = [...new Set(citacoes
    .filter((c) => c.tipo === 'parentetica' && /^[\p{Lu}\s'’\-]{5,}$/u.test(c.autor) && /[AEIOUÁÉÍÓÚÂÊÔÃÕ].*[AEIOUÁÉÍÓÚÂÊÔÃÕ]/u.test(c.autor))
    .map((c) => `${c.autor}, ${c.ano}`))];
  if (caixaAlta.length) {
    out.push(achado('Citações', 'Autor em maiúsculas e minúsculas', 'alerta', `Pela NBR 10520:2023, use “(Silva, 2020)” e não “(SILVA, 2020)”. Siglas (IBGE, BNDES) continuam em maiúsculas. Casos: ${caixaAlta.slice(0, 8).join('; ')}.`));
  }
  return out;
}

function checarFormaReferencias(doc, secoes, refs, numerico) {
  const out = [];
  if (secoes.referencias === null) return out;
  if (!refs.length) return [achado('Referências', 'Lista de referências', 'erro', 'A seção existe, mas nenhuma referência foi identificada.')];

  if (!numerico) {
    // Compara a entrada (autoria completa ou título); referências com autor em traço são puladas.
    const fora = [];
    const comEntrada = refs.filter((r) => r.entrada);
    for (let k = 1; k < comEntrada.length; k++) {
      const [a, b] = [comEntrada[k - 1], comEntrada[k]];
      if (normalizar(a.entrada).localeCompare(normalizar(b.entrada), 'pt', { sensitivity: 'base' }) > 0) {
        fora.push(`#${b.n} (${trecho(b.entrada, 30)}) depois de #${a.n} (${trecho(a.entrada, 30)})`);
      }
    }
    out.push(fora.length
      ? achado('Referências', 'Ordem alfabética', 'erro', `Fora de ordem: ${fora.slice(0, 5).join('; ')}${fora.length > 5 ? '…' : ''}.`)
      : achado('Referências', 'Ordem alfabética', 'ok', `${refs.length} referências em ordem alfabética.`));
  }

  const online = refs.filter((r) => r.urls.length);
  const semDisponivel = online.filter((r) => !/Dispon[íi]vel\s+em/i.test(r.texto));
  const semAcesso = online.filter((r) => !/Acesso\s+em/i.test(r.texto));
  if (semDisponivel.length) out.push(achado('Referências', 'Documentos online: “Disponível em:”', 'erro', `Com link, mas sem “Disponível em:”: ${semDisponivel.slice(0, 10).map((r) => `#${r.n}`).join(', ')}.`));
  if (semAcesso.length) out.push(achado('Referências', 'Documentos online: “Acesso em:”', 'erro', `Com link, mas sem a data de acesso (“Acesso em: dia mês. ano.”): ${semAcesso.slice(0, 10).map((r) => `#${r.n}`).join(', ')}.`));
  if (online.length && !semDisponivel.length && !semAcesso.length) out.push(achado('Referências', 'Documentos online', 'ok', 'Todos com “Disponível em:” e “Acesso em:”.'));

  if (doc.tipo === 'docx') {
    const secao = doc.paragrafos.slice(secoes.referencias + 1, secoes.fimReferencias);
    const ps = secao.filter((p) => p.texto);
    const just = ps.filter((p) => p.alinhamento !== 'esquerda');
    out.push(just.length
      ? achado('Referências', 'Alinhadas à esquerda', 'erro', `${just.length} referência(s) ${just[0].alinhamento === 'justificado' ? 'justificadas' : `com alinhamento ${just[0].alinhamento}`}; devem ficar alinhadas somente à margem esquerda.`)
      : achado('Referências', 'Alinhadas à esquerda', 'ok', 'Alinhadas à margem esquerda.'));
    const espac = ps.filter((p) => p.entrelinha > 1.1);
    out.push(espac.length
      ? achado('Referências', 'Espaçamento simples', 'erro', `${espac.length} referência(s) com entrelinha ${fmt(espac[0].entrelinha, 2)}.`)
      : achado('Referências', 'Espaçamento simples', 'ok', 'Espaçamento simples.'));
    let juntas = 0;
    for (let k = 1; k < secao.length; k++) {
      const a = secao[k - 1];
      const b = secao[k];
      if (a.texto && b.texto && a.espacoDepoisPt < 6 && b.espacoAntesPt < 6) juntas++;
    }
    out.push(juntas
      ? achado('Referências', 'Uma linha em branco entre referências', 'alerta', `${juntas} par(es) de referências sem linha em branco entre si.`)
      : achado('Referências', 'Uma linha em branco entre referências', 'ok', 'Referências separadas por espaço.'));
  }
  return out;
}

// ---------- Ponto de entrada ----------

export function analisar(doc, regras = REGRAS) {
  const caracteres = doc.paragrafos.reduce((s, p) => s + p.texto.length, 0);
  if (doc.tipo === 'pdf' && caracteres < 2000) {
    return {
      achados: [achado('Arquivo', 'Texto do PDF', 'erro', 'O PDF quase não tem texto selecionável (provavelmente é digitalizado). Exporte o PDF a partir do Word/Google Docs ou envie o .docx.')],
      secoes: {}, refs: [], citacoes: [], cruzamento: { semReferencia: [], naoCitadas: [], citadas: new Set() },
    };
  }
  const secoes = localizarSecoes(doc.paragrafos, regras);
  const refs = secoes.referencias !== null
    ? extrairReferencias(doc.paragrafos.slice(secoes.referencias + 1, secoes.fimReferencias).filter((p) => !(doc.tipo === 'pdf' && ehNumeroIsolado(p.texto))), doc.tipo)
    : [];
  // Sistema numérico: lista numerada e chamadas [n] no texto. Lista numerada com chamadas
  // autor-data é tratada como autor-data (e a numeração da lista é apontada).
  const corpo = textoCorpo(doc, secoes);
  const numerada = listaNumerada(refs);
  const chamadas = numerada ? extrairCitacoesNumericas(corpo) : new Set();
  const numerico = numerada && [...chamadas].filter((k) => refs.some((r) => r.numero === k)).length >= Math.min(3, refs.length);
  const citacoes = numerico ? [] : extrairCitacoes(corpo);
  const cruzamento = numerico ? cruzarNumerico(chamadas, refs) : cruzar(citacoes, refs);

  const achados = [
    ...checarEstrutura(doc, secoes, regras),
    ...(doc.tipo === 'docx' ? checarPaginaDocx(doc, secoes, regras) : checarPaginaPdf(doc, secoes, regras)),
    ...(doc.tipo === 'docx' ? checarTextoDocx(doc, secoes, regras) : checarTextoPdf(doc, secoes, regras)),
    ...checarResumo(doc, secoes, 'resumo', 'Resumo', /^palavras?[-\s]chaves?\s*:?/i, regras),
    ...checarResumo(doc, secoes, 'abstract', 'Abstract', /^key[-\s]?words?\s*:?/i, regras),
    ...checarCitacoes(citacoes, refs, cruzamento, numerico),
    ...checarFormaReferencias(doc, secoes, refs, numerico),
    ...(numerada && !numerico ? [achado('Referências', 'Lista sem numeração', 'alerta', 'A lista de referências está numerada, mas as citações usam o sistema autor-data; nesse sistema as referências não são numeradas.')] : []),
  ];
  return { achados, secoes, refs, citacoes, cruzamento, numerico };
}
