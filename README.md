# Verificador de TCC (ABNT)

Aplicativo web que confere se um trabalho acadêmico está pronto para a entrega. Ele checa três coisas:

- a formatação, conforme o *Manual para Elaboração de Trabalhos Baseado na ABNT* da Biblioteca Telles (v5);
- se citações e referências se correspondem;
- se as referências existem de fato, para pegar obras inventadas ou copiadas com erro (inclusive as "alucinadas" por IA).

O app é uma página estática (HTML + JavaScript) e roda inteiro no navegador do aluno, sem servidor.

## O que é checado

| Grupo | Itens |
|---|---|
| Estrutura | Elementos obrigatórios (resumo, abstract, sumário, introdução, considerações finais, referências) e sua ordem; folha de aprovação; capa e folha de rosto com instituição, natureza do trabalho, orientador, local e ano |
| Página | A4; margens 3/3/2/2 cm; número de página no canto superior direito, em tamanho 10, a partir da Introdução, contando desde a folha de rosto |
| Texto | Arial ou Times New Roman 12; entrelinha 1,5; texto justificado; recuo de 1,25 cm; sem espaço entre parágrafos; títulos sem número centralizados |
| Citações longas, notas e ilustrações | Tamanho 10, espaçamento simples e recuo de 4 cm; "Fonte:" abaixo de cada figura ou tabela |
| Resumo e Abstract | 150 a 500 palavras; parágrafo único; 3 a 5 palavras-chave separadas por ponto e vírgula |
| Citações | Toda citação tem referência e toda referência é citada (sistema autor-data); autor em maiúsculas e minúsculas (NBR 10520:2023) |
| Referências | Ordem alfabética; alinhadas à esquerda; espaçamento simples; linha em branco entre elas; "Disponível em:" e "Acesso em:" em documentos online |

Com o **.docx**, a formatação vem do próprio arquivo, já com a herança de estilos aplicada. Com o **.pdf**, margens, espaçamento e numeração são estimados pela posição do texto, e recuos e citações longas não são avaliados.

## Como as referências são verificadas

1. **Crossref e DataCite**, sem IA e sem custo. Se a referência tem DOI, o app confirma que o DOI existe e que pertence àquela obra (compara título, autoria e ano). Sem DOI, faz uma busca bibliográfica na Crossref. Livros costumam aparecer por meio de resenhas publicadas, e isso conta como evidência de existência.
2. **Claude com busca na web**, só se o aluno informar a chave da API. As referências que a Crossref não localizou (livros nacionais, relatórios, sites) são procuradas na web. Para cada uma, o modelo precisa indicar a URL que comprova a busca. O app confere se essa URL apareceu de fato nos resultados da busca; se não apareceu, a referência é marcada como "Incerta".
3. **Revisão de forma**, também com a chave. O Claude aponta desvios da NBR 6023 em cada referência e sugere a versão corrigida, sem inventar dados que faltam: no lugar deles entram marcadores como `[local]`.

| Situação | Significado |
|---|---|
| Verificada / Encontrada na web | Há registro da obra com o mesmo título e autoria |
| Divergências | Existe obra com o mesmo título, mas de outra autoria (sinal típico de referência gerada por IA), com coautores diferentes ou com outro ano |
| DOI incorreto | A obra existe, mas o DOI informado não existe ou é de outra obra; o DOI certo é indicado |
| DOI inexistente | O DOI informado não existe e a obra não foi localizada: forte indício de referência inventada |
| DOI de outra obra | O DOI existe, mas é de outro trabalho |
| Não encontrada | Nem a Crossref nem a busca na web acharam a obra |
| Não localizada | Fora da Crossref e sem busca na web (sem chave). **Não significa inventada** |
| Legislação/norma | Não é consultada; confira na fonte oficial |

## Chave da API e custo

