import { formatarNumeroCurtoBR } from './numeros'
import type { CotacaoFornecedorItem, QuoteItem } from './types'
import { cotacaoAtende, formatCurrency, melhorCotacaoFornecedor, mesmoFornecedor } from './utils'

// -----------------------------------------------------------------------
// Comparar fornecedores como o CUSTO BASE MACRO da empresa: uma linha por
// item (REFERÊNCIA, DESCRIÇÃO, UND, VLR UNIT, TOTAL), o mais barato em verde
// (VLR MÍN, FORNECEDOR, MARCA) e, pra cada fornecedor, a coluna do preço
// (com a cor dele na planilha) e a da marca. As colunas mudam de lugar
// arrastando o título e cada uma tem filtro, como o filtro do Excel; a ordem
// e as escondidas ficam neste aparelho. A tela está em components/PlanilhaComparar.
// -----------------------------------------------------------------------

export type TipoDaColuna = 'texto' | 'numero' | 'moeda'
/** item: dados do item; resultado: o mais barato (cabeçalho verde); preco/marca: de um fornecedor. */
export type GrupoDaColuna = 'item' | 'resultado' | 'preco' | 'marca'

export interface ColunaPlanilha {
  chave: string
  titulo: string
  tipo: TipoDaColuna
  grupo: GrupoDaColuna
  /** Largura, em rem. */
  largura: number
  /** Nas colunas de fornecedor: o nome dele (como aparece nas cotações). */
  fornecedor?: string
}

export const COLUNAS_DO_ITEM: ColunaPlanilha[] = [
  { chave: 'referencia', titulo: 'REFERÊNCIA', tipo: 'texto', grupo: 'item', largura: 7 },
  { chave: 'interno', titulo: 'INTERNO', tipo: 'texto', grupo: 'item', largura: 5.5 },
  { chave: 'descricao', titulo: 'DESCRIÇÃO', tipo: 'texto', grupo: 'item', largura: 12 },
  { chave: 'und', titulo: 'UND', tipo: 'numero', grupo: 'item', largura: 3.5 },
  { chave: 'vlrUnit', titulo: 'VLR UNIT', tipo: 'moeda', grupo: 'item', largura: 6.5 },
  { chave: 'total', titulo: 'TOTAL', tipo: 'moeda', grupo: 'item', largura: 7 },
  { chave: 'vlrMin', titulo: 'VLR MÍN', tipo: 'moeda', grupo: 'resultado', largura: 6.5 },
  { chave: 'fornecedorMin', titulo: 'FORNECEDOR', tipo: 'texto', grupo: 'resultado', largura: 7.5 },
  { chave: 'marcaMin', titulo: 'MARCA', tipo: 'texto', grupo: 'resultado', largura: 6 },
]

// --- cores, como na planilha (cores do tema do Office, clareadas) ---------------------------------
export const COR_CABECALHO = '#8DB3E2'
export const COR_CABECALHO_RESULTADO = '#92D050'
const CORES_DA_PLANILHA: [RegExp, string][] = [
  [/TOLEAGRI/, '#D9D9D9'],
  [/\bCBC\b/, '#E6B9B8'],
  [/ENCOPEL/, '#CCC0DA'],
  [/CENTRAL\s*TORK/, '#DAEEF3'],
  [/\bINGA\b/, '#FCD5B4'],
  [/\bRCC\b/, '#8DB3E2'],
  [/\bMINAS\b/, '#C4BD97'],
  [/SOLUS/, '#FFC000'],
  [/\bIMAM\b/, '#C4BD97'],
  [/\bITS\b/, '#E6B9B8'],
]
// na planilha MG, AGROSEMPRE, IMDEPA, EG e REDEPARTS ficam sem cor
const SEM_COR_NA_PLANILHA = /^(MG|EG)\b|AGROSEMPRE|IMDEPA|REDEPARTS/
// os que não estão na planilha: tons da mesma família, um por coluna
const PALETA = ['#DAEEF3', '#FCD5B4', '#CCC0DA', '#E6B9B8', '#D8E4BC', '#C4BD97', '#B7DEE8', '#FDE9D9']

const comparavel = (nome: string) =>
  nome
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()

/** A cor da coluna do fornecedor ('' = sem cor). `indice`: a posição dele entre os fornecedores. */
export function corDoFornecedor(nome: string, indice: number): string {
  const n = comparavel(nome)
  for (const [padrao, cor] of CORES_DA_PLANILHA) if (padrao.test(n)) return cor
  if (SEM_COR_NA_PLANILHA.test(n)) return ''
  return PALETA[indice % PALETA.length]
}

export const chavePreco = (fornecedor: string) => `preco:${comparavel(fornecedor)}`
export const chaveMarca = (fornecedor: string) => `marca:${comparavel(fornecedor)}`

