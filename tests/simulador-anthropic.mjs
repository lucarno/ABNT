// Respostas simuladas da API de mensagens da Anthropic, em SSE, para testes sem chave.

function sse(eventos) {
  return eventos.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
}

// blocos: [{ type: 'text', text } | { type: 'web_search', query, urls: [...] }]
export function corpoSse(blocos, { stop_reason = 'end_turn', buscas = 0 } = {}) {
  const ev = [{
    type: 'message_start',
    message: { id: 'msg_teste', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 1 } },
  }];
  let i = 0;
  for (const b of blocos) {
    if (b.type === 'text') {
      ev.push({ type: 'content_block_start', index: i, content_block: { type: 'text', text: '' } });
      ev.push({ type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: b.text } });
      ev.push({ type: 'content_block_stop', index: i++ });
    } else {
      const id = `srvtoolu_${i}`;
      ev.push({ type: 'content_block_start', index: i, content_block: { type: 'server_tool_use', id, name: 'web_search', input: {} } });
      ev.push({ type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ query: b.query }) } });
      ev.push({ type: 'content_block_stop', index: i++ });
      ev.push({
        type: 'content_block_start',
        index: i,
        content_block: { type: 'web_search_tool_result', tool_use_id: id, content: b.urls.map((url) => ({ type: 'web_search_result', url, title: 'Resultado', encrypted_content: 'x', page_age: null })) },
      });
      ev.push({ type: 'content_block_stop', index: i++ });
    }
  }
  ev.push({ type: 'message_delta', delta: { stop_reason, stop_sequence: null }, usage: { output_tokens: 500, server_tool_use: { web_search_requests: buscas } } });
  ev.push({ type: 'message_stop' });
  return sse(ev);
}

export const CABECALHOS = {
  'content-type': 'text/event-stream',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
};

// Números das referências presentes no pedido ("[3] SOBRENOME...").
export const numerosDoPedido = (corpo) => [...corpo.messages[0].content.matchAll(/^\[(\d+)\]/gm)].map((m) => Number(m[1]));

// Resposta padrão: revisão sem tools; busca com tools (cada referência "encontrada" com URL vista na busca).
export function responder(corpo) {
  const ns = numerosDoPedido(corpo);
  if (corpo.tools) {
    const urls = ns.map((n) => `https://exemplo.org/obra-${n}`);
    const resultados = ns.map((n, k) => ({ n, status: 'encontrada', evidencia_url: urls[k], titulo_encontrado: `Obra ${n}`, observacao: 'Catálogo da editora.' }));
    return corpoSse([{ type: 'web_search', query: 'busca', urls }, { type: 'text', text: JSON.stringify({ resultados }) }], { buscas: 1 });
  }
  const referencias = ns.map((n) => ({ n, problemas: n === 1 ? ['Falta o local de publicação.'] : [], sugestao: n === 1 ? 'SOBRENOME, Nome. Título. [local]: Editora, 2020.' : '' }));
  return corpoSse([{ type: 'text', text: JSON.stringify({ referencias }) }]);
}
