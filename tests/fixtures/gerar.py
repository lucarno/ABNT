"""Gera os TCCs de teste: tcc_conforme.docx e tcc_problemas.docx (e PDFs via LibreOffice).

Uso: python3 tests/fixtures/gerar.py   (requer python-docx e soffice)
"""
import subprocess
from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import parse_xml
from docx.oxml.ns import nsdecls, qn
from docx.shared import Cm, Pt

AQUI = Path(__file__).parent

RESUMO = (
    "Este trabalho investiga a relação entre instituições políticas e desenvolvimento econômico "
    "no Brasil entre 1990 e 2020. O objetivo é avaliar se a qualidade das instituições ajuda a "
    "explicar diferenças persistentes de renda entre os estados brasileiros. A metodologia combina "
    "uma revisão da literatura sobre instituições inclusivas e extrativas com uma análise empírica "
    "de painel, que usa dados estaduais de renda, escolaridade e indicadores de governança. Os "
    "resultados indicam que estados com instituições mais inclusivas apresentam taxas de crescimento "
    "maiores, mesmo após controlar por capital humano e por características geográficas. A análise "
    "também mostra que o efeito das instituições é mais forte no longo prazo e que choques "
    "transitórios de renda não alteram a trajetória dos estados com instituições frágeis. Conclui-se "
    "que políticas voltadas ao fortalecimento institucional podem ter efeitos duradouros sobre o "
    "desenvolvimento regional, embora a evidência dependa da forma como a qualidade institucional é "
    "medida e da disponibilidade de dados comparáveis entre os estados ao longo de todo o período."
)
ABSTRACT = (
    "This study investigates the relationship between political institutions and economic development "
    "in Brazil between 1990 and 2020. It asks whether institutional quality helps explain persistent "
    "income differences across Brazilian states. The method combines a review of the literature on "
    "inclusive and extractive institutions with an empirical panel analysis based on state-level data "
    "on income, schooling and governance indicators. The results show that states with more inclusive "
    "institutions grow faster, even after controlling for human capital and geography. The analysis "
    "also shows that the institutional effect is stronger in the long run and that transitory income "
    "shocks do not change the path of states with weak institutions. We conclude that policies aimed at "
    "institutional strengthening can have lasting effects on regional development, although the evidence "
    "depends on how institutional quality is measured and on the availability of comparable data "
    "for all states over the whole period. Further research should test these results with "
    "municipal data."
)
CORPO = [
    "Segundo Acemoglu e Robinson (2012), as nações fracassam quando suas instituições econômicas e "
    "políticas são extrativas. A literatura empírica reforça esse argumento ao mostrar que a origem "
    "colonial das instituições tem efeito duradouro sobre a renda (Acemoglu; Johnson; Robinson, 2001, p. 1370).",
    "A abordagem institucional parte da definição de North (1990), para quem as instituições são as regras "
    "do jogo em uma sociedade. Essas regras moldam incentivos e, por consequência, as decisões de "
    "investimento, inovação e acumulação de capital ao longo do tempo.",
]
CITACAO_LONGA = (
    "As instituições são as regras do jogo em uma sociedade ou, mais formalmente, são as restrições "
    "concebidas pelos homens que dão forma à interação humana. Em consequência, estruturam incentivos "
    "no intercâmbio humano, seja ele político, social ou econômico (North, 1990, p. 3)."
)
REFS_OK = [
    "ACEMOGLU, Daron; JOHNSON, Simon; ROBINSON, James A. The colonial origins of comparative development: "
    "an empirical investigation. American Economic Review, v. 91, n. 5, p. 1369-1401, 2001. "
    "DOI: 10.1257/aer.91.5.1369.",
    "ACEMOGLU, Daron; ROBINSON, James A. Why nations fail: the origins of power, prosperity, and poverty. "
    "New York: Crown Business, 2012.",
    "NORTH, Douglass C. Institutions, institutional change and economic performance. Cambridge: "
    "Cambridge University Press, 1990.",
]


def fonte(run, nome, tamanho):
    run.font.name = nome
    run.font.size = Pt(tamanho)
    run._element.rPr.rFonts.set(qn("w:hAnsi"), nome)


