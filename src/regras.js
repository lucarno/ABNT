// Regras de conformidade, conforme o "Manual para Elaboração de Trabalhos Baseado na ABNT"
// da Biblioteca Telles (Insper, v5): NBR 6023:2018, 6024:2012, 6027:2012, 6028:2021,
// 10520:2023 e 14724:2011. Ajuste aqui quando o manual mudar.

export const REGRAS = {
  papel: { larguraCm: 21.0, alturaCm: 29.7, toleranciaCm: 0.1 },

  // Margem esquerda e superior 3 cm; direita e inferior 2 cm.
  margens: { sup: 3.0, esq: 3.0, inf: 2.0, dir: 2.0, toleranciaCm: 0.1 },

  // Arial ou Times New Roman, tamanho 12, texto justificado.
  fontes: ['Arial', 'Times New Roman'],
  tamanhoTexto: 12,
  // Citações com mais de três linhas, notas de rodapé, fontes de figuras/tabelas e paginação.
  tamanhoMenor: 10,

  entrelinhaTexto: 1.5,
  entrelinhaSimples: 1.0,
  recuoParagrafoCm: 1.25,
  // Recomendado: recuo de 4 cm para citação direta longa.
  recuoCitacaoLongaCm: 4.0,

  // Resumo: parágrafo único, justificado, sem tabulação; 150 a 500 palavras; 3 a 5 palavras-chave.
  resumo: { palavrasMin: 150, palavrasMax: 500, palavrasChaveMin: 3, palavrasChaveMax: 5 },

  // Fração mínima de parágrafos conformes para "ok" e para "alerta" (abaixo disso, "erro").
  limiarOk: 0.95,
  limiarAlerta: 0.8,

  // Elementos obrigatórios (marcados com * no manual), na ordem em que devem aparecer.
  elementos: [
    { id: 'aprovacao', nome: 'Folha de aprovação', titulos: ['BANCA EXAMINADORA', 'FOLHA DE APROVAÇÃO'], obrigatorio: false },
    { id: 'resumo', nome: 'Resumo', titulos: ['RESUMO'], obrigatorio: true },
    { id: 'abstract', nome: 'Abstract', titulos: ['ABSTRACT'], obrigatorio: true },
    { id: 'sumario', nome: 'Sumário', titulos: ['SUMÁRIO'], obrigatorio: true },
    { id: 'introducao', nome: 'Introdução', titulos: ['INTRODUÇÃO'], obrigatorio: true },
    { id: 'conclusao', nome: 'Considerações finais', titulos: ['CONSIDERAÇÕES FINAIS', 'CONCLUSÃO', 'CONCLUSÕES'], obrigatorio: true },
    { id: 'referencias', nome: 'Referências', titulos: ['REFERÊNCIAS', 'REFERÊNCIAS BIBLIOGRÁFICAS'], obrigatorio: true },
  ],

  // Títulos sem indicativo numérico: devem ser centralizados.
  titulosCentralizados: ['RESUMO', 'ABSTRACT', 'SUMÁRIO', 'REFERÊNCIAS', 'AGRADECIMENTOS', 'LISTA DE', 'APÊNDICE', 'ANEXO', 'GLOSSÁRIO'],

  // Títulos que encerram a lista de referências.
  titulosPosReferencias: ['OBRAS COMPLEMENTARES', 'OBRAS CONSULTADAS', 'APÊNDICE', 'ANEXO', 'GLOSSÁRIO', 'ÍNDICE'],
};

export const CLAUDE = {
  modelo: 'claude-opus-5-5',
  esforco: 'medium',
  maxTokens: 16000,
  refsPorLoteRevisao: 30,
  refsPorLoteBusca: 5,
};
