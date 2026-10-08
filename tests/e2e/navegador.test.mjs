// Teste de ponta a ponta no Chromium: página real, bibliotecas do CDN, Crossref real e
// API da Anthropic simulada. Requer rede. Uso: npm run test:e2e
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { CABECALHOS, responder } from '../simulador-anthropic.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };

function servidor() {
  const s = http.createServer((req, res) => {
    const arq = path.join(RAIZ, decodeURIComponent(new URL(req.url, 'http://x').pathname === '/' ? '/index.html' : new URL(req.url, 'http://x').pathname));
    if (!arq.startsWith(RAIZ) || !fs.existsSync(arq)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TIPOS[path.extname(arq)] || 'application/octet-stream' });
    fs.createReadStream(arq).pipe(res);
  });
  return new Promise((ok) => s.listen(0, '127.0.0.1', () => ok(s)));
}

async function abrir(t) {
  const srv = await servidor();
  const navegador = await chromium.launch();
  const pagina = await navegador.newPage();
  const erros = [];
  pagina.on('pageerror', (e) => erros.push(e.message));
  const pedidosApi = [];
  await pagina.route('https://api.anthropic.com/**', async (rota) => {
    const corpo = JSON.parse(rota.request().postData());
    pedidosApi.push({ corpo, cabecalhos: rota.request().headers() });
    await rota.fulfill({ status: 200, headers: CABECALHOS, body: responder(corpo) });
  });
  t.after(async () => { await navegador.close(); srv.close(); });
  await pagina.goto(`http://127.0.0.1:${srv.address().port}/`);
  return { pagina, erros, pedidosApi };
}

async function verificar(pagina, arquivo, chave = '') {
  await pagina.setInputFiles('#arquivo', path.join(RAIZ, 'tests/fixtures', arquivo));
  await pagina.fill('#chave', chave);
  await pagina.click('#verificar');
  await pagina.waitForSelector('#resultado:not([hidden])', { timeout: 120000 });
}

test('docx com problemas, com chave: aponta erros e marca o DOI inventado', { timeout: 180000 }, async (t) => {
  const { pagina, erros, pedidosApi } = await abrir(t);
  await verificar(pagina, 'tcc_problemas.docx', 'sk-ant-teste');
  const achados = await pagina.textContent('#achados');
  assert.match(achados, /Margens/);
  assert.match(achados, /SILVA \(2019\)/);
  const refs = await pagina.$$eval('#referencias .ref', (els) => els.map((e) => e.querySelector('.topo').textContent.replace(/\s+/g, ' ').trim()));
  assert.equal(refs.length, 4);
  assert.match(refs[0], /Verificada/); // Why nations fail, por resenha na Crossref
  assert.match(refs[1], /Verificada/); // DOI real
  assert.match(refs[2], /DOI inexistente/);
  assert.match(refs[3], /Encontrada na web/); // World Bank, via busca simulada
  assert.match(await pagina.textContent('#referencias'), /Falta o local de publicação/);
  assert.match(await pagina.textContent('#custo'), /Custo estimado/);
  assert.ok(pedidosApi.some((p) => p.corpo.tools) && pedidosApi.some((p) => !p.corpo.tools));
  assert.equal(pedidosApi[0].cabecalhos['x-api-key'], 'sk-ant-teste');
  assert.equal(pedidosApi[0].cabecalhos['anthropic-dangerous-direct-browser-access'], 'true');
  assert.deepEqual(erros, []);
});

test('pdf conforme, sem chave: nenhum problema e nenhuma chamada à API', { timeout: 180000 }, async (t) => {
  const { pagina, erros, pedidosApi } = await abrir(t);
  await verificar(pagina, 'tcc_conforme.pdf');
  const selos = await pagina.$$eval('#achados > .item .selo', (els) => els.map((e) => e.textContent));
  assert.deepEqual(selos, ['Conferir']); // só o aviso de que recuo e citações longas exigem o .docx
  assert.equal(await pagina.$$eval('#referencias .ref', (els) => els.length), 3);
  assert.match(await pagina.textContent('#custo'), /Sem chave/);
  assert.equal(pedidosApi.length, 0);
  assert.deepEqual(erros, []);
});