def paragrafo(doc, texto, nome, tamanho, *, alinh=WD_ALIGN_PARAGRAPH.JUSTIFY, entrelinha=1.5,
              recuo=None, recuo_esq=None, antes=0, depois=0, estilo=None):
    p = doc.add_paragraph(style=estilo)
    fonte(p.add_run(texto), nome, tamanho)
    f = p.paragraph_format
    f.alignment = alinh
    f.line_spacing = entrelinha
    f.space_before = Pt(antes)
    f.space_after = Pt(depois)
    if recuo is not None:
        f.first_line_indent = Cm(recuo)
    if recuo_esq is not None:
        f.left_indent = Cm(recuo_esq)
    return p


def quebra(doc):
    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)


def numero_pagina(secao, tamanho, no_rodape=False):
    parte = secao.footer if no_rodape else secao.header
    parte.is_linked_to_previous = False
    p = parte.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p._p.append(parse_xml(
        f'<w:fldSimple {nsdecls("w")} w:instr=" PAGE "><w:r><w:rPr><w:sz w:val="{tamanho * 2}"/></w:rPr>'
        f"<w:t>1</w:t></w:r></w:fldSimple>"
    ))


def margens(secao, sup, inf, esq, dir_):
    secao.page_width, secao.page_height = Cm(21), Cm(29.7)
    secao.top_margin, secao.bottom_margin = Cm(sup), Cm(inf)
    secao.left_margin, secao.right_margin = Cm(esq), Cm(dir_)


