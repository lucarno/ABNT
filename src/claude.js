// Uso do Claude com a chave do próprio aluno, direto do navegador:
// 1) revisão da forma das referências (NBR 6023);
// 2) busca na web das referências que a Crossref não localizou.
import { CLAUDE } from './regras.js';

export function criarCliente(Anthropic, apiKey, opcoes = {}) {
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, ...opcoes });
}

const FALLBACK = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };

// Envia a requisição; se a API recusar os parâmetros de fallback (400), repete sem eles.
// Retoma turnos pausados pela busca na web (pause_turn) e devolve a última resposta junto com
// todos os blocos produzidos nas rodadas.
async function enviar(cliente, Anthropic, params, uso) {
  let mensagens = params.messages;
  let extra = FALLBACK;
  const blocos = [];
  for (let rodada = 0; rodada < 4; rodada++) {
    let resp;
    try {
      resp = await cliente.beta.messages.stream({ ...params, ...extra, messages: mensagens }).finalMessage();
    } catch (e) {
      if (extra === FALLBACK && e instanceof Anthropic.BadRequestError) {
        extra = {};
        rodada--;
        continue;
      }
      throw e;
    }
    uso.entrada += resp.usage.input_tokens + (resp.usage.cache_read_input_tokens || 0) + (resp.usage.cache_creation_input_tokens || 0);
    uso.saida += resp.usage.output_tokens;
    uso.buscas += resp.usage.server_tool_use?.web_search_requests || 0;
    blocos.push(...resp.content);
    if (resp.stop_reason === 'refusal') throw new Error('O modelo recusou a solicitação.');
    if (resp.stop_reason === 'pause_turn') {
      mensagens = [...mensagens, { role: 'assistant', content: resp.content }];
      continue;
    }
    if (resp.stop_reason === 'max_tokens') throw new Error('Resposta cortada por limite de tamanho; tente com menos referências.');
    return { resp, blocos, mensagens };
  }
  throw new Error('A busca não terminou após várias rodadas.');
}

function lerJson(resp) {
  const textos = resp.content.filter((b) => b.type === 'text').map((b) => b.text);
  for (let k = textos.length - 1; k >= 0; k--) {
    for (const t of [textos[k], textos.slice(k).join('')]) {
      try {
        return JSON.parse(t);
      } catch {
        // tenta o próximo recorte
      }
    }
  }
  throw new Error('Resposta do modelo sem JSON válido.');
}

function lotes(xs, n) {
  const out = [];
  for (let k = 0; k < xs.length; k += n) out.push(xs.slice(k, k + n));
  return out;
}

const listar = (refs) => refs.map((r) => `[${r.n}] ${r.texto}`).join('\n\n');

// ---------- Revisão ABNT ----------

const SISTEMA_REVISAO = `Você revisa referências bibliográficas de trabalhos acadêmicos do Insper segundo a ABNT NBR 6023:2018 e o manual da Biblioteca Telles.

Para cada referência numerada, aponte os desvios de forma: ordem e pontuação dos elementos; autoria como SOBRENOME, Prenome (até três autores; com mais de três, o primeiro seguido de et al.); local: editora, ano para livros; título do periódico, volume, número, páginas e data para artigos; "Disponível em:" seguido do endereço e "Acesso em:" com dia, mês abreviado e ano para documentos online; elementos essenciais ausentes.

Exemplos do manual:
PORTER, Michael E. Estratégia competitiva: técnicas para análise de indústrias e da concorrência. 2. ed. Rio de Janeiro: Elsevier, 2004. 409 p.
BARNETT, M. L.; SALOMON, R. M. Does it pay to be really good? Addressing the shape of the relationship between social and financial performance. Strategic Management Journal, v. 33, n. 11, p. 1304-1320, 2012.
ULRICH, Fernando. Bitcoin: a moeda na era digital. São Paulo: Instituto Ludwig von Mises Brasil, 2014. 122 p. Disponível em: https://bit.ly/3n4N4u5. Acesso em: 20 mar. 2016.

O texto chega sem formatação, então não comente negrito ou itálico. Não julgue se a obra existe; isso é verificado em outra etapa.

Em "sugestao", reescreva a referência no padrão usando apenas dados presentes no original. Para elemento essencial ausente, use um marcador entre colchetes, como [local], [editora] ou [ano], sem inventar o dado. Se a referência já estiver correta, devolva "problemas" vazio e "sugestao" vazia. Escreva os problemas em português, de forma curta.`;

const ESQUEMA_REVISAO = {
  type: 'object',
  properties: {
    referencias: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          n: { type: 'integer' },
          problemas: { type: 'array', items: { type: 'string' } },
          sugestao: { type: 'string' },
        },
        required: ['n', 'problemas', 'sugestao'],
        additionalProperties: false,
      },
    },
  },
  required: ['referencias'],
  additionalProperties: false,
};

export async function revisarReferencias(cliente, Anthropic, refs, { uso, aoProgredir } = {}) {
  const out = new Map();
  const grupos = lotes(refs, CLAUDE.refsPorLoteRevisao);
  let feitos = 0;
  await Promise.all(grupos.map(async (g) => {
    const { resp } = await enviar(cliente, Anthropic, {
      model: CLAUDE.modelo,
      max_tokens: CLAUDE.maxTokens,
      output_config: { effort: CLAUDE.esforco, format: { type: 'json_schema', schema: ESQUEMA_REVISAO } },
      system: SISTEMA_REVISAO,
      messages: [{ role: 'user', content: `Referências:\n\n${listar(g)}` }],
    }, uso);
    for (const r of lerJson(resp).referencias) out.set(r.n, { problemas: r.problemas, sugestao: r.sugestao });
    feitos += g.length;
    aoProgredir?.(feitos, refs.length);
  }));
  return out;
}

