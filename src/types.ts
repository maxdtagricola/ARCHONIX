import { makeId } from './utils'

// ---------------------------------------------------------------------------
// Acessos — só servem pra identificar quem criou cada cotação, sem senha nem
// permissões diferentes entre eles (todos têm acesso total ao app).
// ---------------------------------------------------------------------------
// nome com que o app conhece cada administrador (cotações, histórico) — os três iniciais, e quem o
// Max promover a administrador (ver Configurações › Usuários)
export type AdminName = string

export const ADMINS: AdminName[] = ['Maicon', 'Gouvêa', 'Max']

// ---------------------------------------------------------------------------
// Vendedor a quem a cotação se refere — usado pra organizar o histórico em
// pastas (admin > vendedor > mês).
// ---------------------------------------------------------------------------
export const VENDEDORES: string[] = ['EDSON', 'GABRIEL', 'SHELTON', 'BRUNO', 'JOAO', 'JOSE', 'THIAGO']

// ---------------------------------------------------------------------------
// Transportadoras cadastradas na aba Frete — lista inicial, cada uma com seu
// próprio espaço na aba.
// ---------------------------------------------------------------------------
export const TRANSPORTADORAS: string[] = ['CARVALIMA', 'EUCATUR', 'RODONAVES', 'VAPTLOG', 'GRANEXPRESS']

// ---------------------------------------------------------------------------
// Recebedores (filiais) sugeridos no Acompanhamento de notas.
// ---------------------------------------------------------------------------
export const RECEBEDORES: string[] = ['DANIEL TRATORES ARIQUEMES', 'DANIEL TRATORES RIO BRANCO', 'DANIEL TRATORES CEREJEIRAS']

// ---------------------------------------------------------------------------
// Notas fiscais — aba "Acompanhamento de notas", por enquanto só pro admin Max.
// Reaproveita o mesmo modelo de status das cotações (status + histórico), só
// que com os status do fluxo de recebimento de mercadoria.
// ---------------------------------------------------------------------------
export type NotaFiscalStatus =
  | 'AGUARDANDO COLETA'
  | 'EM TRANSPORTE'
  | 'EM VERIFICAÇÃO'
  | 'CONFERÊNCIA DO MATERIAL'
  | 'AGUARDANDO ENTRADA'
  | 'DEVOLUÇÃO PARCIAL'
  | 'DEVOLUÇÃO'
  | 'CONCLUIDO'
  // os criados pelo Max em Configurações (ver statusConfig.ts)
  | (string & {})

/** Os status do sistema, na ordem — a lista em uso (com os criados e os nomes editados) vem de statusConfig.ts. */
export const NOTA_FISCAL_STATUSES: NotaFiscalStatus[] = [
  'AGUARDANDO COLETA',
  'EM TRANSPORTE',
  'EM VERIFICAÇÃO',
  'CONFERÊNCIA DO MATERIAL',
  'AGUARDANDO ENTRADA',
  'DEVOLUÇÃO PARCIAL',
  'DEVOLUÇÃO',
  'CONCLUIDO',
]

export interface NotaFiscalStatusChange {
  status: NotaFiscalStatus
  changedAt: number
}

export type NotaFiscalTipo = 'PECAS' | 'IMPLEMENTOS'

export const NOTA_FISCAL_TIPOS: { value: NotaFiscalTipo; label: string }[] = [
  { value: 'PECAS', label: 'Peças' },
  { value: 'IMPLEMENTOS', label: 'Implementos' },
]

/** Por que algo foi transferido — o "selecionador" da nota e de cada produto dela, pra depois
 * filtrar quais transferências eram de fato necessárias (venda já fechada, oficina parada…) e quais
 * foram só reposição/remanejamento. Além dessas, aceita qualquer outra digitada na hora. */
