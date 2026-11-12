import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Layout, type TabKey } from './components/Layout'
import { LoginPage } from './components/LoginPage'
import { MinhaContaModal } from './components/MinhaContaModal'
import { SaidaAutomatica } from './components/SaidaAutomatica'
import { nomeDaAba, usePermissoes } from './abasPermitidas'
import { carregarMinhasPermissoesStatus, carregarStatusConfig, nomeDoStatus, podeMudarStatusPara, statusAntesDe, useVersaoStatus } from './statusConfig'
import { TelaInicialPage } from './pages/TelaInicialPage'
import { useMinhaTelaInicial } from './telaInicialPorUsuario'
import { Dashboard } from './pages/Dashboard'
import { RecuperarRascunhoModal } from './components/RecuperarRascunhoModal'
import { DialogHost } from './components/DialogHost'
import { lerRascunho, limparRascunho, salvarRascunho, type RascunhoCotacao } from './rascunhoCotacao'
import { calculateItem, definirTabelasCustomizadas } from './calc/calculator'
import { formatCurrency, formatDate, mesmoFornecedor, valoresDaCotacaoDoFornecedor } from './utils'
import {
  atualizarValoresEnviados,
  buscarQuote,
  listQuotes,
  saveQuote,
  setPlanilhaOriginal,
  updateQuoteStatus,
  type OpcoesDoVendedor,
} from './db/analysesRepo'
import { totalAtualParaOVendedor, valoresMudaram } from './valoresEnviados'
import { aplicarItensDoVendedor } from './itensDoVendedor'
import { perguntarSeReenviaAoVendedor } from './mudancaDeStatus'
import { AvisoAlteracoesVendedor } from './components/AvisoAlteracoesVendedor'
import { lerPlanilhaCliente } from './db/planilhasClienteRepo'
import { observacoesPorReferencia, sincronizarProdutos } from './db/produtosRepo'
import {
  DEFAULT_PRICING_GLOBAL,
  getFeriadosExtras,
  getPlanilhaAtivaIds,
  getPricingGlobal,
  listPlanilhas,
  setPricingGlobal,
  type PricingGlobal,
} from './db/configRepo'
import { listEmpresas } from './db/empresasRepo'
import { atualizarUsuarioLogado, listarUsuarios, sair } from './auth'
import { getSessao, useSessao, type UsuarioLogado } from './sessaoUsuario'
import { definirFeriadosExtras } from './diasUteis'
import { AvisoEntregas } from './components/AvisoEntregas'
import { useEstadoPersistente } from './estadoPersistente'
import { DIAS_PARA_RETORNO, cotacoesEsperandoRetorno } from './retornoCotacao'
import { avisar, confirmar } from './dialogs'
import { notificar } from './notificacoesDoSistema'
import { createQuoteItem } from './types'
import type { ItemCotacaoImportado } from './quoteImport'
import type {
  AdminName,
  Empresa,
  EstadoDestino,
  ItemExcluidoCotacao,
  PricingConfig,
  ProductInput,
  QuoteItem,
  QuoteRecord,
  QuoteStatus,
  TipoReferencia,
} from './types'

// Cada aba (menos a Tela Inicial e a Precificação, as mais usadas) só é baixada quando é aberta pela
// primeira vez — com elas vão as bibliotecas pesadas de planilha e PDF, que deixam de atrasar a
// abertura do site (o pacote inicial tinha 2,7 MB)
const CotacoesPage = lazy(() => import('./pages/CotacoesPage').then((m) => ({ default: m.CotacoesPage })))
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })))
const ConfiguracoesPage = lazy(() => import('./pages/ConfiguracoesPage').then((m) => ({ default: m.ConfiguracoesPage })))
const CompararFornecedoresPage = lazy(() =>
  import('./pages/CompararFornecedoresPage').then((m) => ({ default: m.CompararFornecedoresPage })),
)
const FaturamentoPage = lazy(() => import('./pages/FaturamentoPage').then((m) => ({ default: m.FaturamentoPage })))
const RelatoriosPage = lazy(() => import('./pages/RelatoriosPage').then((m) => ({ default: m.RelatoriosPage })))
const ProdutosPage = lazy(() => import('./pages/ProdutosPage').then((m) => ({ default: m.ProdutosPage })))
const FornecedoresPage = lazy(() => import('./pages/FornecedoresPage').then((m) => ({ default: m.FornecedoresPage })))
const FretePage = lazy(() => import('./pages/FretePage').then((m) => ({ default: m.FretePage })))
const PedidoCompraPage = lazy(() => import('./pages/PedidoCompraPage').then((m) => ({ default: m.PedidoCompraPage })))
const AcompanhamentoNotasPage = lazy(() =>
  import('./pages/AcompanhamentoNotasPage').then((m) => ({ default: m.AcompanhamentoNotasPage })),
)
const NotasFiscaisPage = lazy(() => import('./pages/NotasFiscaisPage').then((m) => ({ default: m.NotasFiscaisPage })))
const NotasFiscaisDashboardPage = lazy(() =>
  import('./pages/NotasFiscaisDashboardPage').then((m) => ({ default: m.NotasFiscaisDashboardPage })),
)
const HistoryPage = lazy(() => import('./pages/HistoryPage').then((m) => ({ default: m.HistoryPage })))
const PlanilhaClienteModal = lazy(() =>
  import('./components/PlanilhaClienteModal').then((m) => ({ default: m.PlanilhaClienteModal })),
)
// o site do vendedor (só as cotações dele) — quem é administrador nunca baixa
const AppVendedor = lazy(() => import('./vendedor/AppVendedor').then((m) => ({ default: m.AppVendedor })))

function CarregandoAba() {
  return <p className="py-16 text-center text-sm text-ink-400">Carregando…</p>
}

/** Entrada do app: sem usuário logado, a tela de login; com usuário, o site todo (administrador), as
 * cotações dele (vendedor) ou só a própria conta (quem se cadastrou e ainda não ganhou função do Max). */
export default function App() {
  const sessao = useSessao()

  // a função do usuário pode ter mudado desde o último acesso (o Max define) — confere ao abrir;
  // se a sessão não valer mais, db.ts limpa e esta tela volta pro login sozinha
  useEffect(() => {
    if (sessao) atualizarUsuarioLogado().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessao?.token])

  if (!sessao) {
    return (
      <>
        <LoginPage />
        <DialogHost />
      </>
    )
  }
  return (
    <>
      {sessao.usuario.papel === 'vendedor' ? (
        <Suspense fallback={<CarregandoAba />}>
          <AppVendedor key={sessao.usuario.login} usuario={sessao.usuario} />
        </Suspense>
      ) : sessao.usuario.papel !== 'admin' ? (
        <AreaSemFuncao usuario={sessao.usuario} />
      ) : (
        // key: outro usuário entrando começa do zero (abas, cotação aberta...)
        <AppAdmin key={sessao.usuario.login} usuario={sessao.usuario} />
      )}
      {/* key: cada login novo começa a contar do zero */}
      <SaidaAutomatica key={sessao.token} />
    </>
  )
}