// ---------- Busca na web ----------

const SISTEMA_BUSCA = `Você confere se referências bibliográficas citadas em um TCC existem de fato. Elas não foram encontradas na Crossref, então costumam ser livros, documentos brasileiros, relatórios ou páginas da internet.

Para cada referência numerada, pesquise na web (catálogos de editoras, Google Books, bibliotecas, SciELO, repositórios institucionais, sites oficiais) e classifique:
- "encontrada": uma fonte confiável mostra esta obra com o mesmo título e a mesma autoria. Ano e edição podem variar.
- "divergente": existe obra parecida, mas autoria, título ou ano não conferem. Diga o que diverge.
- "nao_encontrada": nenhuma evidência após buscas razoáveis. Isso é um sinal de que a referência pode ter sido inventada ou copiada com erro.

Em "evidencia_url", copie exatamente a URL de um resultado de busca que sustenta a classificação; deixe vazia quando não houver. Use somente URLs que apareceram nos resultados das suas buscas. Em "titulo_encontrado", copie o título como aparece na fonte. Em "observacao", explique em uma frase curta, em português.

Quando terminar as buscas, registre a classificação de todas as referências numa única chamada à ferramenta registrar_resultados.`;

const ESQUEMA_BUSCA = {
  type: 'object',
  properties: {
    resultados: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          n: { type: 'integer' },
          status: { type: 'string', enum: ['encontrada', 'divergente', 'nao_encontrada'] },
          evidencia_url: { type: 'string' },
          titulo_encontrado: { type: 'string' },
          observacao: { type: 'string' },
        },
        required: ['n', 'status', 'evidencia_url', 'titulo_encontrado', 'observacao'],
        additionalProperties: false,
      },
    },
  },
  required: ['resultados'],
  additionalProperties: false,
};

// A busca na web sempre gera citações, que são incompatíveis com output_config.format; por isso
// o resultado volta por uma ferramenta com esquema estrito. A entrada é pequena, então não há
// ganho em eager_input_streaming, que desligaria a validação do esquema pela API.
const FERRAMENTA_RESULTADOS = {
  name: 'registrar_resultados',
  description: 'Registra a classificação final de cada referência. Chame uma única vez, depois de terminar as buscas.',
  strict: true,
  input_schema: ESQUEMA_BUSCA,
};

// Forma comparável de uma URL: sem protocolo, "www.", fragmento e barra final.
const chaveUrl = (u) => {
  try {
    const x = new URL(u);
    return `${x.hostname.replace(/^www\./, '')}${decodeURI(x.pathname).replace(/\/$/, '')}${x.search}`.toLowerCase();
  } catch {
    return String(u).toLowerCase();
  }
};

// URLs que de fato vieram nos resultados da busca (para conferir a evidência citada).
function urlsDaBusca(blocos) {
  const urls = new Set();
  for (const b of blocos) {
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) for (const r of b.content) if (r.url) urls.add(chaveUrl(r.url));
  }
  return urls;
}

const chamadaResultados = (blocos) => blocos.find((b) => b.type === 'tool_use' && b.name === FERRAMENTA_RESULTADOS.name);

export async function buscarNaWeb(cliente, Anthropic, refs, { uso, aoProgredir } = {}) {
  const out = new Map();
  let feitos = 0;
  const grupos = lotes(refs, CLAUDE.refsPorLoteBusca);
  // Dois lotes por vez, para não estourar o limite de requisições de chaves novas.
  for (const fatia of lotes(grupos, 2)) {
    await Promise.all(fatia.map(async (g) => {
      const params = {
        model: CLAUDE.modelo,
        max_tokens: CLAUDE.maxTokens,
        output_config: { effort: CLAUDE.esforco },
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 * g.length }, FERRAMENTA_RESULTADOS],
        system: SISTEMA_BUSCA,
        messages: [{ role: 'user', content: `Referências:\n\n${listar(g)}` }],
      };
      let { blocos, mensagens, resp } = await enviar(cliente, Anthropic, params, uso);
      let chamada = chamadaResultados(blocos);
      if (!chamada) {
        // O modelo terminou sem registrar: pede o registro uma vez.
        const lembrete = [...mensagens, { role: 'assistant', content: resp.content }, { role: 'user', content: 'Registre agora a classificação de todas as referências com a ferramenta registrar_resultados.' }];
        const extra = await enviar(cliente, Anthropic, { ...params, messages: lembrete }, uso);
        blocos = [...blocos, ...extra.blocos];
        chamada = chamadaResultados(blocos);
      }
      if (!chamada) throw new Error('O modelo não registrou o resultado da busca.');
      const vistas = urlsDaBusca(blocos);
      for (const r of chamada.input.resultados || []) {
        const comprovada = !r.evidencia_url || vistas.has(chaveUrl(r.evidencia_url));
        out.set(r.n, comprovada ? r : { ...r, status: 'incerta', observacao: `${r.observacao} (O link indicado não veio dos resultados da busca; confira manualmente.)` });
      }
      feitos += g.length;
      aoProgredir?.(feitos, refs.length);
    }));
  }
  return out;
}

// Preços por milhão de tokens e por mil buscas (estimativa; confira a tabela da Anthropic).
export function custoEstimado(uso) {
  return (uso.entrada * 4 + uso.saida * 20) / 1e6 + (uso.buscas * 10) / 1000;
}
