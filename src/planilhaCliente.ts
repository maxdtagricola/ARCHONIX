import * as XLSX from 'xlsx'
import { calculateItem } from './calc/calculator'
import { abaComTabelaItens, cellTexto, cellValue, clearCellValue, localizarTabelaItens, normalizar, setCellValue } from './xlsxSheetUtil'
import { mesmaReferencia } from './importacao/referencias'
import { parseNumeroFlexivel } from './numeros'
import { avisar } from './dialogs'
import { abrirXlsx, aplicarAlteracoes, ehZip, fecharXlsx, renderizarAba, type AlteracaoCelula, type PreviaOriginal } from './xlsxOriginal'
import type { QuoteItem } from './types'

export async function arquivoParaBase64(arquivo: File): Promise<string> {
  const buffer = await arquivo.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binario = ''
  for (let i = 0; i < bytes.length; i++) binario += String.fromCharCode(bytes[i])
  return btoa(binario)
}

function base64ParaBytes(base64: string): Uint8Array {
  const binario = atob(base64)
  const bytes = new Uint8Array(binario.length)
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i)
  return bytes
}

/** Linha da planilha do cliente que já tinha valor — o site não escreve por cima, só avisa. */
export interface ItemComValorNaPlanilha {
  referencia: string
  descricao: string
  linha: number
  /** O que já estava na planilha: o valor unitário (ou o total, se a linha só tinha o total). */
  valorNaPlanilha: number
  tipoDoValor: 'unitário' | 'total'
  /** O que o site calculou pro mesmo campo — não foi escrito na planilha. */
  valorDoSite: number
}

export interface PlanilhaAtualizada {
  /** O arquivo pronto pra baixar/enviar: o mesmo que o cliente mandou, só com as células preenchidas. */
  arquivo: Blob
  htmlPreview: string
  /** true = a prévia reproduz a formatação da planilha (cores, bordas, larguras, logo); false = prévia
   * simples, só com os valores (formato antigo .xls/.ods, que não dá pra abrir por dentro). */
  previaFiel: boolean
  /** Página HTML completa pra imprimir/"Salvar como PDF", no tamanho e orientação da planilha. */
  paginaImpressao: string
  itensAtualizados: number
  itensComValorNaPlanilha: ItemComValorNaPlanilha[]
}

