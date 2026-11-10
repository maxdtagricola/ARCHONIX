import { calculateItem } from '../calc/calculator'
import { dbDelete, dbGet, dbGetAll, dbPut, STORE_ANALISES } from './db'
import { proximoCodigoCotacao } from './configRepo'
import { makeId } from '../utils'
import { estaACaminho, mercadoriaRecebida } from '../avisosEntrega'
import { conferirPermissaoDeStatus } from '../statusConfig'
import { excluirPlanilhaCliente, gravarPlanilhaCliente, type PlanilhaClienteArquivo } from './planilhasClienteRepo'
import { montarValoresEnviados } from '../valoresEnviados'
import type {
  DadosFreteTransportadora,
  DadosTransporte,
  ItemExcluidoCotacao,
  ItemFaturado,
  ItemFechado,
  MedidasCargaFrete,
  PedidoCompraInfo,
  PreRegistroItem,
  PricingConfig,
  ProducaoPedido,
  ProductInput,
  QuoteItem,
  QuoteRecord,
  QuoteStatus,
  TipoReferencia,
} from '../types'

// Formato antigo (uma análise = um único produto), salvo antes da cotação
// com múltiplos itens existir. Mantido só para migrar registros já salvos.
interface LegacyAnalysisRecord {
  id: string
  product: ProductInput
  pricing: PricingConfig
  createdAt: number
  updatedAt: number
}

function isLegacyRecord(record: unknown): record is LegacyAnalysisRecord {
  return !!record && typeof record === 'object' && 'product' in record && !('items' in record)
}

function normalizeRecord(record: QuoteRecord | LegacyAnalysisRecord): QuoteRecord {
  if (isLegacyRecord(record)) {
    const result = calculateItem(record.product, record.pricing)
    return {
      id: record.id,
      codigo: '',
      criadoPor: '',
      vendedor: '',
      tipoReferencia: 'itens',
      cliente: '',
      maquina: '',
      items: [{ id: makeId(), product: { ...record.product, estadoOrigem: record.product.estadoOrigem || 'SP' }, pricing: record.pricing }],
      itensPreRegistro: [],
      status: 'PENDENTE',
      responsavelStatus: '',
      statusHistory: [{ status: 'PENDENTE', changedAt: record.createdAt }],
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      summary: {
        totalItens: 1,
        precoVendaTotalGeral: result.precoVendaTotal,
      },
    }
  }
  // preenche campos que não existiam em versões anteriores do registro
  return {
    ...record,
    codigo: record.codigo ?? '',
    criadoPor: record.criadoPor ?? '',
    vendedor: record.vendedor ?? '',
    tipoReferencia: record.tipoReferencia ?? 'itens',
    cliente: record.cliente ?? '',
    maquina: record.maquina ?? '',
    // itens salvos antes do campo UF existir (ou salvos em branco) ficam sem nenhuma opção
    // selecionada no <select> — cai pra SP, o mesmo padrão de item novo
    items: (record.items ?? []).map((item) => ({
      ...item,
      product: { ...item.product, estadoOrigem: item.product.estadoOrigem || 'SP' },
    })),
    itensPreRegistro: record.itensPreRegistro ?? [],
    freteTransportadoras: record.freteTransportadoras ?? {},
    fretePorFornecedor: record.fretePorFornecedor ?? {},
    cargaFretePorFornecedor: record.cargaFretePorFornecedor ?? {},
    itensFechados: record.itensFechados ?? {},
    itensFaturados: record.itensFaturados ?? {},
    itensExcluidos: record.itensExcluidos ?? [],
    status: record.status ?? 'PENDENTE',
    responsavelStatus: record.responsavelStatus ?? '',
    statusHistory:
      record.statusHistory && record.statusHistory.length > 0
        ? record.statusHistory
        : [{ status: record.status ?? 'PENDENTE', changedAt: record.createdAt }],
  }
}

// Gravações da mesma cotação, uma de cada vez. Cada gravação lê a versão do servidor, muda um pedaço e
// grava a cotação inteira — duas ao mesmo tempo (ex.: as medidas da carga, salvas ao sair do campo, e
// o frete da transportadora, salvo logo em seguida) e a que terminasse por último desfazia a outra.
const filasPorCotacao = new Map<string, Promise<unknown>>()

/** Evento disparado depois que uma cotação já existente é gravada (status, transporte, entrega…) —
 * quem mostra algo calculado das cotações fora da própria aba (o aviso de entregas) se atualiza. */
export const EVENTO_COTACAO_ALTERADA = 'cotacao-alterada'

function naFila<T>(id: string, tarefa: () => Promise<T>, avisar = true): Promise<T> {
  const anterior = filasPorCotacao.get(id) ?? Promise.resolve()
  // a anterior ter dado erro não impede a próxima
  const proxima = anterior.then(tarefa, tarefa)
  filasPorCotacao.set(id, proxima)
  const limpar = () => {
    if (filasPorCotacao.get(id) === proxima) filasPorCotacao.delete(id)
  }
  proxima.then(limpar, limpar)
  if (avisar) proxima.then(() => window.dispatchEvent(new CustomEvent(EVENTO_COTACAO_ALTERADA, { detail: id })), () => {})
  return proxima
}

/** A função, com as chamadas pra mesma cotação (o 1º argumento é o id) uma de cada vez. */
function emFila<A extends [string, ...unknown[]], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return (...args: A) => naFila(args[0], () => fn(...args))
}