export const NECESSIDADES_TRANSFERENCIA: { value: string; label: string }[] = [
  { value: 'VENDA', label: 'Venda (cliente aguardando)' },
  { value: 'OFICINA', label: 'Oficina / ordem de serviço' },
  { value: 'GARANTIA', label: 'Garantia' },
  { value: 'ESTOQUE', label: 'Reposição de estoque' },
  { value: 'REMANEJAMENTO', label: 'Remanejamento entre filiais' },
  { value: 'DEVOLUCAO', label: 'Devolução' },
]

export function labelNecessidade(valor: string | undefined): string {
  if (!valor) return ''
  return NECESSIDADES_TRANSFERENCIA.find((n) => n.value === valor)?.label ?? valor
}

/** O que aconteceu com o que foi transferido: faturado (virou venda) ou parado no estoque (não
 * vendeu — a transferência não gerou o lucro esperado e conta como prejuízo). Vazio = ainda não se
 * sabe. Vale pra nota inteira ou pra cada produto dela (o do produto, quando marcado, vence).
 * PARCIAL só existe no produto: parte da quantidade foi faturada (quantidadeFaturada) e o resto
 * continua parado no estoque. */
export type ResultadoTransferencia = '' | 'FATURADO' | 'ESTOQUE' | 'PARCIAL'

/** Resultados da nota inteira. */
export const RESULTADOS_TRANSFERENCIA: { value: Exclude<ResultadoTransferencia, ''>; label: string; curto: string }[] = [
  { value: 'FATURADO', label: 'Faturado', curto: 'Faturado' },
  { value: 'ESTOQUE', label: 'Parado no estoque (prejuízo)', curto: 'Estoque' },
]

/** Resultados de um produto — os da nota mais o faturado em parte. */
export const RESULTADOS_DO_PRODUTO: { value: Exclude<ResultadoTransferencia, ''>; label: string; curto: string }[] = [
  ...RESULTADOS_TRANSFERENCIA,
  { value: 'PARCIAL', label: 'Parcialmente faturado', curto: 'Parcial' },
]

export function labelResultado(valor: ResultadoTransferencia | undefined, curto = false): string {
  const r = RESULTADOS_DO_PRODUTO.find((x) => x.value === valor)
  return r ? (curto ? r.curto : r.label) : ''
}

/** Um produto da nota (as linhas "Dados do produto/serviço" da DANFE, ou os <det> do XML). */
export interface NotaFiscalItem {
  id: string
  /** Código do produto na nota (cProd) — normalmente o código interno da empresa. */
  codigo: string
  descricao: string
  ncm: string
  unidade: string
  quantidade: number
  valorUnitario: number
  valorTotal: number
  /** Necessidade da transferência desse produto — vazio = vale a da nota inteira. */
  necessidade: string
  /** Faturado / parado no estoque / parcialmente faturado — vazio = vale o da nota inteira. Registros
   * antigos não têm. */
  resultado?: ResultadoTransferencia
  /** Quantas unidades foram faturadas, quando o resultado é PARCIAL (o resto ficou no estoque). */
  quantidadeFaturada?: number
}

export interface NotaFiscal {
  id: string
  numeroNfe: string
  fornecedor: string
  recebedor: string
  transportadora: string
  valorNota: number
  valorFrete: number
  /** Data em que a nota foi emitida (YYYY-MM-DD) — pode ser anterior à data de registro no sistema. */
  dataEmissao: string
  tipo: NotaFiscalTipo
  /** Necessidade da transferência da nota como um todo (padrão pros produtos dela). Registros
   * antigos não têm. */
  necessidade?: string
  /** Faturado / parado no estoque, pra nota inteira (padrão pros produtos dela). */
  resultado?: ResultadoTransferencia
  /** Produtos a que a nota se refere. Registros antigos não têm. */
  itens?: NotaFiscalItem[]
  status: NotaFiscalStatus
  statusHistory: NotaFiscalStatusChange[]
  criadoPor: string
  createdAt: number
}