Cada aluno usa a própria chave da Anthropic (crie uma em <https://console.anthropic.com>). A chave vai direto do navegador para a API da Anthropic e só fica salva se o aluno marcar "Lembrar neste navegador". Evite marcar em computador compartilhado. O que sai do navegador:

- **para a Anthropic:** apenas a lista de referências, e só quando há chave;
- **para a Crossref e a DataCite:** apenas o texto de cada referência.

A página declara uma Content-Security-Policy que só permite conexões com a Crossref, a DataCite, a API da Anthropic e o CDN das bibliotecas, de modo que um script injetado não consegue enviar a chave para outro endereço.

O modelo usado é o Claude Opus 5.5 (`claude-opus-5-5`, em `src/regras.js`). Ao final da análise, o app mostra os tokens e as buscas usados e uma estimativa de custo em dólares.

## Publicar

É um site estático. No GitHub Pages: **Settings → Pages → Deploy from a branch**, escolha o branch e a pasta `/ (root)`. Serve também qualquer outra hospedagem estática.

Para rodar localmente: `python3 -m http.server 8000` e abra <http://localhost:8000>. Abrir o `index.html` direto pelo sistema de arquivos não funciona, porque o navegador bloqueia módulos JavaScript em `file://`.

As bibliotecas (pdf.js 4.10.38, JSZip 3.10.1 e `@anthropic-ai/sdk` 0.128.0) são carregadas do jsDelivr com versão fixa.

## Ajustar as regras

Todas as regras ficam em `src/regras.js`: margens, fontes, tamanhos, espaçamentos, limites do resumo, elementos obrigatórios e títulos centralizados. Quando o manual da biblioteca mudar, é ali que se ajusta.

## Estrutura

```
index.html, style.css     interface
src/app.js                fluxo da interface
src/docx.js, src/pdf.js   leitura do arquivo (formatação efetiva do .docx; posição do texto no .pdf)
src/checagens.js          checagens de estrutura, página, texto, resumo, citações e referências
src/referencias.js        lista de referências, citações no texto e cruzamento
src/verificacao.js        Crossref e DataCite
src/claude.js             revisão de forma e busca na web com o Claude
tests/                    testes (node:test) e TCCs de exemplo
```

## Testes

```
npm install
npm test            # unitários: leitura, checagens, verificação e SDK com API simulada
npm run test:e2e    # Chromium com a página real, CDN e Crossref reais, API da Anthropic simulada
```

Os TCCs de teste (`tests/fixtures/tcc_conforme.*` e `tcc_problemas.*`) são gerados por `python3 tests/fixtures/gerar.py`, que usa python-docx e LibreOffice. O conforme não deve gerar nenhum erro nem alerta. O com problemas tem 21 problemas plantados, inclusive uma referência com DOI inventado.

## Auditoria com TCCs reais

O verificador foi rodado em 17 TCCs de graduação publicados no repositório do Insper (Word, Google Docs, LaTeX/abnTeX2), com 330 referências, e em DOCX gerados por Word, pandoc e LibreOffice. Cada alerta foi conferido à mão; os falsos alarmes encontrados viraram correções e testes (`tests/*.test.mjs`). Nos trabalhos reais, os problemas mais comuns foram: citações sem referência correspondente (ou com ano diferente), numeração de páginas contando a capa, número de página em tamanho 11 ou 12, referências online sem data de acesso e referências fora de ordem alfabética. Em dois trabalhos apareceram referências com título real atribuído a outros autores ou com coautores trocados.

## Limitações

- A detecção de citações usa padrões do sistema autor-data (e do numérico, quando a lista e o texto usam [n]). Citações fora do padrão ("(Silva 2020)", sem vírgula) não são reconhecidas; menções a nome e ano entre parênteses que não casam com nenhuma referência aparecem como "possíveis" citações, para conferência.
- Em PDF, referências sem linha em branco entre si podem ser lidas juntas quando a anterior não termina em ponto.
- Não são checados: títulos começando em nova página, sumário idêntico aos títulos do texto e cor da fonte.
- A ferramenta é um apoio. A conferência final cabe ao aluno e ao orientador.