export async function listQuotes(): Promise<QuoteRecord[]> {
  const all = await dbGetAll<QuoteRecord | LegacyAnalysisRecord>(STORE_ANALISES)
  const cotacoes = all.map(normalizeRecord).sort((a, b) => b.updatedAt - a.updatedAt)
  separarPlanilhasAntigas(cotacoes)
  return cotacoes
}

// uma tentativa por cotação a cada vez que a página abre
const planilhasJaSeparadas = new Set<string>()

/** Cotação gravada com a planilha do cliente dentro (formato antigo): passa o arquivo pro registro à
 * parte, uma vez só, sem mexer em mais nada da cotação (nem na data de alteração). */
function separarPlanilhasAntigas(cotacoes: QuoteRecord[]) {
  for (const cotacao of cotacoes) {
    if (!cotacao.planilhaOriginal?.conteudoBase64 || planilhasJaSeparadas.has(cotacao.id)) continue
    planilhasJaSeparadas.add(cotacao.id)
    naFila(
      cotacao.id,
      async () => {
        // a versão do servidor agora (não a da lista), pra não desfazer o que mudou nesse meio-tempo
        const atual = await dbGet<QuoteRecord | LegacyAnalysisRecord>(STORE_ANALISES, cotacao.id)
        const planilha = atual && !isLegacyRecord(atual) ? atual.planilhaOriginal : undefined
        if (!atual || !planilha?.conteudoBase64) return
        await gravarPlanilhaCliente(cotacao.id, { nomeArquivo: planilha.nomeArquivo, conteudoBase64: planilha.conteudoBase64 })
        await dbPut(STORE_ANALISES, { ...atual, planilhaOriginal: { nomeArquivo: planilha.nomeArquivo } })
      },
      false,
    ).catch(() => {
      // sem permissão ou sem servidor agora: a cotação continua funcionando com a planilha dentro
    })
  }
}

/** Item com algum dado de verdade — linha em branco (ex.: a que toda cotação nova já começa) não
 * precisa ir pro arquivo de itens excluídos. */
function itemTemDados(item: QuoteItem): boolean {
  const p = item.product
  return !!(p.interno.trim() || p.referencia.trim() || p.descricao.trim() || p.fornecedor.trim() || p.valorUnt > 0)
}

/** Atualiza o arquivo de itens excluídos de uma cotação: todo item que estava salvo nela (ou que a
 * tela avisou ter tirado antes mesmo de salvar) e não está mais em `items` entra no arquivo, com quem
 * tirou e quando; item que voltou pra cotação (restaurado) sai do arquivo. */
function arquivarItensExcluidos(
  base: QuoteRecord | undefined,
  items: QuoteItem[],
  itensRemovidos: QuoteItem[],
  atorAdmin: string,
  agora: number,
): ItemExcluidoCotacao[] {
  const idsAtuais = new Set(items.map((i) => i.id))
  const candidatos = new Map<string, QuoteItem>()
  for (const item of [...(base?.items ?? []), ...itensRemovidos]) {
    if (!idsAtuais.has(item.id) && !candidatos.has(item.id) && itemTemDados(item)) candidatos.set(item.id, item)
  }
  const anteriores = (base?.itensExcluidos ?? []).filter((e) => !idsAtuais.has(e.item.id) && !candidatos.has(e.item.id))
  const novos = Array.from(candidatos.values()).map((item) => ({ item, excluidoEm: agora, excluidoPor: atorAdmin }))
  return [...anteriores, ...novos]
}

export async function saveQuote(
  atorAdmin: string,
  vendedor: string,
  tipoReferencia: TipoReferencia,
  cliente: string,
  maquina: string,
  items: QuoteItem[],
  existingId?: string,
  empresaId?: string,
  dataSolicitacao?: number,
  opcoes?: {
    /** Itens tirados na tela desde o último salvamento — entram no arquivo de excluídos mesmo que
     * nunca tenham chegado a ser salvos na cotação. */
    itensRemovidos?: QuoteItem[]
    /** Observação da cotação — omitida, fica a que já estava salva. */
    observacao?: string
  },
): Promise<QuoteRecord> {
  const gravar = () =>
    gravarCotacao(atorAdmin, vendedor, tipoReferencia, cliente, maquina, items, existingId, empresaId, dataSolicitacao, opcoes)
  // cotação que já existe: na fila das outras gravações dela (ver naFila)
  return existingId ? naFila(existingId, gravar) : gravar()
}