def gerar(caminho, ok):
    doc = Document()
    nome, tam, entre = ("Times New Roman", 12, 1.5) if ok else ("Calibri", 11, 1.15)
    margens(doc.sections[0], *((3, 2, 3, 2) if ok else (2.5, 2.5, 2.5, 2.5)))
    centro = WD_ALIGN_PARAGRAPH.CENTER
    simples = dict(alinh=centro, entrelinha=1.0)

    # Capa e folha de rosto (seção sem numeração)
    for t in ["Insper", "Graduação em Economia", "Nome do Aluno",
              "Instituições e desenvolvimento: evidências para os estados brasileiros", "São Paulo", "2026"]:
        paragrafo(doc, t, nome, tam, **simples)
    quebra(doc)
    for t in ["Nome do Aluno", "Instituições e desenvolvimento: evidências para os estados brasileiros"]:
        paragrafo(doc, t, nome, tam, **simples)
    paragrafo(doc, "Trabalho de Conclusão de Curso apresentado ao programa de Graduação em Economia como "
              "requisito parcial para a obtenção do título de Bacharel em Economia.", nome, tam,
              entrelinha=1.0, recuo_esq=7)
    paragrafo(doc, "Orientador: Prof. Dr. Nome do Orientador", nome, tam, entrelinha=1.0, recuo_esq=7)
    for t in ["São Paulo", "2026"]:
        paragrafo(doc, t, nome, tam, **simples)
    quebra(doc)
    paragrafo(doc, "Banca Examinadora", nome, tam, **simples)
    quebra(doc)

    paragrafo(doc, "Resumo", nome, tam, **simples)
    paragrafo(doc, RESUMO if ok else RESUMO[:400], nome, tam, entrelinha=entre)
    paragrafo(doc, "Palavras-chave: instituições; desenvolvimento econômico; estados brasileiros." if ok
              else "Palavras-chave: instituições, desenvolvimento, Brasil", nome, tam, entrelinha=entre, antes=12)
    quebra(doc)
    if ok:
        paragrafo(doc, "Abstract", nome, tam, **simples)
        paragrafo(doc, ABSTRACT, nome, tam, entrelinha=entre)
        paragrafo(doc, "Keywords: institutions; economic development; Brazilian states.", nome, tam,
                  entrelinha=entre, antes=12)
        quebra(doc)
    paragrafo(doc, "Sumário", nome, tam, **simples)
    for t in ["1\tINTRODUÇÃO\t5", "2\tREFERENCIAL TEÓRICO\t6", "\tCONSIDERAÇÕES FINAIS\t7", "\tREFERÊNCIAS\t8"]:
        paragrafo(doc, t, nome, tam, alinh=WD_ALIGN_PARAGRAPH.LEFT)

    # Parte textual em nova seção, com número de página no cabeçalho
    secao = doc.add_section(WD_SECTION.NEW_PAGE)
    margens(secao, *((3, 2, 3, 2) if ok else (2.5, 2.5, 2.5, 2.5)))
    numero_pagina(secao, 10 if ok else 12, no_rodape=not ok)
    if ok:
        # A capa não é contada: a Introdução é a 7ª folha e deve mostrar o número 6.
        secao._sectPr.append(parse_xml(f'<w:pgNumType {nsdecls("w")} w:start="6"/>'))

    corpo = dict(entrelinha=entre, recuo=1.25 if ok else 0, depois=0 if ok else 8)
    paragrafo(doc, "1 INTRODUÇÃO", nome, tam, alinh=WD_ALIGN_PARAGRAPH.LEFT, estilo="Heading 1")
    paragrafo(doc, CORPO[0], nome, tam, **corpo)
    if not ok:
        paragrafo(doc, "Outros autores discordam dessa leitura e enfatizam a geografia (SILVA, 2019).", nome, tam, **corpo)
        paragrafo(doc, "Para o caso brasileiro, há evidência de efeitos institucionais persistentes (Pereira, 2020).",
                  nome, tam, **corpo)
    paragrafo(doc, "2 REFERENCIAL TEÓRICO", nome, tam, alinh=WD_ALIGN_PARAGRAPH.LEFT, estilo="Heading 1")
    paragrafo(doc, CORPO[1], nome, tam, **corpo)
    paragrafo(doc, CITACAO_LONGA, nome, 10 if ok else tam, entrelinha=1.0, recuo_esq=4)
    paragrafo(doc, "Figura 1 - Renda per capita e qualidade institucional", nome, tam, alinh=WD_ALIGN_PARAGRAPH.LEFT, entrelinha=1.0)
    if ok:
        paragrafo(doc, "Fonte: Elaborado pelo autor.", nome, 10, alinh=WD_ALIGN_PARAGRAPH.LEFT, entrelinha=1.0)
    paragrafo(doc, "CONSIDERAÇÕES FINAIS", nome, tam, alinh=WD_ALIGN_PARAGRAPH.LEFT, estilo="Heading 1")
    paragrafo(doc, "As evidências reunidas indicam que a qualidade das instituições é um determinante relevante "
              "do desenvolvimento dos estados brasileiros no longo prazo.", nome, tam, **corpo)
    quebra(doc)

    paragrafo(doc, "Referências", nome, tam, alinh=centro if ok else WD_ALIGN_PARAGRAPH.LEFT, entrelinha=1.0)
    refs = REFS_OK if ok else [
        REFS_OK[1], REFS_OK[0],  # fora de ordem alfabética
        "PEREIRA, João Carlos. Instituições e crescimento no Brasil contemporâneo. Revista Brasileira de "
        "Economia Aplicada, v. 12, n. 3, p. 45-67, 2020. DOI: 10.1234/rbea.2020.0345.",
        "WORLD BANK. Worldwide governance indicators. 2023. https://www.worldbank.org/en/publication/worldwide-governance-indicators",
    ]
    for r in refs:
        paragrafo(doc, r, nome, tam, alinh=WD_ALIGN_PARAGRAPH.LEFT if ok else WD_ALIGN_PARAGRAPH.JUSTIFY,
                  entrelinha=1.0, depois=12 if ok else 0)

    for est in ("Heading 1",):
        st = doc.styles[est]
        st.font.name, st.font.size, st.font.bold = nome, Pt(tam), True
        st.font.color.rgb = None
        st.paragraph_format.space_before = Pt(0)
        st.paragraph_format.space_after = Pt(0)
    doc.save(caminho)


if __name__ == "__main__":
    for nome, ok in (("tcc_conforme", True), ("tcc_problemas", False)):
        gerar(AQUI / f"{nome}.docx", ok)
        subprocess.run(["soffice", "--headless", "--convert-to", "pdf", "--outdir", str(AQUI), str(AQUI / f"{nome}.docx")],
                       check=True, capture_output=True)
    print("ok")
