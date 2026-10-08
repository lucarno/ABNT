// Verificação na Crossref/DataCite com respostas simuladas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analisarReferencia } from '../src/referencias.js';
import { verificarReferencia } from '../src/verificacao.js';

const json = (corpo, status = 200, cab = {}) => new Response(corpo === null ? 'not found' : JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json', ...cab } });
const item = (titulo, familias, ano, doi = '10.1/x') => ({ DOI: doi, title: [titulo], author: familias.map((family) => ({ family })), issued: { 'date-parts': [[ano]] } });

function falso(rotas) {
  const chamadas = [];
  const f = async (url) => {
    chamadas.push(url);
    for (const [padrao, resp] of rotas) if (padrao.test(url)) return typeof resp === 'function' ? resp() : resp.clone();
    throw new Error(`sem rota para ${url}`);
  };
  f.chamadas = chamadas;
  return f;
}

const ref = (t) => ({ n: 1, ...analisarReferencia(t) });
const ARTIGO = 'ACEMOGLU, Daron; JOHNSON, Simon; ROBINSON, James A. The colonial origins of comparative development: an empirical investigation. American Economic Review, v. 91, n. 5, p. 1369-1401, 2001.';

test('DOI inexistente na Crossref e na DataCite', async () => {
  const f = falso([[/crossref/, json(null, 404)], [/datacite/, json(null, 404)]]);
  const v = await verificarReferencia(ref(`${ARTIGO} DOI: 10.1234/falso.1.`), { fetch: f });
  assert.equal(v.status, 'doi_inexistente');
});

test('DOI que pertence a outra obra', async () => {
  const f = falso([[/works\/10/, json({ message: item('A completely different paper', ['Smith'], 2001) })], [/query/, json({ message: { items: [] } })]]);
  const v = await verificarReferencia(ref(`${ARTIGO} DOI: 10.1257/aer.91.5.1369.`), { fetch: f });
  assert.equal(v.status, 'doi_divergente');
});

test('DOI com erro de digitação: a obra existe com outro DOI', async () => {
  const certo = item('The Colonial Origins of Comparative Development', ['Acemoglu', 'Johnson', 'Robinson'], 2001, '10.1257/aer.91.5.1369');
  const f = falso([[/works\/10/, json(null, 404)], [/datacite/, json(null, 404)], [/query/, json({ message: { items: [certo] } })]]);
  const v = await verificarReferencia(ref(`${ARTIGO} DOI: 10.1257/aer.91.5.1396.`), { fetch: f });
  assert.equal(v.status, 'doi_incorreto');
  assert.match(v.nota, /10\.1257\/aer\.91\.5\.1369/);
});

test('DOI registrado na DataCite', async () => {
  const dc = { data: { attributes: { doi: '10.5281/zenodo.1', titles: [{ title: 'The colonial origins of comparative development' }], creators: [{ familyName: 'Acemoglu' }], publicationYear: 2001 } } };
  const f = falso([[/crossref/, json(null, 404)], [/datacite/, json(dc)]]);
  const v = await verificarReferencia(ref(`${ARTIGO} DOI: 10.5281/zenodo.1.`), { fetch: f });
  assert.equal(v.status, 'verificada');
  assert.equal(v.encontrado.base, 'DataCite');
});

test('busca bibliográfica: verificada, autoria trocada e não localizada', async () => {
  const resp = json({ message: { items: [item('The Colonial Origins of Comparative Development', ['Acemoglu', 'Johnson', 'Robinson'], 2001)] } });
  assert.equal((await verificarReferencia(ref(ARTIGO), { fetch: falso([[/query/, resp]]) })).status, 'verificada');

  const trocada = ARTIGO.replace('ACEMOGLU, Daron; JOHNSON, Simon; ROBINSON, James A.', 'SMITH, John.');
  const v = await verificarReferencia(ref(trocada), { fetch: falso([[/query/, resp]]) });
  assert.equal(v.status, 'divergente');
  assert.match(v.nota, /autoria/);

  const vazio = json({ message: { items: [item('Something else entirely', ['Doe'], 2015)] } });
  assert.equal((await verificarReferencia(ref(ARTIGO), { fetch: falso([[/query/, vazio]]) })).status, 'nao_localizada');
});

test('livro confirmado por resenha publicada', async () => {
  const resenha = item('Acemoglu, Daron & James R. Robinson. Why Nations Fail: the origins of power, prosperity and poverty. New York: Crown, 2012.', ['Korstanje'], 2015);
  const f = falso([[/query/, json({ message: { items: [resenha] } })]]);
  const v = await verificarReferencia(ref('ACEMOGLU, Daron; ROBINSON, James A. Why nations fail: the origins of power, prosperity, and poverty. New York: Crown Business, 2012.'), { fetch: f });
  assert.equal(v.status, 'verificada');
  assert.match(v.nota, /resenha/);
});

test('repete após 429 da Crossref', async () => {
  let n = 0;
  const f = falso([[/query/, () => (n++ === 0 ? json({}, 429, { 'retry-after': '0' }) : json({ message: { items: [] } }))]]);
  const v = await verificarReferencia(ref(ARTIGO), { fetch: f });
  assert.equal(v.status, 'nao_localizada');
  assert.equal(f.chamadas.length, 2);
});

test('legislação não é consultada', async () => {
  const f = falso([]);
  const v = await verificarReferencia(ref('BRASIL. Lei nº 9610, de 19 de fevereiro de 1998. Altera a legislação. Brasília, DF, 1998.'), { fetch: f });
  assert.equal(v.status, 'nao_aplicavel');
  assert.equal(f.chamadas.length, 0);
});