async function gravarCotacao(
  atorAdmin: string,
  vendedor: string,
  tipoReferencia: TipoReferencia,
  cliente: string,
  maquina: string,
  items: QuoteItem[],
  existingId: string | undefined,
  empresaId: string | undefined,
  dataSolicitacao: number | undefined,
  opcoes: { itensRemovidos?: QuoteItem[]; observacao?: string } | undefined,
): Promise<QuoteRecord> {
  const now = Date.now()
  const precoVendaTotalGeral = items.reduce(
    (sum, item) => sum + calculateItem(item.product, item.pricing).precoVendaTotal,
    0,
  )

  // ao editar uma cotação já existente, preserva quem criou e o histórico de status
  const existente = existingId ? await dbGet<QuoteRecord | LegacyAnalysisRecord>(STORE_ANALISES, existingId) : undefined
  const base = existente ? normalizeRecord(existente) : undefined

  if (base && base.status !== 'PENDENTE' && base.responsavelStatus && base.responsavelStatus !== atorAdmin) {
    throw new Error(
      `Essa cotação está sendo analisada por ${base.responsavelStatus} — só ele(a) pode alterá-la agora.`,
    )
  }

  const codigo = base?.codigo || (await proximoCodigoCotacao())

  const record: QuoteRecord = {
    // tudo que essa função não gerencia (frete por transportadora/fornecedor salvo na aba Frete,
    // valores fechados do Pedido de Compra e qualquer campo que vier a existir) passa adiante
    // intacto — antes o registro era montado do zero e cada "Salvar cotação" apagava esses dados
    ...base,
    id: existingId ?? makeId(),
    codigo,
    criadoPor: base?.criadoPor || atorAdmin,
    vendedor,
    tipoReferencia,
    cliente,
    maquina,
    empresaId: empresaId ?? base?.empresaId,
    items,
    itensPreRegistro: base?.itensPreRegistro ?? [],
    planilhaOriginal: base?.planilhaOriginal,
    dataSolicitacao: dataSolicitacao ?? base?.dataSolicitacao,
    observacao: opcoes?.observacao !== undefined ? opcoes.observacao.trim() || undefined : base?.observacao,
    itensExcluidos: arquivarItensExcluidos(base, items, opcoes?.itensRemovidos ?? [], atorAdmin, now),
    status: base?.status ?? 'PENDENTE',
    responsavelStatus: base?.responsavelStatus ?? '',
    statusHistory: base?.statusHistory ?? [{ status: 'PENDENTE', changedAt: now }],
    pedidoCompra: base?.pedidoCompra,
    createdAt: base?.createdAt ?? now,
    updatedAt: now,
    summary: {
      totalItens: items.length,
      precoVendaTotalGeral,
    },
  }
  await dbPut(STORE_ANALISES, record)
  return record
}

export const updateQuoteStatus = emFila(async function updateQuoteStatus(
  id: string,
  novoStatus: QuoteStatus,
  atorAdmin: string,
  pedidoCompra?: PedidoCompraInfo,
  /** Justificativa de quem arquivou — obrigatória ao ir pra ARQUIVO (ver pedirMotivoArquivamento). */
  arquivamento?: { motivo: string; detalhe: string },
  /** Produção do pedido (todo ou parte) — pedida ao ir pra PEDIDO CONFIRMADO (ver pedirProducao). */
  producao?: Omit<ProducaoPedido, 'em' | 'por'>,
): Promise<QuoteRecord> {
  const atual = await dbGet<QuoteRecord | LegacyAnalysisRecord>(STORE_ANALISES, id)
  if (!atual) throw new Error('Cotação não encontrada no servidor.')
  const normalizado = normalizeRecord(atual)
  exigirResponsavel(normalizado, atorAdmin)
  if (normalizado.status !== novoStatus) conferirPermissaoDeStatus('cotacoes', novoStatus)

  const now = Date.now()
  const atualizado: QuoteRecord = {
    ...normalizado,
    status: novoStatus,
    transportePorFornecedor: entregasConformeStatus(normalizado, novoStatus, atorAdmin, now),
    responsavelStatus: novoStatus === 'PENDENTE' ? '' : atorAdmin,
    // cada mudança fica registrada à parte (de onde veio, quem mudou, quando) — não mexe no resto da cotação
    statusHistory: [...normalizado.statusHistory, { status: novoStatus, changedAt: now, de: normalizado.status, por: atorAdmin }],
    pedidoCompra: novoStatus === 'PEDIDO DE COMPRA' ? pedidoCompra : normalizado.pedidoCompra,
    motivoArquivamento:
      novoStatus === 'ARQUIVO' && arquivamento ? { ...arquivamento, em: now, por: atorAdmin } : normalizado.motivoArquivamento,
    producao: novoStatus === 'PEDIDO CONFIRMADO' && producao ? { ...producao, em: now, por: atorAdmin } : normalizado.producao,
    // a primeira ida pra ENVIADO tira a cópia dos valores que o vendedor passa a ver (ver
    // valoresEnviados.ts); depois disso, só troca quando quem cota confirma
    valoresEnviados:
      novoStatus === 'ENVIADO' && !normalizado.valoresEnviados
        ? montarValoresEnviados(normalizado.items, atorAdmin, now)
        : normalizado.valoresEnviados,
    updatedAt: now,
  }
  await dbPut(STORE_ANALISES, atualizado)
  return atualizado
})

/** Troca os valores que o vendedor vê pelos de agora (quem cota confirmou — ver valoresEnviados.ts). */
export const atualizarValoresEnviados = emFila(async function atualizarValoresEnviados(id: string, atorAdmin: string): Promise<QuoteRecord> {
  const atual = await dbGet<QuoteRecord | LegacyAnalysisRecord>(STORE_ANALISES, id)
  if (!atual) throw new Error('Cotação não encontrada no servidor.')
  const normalizado = normalizeRecord(atual)
  const now = Date.now()
  const atualizado: QuoteRecord = {
    ...normalizado,
    valoresEnviados: montarValoresEnviados(normalizado.items, atorAdmin, now, normalizado.valoresEnviados),
    updatedAt: now,
  }
  await dbPut(STORE_ANALISES, atualizado)
  return atualizado
})

