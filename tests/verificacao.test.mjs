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

// Casos reais dos TCCs auditados (registros como vieram da Crossref).
test('casos reais: obras diferentes, autoria trocada, resenha, coautores e edição', async () => {
  const { comparar } = await import('../src/verificacao.js');
  const cand = (titulo, sobrenomes, ano, livro = false) => ({ titulo, sobrenomes, ano, livro, base: 'Crossref' });
  const status = (texto, c) => comparar(ref(texto), c).status;

  // Mesmo título principal, subtítulos diferentes: obras diferentes.
  assert.equal(status('BBVA SPARK. Financial inclusion in Latin America: Fintech entrepreneurship to drive financial inclusion in Latin America. Madrid: BBVA, 2024.',
    cand('Financial Inclusion in Latin America: Facts and Obstacles', ['Rojas-Suarez'], 2016)), null);
  // Título parecido, outra obra: não acusa autoria trocada.
  assert.equal(status('COSTA, Duilio. Fatores que influenciam o spread das debêntures no Brasil. 2009. Dissertação (Mestrado) – FGV, São Paulo, 2009.',
    cand('Fatores que influenciam o spread em emissão primária de debêntures no Brasil', ['Neves da Silva'], 2021)), null);
  // Título idêntico com outra autoria: sinal de referência inventada.
  const trocada = comparar(ref('KRISTOFFERSSON, J.; BÖRJESSON, M. Building acceptance for congestion charges – The Swedish experiences compared. Transport Policy, v. 49, p. 20–29, 2016.'),
    cand('Building acceptance for congestion charges – the Swedish experiences compared', ['Hysing', 'Isaksson'], 2015));
  assert.equal(trocada.status, 'divergente');
  assert.match(trocada.notas[0], /outra autoria/);
  // Resenha do livro confirma a obra.
  assert.equal(status('SUTTON, R. S.; BARTO, A. G. Reinforcement Learning: An Introduction. 2. ed. Cambridge, MA: MIT Press, 2018.',
    cand('Reinforcement Learning: An Introduction; R.S. Sutton, A.G. Barto (Eds.); MIT Press, Cambridge, MA, 1998, 380 pages', ['Rao'], 2000)), 'verificada');
  // Primeiro autor certo, coautores inventados.
  const coautores = comparar(ref('NAKAMURA, Felipe; BARBOSA, Lucas; MARTINS, André. The new era of Brazilian football and clubs managed as a business. Revista X, v. 1, n. 1, 2021.'),
    cand('The New Era of Brazilian Football and Clubs Managed as a Business', ['Nakamura', 'Cerqueira'], 2021));
  assert.equal(coautores.status, 'divergente');
  assert.match(coautores.notas[0], /coautores/);
  // Livro em outra edição: verificado, com aviso.
  const edicao = comparar(ref('GILLIGAN, John; WRIGHT, Mike. Private Equity Demystified: An Explanatory Guide. 3. ed. Londres: ICAEW, 2014.'),
    cand('Private Equity Demystified: An Explanatory Guide', ['Gilligan', 'Wright'], 2020, true));
  assert.equal(edicao.status, 'verificada');
  assert.match(edicao.notas[0], /outra edição/);
  // Referência institucional casada com artigo que só cita a instituição: não verifica.
  assert.equal(status('CET – Companhia de Engenharia de Tráfego. Relatórios Anuais de Mobilidade. São Paulo, diversas edições.',
    cand('Estratégia e estrutura em empresas de mobilidade urbana: o caso da Companhia de Engenharia de Tráfego', ['Silva'], 2015)), null);
});

test('casos reais: letras especiais, verificação sem autor e ano de artigo no prelo', async () => {
  const { comparar } = await import('../src/verificacao.js');
  const cand = (titulo, sobrenomes, ano, extra = {}) => ({ titulo, sobrenomes, ano, livro: false, base: 'Crossref', ...extra });
  // "Çakıroğlu" (ı sem pingo) e "ÇAKIROĞLU" são o mesmo sobrenome.
  assert.equal(comparar(ref('ERASLAN, Ali; ÇAKIROĞLU, Temel. Examination of sporting successes of European football clubs. Journal X, v. 1, 2024.'),
    cand('Examination of Sporting Successes of European Football Clubs', ['Eraslan', 'Çakıroğlu'], 2024)).status, 'verificada');
  // Registro sem autores cujo título só aparece espalhado no texto (revista, instituição): não verifica.
  assert.equal(comparar(ref('ANDRADE, S.; CRESCENTINI, F. Return dispersion in emerging private equity funds. Emerging Markets Review, v. 45, 2020.'),
    cand('Private Equity in the Emerging Markets', [], null)).status, null);
  assert.equal(comparar(ref('LORENZO, Manuela Fortes. Financial technology: essays on the impact of Pix on Brazilian society. 2024. Tese (Doutorado) – Escola Brasileira de Administração Pública da Fundação Getúlio Vargas, Rio de Janeiro, 2024.'),
    cand('Escola Brasileira de Administração Pública da Fundação Getúlio Vargas', ['Siqueira'], 2010)).status, null);
  // Ano do volume impresso (2026) e ano online no DOI (2024).
  assert.equal(comparar(ref('TEBALDI, Raquel; GASSMANN, Franziska. Re-election incentives and early childhood programmes. European Journal of Political Economy, v. 85, 2024.'),
    cand('Re-election incentives and early childhood programmes', ['Tebaldi', 'Gassmann'], 2026, { anos: [2026, 2024] })).status, 'verificada');
});
