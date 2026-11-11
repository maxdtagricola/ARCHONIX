import { useEffect, useState, type ReactNode } from 'react'
import { FundoEmVideo } from './FundoEmVideo'
import { BotaoTema } from './BotaoTema'
import { ICONE_SAIR, ICONES_ABAS } from './IconesAbas'
import { useFecharComEsc } from '../teclaEsc'

export type TabKey =
  | 'telaInicial'
  | 'cotacoes'
  | 'analytics'
  | 'relatorios'
  | 'dashboard'
  | 'comparar'
  | 'faturamento'
  | 'pedidoCompra'
  | 'produtos'
  | 'fornecedores'
  | 'frete'
  | 'configuracoes'
  | 'acompanhamentoNotas'
  | 'notasFiscais'
  | 'notasFiscaisDashboard'
  | 'history'

export interface NavItem {
  key: TabKey
  label: string
  /** Por padrão só do gestor (o Max) — ele pode liberar pra outros em Configurações > Usuários. */
  somenteGestor?: boolean
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

/** As abas do menu, em grupos — também a lista de Configurações > Usuários > Abas. */
export const GRUPOS_DE_ABAS: NavGroup[] = [
  {
    label: 'Início',
    items: [{ key: 'telaInicial', label: 'Tela Inicial' }],
  },
  {
    label: 'Cotações',
    items: [
      { key: 'cotacoes', label: 'Cotações' },
      { key: 'dashboard', label: 'Precificação' },
      { key: 'pedidoCompra', label: 'Pedido de Compra' },
      { key: 'faturamento', label: 'Faturamento' },
      { key: 'acompanhamentoNotas', label: 'Transferências Fiscais', somenteGestor: true },
      { key: 'notasFiscais', label: 'Notas Fiscais', somenteGestor: true },
    ],
  },
  {
    label: 'Visão geral',
    items: [
      { key: 'analytics', label: 'Dashboard' },
      { key: 'relatorios', label: 'Relatórios' },
      { key: 'notasFiscaisDashboard', label: 'Dashboard de Transferências', somenteGestor: true },
    ],
  },
  {
    label: 'Cadastros',
    items: [
      { key: 'produtos', label: 'Produtos' },
      { key: 'fornecedores', label: 'Fornecedores' },
      { key: 'frete', label: 'Frete' },
    ],
  },
  {
    label: 'Histórico',
    items: [{ key: 'history', label: 'Histórico' }],
  },
  {
    label: 'Sistema',
    items: [{ key: 'configuracoes', label: 'Configurações' }],
  },
]

/** true em tela de computador/tablet (sm em diante) — no celular o menu é a gaveta que abre por cima
 * da tela e sempre mostra os nomes das abas (o "recolhido" só vale pra barra fixa do computador). */
function useTelaGrande(): boolean {
  const consulta = '(min-width: 640px)'
  const [grande, setGrande] = useState(() => typeof window !== 'undefined' && window.matchMedia(consulta).matches)
  useEffect(() => {
    const mq = window.matchMedia(consulta)
    const ouvir = () => setGrande(mq.matches)
    ouvir()
    mq.addEventListener('change', ouvir)
    return () => mq.removeEventListener('change', ouvir)
  }, [])
  return grande
}

export function Layout({
  active,
  onChangeTab,
  podeVer,
  nomeExibido,
  onSair,
  podeVoltar,
  onVoltar,
  fundo,
  children,
}: {
  active: TabKey
  onChangeTab: (tab: TabKey) => void
  /** As abas que este usuário vê (Configurações > Usuários > Abas). */
  podeVer: (tab: TabKey) => boolean
  /** Nome de login, mostrado no rodapé (ex.: "MÁXIMUS"). */
  nomeExibido: string
  onSair: () => void
  podeVoltar: boolean
  onVoltar: () => void
  /** Vídeo de fundo atrás do conteúdo — sem isso, fundo liso. Pausar fica em Configurações. */
  fundo?: { pausado: boolean; forte: boolean }
  children: ReactNode
}) {
  // recolhido por padrão (igual ao menu do celular, que começa fechado) — só fica expandido se o usuário escolher
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebarCollapsed') !== '0')
  const [mobileOpen, setMobileOpen] = useState(false)
  useFecharComEsc(() => setMobileOpen(false), mobileOpen)
  const telaGrande = useTelaGrande()
  // só a barra fixa do computador recolhe; a gaveta do celular mostra sempre os nomes
  const recolhido = collapsed && telaGrande

  useEffect(() => {
    localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0')
  }, [collapsed])

  /** O "R$" do topo recolhe/expande o menu (no celular, fecha a gaveta). */
  function alternarMenu() {
    if (telaGrande) setCollapsed((c) => !c)
    else setMobileOpen(false)
  }

  function handleSelect(tab: TabKey) {
    onChangeTab(tab)
    setMobileOpen(false)
  }

  // abas compactas (pouco espaço entre elas) pra caber o menu inteiro na tela sem rolar; no celular
  // ficam um pouco mais altas, que é toque de dedo
  // nas telas grandes (2xl ≥ 1536 px) o texto acompanha os símbolos maiores (ver IconesAbas)
  const itemCls = `w-full flex items-center gap-2.5 2xl:gap-3 rounded-lg px-3 py-2 sm:py-[3px] text-sm 2xl:text-[15px] font-medium transition ${
    recolhido ? 'justify-center' : ''
  }`
  const rotuloMenu = recolhido ? 'Expandir menu' : 'Recolher menu'

  return (
    <div className="min-h-screen bg-ink-50 flex">
      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-black/30 sm:hidden" onClick={() => setMobileOpen(false)} />
      )}

