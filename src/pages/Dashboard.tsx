import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react'
import { ResultPanel } from '../components/ResultPanel'
import { QuoteItemsList } from '../components/QuoteItemsList'
import { ProductValuesTable } from '../components/ProductValuesTable'
import { Button } from '../components/ui/Basics'
import { SelectField, TextField } from '../components/ui/Field'
import { calculateItem } from '../calc/calculator'
import { dateToInputValue, formatCurrency, formatDate, inputValueToDate } from '../utils'
import type { PlanilhaClienteArquivo } from '../db/planilhasClienteRepo'
import { useEstadoPersistente } from '../estadoPersistente'
import { ESTADOS_DESTINO, VENDEDORES } from '../types'
import type {
  CalculationResult,
  Empresa,
  EstadoDestino,
  ItemExcluidoCotacao,
  PricingConfig,
  ProductInput,
  QuoteItem,
  QuoteStatus,
} from '../types'

// só baixada ao abrir (gera PDF e planilha — bibliotecas pesadas)
const EnvioCotacaoModal = lazy(() => import('../components/EnvioCotacaoModal').then((m) => ({ default: m.EnvioCotacaoModal })))

const vendedorOptions = [{ value: '', label: '— selecione —' }, ...VENDEDORES.map((v) => ({ value: v, label: v }))]
const perfilOptions = ESTADOS_DESTINO.map((e) => ({ value: e.value, label: e.label }))

/** Título de um cartão que recolhe clicando nele (lembrado no aparelho): sem os dados de cima à
 * vista, os valores lá de baixo ficam a poucos passos. */
function TituloRecolhivel({ recolhido, onAlternar, children }: { recolhido: boolean; onAlternar: () => void; children: ReactNode }) {
  return (
    <h2 className="font-display text-lg font-semibold text-ink-900">
      <button
        type="button"
        onClick={onAlternar}
        aria-expanded={!recolhido}
        title={recolhido ? 'Mostrar' : 'Recolher'}
        className="flex items-center gap-2 rounded text-left transition hover:text-ink-700"
      >
        <span aria-hidden className={`text-sm text-ink-400 transition-transform ${recolhido ? '-rotate-90' : ''}`}>▾</span>
        <span>{children}</span>
      </button>
    </h2>
  )
}