export const DEFAULT_NOTA_FISCAL: Omit<NotaFiscal, 'id' | 'criadoPor' | 'createdAt' | 'status' | 'statusHistory'> = {
  numeroNfe: '',
  fornecedor: '',
  recebedor: '',
  transportadora: '',
  valorNota: 0,
  valorFrete: 0,
  dataEmissao: '',
  tipo: 'PECAS',
  necessidade: '',
  resultado: '',
  itens: [],
}

// ---------------------------------------------------------------------------
// Estado de destino (perfil de cálculo) — cada planilha original (RBC, ICMS
// ST e alíquotas) foi construída para um estado de destino específico.
// ---------------------------------------------------------------------------
export type EstadoDestino = 'RO' | 'AC'

export const ESTADOS_DESTINO: { value: EstadoDestino; label: string }[] = [
  { value: 'RO', label: 'Rondônia' },
  { value: 'AC', label: 'Acre' },
]

// ---------------------------------------------------------------------------
// Dados de entrada do produto — espelham exatamente as colunas A:J da aba
// "Analise" da planilha original.
// ---------------------------------------------------------------------------
export interface ProductInput {
  perfil: EstadoDestino
  referencia: string
  ncm: string
  interno: string
  fornecedor: string
  marca: string
  /** Alíquota de frete sobre o valor do produto, em fração (0.05 = 5%) */
  freteRate: number
  estadoOrigem: string
  qtd: number
  descricao: string
  /** Valor unitário de compra (R$) */
  valorUnt: number
  /** Peso do produto, em kg */
  peso: number
  /** Prazo de entrega (texto livre, ex.: "IMEDIATO", "2 DIAS") — usado ao devolver a planilha do cliente preenchida. */
  prazoEntrega: string
  /** Observação do item (coluna "Observação" de Itens da cotação, no estilo comentário do Excel).
   * Itens salvos antes dela não têm. */
  observacao?: string
  /** Cotações de fornecedores registradas em "Comparar fornecedores" — a mais barata preenche fornecedor/marca/valorUnt automaticamente. */
  cotacoesFornecedores: CotacaoFornecedorItem[]
  /** Cotação escolhida à mão no comparador, mesmo mais cara — ela é quem preenche o item no lugar da
   * mais barata. Sem escolha (ou se ela sair ou deixar de atender), vale a mais barata. */
  cotacaoEscolhidaId?: string

  // Campos avançados — existem na planilha (colunas U, V, W, Y, Z, AA) mas
  // não fazem parte da entrada principal pedida. Têm padrão 0.
  stRetido: number
  outrasDespesas: number
  desconto: number
  ipi: number
  freteAdicional: number
  credIcmsFrete: number
}

export const DEFAULT_PRODUCT_INPUT: ProductInput = {
  perfil: 'RO',
  referencia: '',
  ncm: '',
  interno: '',
  fornecedor: '',
  marca: '',
  freteRate: 0,
  estadoOrigem: 'SP',
  qtd: 1,
  descricao: '',
  valorUnt: 0,
  peso: 0,
  prazoEntrega: '',
  cotacoesFornecedores: [],
  stRetido: 0,
  outrasDespesas: 0,
  desconto: 0,
  ipi: 0,
  freteAdicional: 0,
  credIcmsFrete: 0,
}

// ---------------------------------------------------------------------------
// Componentes de formação de preço — espelham a linha de configuração
// global (célula 8) da aba "Analise": IMP.FED, Outros, COMISSAO,
// CUSTO FIXO e LUCRO, todos em fração (0.25 = 25%).
// ---------------------------------------------------------------------------
export interface PricingConfig {
  impFedPct: number
  outrosPct: number
  comissaoPct: number
  custoFixoPct: number
  lucroPct: number
}

export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  impFedPct: 0.03,
  outrosPct: 0,
  comissaoPct: 0.04,
  custoFixoPct: 0.1,
  lucroPct: 0.25,
}

export const MARGENS_RAPIDAS = [0.1, 0.15, 0.2, 0.25] as const

