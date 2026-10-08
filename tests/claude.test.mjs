// Integração com o SDK da Anthropic usando respostas SSE simuladas (sem chave real).
import test from 'node:test';
import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';
import { criarCliente, revisarReferencias, buscarNaWeb } from '../src/claude.js';
import { CABECALHOS, corpoSse, responder, numerosDoPedido } from './simulador-anthropic.mjs';

const refs = [1, 2, 3].map((n) => ({ n, texto: `AUTOR${n}, Nome. Obra ${n}. São Paulo: Editora, 2020.` }));

function cliente(gerar) {
  const pedidos = [];
  const fetch = async (url, init) => {
    const corpo = JSON.parse(init.body);
    pedidos.push({ url: String(url), corpo, beta: init.headers?.['anthropic-beta'] ?? new Headers(init.headers).get('anthropic-beta') });
    const r = gerar(corpo, pedidos.length);
    return r instanceof Response ? r : new Response(r, { status: 200, headers: CABECALHOS });
  };
  return { c: criarCliente(Anthropic, 'sk-ant-teste', { fetch, maxRetries: 0 }), pedidos };
}

test('revisão: envia modelo, esforço, esquema e fallback; lê o JSON', async () => {
  const { c, pedidos } = cliente(responder);
  const uso = { entrada: 0, saida: 0, buscas: 0 };
  const out = await revisarReferencias(c, Anthropic, refs, { uso });
  assert.deepEqual(out.get(1).problemas, ['Falta o local de publicação.']);
  assert.deepEqual(out.get(2).problemas, []);
  const { corpo, beta } = pedidos[0];
  assert.equal(corpo.model, 'claude-opus-5-5');
  assert.equal(corpo.output_config.effort, 'medium');
  assert.equal(corpo.output_config.format.type, 'json_schema');
  assert.equal(corpo.fallbacks, 'default');
  assert.match(beta, /server-side-fallback-2026-07-01/);
  assert.equal(corpo.thinking, undefined);
  assert.ok(uso.entrada > 0 && uso.saida > 0);
});

test('revisão: se a API recusar o fallback (400), repete sem ele', async () => {
  const { c, pedidos } = cliente((corpo, k) => (k === 1
    ? new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'x' } }), { status: 400, headers: { 'content-type': 'application/json' } })
    : responder(corpo)));
  const out = await revisarReferencias(c, Anthropic, refs, { uso: { entrada: 0, saida: 0, buscas: 0 } });
  assert.equal(out.size, 3);
  assert.equal(pedidos.length, 2);
  assert.equal(pedidos[1].corpo.fallbacks, undefined);
});

test('busca na web: usa a ferramenta e aceita só evidências vistas nos resultados', async () => {
  const { c, pedidos } = cliente((corpo) => {
    const ns = numerosDoPedido(corpo);
    const resultados = [
      { n: ns[0], status: 'encontrada', evidencia_url: 'https://editora.com.br/obra-1', titulo_encontrado: 'Obra 1', observacao: 'Catálogo.' },
      { n: ns[1], status: 'encontrada', evidencia_url: 'https://inventada.com/obra-2', titulo_encontrado: 'Obra 2', observacao: 'Catálogo.' },
      { n: ns[2], status: 'nao_encontrada', evidencia_url: '', titulo_encontrado: '', observacao: 'Nada encontrado.' },
    ];
    return corpoSse([{ type: 'web_search', query: 'obra', urls: ['https://editora.com.br/obra-1'] }, { type: 'text', text: JSON.stringify({ resultados }) }], { buscas: 3 });
  });
  const uso = { entrada: 0, saida: 0, buscas: 0 };
  const out = await buscarNaWeb(c, Anthropic, refs, { uso });
  assert.equal(out.get(1).status, 'encontrada');
  assert.equal(out.get(2).status, 'incerta');
  assert.equal(out.get(3).status, 'nao_encontrada');
  assert.equal(uso.buscas, 3);
  assert.equal(pedidos[0].corpo.tools[0].type, 'web_search_20260209');
});

test('busca na web: retoma turno pausado (pause_turn)', async () => {
  const { c, pedidos } = cliente((corpo, k) => (k === 1
    ? corpoSse([{ type: 'web_search', query: 'obra', urls: ['https://a.org'] }], { stop_reason: 'pause_turn', buscas: 1 })
    : responder(corpo)));
  const out = await buscarNaWeb(c, Anthropic, refs, { uso: { entrada: 0, saida: 0, buscas: 0 } });
  assert.equal(out.size, 3);
  assert.equal(pedidos.length, 2);
  assert.equal(pedidos[1].corpo.messages.at(-1).role, 'assistant');
});

test('recusa do modelo vira erro legível', async () => {
  const { c } = cliente(() => corpoSse([{ type: 'text', text: '' }], { stop_reason: 'refusal' }));
  await assert.rejects(revisarReferencias(c, Anthropic, refs, { uso: { entrada: 0, saida: 0, buscas: 0 } }), /recusou/);
});