/** Quem cota viu os avisos de alteração do vendedor nessa cotação. */
export const marcarAlteracoesVistas = emFila(async function marcarAlteracoesVistas(id: string, nome: string): Promise<QuoteRecord> {
  const atual = await dbGet<QuoteRecord | LegacyAnalysisRecord>(STORE_ANALISES, id)
  if (!atual) throw new Error('Cotação não encontrada no servidor.')
  const normalizado = normalizeRecord(atual)
  const atualizado: QuoteRecord = {
    ...normalizado,
    alteracoesVendedor: (normalizado.alteracoesVendedor ?? []).map((a) =>
      (a.vistaPor ?? []).includes(nome) ? a : { ...a, vistaPor: [...(a.vistaPor ?? []), nome] },
    ),
  }
  await dbPut(STORE_ANALISES, atualizado)
  return atualizado
})

/** As chaves de transporte (fornecedor + UF) dos itens que entraram no pedido de compra — o mesmo
 * agrupamento da aba Pedido de Compra; itens sem fornecedor ficam juntos em "SEM FORNECEDOR". */
function chavesDeTransporteDoPedido(quote: QuoteRecord): string[] {
  const ids = quote.pedidoCompra?.itemIds
  const itens = ids ? quote.items.filter((it) => ids.includes(it.id)) : quote.items
  return Array.from(new Set(itens.map((it) => chaveFornecedorFrete(it.product.fornecedor, it.product.estadoOrigem) || 'SEM FORNECEDOR')))
}

/** Status indo pra ENTREGUE (ou além): a mercadoria de todo fornecedor do pedido fica como recebida
 * (sem aviso de atrasada/a caminho). Voltando pra antes de ENTREGUE: desfaz só essas marcações
 * automáticas — as entregas marcadas à mão no Pedido de Compra continuam. */
function entregasConformeStatus(
  quote: QuoteRecord,
  novoStatus: QuoteStatus,
  atorAdmin: string,
  now: number,
): QuoteRecord['transportePorFornecedor'] {
  const recebidaAntes = mercadoriaRecebida(quote.status)
  const recebidaDepois = mercadoriaRecebida(novoStatus)
  if (recebidaDepois && !recebidaAntes) {
    const transporte = { ...quote.transportePorFornecedor }
    for (const chave of new Set([...chavesDeTransporteDoPedido(quote), ...Object.keys(transporte)])) {
      const anterior: DadosTransporte = transporte[chave] ?? {
        numeroNotaFiscal: '',
        numeroCotacaoFrete: '',
        transportadora: '',
        linkRastreio: '',
        atualizadoEm: now,
        atualizadoPor: atorAdmin,
      }
      if (!anterior.entregueEm) transporte[chave] = { ...anterior, entregueEm: now, entreguePor: atorAdmin, entregaPeloStatus: true }
    }
    return transporte
  }
  if (recebidaAntes && !recebidaDepois && novoStatus !== 'ARQUIVO' && quote.transportePorFornecedor) {
    const transporte = { ...quote.transportePorFornecedor }
    for (const [chave, dados] of Object.entries(transporte)) {
      if (dados.entregaPeloStatus) transporte[chave] = { ...dados, entregueEm: undefined, entreguePor: undefined, entregaPeloStatus: undefined }
    }
    return transporte
  }
  return quote.transportePorFornecedor
}

/** Fora de PENDENTE, só quem pegou a cotação (responsavelStatus) muda o status dela. */
function exigirResponsavel(cotacao: QuoteRecord, atorAdmin: string) {
  if (cotacao.status !== 'PENDENTE' && cotacao.responsavelStatus && cotacao.responsavelStatus !== atorAdmin) {
    throw new Error(`Essa cotação está sendo analisada por ${cotacao.responsavelStatus} — só ele(a) pode mudar o status agora.`)
  }
}

/** Grava a observação da cotação (aba Cotações) — é só uma anotação, qualquer um pode escrever. */
export const salvarObservacaoCotacao = emFila(async function salvarObservacaoCotacao(id: string, observacao: string): Promise<QuoteRecord> {
  const atual = await dbGet<QuoteRecord | LegacyAnalysisRecord>(STORE_ANALISES, id)
  if (!atual) throw new Error('Cotação não encontrada no servidor.')
  const normalizado = normalizeRecord(atual)
  const atualizado: QuoteRecord = { ...normalizado, observacao: observacao.trim() || undefined, updatedAt: Date.now() }
  await dbPut(STORE_ANALISES, atualizado)
  return atualizado
})

/** Atualiza a produção do pedido (aba Pedido de Compra), sem mudar o status. */
export const salvarProducao = emFila(async function salvarProducao(id: string, producao: Omit<ProducaoPedido, 'em' | 'por'>, atorAdmin: string): Promise<QuoteRecord> {
  const atual = await dbGet<QuoteRecord | LegacyAnalysisRecord>(STORE_ANALISES, id)
  if (!atual) throw new Error('Cotação não encontrada no servidor.')
  const normalizado = normalizeRecord(atual)
  const now = Date.now()
  const atualizado: QuoteRecord = { ...normalizado, producao: { ...producao, em: now, por: atorAdmin }, updatedAt: now }
  await dbPut(STORE_ANALISES, atualizado)
  return atualizado
})

// a entrega só mexe no status enquanto a mercadoria está a caminho — de CONFERIDO em diante (ou
// arquivada) o status fica como está

/** Marca (ou desmarca) a mercadoria dos fornecedores `chaves` como entregue e acerta o status pelos
 * fornecedores do pedido (`todasAsChaves`): todos entregues → ENTREGUE; só alguns → PARCIALMENTE
 * ENTREGUE; nenhum (ao desfazer) → volta pra EM TRANSPORTE. */