// ---------------------------------------------------------------------------
// Item de uma cotação — a maioria das cotações reais tem vários produtos,
// cada um com seu próprio perfil de estado e sua própria formação de preço
// (comissão, margem etc. podem variar de item para item).
// ---------------------------------------------------------------------------
export interface QuoteItem {
  id: string
  product: ProductInput
  pricing: PricingConfig
}

export function createQuoteItem(): QuoteItem {
  return {
    id: makeId(),
    product: { ...DEFAULT_PRODUCT_INPUT },
    pricing: { ...DEFAULT_PRICING_CONFIG },
  }
}

// ---------------------------------------------------------------------------
// Classificação tributária de um item
// ---------------------------------------------------------------------------
export type ClassificacaoIcms = 'Normal' | 'RBC' | 'ST' | 'ST RET'
export type ClassificacaoPisCofins = 'Mono' | 'Poli'

export interface CalculationResult {
  classificacaoIcms: ClassificacaoIcms
  classificacaoPisCofins: ClassificacaoPisCofins
  isRbcElegivel: boolean
  /** Falso quando o NCM não aparece em nenhuma das tabelas da planilha de MARKUP (RBC, ICMS-ST, PIS/COFINS). */
  ncmCadastrado: boolean

  vlrProduto: number // X
  freteCalculado: number // T
  baseSubstituicao: number | null // AI
  mva: number | null // AJ
  icmsSubstituicao: number // AK
  icmsCreditoCompra: number // R

  custoFinalTotal: number // AL
  custoUnitario: number // AM

  cmvFracao: number // BB
  markupMultiplicador: number // BC
  viavel: boolean // BB > 0

  precoVendaTotal: number // AR
  precoVendaUnitario: number // AN
  indexador: number | null // BD

  breakdown: {
    impFed: number
    outros: number
    comissao: number
    custoFixo: number
    lucro: number
    pis: number
    cofins: number
    icmsRo: number
  }
}

// ---------------------------------------------------------------------------
// Status de uma cotação — acompanha o fluxo desde o pedido até o arquivo.
// ---------------------------------------------------------------------------
export type QuoteStatus =
  | 'PENDENTE'
  | 'AGUARDANDO FORNECEDOR'
  | 'ANALISANDO VALORES'
  | 'ENVIADO'
  | 'PEDIDO DE COMPRA'
  | 'PEDIDO CONFIRMADO'
  | 'EM TRANSPORTE'
  | 'CADASTRO DE PRODUTO'
  | 'PARCIALMENTE ENTREGUE'
  | 'ENTREGUE'
  | 'CONFERIDO'
  | 'FATURADO'
  | 'ARQUIVO'
  // os criados pelo Max em Configurações (ver statusConfig.ts)
  | (string & {})

/** Os status do sistema, na ordem — a lista em uso (com os criados e os nomes editados) vem de statusConfig.ts. */
export const QUOTE_STATUSES: QuoteStatus[] = [
  'PENDENTE',
  'AGUARDANDO FORNECEDOR',
  'ANALISANDO VALORES',
  'ENVIADO',
  'PEDIDO DE COMPRA',
  'PEDIDO CONFIRMADO',
  'EM TRANSPORTE',
  'CADASTRO DE PRODUTO',
  'PARCIALMENTE ENTREGUE',
  'ENTREGUE',
  'CONFERIDO',
  'FATURADO',
  'ARQUIVO',
]

/** Por que a cotação foi arquivada sem fechar — pedido sempre que ela vai pra ARQUIVO. */
export interface MotivoArquivamento {
  motivo: string
  detalhe: string
  em: number
  por: string
}

export const MOTIVOS_ARQUIVAMENTO = [
  'Preço acima da concorrência',
  'Prazo de entrega',
  'Cliente desistiu da compra',
  'Cliente não deu retorno',
  'Item indisponível / sem fornecedor',
  'Outro',
] as const

export interface StatusChange {
  status: QuoteStatus
  changedAt: number
  /** Status de onde veio (registros antigos não têm — vale o da mudança anterior). */
  de?: QuoteStatus
  /** Quem mudou (registros antigos não têm — era sempre o responsável pela cotação). */
  por?: string
}

