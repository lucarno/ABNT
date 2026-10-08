// Leitura dos TCCs de teste (tests/fixtures/gerar.py) e checagens determinísticas.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { lerDocx } from '../src/docx.js';
import { lerPdf } from '../src/pdf.js';
import { analisar } from '../src/checagens.js';

const fixture = (nome) => fs.readFileSync(new URL(`./fixtures/${nome}`, import.meta.url));
const ler = (nome) => (nome.endsWith('.pdf') ? lerPdf(fixture(nome), pdfjs) : lerDocx(fixture(nome), { JSZip, DOMParser }));
const problemas = (r) => r.achados.filter((a) => a.status === 'erro' || a.status === 'alerta').map((a) => `${a.status}:${a.grupo}:${a.item}`);

for (const ext of ['docx', 'pdf']) {
  test(`TCC conforme (.${ext}) não tem erros nem alertas`, async () => {
    const r = analisar(await ler(`tcc_conforme.${ext}`));
    assert.deepEqual(problemas(r), []);
    assert.equal(r.refs.length, 3);
    assert.deepEqual(r.cruzamento.semReferencia, []);
    assert.deepEqual(r.cruzamento.naoCitadas, []);
  });
}

test('lê formatação efetiva do .docx', async () => {
  const doc = await ler('tcc_conforme.docx');
  const p = doc.paragrafos.find((x) => x.texto.startsWith('Segundo Acemoglu'));
  assert.equal(p.fonte, 'Times New Roman');
  assert.equal(p.tamanho, 12);
  assert.equal(p.entrelinha, 1.5);
  assert.equal(p.alinhamento, 'justificado');
  assert.ok(Math.abs(p.recuoPrimeiraCm - 1.25) < 0.01);
  assert.deepEqual(doc.numeracao, { local: 'cabecalho', alinhamento: 'direita', tamanho: 10 });
  const ultima = doc.secoes.at(-1);
  assert.ok(Math.abs(ultima.margens.sup - 3) < 0.01 && Math.abs(ultima.margens.dir - 2) < 0.01);
});

const ESPERADOS_DOCX = [
  'erro:Estrutura:Abstract',
  'erro:Página:Margens',
  'erro:Página:Numeração de páginas',
  'alerta:Página:Tamanho do número de página',
  'erro:Texto:Fonte (Arial ou Times New Roman)',
  'erro:Texto:Tamanho 12 no texto',
  'erro:Texto:Entrelinha 1,5',
  'erro:Texto:Recuo de 1,25 cm na primeira linha',
  'erro:Texto:Sem espaço entre parágrafos',
  'erro:Citações longas:Tamanho 10',
  'erro:Ilustrações e tabelas:Indicação de “Fonte:”',
  'alerta:Texto:Títulos sem número centralizados',
  'erro:Resumo:Extensão',
  'alerta:Resumo:Palavras-chave',
  'erro:Citações:Toda citação tem referência',
  'alerta:Citações:Toda referência é citada',
  'alerta:Citações:Autor em maiúsculas e minúsculas',
  'erro:Referências:Ordem alfabética',
  'erro:Referências:Documentos online',
  'erro:Referências:Alinhadas à esquerda',
  'alerta:Referências:Uma linha em branco entre referências',
];

test('TCC com problemas (.docx): aponta cada problema plantado', async () => {
  const r = analisar(await ler('tcc_problemas.docx'));
  assert.deepEqual(problemas(r).sort(), [...ESPERADOS_DOCX].sort());
  const sem = r.cruzamento.semReferencia.map((c) => `${c.autor} (${c.ano})`);
  assert.deepEqual(sem.sort(), ['North (1990)', 'SILVA (2019)']);
});

test('TCC com problemas (.pdf): aponta o que é mensurável em PDF', async () => {
  const r = analisar(await ler('tcc_problemas.pdf'));
  const p = problemas(r);
  for (const esperado of [
    'erro:Estrutura:Abstract',
    'alerta:Página:Margens (estimadas)',
    'erro:Página:Numeração de páginas',
    'erro:Texto:Tamanho 12 no texto',
    'erro:Texto:Fonte (Arial ou Times New Roman)',
    'erro:Resumo:Extensão',
    'erro:Citações:Toda citação tem referência',
    'erro:Referências:Documentos online',
  ]) assert.ok(p.includes(esperado), `faltou ${esperado}`);
  assert.equal(r.refs.length, 4);
});
