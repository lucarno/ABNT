// Regras de conformidade. Ajuste aqui para refletir o manual vigente da Biblioteca Telles.
// Fontes: ABNT NBR 14724:2011 (trabalhos acadêmicos), NBR 6023:2018 (referências),
// NBR 10520:2023 (citações), NBR 6028:2021 (resumo), NBR 6024:2012 e NBR 6027:2012.

export const REGRAS = {
  papel: { larguraCm: 21.0, alturaCm: 29.7, toleranciaCm: 0.1 },

  // Anverso: superior e esquerda 3 cm; inferior e direita 2 cm.
  margens: { sup: 3.0, esq: 3.0, inf: 2.0, dir: 2.0, toleranciaCm: 0.1 },

  // A NBR 14724 não fixa a família; o manual da biblioteca recomenda estas.
  fontes: ['Arial', 'Times New Roman'],
  tamanhoTexto: 12,
  // Citações longas, notas, legendas e paginação: tamanho menor e uniforme.
  tamanhoMenorMax: 11,

  entrelinhaTexto: 1.5,
  entrelinhaSimples: 1.0,

  // Citação direta com mais de três linhas: recuo de 4 cm da margem esquerda.
  recuoCitacaoLongaCm: 4.0,

  resumo: { palavrasMin: 150, palavrasMax: 500, palavrasChaveMin: 3, palavrasChaveMax: 5 },

  // Fração mínima de parágrafos conformes para considerar o item "ok" / "alerta".
  limiarOk: 0.95,
  limiarAlerta: 0.8,

  // Elementos e a ordem esperada (os obrigatórios geram erro se ausentes).
  elementos: [
    { id: 'resumo', titulos: ['RESUMO'], obrigatorio: true },
    { id: 'abstract', titulos: ['ABSTRACT', 'RESUMEN', 'RÉSUMÉ'], obrigatorio: true },
    { id: 'sumario', titulos: ['SUMÁRIO'], obrigatorio: true },
    { id: 'introducao', titulos: ['INTRODUÇÃO'], obrigatorio: true },
    { id: 'conclusao', titulos: ['CONCLUSÃO', 'CONCLUSÕES', 'CONSIDERAÇÕES FINAIS'], obrigatorio: true },
    { id: 'referencias', titulos: ['REFERÊNCIAS', 'REFERÊNCIAS BIBLIOGRÁFICAS'], obrigatorio: true },
  ],

  // Títulos que encerram a lista de referências.
  titulosPosReferencias: ['APÊNDICE', 'APÊNDICES', 'ANEXO', 'ANEXOS', 'GLOSSÁRIO', 'ÍNDICE'],
};

export const CLAUDE = {
  modelo: 'claude-opus-5-5',
  esforco: 'medium',
  maxTokens: 16000,
  refsPorLote: 30,
};