/** Quem ainda não tem função definida: só a própria conta, sem a barra de abas. */
function AreaSemFuncao({ usuario }: { usuario: UsuarioLogado }) {
  const [mostrarMinhaConta, setMostrarMinhaConta] = useState(false)
  return (
    <div className="min-h-screen bg-ink-50">
      <header className="flex items-center justify-between gap-3 border-b border-ink-100 bg-surface px-4 py-3">
        <p className="text-sm font-medium text-ink-700">
          Olá, <span className="font-semibold">{usuario.exibicao}</span>
        </p>
        <div className="flex items-center gap-4">
          <button type="button" onClick={() => setMostrarMinhaConta(true)} className="text-xs text-ink-500 hover:text-ink-700 underline">
            Minha conta
          </button>
          <button type="button" onClick={() => void sair()} className="text-xs text-ink-500 hover:text-ink-700 underline">
            Sair
          </button>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-6">
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Seu cadastro está com o administrador, que vai definir sua função no site.</p>
      </main>
      {mostrarMinhaConta && <MinhaContaModal usuario={usuario} onFechar={() => setMostrarMinhaConta(false)} />}
      <DialogHost />
    </div>
  )
}

function AppAdmin({ usuario }: { usuario: UsuarioLogado }) {
  // o nome com que o app conhece o usuário (cotações, histórico, abas exclusivas) — MÁXIMUS é "Max"
  const currentAdmin: AdminName = usuario.nome
  // as abas que este usuário vê (o Max escolhe em Configurações > Usuários)
  const permissoes = usePermissoes(usuario)
  const { podeVer } = permissoes
  // o que aparece na Tela Inicial deste usuário (também escolhido pelo Max)
  const partesTelaInicial = useMinhaTelaInicial(usuario)
  // todo mundo (o Max também) começa na Tela Inicial
  const [tab, setTab] = useState<TabKey>('telaInicial')
  // a lista de abas chegou do servidor e esta não está nela: volta pra Tela Inicial
  useEffect(() => {
    if (!podeVer(tab)) setTab('telaInicial')
  }, [podeVer, tab])
  // vídeo de fundo: pausado ou não é preferência deste aparelho
  const [fundoPausado, setFundoPausado] = useEstadoPersistente('telaInicial:fundoPausado', false)
  const alternarFundo = () => setFundoPausado((v) => !v)
  // atalhos "Nova cotação" / "Importar cotação" da Tela Inicial: a aba Cotações já abre no modo certo
  const [modoNovoCotacao, setModoNovoCotacao] = useState<'manual' | 'importar'>('manual')
  // e a parte "Nova cotação" abre mesmo se estava recolhida
  const [abrirNovaCotacao, setAbrirNovaCotacao] = useState(false)
  useEffect(() => {
    if (tab === 'cotacoes') return
    setModoNovoCotacao('manual')
    setAbrirNovaCotacao(false)
  }, [tab])

  // feriados locais (Configurações › Feriados) — entram na contagem de dias úteis das telas
  useEffect(() => {
    getFeriadosExtras()
      .then(definirFeriadosExtras)
      .catch(() => {
        // sem servidor agora: contam só os nacionais e os fins de semana
      })
  }, [])

  // os status (nomes, ordem, os criados pelo Max) e pra quais este usuário pode mudar
  useVersaoStatus()
  useEffect(() => {
    carregarStatusConfig().catch(() => {
      // sem servidor agora: fica a última configuração vista neste aparelho
    })
    carregarMinhasPermissoesStatus(usuario.login, usuario.gestor).catch(() => {
      // sem servidor agora: o servidor confere de novo quando a mudança chegar
    })
  }, [usuario.login, usuario.gestor])

  // cotação enviada há 7 dias ou mais e ainda em ENVIADO: quem enviou é avisado, uma vez por sessão,
  // pra atualizar o status (fechou → pedido de compra; não fechou → arquivar com o motivo) — só quem
  // tem o "Retorno do cliente" na Tela Inicial (null = a lista ainda não chegou)
  const veRetorno = partesTelaInicial === null ? null : partesTelaInicial.includes('retorno')
  useEffect(() => {
    const sessao = getSessao()
    if (!sessao || !veRetorno) return
    const chave = `avisoRetorno:${sessao.token.slice(0, 12)}`
    if (sessionStorage.getItem(chave)) return
    // marcado antes de perguntar ao servidor: o efeito pode rodar duas vezes seguidas (StrictMode)
    sessionStorage.setItem(chave, '1')
    listQuotes()
      .then(async (lista) => {
        const esperando = cotacoesEsperandoRetorno(lista, currentAdmin)
        if (esperando.length === 0) return
        const codigos = esperando.map((r) => r.codigo || r.cliente).join(', ')
        notificar(`retorno:${chave}`, {
          titulo: 'Retorno do cliente',
          texto: `${esperando.length === 1 ? 'Uma cotação enviada' : `${esperando.length} cotações enviadas`} há ${DIAS_PARA_RETORNO} dias ou mais ainda sem retorno: ${codigos}.`,
        })
        const ver = await confirmar(
          `${esperando.length === 1 ? 'Uma cotação enviada' : `${esperando.length} cotações enviadas`} por você há ${DIAS_PARA_RETORNO} dias ou mais ` +
            `${esperando.length === 1 ? 'ainda está' : 'ainda estão'} como ${nomeDoStatus('ENVIADO')} (${codigos}).\n\n` +
            'Atualize o status: se fechou, siga pro pedido de compra; se não fechou, arquive com o motivo.',
          { titulo: 'Retorno do cliente', confirmText: 'Ver na Tela Inicial', cancelText: 'Depois' },
        )
        if (ver) changeTab('telaInicial')
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [veRetorno])

  // quem gerencia os usuários (o Max) é avisado, uma vez por sessão, de cadastros esperando função
  useEffect(() => {
    const sessao = getSessao()
    if (!usuario.gestor || !sessao) return
    const chave = `avisoCadastros:${sessao.token.slice(0, 12)}`
    if (sessionStorage.getItem(chave)) return
    // marcado antes de perguntar ao servidor: o efeito pode rodar duas vezes seguidas (StrictMode)
    sessionStorage.setItem(chave, '1')
    listarUsuarios()
      .then((lista) => {
        const pendentes = lista.filter((u) => u.pendente)
        if (pendentes.length === 0) return
        const texto =
          `${pendentes.map((u) => u.exibicao).join(', ')} se ${pendentes.length > 1 ? 'cadastraram' : 'cadastrou'} no site e ` +
          `${pendentes.length > 1 ? 'esperam' : 'espera'} você definir a função. Veja em Configurações › Usuários.`
        notificar(`cadastros:${pendentes.map((u) => u.login).join(',')}`, { titulo: 'Novos usuários', texto })
        void avisar(texto, { titulo: 'Novos usuários' })
      })
      .catch(() => {})
  }, [usuario.gestor])
  // clique numa nota do aviso de entregas: Pedido de Compra já com a janela do transporte dela
  const [transporteParaAbrir, setTransporteParaAbrir] = useState<{ cotacaoId: string; vez: number } | undefined>(undefined)
  // "Abrir pedido" na janela de transporte da Tela Inicial: Pedido de Compra já com essa cotação aberta
  const [pedidoParaAbrir, setPedidoParaAbrir] = useState<{ cotacaoId: string; vez: number } | undefined>(undefined)
  // saindo do Pedido de Compra, os pedidos de abrir já foram atendidos — não abrem de novo na próxima visita
  useEffect(() => {
    if (tab === 'pedidoCompra') return
    setTransporteParaAbrir(undefined)
    setPedidoParaAbrir(undefined)
  }, [tab])
  // pilha de telas visitadas, pro botão "Voltar" — só empilha quando a aba realmente muda (evita
  // entradas repetidas se algo chamar changeTab pra aba em que já se está)
  const [tabHistory, setTabHistory] = useState<TabKey[]>([])
  function changeTab(novaTab: TabKey) {
    if (!podeVer(novaTab)) {
      void avisar(`Você não tem acesso à aba ${nomeDaAba(novaTab)}. Peça ao MÁXIMUS pra liberar em Configurações › Usuários.`)
      return
    }
    setTab((atual) => {
      if (atual !== novaTab) setTabHistory((prev) => [...prev, atual])
      return novaTab
    })
  }
  // Expandir/recolher menu ficou logo acima de Voltar na barra lateral — os dois próximos, um
  // clique errado em Voltar por querer o de expandir agora não arrisca perder trabalho: havendo
  // alteração não salva na cotação aberta, pergunta antes de sair (ver temAlteracoesNaoSalvas).
  async function handleVoltar() {
    if (temAlteracoesNaoSalvas) {
      const querSalvar = await confirmar('Esta cotação tem alterações que ainda não foram salvas. Deseja salvar antes de voltar?', {
        confirmText: 'Salvar e voltar',
        cancelText: 'Voltar sem salvar',
      })
      if (querSalvar) await handleSave()
    }
    setTabHistory((prev) => {
      if (prev.length === 0) return prev
      const proxima = prev.slice(0, -1)
      setTab(prev[prev.length - 1])
      return proxima
    })
  }
  const [vendedor, setVendedor] = useState('')
  const [tipoReferencia, setTipoReferencia] = useState<TipoReferencia>('itens')
  const [cliente, setCliente] = useState('')
  const [maquina, setMaquina] = useState('')
  const [empresaId, setEmpresaId] = useState('')
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [items, setItems] = useState<QuoteItem[]>(() => [createQuoteItem()])
  const [activeItemId, setActiveItemId] = useState<string>(() => items[0].id)
  const [editingQuoteId, setEditingQuoteId] = useState<string | undefined>(undefined)
  const [codigoCotacao, setCodigoCotacao] = useState('')
  const [activeStatus, setActiveStatus] = useState<QuoteStatus>('PENDENTE')
  const [activeResponsavel, setActiveResponsavel] = useState('')
  const [activeCreatedAt, setActiveCreatedAt] = useState<number | undefined>(undefined)
  const [dataSolicitacao, setDataSolicitacao] = useState<number | undefined>(undefined)
  // itens que saíram da cotação: os já arquivados no servidor (vêm com o registro) e os tirados agora,
  // na tela, que só vão pro arquivo no próximo "Salvar cotação" — os dois dá pra trazer de volta
  const [itensExcluidosSalvos, setItensExcluidosSalvos] = useState<ItemExcluidoCotacao[]>([])
  const [itensExcluidosPendentes, setItensExcluidosPendentes] = useState<ItemExcluidoCotacao[]>([])
  // o que o vendedor pediu/mudou e entrou nos itens ao abrir a cotação — vai junto no próximo salvar
  const [doVendedor, setDoVendedor] = useState<OpcoesDoVendedor | undefined>(undefined)
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)
  const [pricingGlobal, setPricingGlobalState] = useState<PricingGlobal>(DEFAULT_PRICING_GLOBAL)
  const [tabelasVersion, setTabelasVersion] = useState(0)
  const [planilhaOriginal, setPlanilhaOriginalState] = useState<QuoteRecord['planilhaOriginal']>(undefined)
  const [mostrarPlanilhaCliente, setMostrarPlanilhaCliente] = useState(false)
  const planilhaDoCliente = planilhaOriginal
    ? { nomeArquivo: planilhaOriginal.nomeArquivo, carregar: () => lerPlanilhaCliente(editingQuoteId ?? '', planilhaOriginal) }
    : undefined
  const [rascunhoDisponivel, setRascunhoDisponivel] = useState<RascunhoCotacao | undefined>(undefined)
  // true logo depois de "Salvar cotação" até a primeira alteração seguinte — enquanto estiver
  // true, qualquer tentativa de mexer num dado já salvo passa primeiro por confirmação (ver
  // confirmarAlteracaoSeJaSalva). Assim que confirmado uma vez, some até o próximo salvamento.
  // Ref, não estado: a guarda da digitação precisa saber na hora (sem esperar o React redesenhar)
  const salvoInalteradoRef = useRef(false)
  const setSalvoInalterado = (valor: boolean) => {
    salvoInalteradoRef.current = valor
  }
  // true só por alguns segundos depois de salvar, pra mostrar "Cotação salva!" ao lado do botão
  const [cotacaoRecemSalva, setCotacaoRecemSalva] = useState(false)
  // true assim que qualquer edição é aplicada (ver protegido) e volta a false só depois de salvar,
  // começar uma cotação nova ou abrir outra — usado pelo Voltar da barra lateral pra perguntar se
  // quer salvar antes de sair, em vez de simplesmente descartar a edição em andamento
  const [temAlteracoesNaoSalvas, setTemAlteracoesNaoSalvas] = useState(false)

  // ao abrir o app, verifica se sobrou algum rascunho de uma queda/fechamento anterior
  useEffect(() => {
    const rascunho = lerRascunho()
    if (rascunho) setRascunhoDisponivel(rascunho)
  }, [])

  // salva o estado da cotação aberta a cada mudança (com um pequeno atraso), pra não perder
  // nada se a página fechar/travar antes do próximo "Salvar" manual
  useEffect(() => {
    if (!editingQuoteId) return
    const timer = setTimeout(() => {
      salvarRascunho({
        editingQuoteId,
        codigo: codigoCotacao,
        vendedor,
        tipoReferencia,
        cliente,
        maquina,
        empresaId,
        items,
        activeItemId,
        activeStatus,
        activeResponsavel,
        planilhaOriginal,
      })
    }, 1500)
    return () => clearTimeout(timer)
  }, [
    editingQuoteId,
    codigoCotacao,
    vendedor,
    tipoReferencia,
    cliente,
    maquina,
    empresaId,
    items,
    activeItemId,
    activeStatus,
    activeResponsavel,
    planilhaOriginal,
  ])

  // formação de preço global — carrega do servidor e mantém os itens sincronizados
  useEffect(() => {
    getPricingGlobal()
      .then(setPricingGlobalState)
      .catch(() => {
        // se falhar, segue com os valores padrão
      })
  }, [])

  // empresas do grupo — usadas no seletor "pra qual empresa é essa cotação" e no frete automático
  useEffect(() => {
    listEmpresas()
      .then(setEmpresas)
      .catch(() => {
        // sem servidor no momento — segue sem a lista, o seletor fica vazio até recarregar
      })
  }, [])

  useEffect(() => {
    setItems((prev) => prev.map((item) => ({ ...item, pricing: { ...item.pricing, ...pricingGlobal } })))
  }, [pricingGlobal])

  // planilhas de markup customizadas (se alguma tiver sido importada e salva antes)
  useEffect(() => {
    async function carregarTabelasCustomizadas() {
      try {
        const [ativas, todas] = await Promise.all([getPlanilhaAtivaIds(), listPlanilhas()])
        let mudou = false
        for (const perfil of Object.keys(ativas) as EstadoDestino[]) {
          const id = ativas[perfil]
          const planilha = todas.find((p) => p.id === id)
          if (planilha) {
            definirTabelasCustomizadas(perfil, planilha)
            mudou = true
          }
        }
        if (mudou) setTabelasVersion((v) => v + 1)
      } catch {
        // tabelas customizadas são opcionais — sem elas, seguem as tabelas padrão
      }
    }
    carregarTabelasCustomizadas()
  }, [])

  function criarItemComGlobais(): QuoteItem {
    const item = createQuoteItem()
    return { ...item, pricing: { ...item.pricing, ...pricingGlobal } }
  }

  // Memoizado pra não gerar um item novo (com id novo) a cada render — se não, a key
  // do ProductForm ficaria mudando sozinha e ele nunca ficaria "parado" na tela.
  const activeItem = useMemo(
    () => items.find((item) => item.id === activeItemId) ?? items[0] ?? criarItemComGlobais(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, activeItemId],
  )
  const result = useMemo(
    () => calculateItem(activeItem.product, activeItem.pricing),
    // tabelasVersion de propósito: as planilhas de markup customizadas ficam fora do React
    // (calculator.ts) e ela muda quando são trocadas — é o que faz recalcular
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeItem, tabelasVersion],
  )

  function handleRecuperarRascunho() {
    if (!rascunhoDisponivel) return
    const r = rascunhoDisponivel
    setVendedor(r.vendedor)
    setTipoReferencia(r.tipoReferencia)
    setCliente(r.cliente)
    setMaquina(r.maquina)
    setEmpresaId(r.empresaId ?? '')
    setItems(r.items)
    setActiveItemId(r.activeItemId)
    setEditingQuoteId(r.editingQuoteId)
    setCodigoCotacao(r.codigo)
    setActiveStatus(r.activeStatus)
    setActiveResponsavel(r.activeResponsavel)
    setPlanilhaOriginalState(r.planilhaOriginal)
    setItensExcluidosPendentes([])
    setDoVendedor(undefined)
    setItensExcluidosSalvos([])
    buscarQuote(r.editingQuoteId)
      .then((registro) => setItensExcluidosSalvos(registro?.itensExcluidos ?? []))
      .catch(() => {
        // sem servidor agora: a lista de excluídos só aparece depois do próximo salvar/abrir
      })
    changeTab('dashboard')
    setRascunhoDisponivel(undefined)
  }

  function handleDescartarRascunho() {
    limparRascunho()
    setRascunhoDisponivel(undefined)
  }

  async function handleSavePricingGlobal(valores: PricingGlobal) {
    await setPricingGlobal(valores)
    setPricingGlobalState(valores)
  }

  // assim que um valor unitário é preenchido, a cotação sai de "pendente" pra "analisando
  // valores" sozinha — não precisa mais passar por "itens a cotar"/"usar na precificação" pra
  // isso acontecer. Dispara sem esperar (a tela já reflete o status novo na hora; se o servidor
  // falhar, o pior caso é o status ficar desatualizado até a próxima ação, sem travar a digitação)
  function promoverStatusPorValorUnitario() {
    if (!editingQuoteId || !currentAdmin || activeStatus !== 'PENDENTE') return
    // sem permissão pra esse status (Configurações > Usuários > Status), a cotação fica como está
    if (!podeMudarStatusPara('cotacoes', 'ANALISANDO VALORES')) return
    setActiveStatus('ANALISANDO VALORES')
    setActiveResponsavel(currentAdmin)
    updateQuoteStatus(editingQuoteId, 'ANALISANDO VALORES', currentAdmin)
      .then(() => setHistoryRefreshKey((k) => k + 1))
      .catch(() => {
        // não interrompe a digitação por causa disso — na pior das hipóteses o status na tela
        // fica um passo à frente do servidor até a próxima ação bem-sucedida
      })
  }

  // guarda de confirmação: se a cotação acabou de ser salva e ainda não sofreu nenhuma alteração
  // desde então, a primeira tentativa de mexer em qualquer dado pede confirmação ao admin. Uma vez
  // confirmada (ou se a cotação nunca foi salva/já tinha sido alterada), libera normalmente e só
  // volta a perguntar depois do próximo "Salvar cotação".
  // uma pergunta só por vez: vários toques/teclas antes da caixa abrir esperam a mesma resposta (antes
  // cada um abria a sua caixa e, confirmando, todos eram aplicados)
  const confirmacaoPendente = useRef<Promise<boolean> | null>(null)
  async function confirmarAlteracaoSeJaSalva(): Promise<boolean> {
    if (!salvoInalteradoRef.current) return true
    if (!confirmacaoPendente.current) {
      confirmacaoPendente.current = confirmar('Esta cotação já foi salva. Tem certeza que quer alterar um dado que já foi salvo?')
        .then((querAlterar) => {
          if (querAlterar) {
            salvoInalteradoRef.current = false
            setSalvoInalterado(false)
          }
          return querAlterar
        })
        .finally(() => {
          confirmacaoPendente.current = null
        })
    }
    return confirmacaoPendente.current
  }

  // na Precificação, com a cotação salva e sem alteração, nada é digitado antes da confirmação: a
  // digitação (e colar/arrastar) é barrada já no campo, pergunta uma vez, e depois de confirmar o
  // cursor volta pro mesmo campo pra digitar de novo. Os campos de apoio (busca, ações nos marcados,
  // margem única) ficam de fora com data-sem-guarda — eles só mudam algo ao clicar em "Aplicar".
  const guardaRef = useRef<HTMLDivElement>(null)
  const confirmarRef = useRef(confirmarAlteracaoSeJaSalva)
  confirmarRef.current = confirmarAlteracaoSeJaSalva
  useEffect(() => {
    const raiz = guardaRef.current
    if (!raiz) return
    function barrar(e: Event) {
      if (!salvoInalteradoRef.current) return
      const alvo = e.target
      if (!(alvo instanceof HTMLElement) || alvo.closest('[data-sem-guarda]')) return
      // o balão da observação é desenhado fora da área (ver CelulaObservacao), mas escreve na cotação igual
      if (!raiz?.contains(alvo) && !alvo.closest('[data-linha-item]')) return
      const campo = alvo.closest('input, textarea, select, [contenteditable="true"]') as HTMLElement | null
      if (!campo) return
      if (campo instanceof HTMLInputElement && ['checkbox', 'radio', 'button', 'submit'].includes(campo.type)) return
      e.preventDefault()
      e.stopPropagation()
      void confirmarRef.current().then((ok) => {
        if (ok) campo.focus()
      })
    }
    // teclas que mexem no valor sem passar por "beforeinput" (setas num campo de número)
    function barrarTecla(e: KeyboardEvent) {
      if (!salvoInalteradoRef.current || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
      const alvo = e.target as HTMLElement | null
      if (alvo instanceof HTMLInputElement && alvo.type === 'number' && !alvo.closest('[data-sem-guarda]')) e.preventDefault()
    }
    document.addEventListener('beforeinput', barrar, true)
    document.addEventListener('paste', barrar, true)
    document.addEventListener('drop', barrar, true)
    raiz.addEventListener('keydown', barrarTecla, true)
    return () => {
      document.removeEventListener('beforeinput', barrar, true)
      document.removeEventListener('paste', barrar, true)
      document.removeEventListener('drop', barrar, true)
      raiz.removeEventListener('keydown', barrarTecla, true)
    }
  }, [tab])

  // envolve um setter/handler de edição com a guarda acima — usado nos callbacks passados pro
  // Dashboard, pra não duplicar o "if (!(await confirmarAlteracaoSeJaSalva())) return" em cada um
  function protegido<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
    return (...args: A) => {
      // sem confirmação pendente, aplica na hora (síncrono): campo controlado precisa receber o valor
      // novo ainda dentro do evento de digitação — esperar um await aqui fazia o React devolver o
      // valor antigo pro campo e depois aplicar o novo, jogando o cursor pro fim a cada letra (quem
      // corrigia algo no meio do texto só conseguia digitar uma letra por vez)
      if (!salvoInalteradoRef.current) {
        fn(...args)
        setTemAlteracoesNaoSalvas(true)
        return
      }
      void (async () => {
        if (!(await confirmarAlteracaoSeJaSalva())) return
        fn(...args)
        setTemAlteracoesNaoSalvas(true)
      })()
    }
  }

  function patchActivePricing(patch: Partial<PricingConfig>) {
    setItems((prev) => prev.map((item) => (item.id === activeItemId ? { ...item, pricing: { ...item.pricing, ...patch } } : item)))
  }
  function patchItemProduct(id: string, patch: Partial<ProductInput>) {
    // trocar só o fornecedor (digitando, escolhendo na lista ou aplicando aos marcados) puxa o preço,
    // a marca, o prazo e o NCM da cotação desse fornecedor na comparação, se ele tiver uma
    const atual = items.find((item) => item.id === id)
    const daCotacao: Partial<ProductInput> =
      atual && patch.fornecedor !== undefined && patch.valorUnt === undefined && !mesmoFornecedor(patch.fornecedor, atual.product.fornecedor)
        ? valoresDaCotacaoDoFornecedor(atual.product.cotacoesFornecedores, patch.fornecedor)
        : {}
    const completo: Partial<ProductInput> = { ...patch, ...daCotacao }
    // fornecedor trocado fora do comparador: a escolha de lá passa a ser a cotação dele (ou nenhuma)
    if (atual && patch.fornecedor !== undefined && patch.cotacoesFornecedores === undefined && !mesmoFornecedor(patch.fornecedor, atual.product.fornecedor)) {
      completo.cotacaoEscolhidaId = daCotacao.cotacaoEscolhidaId
    }
    // marca trocada na Precificação (na linha ou "Aplicar marca" nos marcados): a cotação do
    // fornecedor do item (a que veio da planilha/PDF dele) passa a ter a mesma marca
    if (atual && patch.marca !== undefined && patch.fornecedor === undefined && patch.cotacoesFornecedores === undefined) {
      const cotacoes = atual.product.cotacoesFornecedores ?? []
      const doFornecedor = cotacoes.filter((c) => mesmoFornecedor(c.fornecedor, atual.product.fornecedor))
      const alvo = doFornecedor.find((c) => c.valorUnitario === atual.product.valorUnt) ?? doFornecedor[0]
      if (alvo && alvo.marca !== patch.marca) {
        completo.cotacoesFornecedores = cotacoes.map((c) => (c.id === alvo.id ? { ...c, marca: patch.marca! } : c))
      }
    }
    if (completo.valorUnt !== undefined) promoverStatusPorValorUnitario()
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, product: { ...item.product, ...completo } } : item)))
  }
  function handleApplyMarginToAll(lucroPct: number) {
    setItems((prev) => prev.map((item) => ({ ...item, pricing: { ...item.pricing, lucroPct } })))
  }
  function handleApplyPerfilToAll(perfil: EstadoDestino) {
    setItems((prev) => prev.map((item) => ({ ...item, product: { ...item.product, perfil } })))
  }

  const antesDoEnviado = (status: string) => statusAntesDe(status, 'ENVIADO')

  async function handleEnviarCotacao() {
    if (!editingQuoteId || !currentAdmin) return
    // qualquer status de antes do ENVIADO (AGUARDANDO FORNECEDOR também: antes ficava como estava, e o
    // vendedor nunca recebia os valores)
    if (antesDoEnviado(activeStatus)) {
      // já foi enviada antes e os valores mudaram: o vendedor passa a ver os novos?
      const salva = await buscarQuote(editingQuoteId)
      const atualizar = salva ? await perguntarSeReenviaAoVendedor(salva) : undefined
      await updateQuoteStatus(editingQuoteId, 'ENVIADO', currentAdmin, undefined, undefined, undefined, { atualizarValoresDoVendedor: atualizar })
      setActiveStatus('ENVIADO')
      setActiveResponsavel(currentAdmin)
      setHistoryRefreshKey((k) => k + 1)
    }
  }

  /** "Enviar ao vendedor" (janela Enviar cotação): ele passa a ver na tela dele os itens com marca,
   * prazo e os valores de agora — e baixa/compartilha a planilha (a do cliente ou a nossa) e o texto,
   * sem esperar a equipe mandar o arquivo. A cotação vai pra ENVIADO; já em ENVIADO, os valores dele
   * são trocados pelos de agora (o clique é a confirmação). Depois do ENVIADO, os dele não mudam mais
   * (regra dos valores enviados — ver valoresEnviados.ts), a não ser que nunca tenham sido enviados. */
  async function handleEnviarAoVendedor(): Promise<boolean> {
    if (!editingQuoteId || !currentAdmin) return false
    try {
      // os valores que vão são os da tela: o que não foi salvo, salva antes
      if (temAlteracoesNaoSalvas && !(await salvarCotacao(false))) return false
      const salva = await buscarQuote(editingQuoteId)
      if (!salva) throw new Error('Cotação não encontrada no servidor.')
      let enviada: QuoteRecord
      if (antesDoEnviado(salva.status)) {
        enviada = await updateQuoteStatus(salva.id, 'ENVIADO', currentAdmin, undefined, undefined, undefined, { atualizarValoresDoVendedor: true })
        setActiveStatus('ENVIADO')
        setActiveResponsavel(currentAdmin)
      } else if (salva.status === 'ENVIADO' || !salva.valoresEnviados) {
        enviada = await atualizarValoresEnviados(salva.id, currentAdmin)
      } else {
        await avisar(
          `A ${salva.codigo} já passou do ENVIADO: o vendedor ${salva.vendedor} continua vendo os valores que foram enviados (depois do envio eles não mudam).`,
          { titulo: 'Enviar ao vendedor' },
        )
        return false
      }
      setHistoryRefreshKey((k) => k + 1)
      void avisar(
        `Pronto: o vendedor ${enviada.vendedor} já vê a ${enviada.codigo} na tela dele, com marca, prazo e valores ` +
          `(total ${formatCurrency(enviada.valoresEnviados?.total ?? 0)}), e pode baixar e compartilhar a planilha e o texto.`,
        { titulo: 'Enviado ao vendedor' },
      )
      return true
    } catch (err) {
      await avisar(err instanceof Error ? err.message : 'Erro ao enviar ao vendedor.')
      return false
    }
  }

  function handleAddItem() {
    const item = criarItemComGlobais()
    setItems((prev) => [...prev, item])
    setActiveItemId(item.id)
  }

  /** Item novo digitado na planilha do Comparar (referência, interno, descrição, UND) — o resto (preço,
   * fornecedor) vem das cotações que forem lançadas nele. */
  function handleAdicionarItemComCampos(campos: Partial<ProductInput>) {
    const item = criarItemComGlobais()
    const novo = { ...item, product: { ...item.product, ...campos } }
    setItems((prev) => [...prev, novo])
    setActiveItemId(novo.id)
  }

  // a confirmação já foi feita por quem chamou (Itens da cotação, listando o que vai sair) — aqui
  // não passa pelo "essa cotação já foi salva, quer mesmo alterar?" pra não perguntar duas vezes
  function handleRemoveItems(ids: string[]) {
    const remover = new Set(ids)
    const removidos = items.filter((item) => remover.has(item.id))
    if (removidos.length === 0) return
    const agora = Date.now()
    setItensExcluidosPendentes((prev) => [
      ...prev.filter((e) => !remover.has(e.item.id)),
      ...removidos.map((item) => ({ item, excluidoEm: agora, excluidoPor: currentAdmin ?? '' })),
    ])
    const idxAtivo = items.findIndex((item) => item.id === activeItemId)
    const next = items.filter((item) => !remover.has(item.id))
    setSalvoInalterado(false)
    setTemAlteracoesNaoSalvas(true)
    if (next.length === 0) {
      const fresh = criarItemComGlobais()
      setItems([fresh])
      setActiveItemId(fresh.id)
      return
    }
    setItems(next)
    if (remover.has(activeItemId)) {
      // o item aberto saiu: abre o que ficou mais perto da posição dele
      const proximo = items.slice(idxAtivo + 1).find((item) => !remover.has(item.id)) ?? next[next.length - 1]
      setActiveItemId(proximo.id)
    }
  }

  /** Traz de volta pra cotação um item que tinha sido tirado (agora mesmo ou já arquivado no servidor). */
  function handleRestaurarItem(itemId: string) {
    const entrada =
      itensExcluidosPendentes.find((e) => e.item.id === itemId) ?? itensExcluidosSalvos.find((e) => e.item.id === itemId)
    if (!entrada || items.some((item) => item.id === itemId)) return
    const restaurado: QuoteItem = { ...entrada.item, pricing: { ...entrada.item.pricing, ...pricingGlobal } }
    // a linha em branco que fica no lugar quando a cotação esvazia não precisa continuar ali
    const semLinhaVazia = items.filter(
      (item) =>
        item.product.interno.trim() ||
        item.product.referencia.trim() ||
        item.product.descricao.trim() ||
        item.product.fornecedor.trim() ||
        item.product.valorUnt > 0,
    )
    setItems([...semLinhaVazia, restaurado])
    setActiveItemId(restaurado.id)
    setItensExcluidosPendentes((prev) => prev.filter((e) => e.item.id !== itemId))
    setSalvoInalterado(false)
    setTemAlteracoesNaoSalvas(true)
  }

  // lista mostrada em "Itens excluídos": os tirados agora (ainda não salvos) primeiro, depois os
  // arquivados no servidor — menos os que já voltaram pra cotação
  const itensExcluidosVisiveis = useMemo(() => {
    const naCotacao = new Set(items.map((item) => item.id))
    const pendentes = itensExcluidosPendentes.filter((e) => !naCotacao.has(e.item.id))
    const idsPendentes = new Set(pendentes.map((e) => e.item.id))
    const salvos = itensExcluidosSalvos.filter((e) => !naCotacao.has(e.item.id) && !idsPendentes.has(e.item.id))
    return [
      ...pendentes.map((e) => ({ ...e, pendente: true })),
      ...[...salvos].reverse().map((e) => ({ ...e, pendente: false })),
    ]
  }, [items, itensExcluidosPendentes, itensExcluidosSalvos])

  /** Salva a cotação aberta — true se gravou (usado por quem precisa saber, ex.: "Salvar e fechar"). */
  /** Os valores salvos ficaram diferentes dos que o vendedor vê (ver valoresEnviados.ts): pergunta se
   * troca — sem confirmação, ele continua vendo os que foram enviados. Só com a cotação em ENVIADO: em
   * outro status, o vendedor só vê os valores novos quando ela for enviada de novo. */
  async function perguntarSeAtualizaOVendedor(record: QuoteRecord) {
    if (record.status !== 'ENVIADO' || !record.vendedor || !record.valoresEnviados || !valoresMudaram(record)) return
    const enviados = record.valoresEnviados
    const trocar = await confirmar(
      `O vendedor ${record.vendedor} está vendo os valores enviados em ${formatDate(enviados.atualizadoEm ?? enviados.enviadoEm)} ` +
        `(total ${formatCurrency(enviados.total)}). Os desta cotação agora somam ${formatCurrency(totalAtualParaOVendedor(record.items))}.\n\n` +
        'Atualizar os valores que o vendedor vê?',
      { titulo: 'Valores do vendedor', confirmText: 'Atualizar para o vendedor', cancelText: 'Manter os enviados' },
    )
    if (!trocar) return
    try {
      await atualizarValoresEnviados(record.id, currentAdmin)
      void avisar(`Pronto: o vendedor ${record.vendedor} já vê os valores novos.`)
    } catch (err) {
      void avisar(err instanceof Error ? err.message : 'Erro ao atualizar os valores do vendedor.')
    }
  }

  function handleSave(): Promise<boolean> {
    return salvarCotacao(true)
  }

  /** `perguntarDoVendedor`: com valores diferentes dos que o vendedor vê, pergunta se troca (não pergunta
   * quando quem chamou já vai mandar os valores pra ele — "Enviar ao vendedor"). */
  async function salvarCotacao(perguntarDoVendedor: boolean): Promise<boolean> {
    if (!currentAdmin) return false
    try {
      const record = await saveQuote(
        currentAdmin,
        vendedor,
        tipoReferencia,
        cliente,
        maquina,
        items,
        editingQuoteId,
        empresaId,
        dataSolicitacao,
        { itensRemovidos: itensExcluidosPendentes.map((e) => e.item), doVendedor },
      )
      setEditingQuoteId(record.id)
      setItensExcluidosSalvos(record.itensExcluidos ?? [])
      setItensExcluidosPendentes([])
      setDoVendedor(undefined)
      setHistoryRefreshKey((k) => k + 1)
      limparRascunho()
      // mantém o catálogo de Produtos (e o "mais barato já cotado" de cada item) em dia sem depender
      // de alguém abrir a aba Produtos — em segundo plano, sem segurar a tela nem avisar se falhar
      listQuotes()
        .then(sincronizarProdutos)
        .catch(() => {})
      setSalvoInalterado(true)
      setTemAlteracoesNaoSalvas(false)
      setCotacaoRecemSalva(true)
      setTimeout(() => setCotacaoRecemSalva(false), 2500)
      if (perguntarDoVendedor) await perguntarSeAtualizaOVendedor(record)
      return true
    } catch (err) {
      await avisar(err instanceof Error ? err.message : 'Erro ao salvar a cotação no servidor.')
      return false
    }
  }

  /** Fecha a cotação aberta na Precificação (ela continua salva em Cotações): a Precificação fica
   * vazia e as outras telas deixam de carregar essa cotação ("Continuar", Frete…). Havendo alteração
   * não salva, pergunta antes — e nunca descarta sem uma confirmação explícita. */
  async function fecharCotacao() {
    if (temAlteracoesNaoSalvas) {
      const salvar = await confirmar('Esta cotação tem alterações que ainda não foram salvas. Salvar antes de fechar?', {
        titulo: 'Fechar cotação',
        confirmText: 'Salvar e fechar',
        cancelText: 'Não salvar',
      })
      if (salvar) {
        if (!(await handleSave())) return
      } else {
        const descartar = await confirmar('Fechar sem salvar? O que foi alterado desde o último salvamento vai se perder.', {
          titulo: 'Fechar sem salvar',
          confirmText: 'Fechar sem salvar',
          cancelText: 'Continuar editando',
          tone: 'danger',
        })
        if (!descartar) return
      }
    }
    handleNew()
  }

  function handleNew() {
    const fresh = criarItemComGlobais()
    setVendedor('')
    setTipoReferencia('itens')
    setCliente('')
    setMaquina('')
    setEmpresaId('')
    setItems([fresh])
    setActiveItemId(fresh.id)
    setEditingQuoteId(undefined)
    setCodigoCotacao('')
    setActiveStatus('PENDENTE')
    setActiveResponsavel('')
    setActiveCreatedAt(undefined)
    setDataSolicitacao(undefined)
    setItensExcluidosSalvos([])
    setItensExcluidosPendentes([])
    setDoVendedor(undefined)
    setPlanilhaOriginalState(undefined)
    limparRascunho()
    setSalvoInalterado(false)
    setCotacaoRecemSalva(false)
    setTemAlteracoesNaoSalvas(false)
  }

  function handleLoad(record: QuoteRecord) {
    limparRascunho()
    const gravados =
      record.items.length > 0
        ? record.items.map((item) => ({ ...item, pricing: { ...item.pricing, ...pricingGlobal } }))
        : [criarItemComGlobais()]
    // o que o vendedor pediu ou mudou nos itens e ainda não foi salvo na cotação entra agora
    const doVendedorAgora = aplicarItensDoVendedor(record, gravados, criarItemComGlobais)
    const loadedItems = doVendedorAgora?.items ?? gravados
    const mudouPeloVendedor = !!doVendedorAgora && doVendedorAgora.resumo.length > 0
    setVendedor(record.vendedor)
    setTipoReferencia(record.tipoReferencia)
    setCliente(record.cliente)
    setMaquina(record.maquina)
    setEmpresaId(record.empresaId ?? '')
    setItems(loadedItems)
    setActiveItemId(loadedItems[0]?.id ?? '')
    setEditingQuoteId(record.id)
    setCodigoCotacao(record.codigo)
    setActiveStatus(record.status)
    setActiveResponsavel(record.responsavelStatus)
    setActiveCreatedAt(record.createdAt)
    setDataSolicitacao(record.dataSolicitacao)
    setItensExcluidosSalvos(record.itensExcluidos ?? [])
    setItensExcluidosPendentes(
      (doVendedorAgora?.retirados ?? []).map((item) => ({ item, excluidoEm: Date.now(), excluidoPor: `vendedor ${record.vendedor}` })),
    )
    setDoVendedor(doVendedorAgora ? { alteracoes: doVendedorAgora.alteracoes, doPedido: doVendedorAgora.doPedido } : undefined)
    setPlanilhaOriginalState(record.planilhaOriginal)
    setSalvoInalterado(false)
    setCotacaoRecemSalva(false)
    setTemAlteracoesNaoSalvas(mudouPeloVendedor)
    changeTab('dashboard')
    if (mudouPeloVendedor) {
      void avisar(
        `Itens do vendedor ${record.vendedor} na ${record.codigo || 'cotação'}:\n\n• ${doVendedorAgora.resumo.join('\n• ')}\n\n` +
          'Já estão na tela. Confira e salve a cotação pra gravar.',
        { titulo: 'Itens do vendedor' },
      )
    }
  }

  async function handleCreateQuote(
    vendedorNovo: string,
    clienteNovo: string,
    maquinaNova: string,
    tipo: TipoReferencia,
    observacao: string,
  ) {
    if (!currentAdmin) return
    try {
      const record = await saveQuote(currentAdmin, vendedorNovo, tipo, clienteNovo, maquinaNova, [], undefined, undefined, undefined, {
        observacao,
      })
      setHistoryRefreshKey((k) => k + 1)
      handleLoad(record)
    } catch (err) {
      await avisar(err instanceof Error ? err.message : 'Erro ao criar a cotação no servidor.')
    }
  }

  async function handleImportQuote(
    vendedorNovo: string,
    clienteNovo: string,
    maquinaNova: string,
    itensImportados: ItemCotacaoImportado[],
    planilha: { nomeArquivo: string; conteudoBase64: string },
    observacao: string,
  ) {
    if (!currentAdmin) return
    // observação atrelada ao item no catálogo: entra junto (a escrita na tela, se houver, vale mais)
    const atreladas = await observacoesPorReferencia().catch(() => new Map<string, string>())
    const itens: QuoteItem[] = itensImportados.map((it) => {
      const item = criarItemComGlobais()
      const observacao = it.observacao?.trim() || atreladas.get(it.referencia.trim().toLowerCase())
      return {
        ...item,
        product: {
          ...item.product,
          referencia: it.referencia,
          descricao: it.descricao,
          qtd: it.quantidade || 1,
          ...(observacao ? { observacao } : {}),
        },
      }
    })
    const record = await saveQuote(currentAdmin, vendedorNovo, 'itens', clienteNovo, maquinaNova, itens, undefined, undefined, undefined, {
      observacao,
    })
    const registroFinal = await setPlanilhaOriginal(record.id, planilha)
    setHistoryRefreshKey((k) => k + 1)
    handleLoad(registroFinal)
  }

  return (
    <Layout
      active={tab}
      onChangeTab={changeTab}
      podeVer={podeVer}
      nomeExibido={usuario.exibicao}
      onSair={() => void sair()}
      podeVoltar={tabHistory.length > 0}
      onVoltar={handleVoltar}
      fundo={{ pausado: fundoPausado, forte: tab !== 'telaInicial' }}
    >
      {tab === 'telaInicial' && (
        <TelaInicialPage
          nomeExibido={usuario.exibicao}
          currentAdmin={currentAdmin}
          cotacaoAberta={editingQuoteId ? { codigo: codigoCotacao, cliente } : undefined}
          onOpenQuote={handleLoad}
          onNovaCotacao={(modo) => {
            setModoNovoCotacao(modo)
            setAbrirNovaCotacao(true)
            changeTab('cotacoes')
          }}
          onContinuar={() => changeTab('dashboard')}
          onIrPara={changeTab}
          podeVer={podeVer}
          veFinanceiro={permissoes.veFinanceiro}
          partes={partesTelaInicial}
          onAbrirPedido={(cotacaoId) => {
            setPedidoParaAbrir((anterior) => ({ cotacaoId, vez: (anterior?.vez ?? 0) + 1 }))
            changeTab('pedidoCompra')
          }}
        />
      )}
      {/* as outras abas vêm sob demanda (ver os lazy() lá em cima) */}
      <Suspense fallback={<CarregandoAba />}>
      {tab === 'cotacoes' && (
        <CotacoesPage
          refreshKey={historyRefreshKey}
          currentAdmin={currentAdmin}
          onCreateQuote={handleCreateQuote}
          onImportQuote={handleImportQuote}
          onOpenQuote={handleLoad}
          modoNovoInicial={modoNovoCotacao}
          abrirNova={abrirNovaCotacao}
        />
      )}
      {tab === 'analytics' && <AnalyticsPage veFinanceiro={permissoes.veFinanceiro} />}
      {tab === 'comparar' && (
        <CompararFornecedoresPage
          currentAdmin={currentAdmin}
          isEditing={!!editingQuoteId}
          activeStatus={activeStatus}
          activeResponsavel={activeResponsavel}
          items={items}
          codigoCotacao={codigoCotacao}
          cliente={cliente}
          onPatchItem={protegido(patchItemProduct)}
          onAdicionarItem={protegido(handleAdicionarItemComCampos)}
          onRemoverItem={(id) => handleRemoveItems([id])}
          onGoToCotacoes={() => changeTab('cotacoes')}
          onGoToPrecificacao={() => changeTab('dashboard')}
        />
      )}
      {tab === 'dashboard' && (
        <div ref={guardaRef}>
        <Dashboard
          currentAdmin={currentAdmin}
          codigo={codigoCotacao}
          activeStatus={activeStatus}
          activeResponsavel={activeResponsavel}
          vendedor={vendedor}
          cliente={cliente}
          maquina={maquina}
          empresaId={empresaId}
          empresas={empresas}
          onVendedorChange={protegido(setVendedor)}
          onClienteChange={protegido(setCliente)}
          onMaquinaChange={protegido(setMaquina)}
          onEmpresaIdChange={protegido(setEmpresaId)}
          items={items}
          activeItemId={activeItem.id}
          activeProduct={activeItem.product}
          activePricing={activeItem.pricing}
          result={result}
          isEditing={!!editingQuoteId}
          onSelectItem={setActiveItemId}
          onAddItem={protegido(handleAddItem)}
          onRemoveItems={handleRemoveItems}
          itensExcluidos={itensExcluidosVisiveis}
          onRestaurarItem={handleRestaurarItem}
          onPatchItem={protegido(patchItemProduct)}
          onApplyMarginToAll={protegido(handleApplyMarginToAll)}
          onApplyPerfilToAll={protegido(handleApplyPerfilToAll)}
          onPricingChange={protegido(patchActivePricing)}
          onSave={handleSave}
          onNew={() => void fecharCotacao()}
          onFechar={() => void fecharCotacao()}
          onGoToCotacoes={() => changeTab('cotacoes')}
          onGoToComparar={() => changeTab('comparar')}
          onGoToFrete={() => changeTab('frete')}
          onEnviarCotacao={handleEnviarCotacao}
          onEnviarAoVendedor={handleEnviarAoVendedor}
          planilhaCliente={planilhaDoCliente}
          onVerPlanilhaCliente={() => setMostrarPlanilhaCliente(true)}
          createdAt={activeCreatedAt}
          dataSolicitacao={dataSolicitacao}
          onChangeDataSolicitacao={protegido(setDataSolicitacao)}
          cotacaoSalva={cotacaoRecemSalva}
          cotacaoId={editingQuoteId}
        />
        </div>
      )}
      {tab === 'faturamento' && podeVer('faturamento') && <FaturamentoPage currentAdmin={currentAdmin} />}
      {tab === 'relatorios' && podeVer('relatorios') && <RelatoriosPage currentAdmin={currentAdmin} />}
      {tab === 'produtos' && <ProdutosPage currentAdmin={currentAdmin} />}
      {tab === 'fornecedores' && <FornecedoresPage />}
      {tab === 'frete' && <FretePage cotacaoIdInicial={editingQuoteId} onGoToPrecificacao={() => changeTab('dashboard')} />}
      {tab === 'pedidoCompra' && <PedidoCompraPage currentAdmin={currentAdmin} abrirTransporte={transporteParaAbrir} abrirPedido={pedidoParaAbrir} />}
      {tab === 'configuracoes' && (
        <ConfiguracoesPage
          currentAdmin={currentAdmin}
          pricingGlobal={pricingGlobal}
          onSavePricingGlobal={handleSavePricingGlobal}
          onTabelasAtualizadas={() => setTabelasVersion((v) => v + 1)}
          fundoPausado={fundoPausado}
          onAlternarFundo={alternarFundo}
          configuracoesGerais={permissoes.configuracoesGerais}
        />
      )}
      {tab === 'acompanhamentoNotas' && podeVer('acompanhamentoNotas') && (
        <AcompanhamentoNotasPage currentAdmin={currentAdmin} veFinanceiro={permissoes.veFinanceiro} />
      )}
      {tab === 'notasFiscais' && podeVer('notasFiscais') && <NotasFiscaisPage currentAdmin={currentAdmin} />}
      {tab === 'notasFiscaisDashboard' && podeVer('notasFiscaisDashboard') && <NotasFiscaisDashboardPage veFinanceiro={permissoes.veFinanceiro} />}
      {tab === 'history' && (
        <HistoryPage refreshKey={historyRefreshKey} currentAdmin={currentAdmin} onLoad={handleLoad} />
      )}
      </Suspense>

      {mostrarPlanilhaCliente && (
        <Suspense fallback={null}>
          <PlanilhaClienteModal
            planilhaImportada={planilhaDoCliente}
            items={items}
            cliente={cliente}
            maquina={maquina}
            vendedor={vendedor}
            onClose={() => setMostrarPlanilhaCliente(false)}
          />
        </Suspense>
      )}

      {rascunhoDisponivel && (
        <RecuperarRascunhoModal
          rascunho={rascunhoDisponivel}
          onRecuperar={handleRecuperarRascunho}
          onDescartar={handleDescartarRascunho}
        />
      )}

      {podeVer('cotacoes') && <AvisoAlteracoesVendedor nome={currentAdmin} onAbrir={handleLoad} />}
      <AvisoEntregas
        aba={tab}
        onAbrir={(cotacaoId) => {
          setTransporteParaAbrir((anterior) => ({ cotacaoId, vez: (anterior?.vez ?? 0) + 1 }))
          changeTab('pedidoCompra')
        }}
      />
      <DialogHost />
    </Layout>
  )
}