// --- linhas --------------------------------------------------------------------------------------
export interface CelulaDoFornecedor {
  /** A que aparece na célula: a mais barata desse fornecedor pro item. */
  cotacao: CotacaoFornecedorItem
  /** Outras ofertas do mesmo fornecedor pro item (outra marca, por exemplo). */
  outras: CotacaoFornecedorItem[]
}

export interface LinhaPlanilha {
  item: QuoteItem
  /** 1, 2, 3… na ordem dos itens da cotação. */
  numero: number
  und: number
  vlrUnit: number
  total: number
  /** A mais barata que atende (a do VLR MÍN). */
  melhor?: CotacaoFornecedorItem
  /** A que preenche o item: a escolhida à mão ou a mais barata. */
  emUso?: CotacaoFornecedorItem
  porFornecedor: Map<string, CelulaDoFornecedor>
  /** A referência aparece em mais de um item (a planilha marca de vermelho). */
  referenciaRepetida: boolean
}

/** Os fornecedores das cotações (sem repetir, pelo nome), na ordem em que aparecem — mais os `extras`
 * (colunas novas, ainda sem preço). */
export function fornecedoresDaPlanilha(items: QuoteItem[], extras: string[] = []): string[] {
  const nomes: string[] = []
  const incluir = (nome: string) => {
    if (nome.trim() && !nomes.some((n) => mesmoFornecedor(n, nome))) nomes.push(nome.trim())
  }
  for (const item of items) for (const c of item.product.cotacoesFornecedores ?? []) incluir(c.fornecedor)
  for (const nome of extras) incluir(nome)
  return nomes
}

export function montarLinhas(items: QuoteItem[], fornecedores: string[]): LinhaPlanilha[] {
  const referencias = new Map<string, number>()
  for (const item of items) {
    const r = comparavel(item.product.referencia || '')
    if (r) referencias.set(r, (referencias.get(r) ?? 0) + 1)
  }
  return items.map((item, i) => {
    const p = item.product
    const todas = p.cotacoesFornecedores ?? []
    const melhor = melhorCotacaoFornecedor(todas.filter(cotacaoAtende))
    const escolhida = todas.find((c) => c.id === p.cotacaoEscolhidaId && cotacaoAtende(c))
    const porFornecedor = new Map<string, CelulaDoFornecedor>()
    for (const nome of fornecedores) {
      const dele = todas.filter((c) => mesmoFornecedor(c.fornecedor, nome)).sort((a, b) => a.valorUnitario - b.valorUnitario)
      if (dele.length > 0) porFornecedor.set(chavePreco(nome), { cotacao: dele[0], outras: dele.slice(1) })
    }
    const und = p.qtd || 0
    const vlrUnit = p.valorUnt || 0
    return {
      item,
      numero: i + 1,
      und,
      vlrUnit,
      total: vlrUnit * und,
      melhor,
      emUso: escolhida ?? melhor,
      porFornecedor,
      referenciaRepetida: (referencias.get(comparavel(p.referencia || '')) ?? 0) > 1,
    }
  })
}

/** As colunas que existem (as do item e as dos fornecedores), na ordem padrão. */
export function colunasDisponiveis(fornecedores: string[]): ColunaPlanilha[] {
  return [
    ...COLUNAS_DO_ITEM,
    ...fornecedores.flatMap((nome): ColunaPlanilha[] => [
      { chave: chavePreco(nome), titulo: nome.toUpperCase(), tipo: 'moeda', grupo: 'preco', largura: 6.5, fornecedor: nome },
      { chave: chaveMarca(nome), titulo: 'MARCA', tipo: 'texto', grupo: 'marca', largura: 5.5, fornecedor: nome },
    ]),
  ]
}

/** O valor de uma célula — pra filtrar, ordenar e mostrar. */
export function valorDaCelula(linha: LinhaPlanilha, coluna: ColunaPlanilha): string | number | undefined {
  const p = linha.item.product
  switch (coluna.chave) {
    case 'referencia':
      return p.referencia || undefined
    case 'interno':
      return p.interno || undefined
    case 'descricao':
      return p.descricao || undefined
    case 'und':
      return linha.und
    case 'vlrUnit':
      return linha.vlrUnit > 0 ? linha.vlrUnit : undefined
    case 'total':
      return linha.total > 0 ? linha.total : undefined
    case 'vlrMin':
      return linha.melhor?.valorUnitario
    case 'fornecedorMin':
      return linha.melhor?.fornecedor || undefined
    case 'marcaMin':
      return linha.melhor?.marca || undefined
  }
  if (!coluna.fornecedor) return undefined
  const celula = linha.porFornecedor.get(chavePreco(coluna.fornecedor))
  if (coluna.grupo === 'preco') return celula?.cotacao.valorUnitario
  return celula?.cotacao.marca || undefined
}

