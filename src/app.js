import { analisar } from './checagens.js';
import { lerDocx } from './docx.js';
import { lerPdf } from './pdf.js';
import { verificarTodas } from './verificacao.js';
import { criarCliente, revisarReferencias, buscarNaWeb, custoEstimado } from './claude.js';

const CDN = {
  jszip: 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm',
  pdfjs: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs',
  pdfWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs',
  anthropic: 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.128.0/+esm',
};
const CHAVE_LOCAL = 'verificador-tcc-chave';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const link = (url, texto) => (/^https?:\/\//i.test(url || '') ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(texto || url)}</a>` : '');
const ROTULO = { ok: 'Conforme', alerta: 'Atenção', erro: 'Corrigir', info: 'Conferir' };

let arquivo = null;

// ---------- Entrada ----------

function escolher(f) {
  if (!f) return;
  if (!/\.(docx|pdf)$/i.test(f.name)) {
    mostrarErro('Envie um arquivo .docx ou .pdf.');
    return;
  }
  arquivo = f;
  $('zona-texto').innerHTML = `<strong>${esc(f.name)}</strong> (${Math.round(f.size / 1024)} KB). Clique para trocar.`;
  $('verificar').disabled = false;
  $('erro').hidden = true;
}

function iniciarEntrada() {
  $('arquivo').addEventListener('change', (e) => escolher(e.target.files[0]));
  const zona = $('zona');
  zona.addEventListener('dragover', (e) => { e.preventDefault(); zona.classList.add('ativa'); });
  zona.addEventListener('dragleave', () => zona.classList.remove('ativa'));
  zona.addEventListener('drop', (e) => { e.preventDefault(); zona.classList.remove('ativa'); escolher(e.dataTransfer.files[0]); });

  try {
    const salva = localStorage.getItem(CHAVE_LOCAL);
    if (salva) { $('chave').value = salva; $('lembrar').checked = true; }
  } catch { /* armazenamento indisponível */ }

  $('verificar').addEventListener('click', executar);
  $('imprimir').addEventListener('click', () => window.print());
}

function lembrarChave(chave) {
  try {
    if ($('lembrar').checked && chave) localStorage.setItem(CHAVE_LOCAL, chave);
    else localStorage.removeItem(CHAVE_LOCAL);
  } catch { /* armazenamento indisponível */ }
}

// ---------- Progresso ----------

function etapa(texto) {
  const li = document.createElement('li');
  li.textContent = texto;
  $('etapas').append(li);
  return {
    atualizar: (t) => { li.textContent = t; },
    concluir: (t) => { if (t) li.textContent = t; li.classList.add('feita'); },
  };
}

function mostrarErro(msg) {
  $('erro').textContent = msg;
  $('erro').hidden = false;
}

// ---------- Fluxo ----------

async function lerArquivo(f) {
  const buffer = await f.arrayBuffer();
  if (/\.pdf$/i.test(f.name)) {
    const pdfjs = await import(CDN.pdfjs);
    pdfjs.GlobalWorkerOptions.workerSrc = CDN.pdfWorker;
    return lerPdf(buffer, pdfjs);
  }
  const { default: JSZip } = await import(CDN.jszip);
  return lerDocx(buffer, { JSZip, DOMParser });
}

function mensagemDeErroDaApi(e, Anthropic) {
  if (e instanceof Anthropic.AuthenticationError) return 'Chave da API inválida.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'A chave não tem permissão para este modelo ou para a busca na web.';
  if (e instanceof Anthropic.RateLimitError) return 'Limite de uso da chave atingido. Tente de novo em alguns minutos.';
  if (e instanceof Anthropic.APIError) return `Erro da API (${e.status ?? 'sem status'}): ${e.message}`;
  return e.message;
}

async function executar() {
  if (!arquivo) return;
  $('verificar').disabled = true;
  $('etapas').innerHTML = '';
  $('etapas').hidden = false;
  $('erro').hidden = true;
  $('resultado').hidden = true;
  const chave = $('chave').value.trim();
  lembrarChave(chave);

  try {
    let e = etapa('Lendo o arquivo…');
    const doc = await lerArquivo(arquivo);
    e.concluir(`Arquivo lido (${doc.paragrafos.length} ${doc.tipo === 'pdf' ? 'linhas' : 'parágrafos'}).`);

    e = etapa('Checando estrutura, formatação e citações…');
    const analise = analisar(doc);
    e.concluir(`Estrutura, formatação e citações checadas; ${analise.refs.length} referências identificadas.`);

    e = etapa('Procurando as referências na Crossref…');
    const verif = await verificarTodas(analise.refs, { aoProgredir: (i, n) => e.atualizar(`Procurando as referências na Crossref… ${i}/${n}`) });
    e.concluir('Referências consultadas na Crossref.');

    const uso = { entrada: 0, saida: 0, buscas: 0 };
    let revisao = new Map();
    let web = new Map();
    let falhaIa = '';
    if (chave && analise.refs.length) {
      const { default: Anthropic } = await import(CDN.anthropic);
      const cliente = criarCliente(Anthropic, chave);
      const pendentes = analise.refs.filter((r) => ['nao_localizada', 'erro'].includes(verif.get(r.n)?.status));
      const e1 = etapa('Claude revisando a forma das referências…');
      const e2 = pendentes.length ? etapa(`Claude buscando na web ${pendentes.length} referência(s) não localizada(s)…`) : null;
      const [r1, r2] = await Promise.allSettled([
        revisarReferencias(cliente, Anthropic, analise.refs, { uso, aoProgredir: (i, n) => e1.atualizar(`Claude revisando a forma das referências… ${i}/${n}`) }),
        pendentes.length ? buscarNaWeb(cliente, Anthropic, pendentes, { uso, aoProgredir: (i, n) => e2.atualizar(`Claude buscando na web… ${i}/${n}`) }) : Promise.resolve(new Map()),
      ]);
      if (r1.status === 'fulfilled') { revisao = r1.value; e1.concluir('Forma das referências revisada.'); } else { falhaIa = mensagemDeErroDaApi(r1.reason, Anthropic); e1.concluir(`Revisão não concluída: ${falhaIa}`); }
      if (e2) {
        if (r2.status === 'fulfilled') { web = r2.value; e2.concluir('Busca na web concluída.'); } else { falhaIa = mensagemDeErroDaApi(r2.reason, Anthropic); e2.concluir(`Busca na web não concluída: ${falhaIa}`); }
      }
    }

    renderizar(analise, verif, revisao, web, { usouIa: !!chave, uso, falhaIa });
  } catch (err) {
    console.error(err);
    mostrarErro(`Não foi possível analisar o arquivo: ${err.message}`);
  } finally {
    $('verificar').disabled = false;
  }
}

// ---------- Resultado ----------

// Situação final de cada referência, combinando Crossref e busca na web.
function situacao(ref, v, w, usouIa) {
  const base = { nota: v?.nota || '', url: v?.encontrado?.url, titulo: v?.encontrado?.titulo };
  switch (v?.status) {
    case 'verificada': return { ...base, nivel: 'ok', rotulo: 'Verificada' };
    case 'doi_inexistente': return { ...base, nivel: 'erro', rotulo: 'DOI inexistente' };
    case 'doi_divergente': return { ...base, nivel: 'erro', rotulo: 'DOI de outra obra' };
    case 'divergente': return { ...base, nivel: 'alerta', rotulo: 'Divergências' };
    case 'nao_aplicavel': return { ...base, nivel: 'info', rotulo: 'Legislação/norma' };
    default: break;
  }
  if (w) {
    const nota = `${w.observacao}${w.titulo_encontrado ? ` Título na fonte: “${w.titulo_encontrado}”.` : ''}`;
    if (w.status === 'encontrada') return { nivel: 'ok', rotulo: 'Encontrada na web', nota, url: w.evidencia_url };
    if (w.status === 'nao_encontrada') return { nivel: 'erro', rotulo: 'Não encontrada', nota: `${nota} Pode ter sido inventada ou copiada com erro; confira a obra original.` };
    return { nivel: 'alerta', rotulo: w.status === 'incerta' ? 'Incerta' : 'Divergências', nota, url: w.evidencia_url };
  }
  if (v?.status === 'erro') return { ...base, nivel: 'info', rotulo: 'Falha na consulta' };
  return { ...base, nivel: 'info', rotulo: 'Não localizada', nota: `${base.nota}${usouIa ? '' : ' Informe uma chave da API para buscar na web.'}` };
}

function renderizar(analise, verif, revisao, web, { usouIa, uso, falhaIa }) {
  const { achados, refs, cruzamento } = analise;
  const sits = refs.map((r) => situacao(r, verif.get(r.n), web.get(r.n), usouIa && !falhaIa));
  const conta = (xs, nivel) => xs.filter((x) => (x.status || x.nivel) === nivel).length;
  const problemasAbnt = refs.filter((r) => revisao.get(r.n)?.problemas?.length).length;

  $('placar').innerHTML = [
    ['erro', conta(achados, 'erro'), 'itens a corrigir'],
    ['alerta', conta(achados, 'alerta'), 'itens de atenção'],
    ['ok', conta(achados, 'ok'), 'itens conformes'],
    ['erro', conta(sits, 'erro'), 'referências suspeitas'],
    ['ok', conta(sits, 'ok'), `de ${refs.length} referências confirmadas`],
  ].map(([n, v, t]) => `<div class="s-${n}"><strong>${v}</strong>${esc(t)}</div>`).join('');

  $('custo').textContent = usouIa
    ? `Uso da API: ${uso.entrada.toLocaleString('pt-BR')} tokens de entrada, ${uso.saida.toLocaleString('pt-BR')} de saída, ${uso.buscas} buscas na web. Custo estimado: US$ ${custoEstimado(uso).toFixed(2)}.${problemasAbnt ? ` ${problemasAbnt} referência(s) com ajustes de forma sugeridos.` : ''}`
    : 'Sem chave da API: revisão de forma das referências e busca na web não realizadas.';

  // Achados: problemas primeiro, por grupo; itens conformes recolhidos.
  const peso = { erro: 0, alerta: 1, info: 2, ok: 3 };
  const pendentes = achados.filter((a) => a.status !== 'ok').sort((a, b) => peso[a.status] - peso[b.status]);
  const ok = achados.filter((a) => a.status === 'ok');
  const item = (a) => `<div class="item"><span class="selo s-${a.status}">${ROTULO[a.status]}</span><span class="nome">${esc(a.grupo)}: ${esc(a.item)}</span><span class="det">${esc(a.detalhe)}</span></div>`;
  $('achados').innerHTML = (pendentes.length ? pendentes.map(item).join('') : '<p>Nenhum problema encontrado.</p>')
    + (ok.length ? `<details class="conformes"><summary>Itens conformes (${ok.length})</summary>${ok.map(item).join('')}</details>` : '');

  // Referências.
  const naoCitadas = new Set(cruzamento.naoCitadas.map((r) => r.n));
  $('referencias').innerHTML = refs.length ? refs.map((r, k) => {
    const s = sits[k];
    const rev = revisao.get(r.n);
    const abnt = rev && rev.problemas.length
      ? `<div class="abnt"><strong>Forma (NBR 6023):</strong><ul>${rev.problemas.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>${rev.sugestao ? `<div class="sugestao">${esc(rev.sugestao)}</div>` : ''}</div>`
      : rev ? '<div class="abnt"><strong>Forma (NBR 6023):</strong> sem ajustes.</div>' : '';
    return `<div class="ref">
      <div class="topo"><span class="num">#${r.n}</span><span class="selo s-${s.nivel}">${esc(s.rotulo)}</span>${naoCitadas.has(r.n) ? '<span class="selo s-alerta">Não citada no texto</span>' : ''}</div>
      <div class="texto">${esc(r.texto)}</div>
      <div class="det">${esc(s.nota)} ${link(s.url, 'ver registro')}</div>
      ${abnt}
    </div>`;
  }).join('') : '<p>Nenhuma referência identificada.</p>';

  $('resultado').hidden = false;
  $('resultado').scrollIntoView({ behavior: 'smooth' });
}

iniciarEntrada();