// ---------------------------------------------------------------------------
// A que a cotação se refere — definido já na criação, antes de precificar.
// ---------------------------------------------------------------------------
export type TipoReferencia = 'planilha' | 'itens'

export const TIPOS_REFERENCIA: { value: TipoReferencia; label: string }[] = [
  { value: 'planilha', label: 'PLANILHA COMPLETA' },
  { value: 'itens', label: 'SOMENTE ALGUNS ITENS' },
]

/** Preenchido quando o status vira "PEDIDO DE COMPRA": pedido completo ou só alguns itens. */
export interface PedidoCompraInfo {
  tipo: 'completo' | 'parcial'
  itemIds: string[]
}

/** Preenchido quando o status vira "PEDIDO CONFIRMADO" (e atualizável no Pedido de Compra): o pedido
 * todo já está em produção no fornecedor, ou só parte dele. */
export interface ProducaoPedido {
  tipo: 'total' | 'parcial'
  /** Itens do pedido que já estão em produção — no total, todos. */
  itemIds: string[]
  observacao: string
  /** Quando o fornecedor diz que a produção fica pronta ("AAAA-MM-DD"; vazio = sem previsão) — pedido
   * com um fornecedor só (ou informado antes de existir a previsão por fornecedor). */
  previsaoFinalizacao?: string
  /** Pedido com mais de um fornecedor: a previsão de cada um, pela chave do pedido dele
   * (fornecedor + UF, a mesma do transporte). */
  previsaoPorFornecedor?: Record<string, string>
  em: number
  por: string
}

/** Valores "fechados" de um item na aba Pedido de Compra — separados de item.product de propósito:
 * a negociação inicial (feita na correria) e o que realmente saiu no fechamento com o fornecedor
 * costumam ser diferentes, e a comparação entre os dois só funciona se um não sobrescrever o outro. */
export interface ItemFechado {
  qtd: number
  valorUnt: number
  freteRate: number
}

/** Quanto de um item foi faturado pro cliente (aba Faturamento) — comparado com o preço de venda que
 * foi passado na cotação antes do pedido. Separado de item.product pelo mesmo motivo do ItemFechado:
 * um não pode sobrescrever o outro, senão a comparação some. */
export interface ItemFaturado {
  qtd: number
  valorUnt: number
  registradoEm: number
  registradoPor: string
}

/** Item que saiu de uma cotação — fica guardado no próprio registro dela, no servidor, com quem
 * tirou e quando: o item nunca some do sistema e dá pra trazer de volta. */
export interface ItemExcluidoCotacao {
  item: QuoteItem
  excluidoEm: number
  excluidoPor: string
}

// ---------------------------------------------------------------------------
// Pré-registro — lista rápida (Interno, Referência, Quantidade) dos itens que
// ainda precisam ser cotados, preenchida antes de ir pra precificação.
// ---------------------------------------------------------------------------
/** Uma cotação de preço devolvida por um fornecedor, pra comparar e escolher a melhor. */
export interface CotacaoFornecedorItem {
  id: string
  fornecedor: string
  marca: string
  valorUnitario: number
  /** Valor total cotado pelo fornecedor pra esse item — quando o fornecedor informou os dois (ex.:
   * na planilha, ou na mensagem/print da cotação), guarda o valor total dele mesmo, em vez de só
   * calcular unitário × quantidade; os dois às vezes divergem um pouco (arredondamento, desconto
   * fechado no total etc.) e vale a pena mostrar o que o fornecedor realmente cotou. */
  valorTotal?: number
  /** Prazo de entrega que esse fornecedor deu (texto livre, ex.: "IMEDIATO", "5 DIAS"). */
  prazoEntrega?: string
  /** NCM que esse fornecedor informou pro item (0000.00.00) — cada fornecedor pode classificar
   * diferente; o do fornecedor mais barato é o que vai pro item (ver aplicarCotacoes no comparador). */
  ncm?: string
  /** Quantas unidades o fornecedor tem pra atender — muitas vezes ele tem o item, mas não a
   * quantidade toda que precisamos; menor que a quantidade do item = cotação parcial (o resto tem
   * que vir de outro fornecedor). Vazio: atende a quantidade toda. */
  quantidadeDisponivel?: number
  /** UF de onde a mercadoria sai, quando o fornecedor informou (filial que fatura — ex.: TOLEAGRI
   * PR/SC/GO). Do mais barato, vira o estado de origem do item (muda o ICMS da compra). */
  ufOrigem?: string
  /** Observação do fornecedor pro item ("S/ PARAFUSO", IPI à parte…). */
  observacao?: string
}