      <aside
        className={`fixed sm:sticky top-0 h-screen z-40 flex flex-col border-r border-ink-100 bg-surface transition-all duration-200 w-64 ${
          collapsed ? 'sm:w-[4.5rem]' : 'sm:w-60 2xl:w-64'
        } ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} sm:translate-x-0`}
      >
        <div className={`flex items-center gap-2.5 border-b border-ink-100 px-3 py-2 ${recolhido ? 'justify-center' : ''}`}>
          {/* o "R$" é o botão de recolher/expandir o menu — a setinha no canto mostra pra que lado vai */}
          <button
            type="button"
            onClick={alternarMenu}
            title={telaGrande ? rotuloMenu : 'Fechar menu'}
            aria-label={telaGrande ? rotuloMenu : 'Fechar menu'}
            aria-expanded={telaGrande ? !recolhido : mobileOpen}
            className="group relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-600 transition hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2"
          >
            {/* a logo é preta, com fundo transparente: invertida, fica branca no quadrado (escuro nos dois
             * temas); o quadrado ocupa a largura toda do menu recolhido, pra logo ficar bem visível */}
            <img src={`${import.meta.env.BASE_URL}logo-archonix.png`} alt="" className="h-11 w-11 object-contain invert" />
            <span
              aria-hidden
              className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full border border-ink-200 bg-surface text-ink-700 shadow-sm transition group-hover:border-ink-400 group-hover:text-ink-900"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                <path d={recolhido ? 'm9 18 6-6-6-6' : 'm15 18-6-6 6-6'} />
              </svg>
            </span>
          </button>
          {!recolhido && (
            <div className="min-w-0">
              <h1 className="font-display text-[15px] font-bold leading-tight text-ink-900 tracking-tight truncate">
                Archonix
              </h1>
              {/* em duas linhas se precisar (cabe na altura da logo), em vez de cortar com "…" */}
              <p className="text-[11px] leading-tight text-ink-400">Markup, ICMS-ST, RBC e PIS/COFINS</p>
            </div>
          )}
        </div>