const TIPOS_POR_EXTENSAO: Record<string, { bookType: XLSX.BookType; mime: string }> = {
  xlsx: { bookType: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  xlsm: { bookType: 'xlsm', mime: 'application/vnd.ms-excel.sheet.macroEnabled.12' },
  xls: { bookType: 'biff8', mime: 'application/vnd.ms-excel' },
  ods: { bookType: 'ods', mime: 'application/vnd.oasis.opendocument.spreadsheet' },
}

function tipoDoArquivo(nomeArquivo: string) {
  const extensao = nomeArquivo.split('.').pop()?.toLowerCase() ?? ''
  return TIPOS_POR_EXTENSAO[extensao] ?? TIPOS_POR_EXTENSAO.xlsx
}

export function paginaDeImpressao(previa: PreviaOriginal, titulo: string): string {
  // mesma escala/orientação/margens configuradas na planilha; se ainda não couber na largura da folha, reduz
  const larguraFolhaPol = previa.orientacao === 'landscape' ? 11.69 : 8.27
  const larguraUtilPx = (larguraFolhaPol - previa.margens.left - previa.margens.right) * 96
  const escala = Math.min(previa.escala, larguraUtilPx / Math.max(1, previa.largura))
  const m = previa.margens
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${escaparHtml(titulo)}</title>
<style>
  @page { size: A4 ${previa.orientacao}; margin: ${m.top}in ${m.right}in ${m.bottom}in ${m.left}in; }
  html, body { margin: 0; background: #fff; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .folha { zoom: ${escala.toFixed(3)}; }
</style>
</head>
<body><div class="folha">${previa.html}</div></body>
</html>`
}

/** Valor já preenchido numa célula (número, ou texto tipo "R$ 12,50") — vazio, zero ou "-" não contam. */
function valorNaCelula(ws: XLSX.WorkSheet, linha: number, coluna: number): number | undefined {
  if (coluna < 1) return undefined
  const bruto = cellValue(ws, linha, coluna)
  const valor = typeof bruto === 'number' ? bruto : typeof bruto === 'string' ? parseNumeroFlexivel(bruto) : undefined
  return valor !== undefined && Number.isFinite(valor) && valor > 0 ? valor : undefined
}

/**
 * Reabre a planilha original do cliente e preenche, nas linhas cuja
 * Referência bate com algum item da cotação, a marca, o prazo de entrega, o
 * valor unitário e o valor total — e apaga a marcação "cotar" da linha, já
 * que o item foi precificado. Atualiza também o total geral, se achar o rótulo.
 *
 * O que já estava preenchido na planilha nunca é sobrescrito: linha que já
 * tem valor (unitário ou total) fica como veio — e entra na lista
 * itensComValorNaPlanilha, pra avisar quem está gerando; marca e prazo que o
 * cliente já tinha escrito também ficam ("COTAR" na célula não conta: é só a
 * marcação, e dá lugar à marca/prazo).
 *
 * O arquivo devolvido é o próprio arquivo do cliente, alterado só nessas
 * células (direto no XML de dentro do .xlsx): logo, cores, bordas, larguras,
 * fórmulas e configuração de impressão ficam iguais ao original.
 */
export function gerarPlanilhaAtualizada(
  conteudoBase64: string,
  items: QuoteItem[],
  nomeArquivo = 'planilha.xlsx',
  titulo = 'Planilha do cliente',
): PlanilhaAtualizada {
  const linhas = items
    .filter((it) => it.product.referencia.trim())
    .map((it): LinhaParaPreencher => {
      const resultado = calculateItem(it.product, it.pricing)
      return {
        referencia: it.product.referencia,
        descricao: it.product.descricao,
        marca: it.product.marca,
        entrega: it.product.prazoEntrega,
        valorUnitario: resultado.precoVendaUnitario,
        valorTotal: resultado.precoVendaTotal,
      }
    })
  return preencherPlanilhaDoCliente(conteudoBase64, linhas, nomeArquivo, titulo)
}

/** O que vai numa linha da planilha do cliente — os valores já calculados (da cotação aberta, pra
 * equipe; os enviados, pro vendedor — ver vendedor/PlanilhaDoVendedor). */
export interface LinhaParaPreencher {
  referencia: string
  descricao: string
  marca: string
  entrega: string
  valorUnitario: number
  valorTotal: number
}

/** A marcação que o cliente põe na linha do item a cotar ("COTAR", "A COTAR!"). */
const ehMarcacaoCotar = (valor: unknown) => /^(a\s+)?cotar[\s!.]*$/.test(normalizar(valor))

/** O preenchimento em si (ver gerarPlanilhaAtualizada): casa cada linha da planilha pela referência. */
export function preencherPlanilhaDoCliente(
  conteudoBase64: string,
  itens: LinhaParaPreencher[],
  nomeArquivo = 'planilha.xlsx',
  titulo = 'Planilha do cliente',
): PlanilhaAtualizada {
  const bytes = base64ParaBytes(conteudoBase64)
  const workbook = XLSX.read(bytes, { type: 'array' })
  // a mesma aba de onde a cotação foi importada (a primeira que tem a tabela de itens)
  const { ws, nome: nomeAba } = abaComTabelaItens(workbook)

  const tabela = localizarTabelaItens(ws)
  let itensAtualizados = 0
  let somaVlrTotal = 0
  const itensComValorNaPlanilha: ItemComValorNaPlanilha[] = []
  // o que muda na planilha: aplicado na cópia lida pelo "xlsx" (pras contas abaixo) e anotado pra
  // depois aplicar no arquivo original
  const alteracoes: AlteracaoCelula[] = []
  const escrever = (linha: number, coluna: number, valor: number | string) => {
    setCellValue(ws, linha, coluna, valor)
    alteracoes.push({ linha, coluna, valor })
  }
  const apagar = (linha: number, coluna: number) => {
    clearCellValue(ws, linha, coluna)
    alteracoes.push({ linha, coluna, valor: null })
  }

  for (let r = tabela.linhaCabecalho + 1; r <= tabela.maxRow; r++) {
    const referenciaTexto = cellTexto(ws, r, tabela.colReferencia)
    if (referenciaTexto) {
      // mesma referência ignorando espaço/hífen/maiúscula ("KK-45376" = "kk45376")
      const item = itens.find((it) => it.referencia.trim() && mesmaReferencia(it.referencia, referenciaTexto))
      if (item) {
        const unitarioNaPlanilha = valorNaCelula(ws, r, tabela.colVlrUnt)
        const totalNaPlanilha = valorNaCelula(ws, r, tabela.colVlrTotal)
        if (unitarioNaPlanilha !== undefined || totalNaPlanilha !== undefined) {
          // a linha já tem valor na planilha do cliente: fica como está (valores, prazo e marcação)
          const ehUnitario = unitarioNaPlanilha !== undefined
          itensComValorNaPlanilha.push({
            referencia: referenciaTexto,
            descricao: item.descricao,
            linha: r,
            valorNaPlanilha: ehUnitario ? unitarioNaPlanilha : totalNaPlanilha!,
            tipoDoValor: ehUnitario ? 'unitário' : 'total',
            valorDoSite: Number((ehUnitario ? item.valorUnitario : item.valorTotal).toFixed(2)),
          })
        } else {
          if (tabela.colVlrUnt > -1) {
            escrever(r, tabela.colVlrUnt, Number(item.valorUnitario.toFixed(2)))
          }
          if (tabela.colVlrTotal > -1) {
            escrever(r, tabela.colVlrTotal, Number(item.valorTotal.toFixed(2)))
          }
          // marca e prazo que o cliente já tinha escrito ficam; célula vazia ou só com "COTAR" recebe
          const escritas = new Set<number>()
          for (const [coluna, texto] of [
            [tabela.colMarca, item.marca],
            [tabela.colEntrega, item.entrega],
          ] as const) {
            const doCliente = coluna > -1 ? cellTexto(ws, r, coluna) : ''
            if (coluna > -1 && texto.trim() && (!doCliente || ehMarcacaoCotar(doCliente))) {
              escrever(r, coluna, texto.trim())
              escritas.add(coluna)
            }
          }
          for (let c = 1; c <= tabela.maxCol; c++) {
            if (!escritas.has(c) && ehMarcacaoCotar(cellValue(ws, r, c))) apagar(r, c)
          }
          itensAtualizados++
        }
      }
    }

    if (tabela.colVlrTotal > -1) {
      // número ou texto ("R$ 50,00") — o que o cliente já tinha escrito também entra no total geral
      somaVlrTotal += valorNaCelula(ws, r, tabela.colVlrTotal) ?? 0
    }
  }

  for (let r = 1; r <= tabela.maxRow; r++) {
    for (let c = 1; c <= tabela.maxCol; c++) {
      const texto = normalizar(cellValue(ws, r, c))
      if (texto.startsWith('valo total') || texto.startsWith('valor total')) {
        for (let c2 = c + 1; c2 <= tabela.maxCol; c2++) {
          if (typeof cellValue(ws, r, c2) === 'number') {
            escrever(r, c2, Number(somaVlrTotal.toFixed(2)))
            break
          }
        }
      }
    }
  }

  const tipo = tipoDoArquivo(nomeArquivo)
  const resumo = { itensAtualizados, itensComValorNaPlanilha }
  if (ehZip(bytes) && tipo.bookType !== 'ods') {
    try {
      const arquivos = abrirXlsx(bytes)
      aplicarAlteracoes(arquivos, nomeAba, alteracoes)
      const previa = renderizarAba(arquivos, nomeAba)
      return {
        arquivo: new Blob([fecharXlsx(arquivos) as Uint8Array<ArrayBuffer>], { type: tipo.mime }),
        htmlPreview: previa.html,
        previaFiel: true,
        paginaImpressao: paginaDeImpressao(previa, titulo),
        ...resumo,
      }
    } catch (err) {
      // arquivo que não deu pra abrir por dentro: cai na regravação simples abaixo
      console.warn('Planilha do cliente: não deu pra manter o arquivo original, regravando sem a formatação.', err)
    }
  }

  // formato antigo (.xls/.ods): regrava com a biblioteca de planilha — os valores ficam certos, a formatação não
  const htmlPreview = XLSX.utils.sheet_to_html(ws)
  const array = XLSX.write(workbook, { bookType: tipo.bookType, type: 'array' }) as ArrayBuffer
  return {
    arquivo: new Blob([array], { type: tipo.mime }),
    htmlPreview,
    previaFiel: false,
    paginaImpressao: paginaSimples(htmlPreview, titulo),
    ...resumo,
  }
}

/** Busca a planilha que veio do cliente (fica à parte da cotação no servidor) e preenche com a cotação. */
export async function montarPlanilhaImportada(
  carregar: () => Promise<{ conteudoBase64: string } | undefined>,
  items: QuoteItem[],
  nomeArquivo: string,
  titulo: string,
): Promise<PlanilhaAtualizada> {
  const planilha = await carregar()
  if (!planilha) throw new Error('A planilha original dessa cotação não foi encontrada no servidor.')
  return gerarPlanilhaAtualizada(planilha.conteudoBase64, items, nomeArquivo, titulo)
}

/** O arquivo guardado (base64) de volta como arquivo — pra baixar o original como veio. */
export function blobDoBase64(conteudoBase64: string, nomeArquivo: string): Blob {
  return new Blob([base64ParaBytes(conteudoBase64) as Uint8Array<ArrayBuffer>], { type: tipoDoArquivo(nomeArquivo).mime })
}

export function baixarBlob(blob: Blob, nomeArquivo: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomeArquivo
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function paginaSimples(htmlTable: string, titulo: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${escaparHtml(titulo)}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; padding: 24px; color: #111; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 1px solid #999; padding: 4px 8px; font-size: 12px; }
</style>
</head>
<body>${htmlTable}</body>
</html>`
}

/** Abre uma aba só com a tabela, pronta pra imprimir/"Salvar como PDF" pelo próprio navegador. */
export function abrirParaImpressao(htmlTable: string, titulo: string): void {
  abrirPaginaParaImpressao(paginaSimples(htmlTable, titulo))
}

/** Igual a abrirParaImpressao, mas com uma página HTML já completa (com o próprio CSS) — usado
 * quando a prévia precisa sair impressa exatamente como foi montada (ex.: pedido de compra). */
export function abrirPaginaParaImpressao(htmlCompleto: string): void {
  const win = window.open('', '_blank')
  if (!win) {
    void avisar('O navegador bloqueou a nova aba — permita pop-ups pra esse site e tente de novo.')
    return
  }
  win.document.write(htmlCompleto)
  win.document.close()
  // espera a logo (imagem embutida) carregar antes de abrir a impressão
  setTimeout(() => win.print(), 500)
}

export function linkWhatsApp(mensagem: string): string {
  return `https://wa.me/?text=${encodeURIComponent(mensagem)}`
}

export function linkEmail(assunto: string, corpo: string): string {
  return `mailto:?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`
}

export const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export function suportaCompartilharArquivo(tipo: string = MIME_XLSX): boolean {
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean }
  if (!nav.canShare || !navigator.share) return false
  try {
    const teste = new File(['teste'], 'teste', { type: tipo })
    return nav.canShare({ files: [teste] })
  } catch {
    return false
  }
}

export async function compartilharArquivo(
  blob: Blob,
  nomeArquivo: string,
  titulo: string,
  texto: string,
  tipo: string = MIME_XLSX,
): Promise<void> {
  const arquivo = new File([blob], nomeArquivo, { type: tipo })
  await navigator.share({ files: [arquivo], title: titulo, text: texto })
}