export const registrarEntrega = emFila(async function registrarEntrega(
  id: string,
  alvo: { chaves: string[]; todasAsChaves: string[]; entregue: boolean },
  atorAdmin: string,
): Promise<QuoteRecord> {
  const atual = await dbGet<QuoteRecord | LegacyAnalysisRecord>(STORE_ANALISES, id)
  if (!atual) throw new Error('Cotação não encontrada no servidor.')
  const normalizado = normalizeRecord(atual)
  const mudaStatus = estaACaminho(normalizado.status) || normalizado.status === 'ENTREGUE'
  if (mudaStatus) exigirResponsavel(normalizado, atorAdmin)

  const now = Date.now()
  const transporte = { ...normalizado.transportePorFornecedor }
  for (const chave of alvo.chaves) {
    const anterior: DadosTransporte = transporte[chave] ?? {
      numeroNotaFiscal: '',
      numeroCotacaoFrete: '',
      transportadora: '',
      linkRastreio: '',
      atualizadoEm: now,
      atualizadoPor: atorAdmin,
    }
    transporte[chave] = alvo.entregue
      ? { ...anterior, entregueEm: now, entreguePor: atorAdmin, entregaPeloStatus: undefined }
      : { ...anterior, entregueEm: undefined, entreguePor: undefined, entregaPeloStatus: undefined }
  }

  let status = normalizado.status
  if (mudaStatus) {
    const entregues = alvo.todasAsChaves.filter((chave) => transporte[chave]?.entregueEm).length
    if (entregues > 0 && entregues === alvo.todasAsChaves.length) status = 'ENTREGUE'
    else if (entregues > 0) status = 'PARCIALMENTE ENTREGUE'
    else if (status === 'PARCIALMENTE ENTREGUE' || status === 'ENTREGUE') status = 'EM TRANSPORTE'
  }

  const atualizado: QuoteRecord = {
    ...normalizado,
    transportePorFornecedor: transporte,
    status,
    responsavelStatus: status !== normalizado.status ? atorAdmin : normalizado.responsavelStatus,
    statusHistory:
      status !== normalizado.status
        ? [...normalizado.statusHistory, { status, changedAt: now, de: normalizado.status, por: atorAdmin }]
        : normalizado.statusHistory,
    updatedAt: now,
  }
  await dbPut(STORE_ANALISES, atualizado)
  return atualizado
})

/** Salva a lista de pré-registro (Interno, Referência, Quantidade) da cotação, sem mexer nos itens já precificados.
 * `dataSolicitacao` e `numeroCotacaoTransportadora` são opcionais — quando omitidos, preservam o valor já salvo
 * (evita apagar ao chamar de fluxos que não mexem nesses campos, como a importação de planilha). */
export const updateItensPreRegistro = emFila(async function updateItensPreRegistro(
  id: string,
  itens: PreRegistroItem[],
  atorAdmin: string,
  dataSolicitacao?: number,
  numeroCotacaoTransportadora?: string,
): Promise<QuoteRecord> {
  const atual = await dbGet<QuoteRecord | LegacyAnalysisRecord>(STORE_ANALISES, id)
  if (!atual) throw new Error('Cotação não encontrada no servidor.')
  const normalizado = normalizeRecord(atual)

  if (
    normalizado.status !== 'PENDENTE' &&
    normalizado.responsavelStatus &&
    normalizado.responsavelStatus !== atorAdmin
  ) {
    throw new Error(
      `Essa cotação está sendo analisada por ${normalizado.responsavelStatus} — só ele(a) pode alterá-la agora.`,
    )
  }

  const atualizado: QuoteRecord = {
    ...normalizado,
    itensPreRegistro: itens,
    dataSolicitacao: dataSolicitacao ?? normalizado.dataSolicitacao,
    numeroCotacaoTransportadora: numeroCotacaoTransportadora ?? normalizado.numeroCotacaoTransportadora,
    updatedAt: Date.now(),
  }
  await dbPut(STORE_ANALISES, atualizado)
  return atualizado
})

/** Guarda a planilha original do cliente (só usado logo na criação, por importação de planilha) — o
 * arquivo no registro à parte, e na cotação só o nome. */
export const setPlanilhaOriginal = emFila(async function setPlanilhaOriginal(
  id: string,
  planilha: PlanilhaClienteArquivo,
): Promise<QuoteRecord> {
  const atual = await dbGet<QuoteRecord | LegacyAnalysisRecord>(STORE_ANALISES, id)
  if (!atual) throw new Error('Cotação não encontrada no servidor.')
  const normalizado = normalizeRecord(atual)
  await gravarPlanilhaCliente(id, planilha)
  const atualizado: QuoteRecord = { ...normalizado, planilhaOriginal: { nomeArquivo: planilha.nomeArquivo }, updatedAt: Date.now() }
  await dbPut(STORE_ANALISES, atualizado)
  return atualizado
})

/** Quem despacha a mercadoria: o fornecedor dos itens (o nome como está neles) e o estado de onde
 * ela sai (a UF de origem dos itens). O mesmo fornecedor em estados diferentes é outra origem —
 * outra filial, outro frete — e fica separado em tudo (itens da cotação, frete, pedido). */
export interface RemetenteFrete {
  nome: string
  uf?: string
}

function nomeNaChave(nome: string): string {
  return nome.trim().toUpperCase()
}

function ufNaChave(uf: string | undefined): string {
  return (uf ?? '').trim().toUpperCase()
}