export interface PreRegistroItem {
  id: string
  interno: string
  referencia: string
  /** Preenchida quando o item vem de uma planilha importada — ajuda a identificar o item mesmo sem Interno. */
  descricao?: string
  quantidade: number
  /** Cotações de fornecedores devolvidas pra esse item — a mais barata vira o valor/fornecedor ao ir pra precificação. */
  cotacoesFornecedores?: CotacaoFornecedorItem[]
}

// ---------------------------------------------------------------------------
// Registro salvo no histórico (IndexedDB) — uma cotação inteira, com um ou
// mais itens.
// ---------------------------------------------------------------------------

/** Dados do pedido de frete salvos por transportadora numa cotação — tanto os campos do
 * formulário de pedido (CNPJ, CEP, peso etc.) quanto o retorno dela (valor e número da cotação). */
export interface DadosFreteTransportadora {
  camposPedido: Record<string, string>
  valorCotacao: string
  numeroCotacao: string
  /** Quando foi salvo pela última vez. */
  salvoEm?: number
}

/** Envio de um fornecedor do pedido, preenchido quando a cotação vai pra EM TRANSPORTE (aba Pedido
 * de Compra) — cada fornecedor despacha com a nota, a transportadora e o rastreio dele. */
export interface DadosTransporte {
  numeroNotaFiscal: string
  numeroCotacaoFrete: string
  transportadora: string
  /** Página de acompanhamento da transportadora — abre numa aba nova. */
  linkRastreio: string
  /** Previsão de entrega que a transportadora informa no rastreio ("AAAA-MM-DD"; vazio = sem previsão). */
  previsaoEntrega?: string
  atualizadoEm: number
  atualizadoPor: string
  /** Quando a mercadoria desse fornecedor chegou (marcado no Pedido de Compra) e quem marcou. */
  entregueEm?: number
  entreguePor?: string
  /** A entrega foi marcada sozinha, quando o status da cotação foi pra ENTREGUE (ou além) — volta a
   * "não entregue" se o status voltar pra antes disso. Marcada à mão no Pedido de Compra: sem isso. */
  entregaPeloStatus?: boolean
}

/** Medidas da carga pro pedido de frete — comprimento/largura/altura sempre em centímetros e peso
 * em quilos, informados uma vez e repassados (já com a unidade) pra todas as transportadoras. */
export interface MedidasCargaFrete {
  comprimentoCm: number
  larguraCm: number
  alturaCm: number
  pesoKg: number
}

/** Um item como foi pro vendedor — as mesmas colunas da planilha do cliente (ver planilhaClientePadrao). */
export interface ItemValorEnviado {
  marca: string
  entrega: string
  referencia: string
  descricao: string
  quantidade: number
  valorUnitario: number
  valorTotal: number
}

export interface ValoresEnviados {
  itens: ItemValorEnviado[]
  total: number
  /** Quando foi pra ENVIADO (a primeira vez que o vendedor passou a ver valores) e quem mandou. */
  enviadoEm: number
  enviadoPor: string
  /** A última vez que quem cota confirmou trocar os valores — sem isso, são os do envio. */
  atualizadoEm?: number
  atualizadoPor?: string
}