export const VAZIAS = '(Vazias)'

/** Como o valor aparece no filtro (e na célula). */
export function textoDoValor(valor: string | number | undefined, tipo: TipoDaColuna): string {
  if (valor === undefined || valor === '') return VAZIAS
  if (typeof valor === 'number') return tipo === 'moeda' ? formatCurrency(valor) : formatarNumeroCurtoBR(valor, 3)
  return valor.trim()
}

// --- filtros e ordem ------------------------------------------------------------------------------
/** Por coluna, os valores (como aparecem no filtro) que ficam à mostra. Coluna sem entrada: todos. */
export type FiltrosDaPlanilha = Record<string, string[]>

export interface OrdemDaPlanilha {
  chave: string
  desc: boolean
}

export function filtrarLinhas(linhas: LinhaPlanilha[], colunas: ColunaPlanilha[], filtros: FiltrosDaPlanilha): LinhaPlanilha[] {
  const ativos = colunas.filter((c) => filtros[c.chave])
  if (ativos.length === 0) return linhas
  return linhas.filter((l) => ativos.every((c) => filtros[c.chave].includes(textoDoValor(valorDaCelula(l, c), c.tipo))))
}

export function ordenarLinhas(linhas: LinhaPlanilha[], colunas: ColunaPlanilha[], ordem: OrdemDaPlanilha | null): LinhaPlanilha[] {
  const coluna = ordem && colunas.find((c) => c.chave === ordem.chave)
  if (!ordem || !coluna) return linhas
  return [...linhas].sort((a, b) => {
    const va = valorDaCelula(a, coluna)
    const vb = valorDaCelula(b, coluna)
    // vazio sempre no fim, como no Excel
    if (va === undefined) return vb === undefined ? a.numero - b.numero : 1
    if (vb === undefined) return -1
    const r = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'pt-BR', { numeric: true })
    return (ordem.desc ? -r : r) || a.numero - b.numero
  })
}

/** Os valores diferentes de uma coluna, em ordem (vazias no fim). */
export function valoresDaColuna(linhas: LinhaPlanilha[], coluna: ColunaPlanilha): string[] {
  const porTexto = new Map<string, string | number | undefined>()
  for (const l of linhas) {
    const v = valorDaCelula(l, coluna)
    porTexto.set(textoDoValor(v, coluna.tipo), v)
  }
  return [...porTexto.entries()]
    .sort(([ta, a], [tb, b]) => {
      if (a === undefined) return 1
      if (b === undefined) return -1
      return typeof a === 'number' && typeof b === 'number' ? a - b : ta.localeCompare(tb, 'pt-BR', { numeric: true })
    })
    .map(([t]) => t)
}

// --- colunas: ordem e escondidas, guardadas neste aparelho ---------------------------------------
export interface ArranjoDasColunas {
  ordem: string[]
  ocultas: string[]
}

export const CHAVE_ARRANJO = 'comparar:planilha:colunas'

export function lerArranjo(): ArranjoDasColunas {
  try {
    const bruto = JSON.parse(localStorage.getItem(CHAVE_ARRANJO) ?? 'null') as Partial<ArranjoDasColunas> | null
    const lista = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
    return { ordem: lista(bruto?.ordem), ocultas: lista(bruto?.ocultas) }
  } catch {
    return { ordem: [], ocultas: [] }
  }
}

export function gravarArranjo(arranjo: ArranjoDasColunas): void {
  try {
    localStorage.setItem(CHAVE_ARRANJO, JSON.stringify(arranjo))
  } catch {
    // sem armazenamento: vale até recarregar
  }
}

/** As colunas na ordem escolhida: as que não estavam nela (fornecedor novo) entram logo depois da que
 * vem antes delas na ordem padrão. */
export function colunasNaOrdem(disponiveis: ColunaPlanilha[], ordem: string[]): ColunaPlanilha[] {
  const porChave = new Map(disponiveis.map((c) => [c.chave, c]))
  const lista = ordem.filter((k, i) => porChave.has(k) && ordem.indexOf(k) === i)
  disponiveis.forEach((c, i) => {
    if (lista.includes(c.chave)) return
    const anterior = i > 0 ? lista.indexOf(disponiveis[i - 1].chave) : -1
    lista.splice(anterior + 1, 0, c.chave)
  })
  return lista.map((k) => porChave.get(k)!)
}

/** Tira `chave` do lugar e põe antes (ou depois) de `alvo`. */
export function moverColuna(ordem: string[], chave: string, alvo: string, depois: boolean): string[] {
  if (chave === alvo) return ordem
  const sem = ordem.filter((k) => k !== chave)
  const i = sem.indexOf(alvo)
  if (i < 0) return ordem
  sem.splice(depois ? i + 1 : i, 0, chave)
  return sem
}