/** Chave do fornecedor nos dados de frete: o nome como aparece nos itens da cotação (sem diferença
 * de maiúscula/espaço) + a UF de origem — o mesmo critério usado pra agrupar os itens. Sem UF, só o
 * nome (era o formato antes da separação por estado). */
export function chaveFornecedorFrete(nomeFornecedor: string, uf?: string): string {
  const nome = nomeNaChave(nomeFornecedor)
  const estado = ufNaChave(uf)
  return nome && estado ? `${nome}|${estado}` : nome
}

/** Os grupos fornecedor + UF que aparecem nos itens da cotação, na ordem em que cada um aparece
 * pela primeira vez (itens sem fornecedor ficam de fora). */
export function remetentesDaCotacao(quote: Pick<QuoteRecord, 'items'>): Array<RemetenteFrete & { chave: string }> {
  const vistos = new Map<string, RemetenteFrete & { chave: string }>()
  for (const it of quote.items) {
    const nome = it.product.fornecedor.trim()
    if (!nome) continue
    const chave = chaveFornecedorFrete(nome, it.product.estadoOrigem)
    if (!vistos.has(chave)) vistos.set(chave, { nome, uf: ufNaChave(it.product.estadoOrigem) || undefined, chave })
  }
  return Array.from(vistos.values())
}

/** Nome do grupo pra mostrar na tela: o fornecedor e, quando ele aparece com mais de um estado na
 * mesma cotação, a UF junto — é o que diferencia um grupo do outro. */
export function rotuloRemetente(remetente: RemetenteFrete, todos: RemetenteFrete[]): string {
  const nome = remetente.nome.trim()
  const uf = ufNaChave(remetente.uf)
  if (!nome || !uf) return nome
  const estadosDoNome = new Set(todos.filter((r) => nomeNaChave(r.nome) === nomeNaChave(nome)).map((r) => ufNaChave(r.uf)))
  return estadosDoNome.size > 1 ? `${nome} — ${uf}` : nome
}

/** Antes da separação por UF o frete ficava salvo só com o nome do fornecedor — esses dados
 * continuam valendo pro primeiro grupo daquele fornecedor nos itens: quase sempre o único, e,
 * havendo mais de um estado, o grupo que já existia quando o frete foi salvo. */
function ehPrimeiroGrupoDoFornecedor(quote: Pick<QuoteRecord, 'items'>, remetente: RemetenteFrete): boolean {
  const uf = ufNaChave(remetente.uf)
  if (!uf) return true
  const nome = nomeNaChave(remetente.nome)
  const primeiro = quote.items.find((it) => nomeNaChave(it.product.fornecedor) === nome)
  return !primeiro || ufNaChave(primeiro.product.estadoOrigem) === uf
}

/** Cadastro do fornecedor de um grupo dos itens: o de mesmo nome e mesmo estado, ou, não havendo, o
 * de mesmo nome. */
export function cadastroDoRemetente<F extends { nome: string; estado?: string }>(fornecedores: F[], remetente: RemetenteFrete): F | undefined {
  const doNome = fornecedores.filter((f) => nomeNaChave(f.nome) === nomeNaChave(remetente.nome))
  return doNome.find((f) => ufNaChave(f.estado) === ufNaChave(remetente.uf)) ?? doNome[0]
}

function digitos(texto: string | undefined): string {
  return (texto ?? '').replace(/\D/g, '')
}

/** Os dados de frete salvos de UM fornecedor (+ UF) da cotação, por transportadora — só os dele:
 * dado de outro fornecedor nunca aparece aqui. Vale também o formato antigo do mesmo fornecedor (só
 * o nome, antes da separação por UF). O conjunto geral da cotação (`freteTransportadoras`, de antes
 * da separação por fornecedor) só entra quando o CNPJ do remetente gravado nele é o do fornecedor
 * (`cnpjDoFornecedor`, do cadastro) — antes ele aparecia pra qualquer fornecedor que ficasse sozinho
 * na cotação, e o frete de um vinha parar no outro. */
export function freteDoFornecedor(
  quote: Pick<QuoteRecord, 'items' | 'fretePorFornecedor' | 'freteTransportadoras'>,
  remetente: RemetenteFrete,
  cnpjDoFornecedor?: string,
): Record<string, DadosFreteTransportadora> {
  const geral = Object.entries(quote.freteTransportadoras ?? {})
  const nome = nomeNaChave(remetente.nome)
  // itens ainda sem fornecedor: o conjunto geral — menos o que já tem remetente (é de algum fornecedor)
  if (!nome) return Object.fromEntries(geral.filter(([, dados]) => !digitos(dados.camposPedido?.cnpjRemetente)))
  const chave = chaveFornecedorFrete(remetente.nome, remetente.uf)
  const proprio = quote.fretePorFornecedor?.[chave]
  const legadoSoNome = ehPrimeiroGrupoDoFornecedor(quote, remetente) && chave !== nome ? quote.fretePorFornecedor?.[nome] : undefined
  const cnpj = digitos(cnpjDoFornecedor)
  const geralDele = cnpj ? Object.fromEntries(geral.filter(([, dados]) => digitos(dados.camposPedido?.cnpjRemetente) === cnpj)) : {}
  return { ...geralDele, ...(legadoSoNome ?? {}), ...(proprio ?? {}) }
}

/** Medidas da carga salvas pra um fornecedor (+ UF) da cotação — com o mesmo aproveitamento do
 * formato antigo (só o nome) que o frete. */