/** Uma alteração do vendedor: o que mudou, campo por campo (texto pronto do servidor). */
export interface AlteracaoVendedor {
  id: string
  em: number
  /** Nome do vendedor no app (quem alterou). */
  por: string
  campos: { campo: string; antes: string; depois: string }[]
  /** Quem estava com a cotação na hora — é quem recebe o aviso; vazio = ninguém (todos veem). */
  para?: string
  /** Quem já viu o aviso (nomes no app). */
  vistaPor?: string[]
}

export interface QuoteRecord {
  id: string
  /** Código sequencial (ex.: "COT-0001") pra facilitar o acompanhamento — registros antigos podem não ter. */
  codigo: string
  /** Quem criou a cotação — só um identificador, não controla permissão. */
  criadoPor: string
  /** Vendedor a quem a cotação se refere — usado pra organizar o histórico em pastas. */
  vendedor: string
  /** Se a cotação se refere a uma planilha completa ou só a alguns itens. */
  tipoReferencia: TipoReferencia
  /** Dados iniciais da cotação — quem pediu e pra qual máquina, além dos itens. */
  cliente: string
  maquina: string
  /** Empresa do grupo (destinatário) pra qual essa cotação está sendo feita — usada pra carregar o frete automaticamente. */
  empresaId?: string
  items: QuoteItem[]
  /** Itens ainda não precificados — lista rápida preenchida antes da precificação. */
  itensPreRegistro: PreRegistroItem[]
  /** Planilha original enviada pelo cliente, guardada pra devolver com valores e prazos preenchidos. O
   * arquivo fica à parte (ver planilhasClienteRepo); `conteudoBase64` aqui dentro só nas cotações
   * gravadas antes disso, até a migração automática tirar. */
  planilhaOriginal?: { nomeArquivo: string; conteudoBase64?: string }
  status: QuoteStatus
  /** Admin que tirou a cotação de PENDENTE — só ele pode mudar o status até voltar pra PENDENTE. */
  responsavelStatus: string
  statusHistory: StatusChange[]
  pedidoCompra?: PedidoCompraInfo
  /** Produção do pedido no fornecedor (todo ou parte), informada ao confirmar o pedido. */
  producao?: ProducaoPedido
  /** Observação da cotação inteira (aba Cotações) — a de cada item fica no próprio item (product.observacao). */
  observacao?: string
  /** Data em que o cliente pediu a cotação (editável) — diferente de createdAt, que é quando o registro foi criado no sistema. */
  dataSolicitacao?: number
  /** Número da cotação de frete que a transportadora informou, pra referência depois. */
  numeroCotacaoTransportadora?: string
  /** Dados de pedido de frete + retorno (valor, número) salvos por transportadora, ver Frete —
   * formato antigo, um conjunto só pra cotação inteira (hoje só usado quando os itens ainda não têm
   * fornecedor definido). O atual é `fretePorFornecedor`. */
  freteTransportadoras?: Record<string, DadosFreteTransportadora>
  /** Frete separado por fornecedor (chave: nome do fornecedor dos itens em maiúsculas + UF de
   * origem, ver chaveFornecedorFrete) e, dentro dele, por transportadora — cada fornecedor (e cada
   * estado de onde ele despacha) tem as suas próprias cotações de frete. Registros de antes da
   * separação por UF têm a chave só com o nome. */
  fretePorFornecedor?: Record<string, Record<string, DadosFreteTransportadora>>
  /** Por que foi arquivada sem fechar (a última vez que foi pra ARQUIVO). */
  motivoArquivamento?: MotivoArquivamento
  /** Dados do envio (NF, cotação do frete, transportadora, rastreio) por fornecedor, informados ao
   * passar pra EM TRANSPORTE na aba Pedido de Compra — mesma chave do frete (ver chaveFornecedorFrete). */
  transportePorFornecedor?: Record<string, DadosTransporte>
  /** Medidas da carga (cm/kg) por fornecedor, informadas na aba Frete — mesma chave do frete. */
  cargaFretePorFornecedor?: Record<string, MedidasCargaFrete>
  /** Valores fechados por item na aba Pedido de Compra — chave é o id do QuoteItem. */
  itensFechados?: Record<string, ItemFechado>
  /** Valores faturados por item na aba Faturamento — chave é o id do QuoteItem. */
  itensFaturados?: Record<string, ItemFaturado>
  /** Nº da(s) nota(s) fiscal(is) de venda e data do faturamento (aba Faturamento). */
  notaFaturamento?: string
  dataFaturamento?: string
  /** Itens que já saíram dessa cotação — guardados aqui pra nunca sumirem do sistema. */
  itensExcluidos?: ItemExcluidoCotacao[]
  /** O que o vendedor vê de valores (ver valoresEnviados.ts): fica como estava ao ir pra ENVIADO, e só
   * muda quando quem cota confirma — o que mudar depois (no Pedido de Compra, por exemplo) não mexe. */
  valoresEnviados?: ValoresEnviados
  /** O que o vendedor alterou na cotação dele (gravado pelo servidor), pra quem cota ser avisado. */
  alteracoesVendedor?: AlteracaoVendedor[]
  createdAt: number
  updatedAt: number
  // resumo pré-calculado para exibição rápida na lista do histórico
  summary: {
    totalItens: number
    precoVendaTotalGeral: number
  }
}

