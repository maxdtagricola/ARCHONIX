import * as XLSX from 'xlsx'
import { abaComTabelaItens, cellNumero, cellTexto, cellValue, normalizar, sheetDims, vazio } from './xlsxSheetUtil'
import { VENDEDORES } from './types'

export interface ItemCotacaoImportado {
  referencia: string
  descricao: string
  quantidade: number
  /** Escrita na tela, antes de criar a cotação — vai pra observação do item na Precificação. */
  observacao?: string
}

export interface ResultadoImportacaoCotacao {
  cliente: string
  equipamento: string
  /** Já resolvido pra um dos VENDEDORES cadastrados, ou '' se não achar/reconhecer. */
  vendedor: string
  itens: ItemCotacaoImportado[]
}

/** Rótulo comparável: sem acento, minúsculo, sem dois-pontos/pontuação no fim. */
function rotuloDe(valor: unknown): string {
  return normalizar(valor).replace(/[\s:.\-–]+$/, '').trim()
}

/** Procura um rótulo (ex.: "Cliente:") em qualquer célula e retorna o valor: o que vier depois dos
 * dois-pontos na própria célula ("CLIENTE: FULANO"), ou a primeira célula não vazia à direita. */
function buscarValorAoLadoDoRotulo(
  ws: XLSX.WorkSheet,
  maxRow: number,
  maxCol: number,
  rotulos: string[],
  linhaInicial = 1,
): string {
  for (let r = linhaInicial; r <= maxRow; r++) {
    for (let c = 1; c <= maxCol; c++) {
      const bruto = cellValue(ws, r, c)
      if (vazio(bruto)) continue
      const texto = String(bruto)
      const rotulo = rotuloDe(texto)
      const naPropriaCelula = texto.match(/^([^:]{2,30}):\s*(.+)$/)
      if (naPropriaCelula && rotulos.includes(rotuloDe(naPropriaCelula[1]))) return naPropriaCelula[2].trim()
      if (!rotulos.includes(rotulo)) continue
      for (let c2 = c + 1; c2 <= maxCol; c2++) {
        const valor = cellValue(ws, r, c2)
        if (!vazio(valor)) return String(valor).trim()
      }
    }
  }
  return ''
}

/**
 * Igual a buscarValorAoLadoDoRotulo, mas também aceita o valor na mesma
 * coluna, algumas linhas acima ou abaixo do rótulo — o "Vendedor" costuma
 * vir no rodapé desse tipo de planilha, às vezes com o rótulo abaixo do
 * nome (célula do nome _acima_ da célula "Vendedor").
 */
function buscarValorPertoDoRotulo(ws: XLSX.WorkSheet, maxRow: number, maxCol: number, rotulos: string[]): string {
  const aoLado = buscarValorAoLadoDoRotulo(ws, maxRow, maxCol, rotulos)
  if (aoLado) return aoLado
  for (let r = 1; r <= maxRow; r++) {
    for (let c = 1; c <= maxCol; c++) {
      if (!rotulos.includes(rotuloDe(cellValue(ws, r, c)))) continue
      for (let r2 = r - 1; r2 >= Math.max(1, r - 4); r2--) {
        const valor = cellValue(ws, r2, c)
        if (!vazio(valor)) return String(valor).trim()
      }
      for (let r2 = r + 1; r2 <= Math.min(maxRow, r + 4); r2++) {
        const valor = cellValue(ws, r2, c)
        if (!vazio(valor)) return String(valor).trim()
      }
    }
  }
  return ''
}

/** Reconhece qual dos VENDEDORES cadastrados está contido no texto bruto lido da planilha. */
function resolverVendedor(textoBruto: string): string {
  const alvo = normalizar(textoBruto)
  if (!alvo) return ''
  return VENDEDORES.find((v) => new RegExp(`(^|[^a-z])${normalizar(v)}([^a-z]|$)`).test(alvo)) ?? ''
}

/** Marcação de "item a cotar" na linha: "COTAR", "cotar", "A COTAR", "Cotar!"… */
function ehMarcacaoCotar(valor: unknown): boolean {
  return /^(a\s+)?cotar[\s!.]*$/.test(normalizar(valor))
}

/**
 * Lê uma planilha de cotação (modelo "orçamento cliente"): pega o Cliente e o
 * Equipamento do cabeçalho, ignora o resto do topo, e na tabela de itens
 * (colunas MARCA/ENTREGA/REFERENCIA/DESCRIÇÃO/QUANT/VLR UNT/VLR TOTAL, e
 * variações desses nomes) separa só os itens que ainda precisam ser
 * cotados: entrega em branco e, em algum lugar da linha, a marcação "cotar"
 * (maiúscula ou minúscula). Procura a tabela em todas as abas.
 */