export function cargaDoFornecedor(
  quote: Pick<QuoteRecord, 'items' | 'cargaFretePorFornecedor'>,
  remetente: RemetenteFrete,
): MedidasCargaFrete | undefined {
  const chave = chaveFornecedorFrete(remetente.nome, remetente.uf)
  const propria = quote.cargaFretePorFornecedor?.[chave]
  if (propria) return propria
  const nome = nomeNaChave(remetente.nome)
  return chave !== nome && ehPrimeiroGrupoDoFornecedor(quote, remetente) ? quote.cargaFretePorFornecedor?.[nome] : undefined
}

/** Salva os dados de pedido de frete (campos do formulário + valor/número da cotação recebida) de
 * uma transportadora pra um fornecedor (+ UF) específico da cotação, sem mexer nos das outras
 * transportadoras nem nos dos outros fornecedores — cada origem tem a sua própria cotação de frete.
 * Lê a versão atual do servidor antes de gravar (não usa a cópia da tela), pra não desfazer o que
 * outra aba salvou nesse meio-tempo. */
export const salvarFreteTransportadora = emFila(gravarFreteTransportadora)

// sem fila: quem chama já está na fila da cotação (limparCotacaoFreteTransportadora chama de dentro dela)
async function gravarFreteTransportadora(
  id: string,
  remetente: RemetenteFrete,
  transportadora: string,
  dados: DadosFreteTransportadora,
): Promise<QuoteRecord> {
  const atual = await dbGet<QuoteRecord | LegacyAnalysisRecord>(STORE_ANALISES, id)
  if (!atual) throw new Error('Cotação não encontrada no servidor.')
  const normalizado = normalizeRecord(atual)
  const chave = chaveFornecedorFrete(remetente.nome, remetente.uf)
  const dadosComData: DadosFreteTransportadora = { ...dados, salvoEm: Date.now() }
  const atualizado: QuoteRecord = chave
    ? {
        ...normalizado,
        fretePorFornecedor: {
          ...normalizado.fretePorFornecedor,
          [chave]: { ...freteDoFornecedor(normalizado, remetente), [transportadora]: dadosComData },
        },
        updatedAt: Date.now(),
      }
    : {
        // sem fornecedor definido nos itens ainda — guarda no conjunto geral da cotação
        ...normalizado,
        freteTransportadoras: { ...normalizado.freteTransportadoras, [transportadora]: dadosComData },
        updatedAt: Date.now(),
      }
  await dbPut(STORE_ANALISES, atualizado)
  return atualizado
}

/** Tira o valor/número da cotação de frete de uma transportadora (pra um fornecedor), mantendo os
 * campos do pedido de frete que já tinham sido preenchidos pra ela. */
export const limparCotacaoFreteTransportadora = emFila(async function limparCotacaoFreteTransportadora(
  id: string,
  remetente: RemetenteFrete,
  transportadora: string,
): Promise<QuoteRecord> {
  const atual = await dbGet<QuoteRecord | LegacyAnalysisRecord>(STORE_ANALISES, id)
  if (!atual) throw new Error('Cotação não encontrada no servidor.')
  const existente = freteDoFornecedor(normalizeRecord(atual), remetente)[transportadora]
  return gravarFreteTransportadora(id, remetente, transportadora, {
    camposPedido: existente?.camposPedido ?? {},
    valorCotacao: '',
    numeroCotacao: '',
  })
})

/** Medidas da carga (cm/kg) informadas na aba Frete pra um fornecedor (+ UF) da cotação — preenchem
 * sozinhas os campos de medida/peso do pedido de frete de todas as transportadoras. */
export const salvarCargaFrete = emFila(async function salvarCargaFrete(id: string, remetente: RemetenteFrete, carga: MedidasCargaFrete): Promise<QuoteRecord> {
  const atual = await dbGet<QuoteRecord | LegacyAnalysisRecord>(STORE_ANALISES, id)
  if (!atual) throw new Error('Cotação não encontrada no servidor.')
  const normalizado = normalizeRecord(atual)
  const atualizado: QuoteRecord = {
    ...normalizado,
    cargaFretePorFornecedor: {
      ...normalizado.cargaFretePorFornecedor,
      [chaveFornecedorFrete(remetente.nome, remetente.uf)]: carga,
    },
    updatedAt: Date.now(),
  }
  await dbPut(STORE_ANALISES, atualizado)
  return atualizado
})

/** Busca a versão atual de uma cotação direto do servidor (sem a lista inteira). */
export async function buscarQuote(id: string): Promise<QuoteRecord | undefined> {
  const atual = await dbGet<QuoteRecord | LegacyAnalysisRecord>(STORE_ANALISES, id)
  return atual ? normalizeRecord(atual) : undefined
}

/** Salva os valores "fechados" (Pedido de Compra) de todos os itens de uma vez — vem sempre do
 * objeto inteiro (mais simples que mesclar item a item, e a tela sempre edita a cotação inteira). */
export const salvarItensFechados = emFila(async function salvarItensFechados(id: string, itensFechados: Record<string, ItemFechado>): Promise<QuoteRecord> {
  const atual = await dbGet<QuoteRecord | LegacyAnalysisRecord>(STORE_ANALISES, id)
  if (!atual) throw new Error('Cotação não encontrada no servidor.')
  const normalizado = normalizeRecord(atual)
  const atualizado: QuoteRecord = { ...normalizado, itensFechados, updatedAt: Date.now() }
  await dbPut(STORE_ANALISES, atualizado)
  return atualizado
})