export function Dashboard({
  currentAdmin,
  codigo,
  activeStatus,
  activeResponsavel,
  vendedor,
  cliente,
  maquina,
  empresaId,
  empresas,
  onVendedorChange,
  onClienteChange,
  onMaquinaChange,
  onEmpresaIdChange,
  items,
  activeItemId,
  activeProduct,
  activePricing,
  result,
  isEditing,
  onSelectItem,
  onAddItem,
  onRemoveItems,
  itensExcluidos,
  onRestaurarItem,
  onPatchItem,
  onApplyMarginToAll,
  onApplyPerfilToAll,
  onPricingChange,
  onSave,
  onNew,
  onFechar,
  onGoToCotacoes,
  onGoToComparar,
  onGoToFrete,
  onEnviarCotacao,
  onEnviarAoVendedor,
  planilhaCliente,
  onVerPlanilhaCliente,
  createdAt,
  dataSolicitacao,
  onChangeDataSolicitacao,
  cotacaoSalva,
  cotacaoId,
}: {
  currentAdmin: string
  codigo: string
  activeStatus: QuoteStatus
  activeResponsavel: string
  vendedor: string
  cliente: string
  maquina: string
  empresaId: string
  empresas: Empresa[]
  onVendedorChange: (value: string) => void
  onClienteChange: (value: string) => void
  onMaquinaChange: (value: string) => void
  onEmpresaIdChange: (value: string) => void
  items: QuoteItem[]
  activeItemId: string
  activeProduct: ProductInput
  activePricing: PricingConfig
  result: CalculationResult
  isEditing: boolean
  onSelectItem: (id: string) => void
  onAddItem: () => void
  /** Tira os itens da cotação (já confirmado por quem chamou) — eles vão pro arquivo de excluídos. */
  onRemoveItems: (ids: string[]) => void
  /** Itens que saíram da cotação (os tirados agora, ainda não salvos, e os já arquivados no servidor). */
  itensExcluidos: Array<ItemExcluidoCotacao & { pendente: boolean }>
  onRestaurarItem: (itemId: string) => void
  onPatchItem: (id: string, patch: Partial<ProductInput>) => void
  onApplyMarginToAll: (lucroPct: number) => void
  onApplyPerfilToAll: (perfil: EstadoDestino) => void
  onPricingChange: (patch: Partial<PricingConfig>) => void
  onSave: () => void
  onNew: () => void
  /** Fecha a cotação aberta (continua salva em Cotações) — a Precificação fica vazia. */
  onFechar: () => void
  onGoToCotacoes: () => void
  onGoToComparar: () => void
  onGoToFrete: () => void
  onEnviarCotacao: () => Promise<void>
  /** Manda a cotação pro vendedor ver na tela dele (true se mandou). */
  onEnviarAoVendedor: () => Promise<boolean>
  /** A planilha que veio do cliente, se a cotação foi importada de uma — sem ela, gera no molde padrão. */
  planilhaCliente?: { nomeArquivo: string; carregar: () => Promise<PlanilhaClienteArquivo | undefined> }
  onVerPlanilhaCliente: () => void
  createdAt?: number
  dataSolicitacao?: number
  onChangeDataSolicitacao: (ts: number | undefined) => void
  /** true por alguns segundos logo depois de salvar — mostra a confirmação ao lado do botão, agora em Itens da cotação. */
  cotacaoSalva: boolean
  /** Id da cotação no servidor — o frete de cada fornecedor (Itens da cotação) é salvo direto nela. */
  cotacaoId?: string
}) {
  const [mostrarEnvioCotacao, setMostrarEnvioCotacao] = useState(false)
  const [dadosRecolhidos, setDadosRecolhidos] = useEstadoPersistente('precificacao:dadosRecolhidos', false)
  const [perfilRecolhido, setPerfilRecolhido] = useEstadoPersistente('precificacao:perfilRecolhido', false)
  // itens em foco em Itens da cotação (marcados ou filtrados) — "Valores dos produtos" mostra só eles
  const [recorteItens, setRecorteItens] = useState<{ ids: string[]; motivo: string } | undefined>(undefined)
  const itensValores = useMemo(
    () => (recorteItens ? items.filter((i) => recorteItens.ids.includes(i.id)) : items),
    [items, recorteItens],
  )
  const travadaPorOutro = activeStatus !== 'PENDENTE' && !!activeResponsavel && activeResponsavel !== currentAdmin

  const empresaOptions = [
    { value: '', label: '— SELECIONE —' },
    ...empresas.map((e) => ({ value: e.id, label: e.nome })),
  ]

  const totalGeral = useMemo(
    () => items.reduce((sum, item) => sum + calculateItem(item.product, item.pricing).precoVendaTotal, 0),
    [items],
  )

  if (!isEditing) {
    return (
      <div className="card text-center py-16">
        <h2 className="font-display text-lg font-semibold text-ink-900 mb-1">Nenhuma cotação aberta</h2>
        <p className="text-sm text-ink-400 mb-5">
          Crie ou abra uma cotação na aba Cotações pra começar a precificar os itens dela.
        </p>
        <Button variant="primary" onClick={onGoToCotacoes}>
          Ir para Cotações
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {travadaPorOutro && (
        <div className="card border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-800">
            Esta cotação está sendo analisada por <strong>{activeResponsavel}</strong> — só ele(a) pode alterá-la
            agora. Você pode ver os dados, mas não vai conseguir salvar nenhuma mudança.
          </p>
        </div>
      )}

      <div className="card">
        <div className={`flex flex-wrap items-center justify-between gap-3 ${dadosRecolhidos ? '' : 'mb-1'}`}>
          <TituloRecolhivel recolhido={dadosRecolhidos} onAlternar={() => setDadosRecolhidos((v) => !v)}>
            Dados da cotação{codigo && <span className="ml-2 font-mono text-sm text-ink-400">{codigo}</span>}
          </TituloRecolhivel>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={onVerPlanilhaCliente} disabled={items.length === 0}>
              {planilhaCliente ? 'Planilha do cliente' : 'Gerar planilha do cliente'}
            </Button>
            <Button variant="secondary" onClick={() => setMostrarEnvioCotacao(true)} disabled={items.length === 0}>
              Enviar cotação
            </Button>
            <Button variant="ghost" onClick={onFechar} title="Fechar esta cotação — ela continua salva em Cotações">
              ✕ Fechar cotação
            </Button>
          </div>
        </div>
        {!dadosRecolhidos && (
          <>
            <p className="text-sm text-ink-400 mb-4">Informações gerais — servem de base pra recursos futuros.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <SelectField label="Vendedor" value={vendedor} onChange={onVendedorChange} options={vendedorOptions} />
              <TextField label="Cliente" value={cliente} onChange={onClienteChange} uppercase />
              <TextField label="Máquina" value={maquina} onChange={onMaquinaChange} />
              <SelectField
                label="Empresa (destinatário)"
                value={empresaId}
                onChange={onEmpresaIdChange}
                options={empresaOptions}
                hint={empresas.length === 0 ? 'Cadastre empresas em Configurações' : 'Usada pra carregar o frete automaticamente'}
              />
            </div>

            <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-3 rounded-lg border border-ink-100 bg-ink-50/60 px-3 py-2.5">
              <div>
                <p className="text-xs text-ink-400">Data criada</p>
                <p className="text-sm text-ink-700">{createdAt ? formatDate(createdAt) : '—'}</p>
              </div>
              <label className="block">
                <span className="field-label">Data de solicitação</span>
                <input
                  // não-controlado (defaultValue, não value): um <input type="date"> controlado fica
                  // com o .value vazio enquanto o ano não tem os 4 dígitos completos — isso zerava
                  // dataSolicitacao a cada tecla e o campo voltava pro vazio, brigando com quem tava
                  // digitando o ano na mão. Só remonta (e recarrega o valor certo) quando a key muda,
                  // isto é, ao trocar de cotação — dentro da mesma cotação o campo edita livre.
                  key={codigo || 'nova'}
                  type="date"
                  className="field-input"
                  defaultValue={dateToInputValue(dataSolicitacao)}
                  disabled={travadaPorOutro}
                  onChange={(e) => onChangeDataSolicitacao(inputValueToDate(e.target.value))}
                />
              </label>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <TituloRecolhivel recolhido={perfilRecolhido} onAlternar={() => setPerfilRecolhido((v) => !v)}>
              Perfil de cálculo
            </TituloRecolhivel>
            {!perfilRecolhido && (
              <p className="text-sm text-ink-400">Estado de destino usado no cálculo (RBC/ICMS-ST) de todos os itens desta cotação.</p>
            )}
          </div>
          {perfilRecolhido ? (
            <span className="text-sm text-ink-600">{perfilOptions.find((o) => o.value === activeProduct.perfil)?.label}</span>
          ) : (
            <div className="w-full sm:w-56">
              <SelectField
                label="Perfil"
                value={activeProduct.perfil}
                onChange={(v) => onApplyPerfilToAll(v as EstadoDestino)}
                options={perfilOptions}
              />
            </div>
          )}
        </div>
      </div>

      <QuoteItemsList
        items={items}
        activeItemId={activeItemId}
        maquina={maquina}
        cliente={cliente}
        onSelect={onSelectItem}
        onAdd={onAddItem}
        onRemoveItems={onRemoveItems}
        itensExcluidos={itensExcluidos}
        onRestaurarItem={onRestaurarItem}
        onPatchItem={onPatchItem}
        onApplyMarginToAll={onApplyMarginToAll}
        onGoToComparar={onGoToComparar}
        onGoToFrete={onGoToFrete}
        onSave={onSave}
        podeSalvar={!travadaPorOutro}
        salvoRecentemente={cotacaoSalva}
        cotacaoId={cotacaoId}
        onRecorteChange={setRecorteItens}
      >
      {/* dentro do bloco de Itens da cotação de propósito: a barra de cima (Salvar cotação, ações
       * dos marcados) continua presa no topo enquanto se rola por aqui */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 space-y-6">
          <ProductValuesTable
            items={itensValores}
            recorte={recorteItens ? { motivo: recorteItens.motivo, total: items.length } : undefined}
          />
        </div>

        <div className="lg:col-span-2 space-y-4">
          {/* gruda logo abaixo da barra de Itens da cotação (a altura dela vem em --altura-barra-itens) */}
          <div className="sticky space-y-4" style={{ top: 'calc(var(--altura-topo) + var(--altura-barra-itens, 0px) + 1rem)' }}>
            <ResultPanel
              result={result}
              qtd={activeProduct.qtd || 1}
              lucroPct={activePricing.lucroPct}
              onChangeLucroPct={(v) => onPricingChange({ lucroPct: v })}
            />

            {items.length > 1 && (
              <div className="card flex items-center justify-between">
                <span className="text-sm text-ink-500">Total da cotação ({items.length} itens)</span>
                <span className="font-mono font-semibold text-ink-900 tabular-nums">{formatCurrency(totalGeral)}</span>
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={onNew}>
                Nova cotação
              </Button>
            </div>
          </div>
        </div>
      </div>
      </QuoteItemsList>

      {mostrarEnvioCotacao && (
        <Suspense fallback={null}>
          <EnvioCotacaoModal
            items={items}
            cliente={cliente}
            maquina={maquina}
            codigo={codigo}
            vendedor={vendedor}
            planilhaCliente={planilhaCliente}
            onClose={() => setMostrarEnvioCotacao(false)}
            onEnviado={async () => {
              await onEnviarCotacao()
              setMostrarEnvioCotacao(false)
            }}
            // só pros vendedores que têm a tela deles no site
            onEnviarAoVendedor={
              VENDEDORES.includes(vendedor) && isEditing
                ? async () => {
                    if (await onEnviarAoVendedor()) setMostrarEnvioCotacao(false)
                  }
                : undefined
            }
          />
        </Suspense>
      )}
    </div>
  )
}