export async function lerPlanilhaCotacao(
  arquivo: File,
  opcoes: {
    /** false: todas as linhas da tabela (a planilha que o cliente manda ao vendedor não tem as marcas
     * "COTAR" nem prazos — ver vendedor/ImportarItens). */
    soMarcadosCotar?: boolean
  } = {},
): Promise<ResultadoImportacaoCotacao> {
  const soMarcados = opcoes.soMarcadosCotar ?? true
  const buffer = await arquivo.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const { ws, tabela } = abaComTabelaItens(workbook)
  if (!ws) throw new Error('Não consegui ler nenhuma aba nesse arquivo.')
  if (!tabela) throw new Error('Não encontrei a tabela de itens (coluna "REFERENCIA", "REF" ou "CÓDIGO") nessa planilha.')
  if (tabela.colDescricao === -1 || tabela.colQuant === -1) {
    throw new Error('Não encontrei as colunas de descrição e quantidade na tabela de itens.')
  }

  const { maxRow, maxCol } = sheetDims(ws)
  // cliente/equipamento costumam ficar acima da tabela; se não estiverem lá, procura no rodapé
  // (abaixo do cabeçalho da tabela — nunca na própria linha de títulos das colunas)
  const buscarCabecalhoOuRodape = (rotulos: string[]) =>
    buscarValorAoLadoDoRotulo(ws, tabela.linhaCabecalho - 1, maxCol, rotulos) ||
    buscarValorAoLadoDoRotulo(ws, maxRow, maxCol, rotulos, tabela.linhaCabecalho + 1)
  const cliente = buscarCabecalhoOuRodape(['cliente', 'nome do cliente', 'razao social'])
  const equipamento = buscarCabecalhoOuRodape(['equipamento', 'maquina', 'modelo da maquina'])
  const vendedor = resolverVendedor(buscarValorPertoDoRotulo(ws, maxRow, maxCol, ['vendedor', 'vendedor responsavel', 'consultor']))

  const itens: ItemCotacaoImportado[] = []
  let linhasVaziasSeguidas = 0
  for (let r = tabela.linhaCabecalho + 1; r <= tabela.maxRow; r++) {
    const referencia = cellTexto(ws, r, tabela.colReferencia)
    const descricao = cellTexto(ws, r, tabela.colDescricao)

    if (!referencia && !descricao) {
      linhasVaziasSeguidas += 1
      if (linhasVaziasSeguidas >= 3 && itens.length > 0) break
      continue
    }
    linhasVaziasSeguidas = 0

    if (soMarcados) {
      const entregaValor = tabela.colEntrega > -1 ? cellValue(ws, r, tabela.colEntrega) : undefined
      if (!vazio(entregaValor)) continue // já tem prazo de entrega — não precisa ser cotado

      let temMarcacaoCotar = false
      for (let c = 1; c <= tabela.maxCol; c++) {
        if (ehMarcacaoCotar(cellValue(ws, r, c))) {
          temMarcacaoCotar = true
          break
        }
      }
      if (!temMarcacaoCotar) continue
    }

    itens.push({
      referencia,
      descricao,
      quantidade: cellNumero(ws, r, tabela.colQuant) ?? 0,
    })
  }

  if (itens.length === 0) {
    throw new Error('Não encontrei itens marcados como "COTAR" (com entrega em branco) nessa planilha.')
  }

  return { cliente, equipamento, vendedor, itens: sintetizarPorReferencia(itens) }
}

/**
 * Quando a mesma referência aparece em mais de uma linha da planilha (pedidos
 * parcelados, por exemplo), soma as quantidades num item só em vez de duplicar
 * a linha na cotação. Referência em branco não é uma chave confiável (pode
 * repetir sem ser o mesmo item de verdade), então essas linhas nunca são
 * mescladas entre si — cada uma vira seu próprio item, como já era.
 */
function sintetizarPorReferencia(itens: ItemCotacaoImportado[]): ItemCotacaoImportado[] {
  const resultado: ItemCotacaoImportado[] = []
  const indicePorReferencia = new Map<string, number>()

  for (const item of itens) {
    const chave = item.referencia.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
    const indiceExistente = chave ? indicePorReferencia.get(chave) : undefined
    if (indiceExistente !== undefined) {
      resultado[indiceExistente].quantidade += item.quantidade
      continue
    }
    resultado.push({ ...item })
    if (chave) indicePorReferencia.set(chave, resultado.length - 1)
  }

  return resultado
}