        <div className="px-2 pt-1">
          {/* Voltar: havendo alteração não salva na cotação aberta, a própria função de Voltar
           * pergunta antes de sair (ver handleVoltar/temAlteracoesNaoSalvas no App) */}
          <button
            type="button"
            onClick={onVoltar}
            disabled={!podeVoltar}
            title="Voltar pra tela anterior"
            className={`${itemCls} text-ink-500 ${podeVoltar ? 'hover:bg-ink-100 hover:text-ink-800' : 'opacity-30 cursor-not-allowed'}`}
          >
            <span aria-hidden className="w-[18px] xl:w-[21px] 2xl:w-6 shrink-0 text-center 2xl:text-base">
              ←
            </span>
            {!recolhido && <span>Voltar</span>}
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-1 space-y-1">
          {GRUPOS_DE_ABAS.map((grupoBruto, i) => {
            const group = {
              ...grupoBruto,
              items: grupoBruto.items.filter((item) => podeVer(item.key)),
            }
            if (group.items.length === 0) return null
            return (
              <div key={group.label}>
                {recolhido ? (
                  i > 0 && <div className="mx-2 mb-1 border-t border-ink-100" />
                ) : (
                  <p className="px-3 pb-0.5 pt-0.5 text-[10px] font-semibold uppercase leading-3 tracking-wider text-ink-400">
                    {group.label}
                  </p>
                )}
                <div className="space-y-0.5">
                  {group.items.map((tab) => {
                    const isActive = active === tab.key
                    return (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => handleSelect(tab.key)}
                        title={recolhido ? tab.label : undefined}
                        aria-current={isActive ? 'page' : undefined}
                        className={`${itemCls} ${isActive ? 'bg-ink-950 text-white' : 'text-ink-500 hover:bg-ink-100'}`}
                      >
                        <span aria-hidden className={`shrink-0 ${isActive ? 'text-white' : 'text-ink-500'}`}>
                          {ICONES_ABAS[tab.key]}
                        </span>
                        {!recolhido && <span className="truncate">{tab.label}</span>}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </nav>

        {/* rodapé numa linha só: quem está logado (sair) + tema claro/escuro — trocar a senha fica em Configurações > Minha conta */}
        <div
          className={`border-t border-ink-100 px-2 py-2 ${
            recolhido ? 'flex flex-col items-center gap-1' : 'flex items-center gap-2 pl-3'
          }`}
        >
          {recolhido ? (
            <button
                type="button"
                onClick={onSair}
                title={`${nomeExibido} — sair`}
                aria-label={`${nomeExibido} — sair`}
                className="flex h-7 w-full items-center justify-center rounded-lg text-ink-400 hover:bg-ink-100 hover:text-ink-700 transition"
              >
                {ICONE_SAIR}
              </button>
          ) : (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium leading-tight text-ink-700">{nomeExibido}</p>
              <p className="text-xs leading-tight text-ink-400">
                <button type="button" onClick={onSair} className="hover:text-ink-600 transition">
                  Sair
                </button>
              </p>
            </div>
          )}
          <BotaoTema recolhido={recolhido} />
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        {/* altura fixa (h-14 = --altura-topo no index.css): o que gruda no topo ao rolar a tela (ex.:
         * a barra de Itens da cotação) se posiciona logo abaixo dessa barra no celular */}
        <header className="sm:hidden flex h-14 items-center justify-between gap-3 border-b border-ink-100 bg-surface px-4 sticky top-0 z-20">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-lg p-2 hover:bg-ink-100 transition"
            aria-label="Abrir menu"
          >
            ☰
          </button>
          <div className="flex items-center gap-2">
            <img src={`${import.meta.env.BASE_URL}logo-archonix.png`} alt="" className="h-9 w-auto dark:invert" />
            <h1 className="font-display text-base font-bold text-ink-900">Archonix</h1>
          </div>
          <div className="w-9" />
        </header>
        <main className={`relative flex-1 w-full px-4 sm:px-6 py-6 sm:py-8 ${fundo ? 'com-fundo-video' : ''}`}>
          {fundo && <FundoEmVideo pausado={fundo.pausado} forte={fundo.forte} />}
          {/* "relative" (sem z-index): fica por cima do vídeo e as janelas abertas continuam por cima do menu */}
          <div className="relative">{children}</div>
        </main>
      </div>
    </div>
  )
}
