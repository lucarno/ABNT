import test from 'node:test';
import assert from 'node:assert/strict';
import { analisarReferencia, extrairCitacoes, cruzar, agruparLinhasPdf } from '../src/referencias.js';
import { similaridadeTitulo } from '../src/texto.js';

test('analisa referências do manual da Biblioteca Telles', () => {
  const livro = analisarReferencia('CHURCHILL JUNIOR, Gilbert A.; PETER, J. Paul. Marketing: criando valor para os clientes. 3. ed. São Paulo: Saraiva, 2012. 636 p.');
  assert.equal(livro.autor, 'CHURCHILL JUNIOR');
  assert.equal(livro.titulo, 'Marketing: criando valor para os clientes');
  assert.deepEqual(livro.anos, [2012]);
  assert.equal(livro.tipo, 'livro');

  const iniciais = analisarReferencia('BARNETT, M. L.; SALOMON, R. M. Does it pay to be really good? Addressing the shape. Strategic Management Journal, v. 33, n. 11, p. 1304-1320, 2012.');
  assert.equal(iniciais.titulo, 'Does it pay to be really good');
  assert.equal(iniciais.tipo, 'artigo');

  const etal = analisarReferencia('ASATO, Regina et al. Alinhamento entre estratégia de negócios e melhoria de processos. Produção, v. 21, n. 2, p. 314-328, 2011.');
  assert.equal(etal.titulo, 'Alinhamento entre estratégia de negócios e melhoria de processos');

  const org = analisarReferencia('BARROSO, João Rodrigues (coord.). Globalização e identidade nacional. São Paulo: Atlas, 1999. 185 p.');
  assert.equal(org.titulo, 'Globalização e identidade nacional');

  const semAutor = analisarReferencia('ORIGENS e trajetória da indústria farmacêutica no Brasil. São Paulo: Narrativa Um, 2007. 192 p.');
  assert.equal(semAutor.titulo, 'ORIGENS e trajetória da indústria farmacêutica no Brasil');

  const lei = analisarReferencia('BRASIL. Lei nº 9610, de 19 de fevereiro de 1998. Altera a legislação sobre direitos autorais. Disponível em: http://www.planalto.gov.br/. Acesso em: 11 ago. 2014.');
  assert.equal(lei.tipo, 'legislacao');
  assert.deepEqual(lei.urls, ['http://www.planalto.gov.br/']);

  const doi = analisarReferencia('ACEMOGLU, Daron. Título. American Economic Review, v. 91, n. 5, 2001. DOI: 10.1257/aer.91.5.1369.');
  assert.equal(doi.doi, '10.1257/aer.91.5.1369');

  const anterior = analisarReferencia('ULRICH, Fernando. Bitcoin: a moeda na era digital. São Paulo: Mises, 2014.');
  const repetido = analisarReferencia('______. Outro livro. São Paulo: Mises, 2015.', anterior);
  assert.equal(repetido.autor, 'ULRICH');
});

test('extrai citações autor-data, inclusive múltiplas e "citado por"', () => {
  const t = 'Texto (Churchill Junior; Peter, 2012, p. 8). Outro (SILVA, 2019, 2020; Lima, 2021). '
    + 'Ideia (Simon, 1960 citado por Mintzberg; Ahlstrand; Lampel, 2010, p. 161). '
    + 'Segundo Osterwalder e Pigneur (2011), algo. Para Fritz et al. (1999, p. 35), algo. Na Tabela 1 (2020) nada.';
  const cs = extrairCitacoes(t).map((c) => `${c.autor}|${c.ano}`);
  for (const esperado of ['Churchill Junior|2012', 'SILVA|2019', 'SILVA|2020', 'Lima|2021', 'Mintzberg|2010', 'Osterwalder e Pigneur|2011', 'Fritz|1999']) {
    assert.ok(cs.includes(esperado), `faltou ${esperado} em ${cs.join(', ')}`);
  }
  assert.ok(!cs.some((c) => c.startsWith('Simon')), 'citação de citação: só a obra consultada vai para as referências');
  assert.ok(!cs.some((c) => c.includes('Tabela')));
});

test('cruza citações e referências', () => {
  const refs = [
    'CHURCHILL JUNIOR, Gilbert A.; PETER, J. Paul. Marketing. São Paulo: Saraiva, 2012.',
    'NORTH, Douglass C. Institutions. Cambridge: CUP, 1990.',
    'INSTITUTO BRASILEIRO DE GEOGRAFIA E ESTATÍSTICA (IBGE). Censo. Rio de Janeiro: IBGE, 2022.',
  ].map((t, k) => ({ n: k + 1, ...analisarReferencia(t) }));
  const cs = extrairCitacoes('Como em Churchill Junior e Peter (2012) e no censo (IBGE, 2022). Também (Souza, 2018).');
  const { semReferencia, naoCitadas } = cruzar(cs, refs);
  assert.deepEqual(semReferencia.map((c) => c.autor), ['Souza']);
  assert.deepEqual(naoCitadas.map((r) => r.n), [2]);
});

test('separa referências de PDF pela linha em branco', () => {
  const l = (texto, topo) => ({ texto, topo, pagina: 1 });
  const grupos = agruparLinhasPdf([
    l('ACEMOGLU, Daron. Why nations fail: the origins of power,', 100),
    l('prosperity, and poverty. New York: Crown, 2012.', 114),
    l('NORTH, Douglass C. Institutions. Cambridge: CUP, 1990.', 142),
    l('PORTER, Michael E. Estratégia compe-', 170),
    l('titiva. Rio de Janeiro: Elsevier, 2004.', 184),
  ]);
  assert.equal(grupos.length, 3);
  assert.match(grupos[0], /power, prosperity/);
  assert.match(grupos[2], /competitiva/);
});

test('similaridade de títulos: subtítulo omitido conta, palavras parecidas em outra ordem não', () => {
  assert.ok(similaridadeTitulo('Why nations fail: the origins of power, prosperity, and poverty', 'Why Nations Fail') >= 0.75);
  assert.ok(similaridadeTitulo('Instituições e crescimento no Brasil contemporâneo', 'Crescimento econômico e instituições no Brasil: o esforço para reformar leis') < 0.75);
});