/** Salva os dados de transporte (NF, cotação do frete, transportadora, rastreio) dos fornecedores
 * informados, sem mexer nos dos outros — lendo a versão atual do servidor antes de gravar. */
export const salvarTransporte = emFila(async function salvarTransporte(id: string, porFornecedor: Record<string, DadosTransporte>): Promise<QuoteRecord> {
  const atual = await dbGet<QuoteRecord | LegacyAnalysisRecord>(STORE_ANALISES, id)
  if (!atual) throw new Error('Cotação não encontrada no servidor.')
  const normalizado = normalizeRecord(atual)
  // mescla por fornecedor: o que a tela não manda (ex.: a marca de entregue) continua como estava
  const transporte = { ...normalizado.transportePorFornecedor }
  for (const [chave, dados] of Object.entries(porFornecedor)) transporte[chave] = { ...transporte[chave], ...dados }
  const atualizado: QuoteRecord = {
    ...normalizado,
    transportePorFornecedor: transporte,
    updatedAt: Date.now(),
  }
  await dbPut(STORE_ANALISES, atualizado)
  return atualizado
})

/** Salva o faturamento da cotação (aba Faturamento): o quanto de cada item foi faturado e por qual
 * valor, mais o nº da nota de venda e a data — tudo de uma vez, lendo a versão atual do servidor
 * antes de gravar pra não desfazer o que outra aba salvou. */
export const salvarFaturamento = emFila(async function salvarFaturamento(
  id: string,
  dados: { itensFaturados: Record<string, ItemFaturado>; notaFaturamento: string; dataFaturamento: string },
): Promise<QuoteRecord> {
  const atual = await dbGet<QuoteRecord | LegacyAnalysisRecord>(STORE_ANALISES, id)
  if (!atual) throw new Error('Cotação não encontrada no servidor.')
  const normalizado = normalizeRecord(atual)
  const atualizado: QuoteRecord = {
    ...normalizado,
    itensFaturados: dados.itensFaturados,
    notaFaturamento: dados.notaFaturamento.trim() || undefined,
    dataFaturamento: dados.dataFaturamento || undefined,
    updatedAt: Date.now(),
  }
  await dbPut(STORE_ANALISES, atualizado)
  return atualizado
})

export const deleteQuote = emFila(async function deleteQuote(id: string, atorAdmin: string): Promise<void> {
  const atual = await dbGet<QuoteRecord | LegacyAnalysisRecord>(STORE_ANALISES, id)
  const normalizado = atual ? normalizeRecord(atual) : undefined
  if (normalizado && normalizado.status !== 'PENDENTE' && normalizado.responsavelStatus && normalizado.responsavelStatus !== atorAdmin) {
    throw new Error(
      `Essa cotação está sendo analisada por ${normalizado.responsavelStatus} — só ele(a) pode excluí-la agora.`,
    )
  }
  await dbDelete(STORE_ANALISES, id)
  // a planilha à parte vai junto (a cotação já foi; se esta falhar, sobra só um arquivo solto)
  if (normalizado?.planilhaOriginal && !normalizado.planilhaOriginal.conteudoBase64) {
    await excluirPlanilhaCliente(id).catch(() => {})
  }
})

/** Busca, no item mais recente com o mesmo código "Interno", os dados gerais do produto. */
export async function findByInterno(interno: string): Promise<ProductInput | undefined> {
  const target = interno.trim().toLowerCase()
  if (!target) return undefined
  const quotes = await listQuotes()
  for (const quote of quotes) {
    for (const item of quote.items) {
      if (item.product.interno.trim().toLowerCase() === target) {
        return item.product
      }
    }
  }
  return undefined
}

/** Mesma busca de `findByInterno`, mas pelo código "Referência". */
export async function findByReferencia(referencia: string): Promise<ProductInput | undefined> {
  const target = referencia.trim().toLowerCase()
  if (!target) return undefined
  const quotes = await listQuotes()
  for (const quote of quotes) {
    for (const item of quote.items) {
      if (item.product.referencia.trim().toLowerCase() === target) {
        return item.product
      }
    }
  }
  return undefined
}

export interface UltimoUsoDoProduto {
  product: ProductInput
  /** Código da cotação de onde veio esse preço (ex.: "COT-0042"). */
  codigo: string
  /** Quando essa cotação foi atualizada pela última vez. */
  data: number
}

/** Último uso de um produto (por Interno ou Referência) numa cotação — preferindo a cotação mais
 * recente em que ele JÁ TINHA preço (valor unitário > 0), pra "último preço usado" mostrar um valor
 * de verdade, e não um item que ainda estava esperando cotação. Sem nenhum uso com preço, cai pro
 * uso mais recente de qualquer jeito (ainda serve pra carregar descrição, NCM, peso etc.). */
export async function buscarUltimoUsoDoProduto(campo: 'interno' | 'referencia', valor: string): Promise<UltimoUsoDoProduto | undefined> {
  const target = valor.trim().toLowerCase()
  if (!target) return undefined
  const quotes = await listQuotes()
  let semPreco: UltimoUsoDoProduto | undefined
  for (const quote of quotes) {
    for (const item of quote.items) {
      if (item.product[campo].trim().toLowerCase() !== target) continue
      const uso = { product: item.product, codigo: quote.codigo, data: quote.updatedAt }
      if (item.product.valorUnt > 0) return uso
      semPreco ??= uso
    }
  }
  return semPreco
}