// ---------------------------------------------------------------------------
// Catálogo de produtos — registro independente, sobrevive mesmo se todas as
// cotações onde o produto apareceu forem excluídas depois (sincronizado a
// partir delas, mas não derivado só delas — ver produtosRepo.ts).
// ---------------------------------------------------------------------------
/** Um registro de preço já visto pra um produto do catálogo — fornecedor, marca e valor unitário,
 * de quando esse item foi precificado numa cotação. */
export interface ProdutoCotacaoHistorico {
  fornecedor: string
  marca: string
  valorUnt: number
  registradoEm: number
}

export interface Produto {
  id: string
  interno: string
  descricao: string
  /** Pode ter mais de uma — fornecedores diferentes às vezes usam códigos diferentes pro mesmo item. */
  referencias: string[]
  ncm: string
  peso: number
  createdAt: number
  updatedAt: number
  /** As duas cotações mais baratas já vistas pra esse produto (fornecedor/marca/valor), a mais
   * barata sempre no índice 0 — pra saber rápido onde comprou mais barato e por quanto. */
  melhoresCotacoes?: ProdutoCotacaoHistorico[]
  /** Observação atrelada ao item: aparece quando ele é carregado em qualquer cotação (a observação
   * de uma cotação só fica em product.observacao, daquela cotação). */
  observacao?: string
}

// ---------------------------------------------------------------------------
// Cadastro de fornecedores — dados completos de endereço, para dar base a um
// futuro cálculo de frete a partir da origem de cada fornecedor.
// ---------------------------------------------------------------------------
export interface Fornecedor {
  id: string
  cnpj: string
  nome: string
  cep: string
  rua: string
  numero: string
  bairro: string
  cidade: string
  estado: string
}

export const DEFAULT_FORNECEDOR: Omit<Fornecedor, 'id'> = {
  cnpj: '',
  nome: '',
  cep: '',
  rua: '',
  numero: '',
  bairro: '',
  cidade: '',
  estado: 'RO',
}

// ---------------------------------------------------------------------------
// Empresas (do próprio grupo) que recebem os materiais — usadas como destino
// no cálculo de frete automático da aba Frete. Endereço completo, igual ao
// fornecedor.
// ---------------------------------------------------------------------------
// Campos espelham exatamente o quadro "Destinatário/Remetente" da NF-e (DANFE).
export interface Empresa {
  id: string
  nome: string
  cnpj: string
  endereco: string
  bairro: string
  cep: string
  municipio: string
  uf: string
  email: string
}

export const DEFAULT_EMPRESA: Omit<Empresa, 'id'> = {
  nome: '',
  cnpj: '',
  endereco: '',
  bairro: '',
  cep: '',
  municipio: '',
  uf: 'RO',
  email: '',
}
