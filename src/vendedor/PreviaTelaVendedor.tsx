import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { avisar, confirmar } from '../dialogs'
import { useFecharComEsc } from '../teclaEsc'
import { VENDEDORES } from '../types'
import type { UsuarioLogado } from '../sessaoUsuario'
import { AppVendedor } from './AppVendedor'
import { EditorTelaVendedor } from './EditorTelaVendedor'
import { CONFIG_TELA_VENDEDOR_PADRAO, getConfigDosVendedores, salvarConfigTelaVendedor, type ConfigTelaVendedor } from './telaVendedor'

/** A tela de um vendedor como ele vê (as cotações dele, pelo mesmo filtro do servidor), com o painel
 * pra escolher o que vale pra todos os vendedores — ao vivo aqui e, salvo, pra eles. Vendedor com
 * permissões só dele (Usuários › Permissões) aparece com as dele. Só pro Max; nada que se faça na tela
 * em si é salvo. */
export function PreviaTelaVendedor({ vendedorInicial, aoFechar }: { vendedorInicial?: string; aoFechar: () => void }) {
  const [vendedor, setVendedor] = useState(vendedorInicial && VENDEDORES.includes(vendedorInicial) ? vendedorInicial : VENDEDORES[0])
  const [salva, setSalva] = useState<ConfigTelaVendedor | null>(null)
  const [config, setConfig] = useState<ConfigTelaVendedor>(CONFIG_TELA_VENDEDOR_PADRAO)
  const [porVendedor, setPorVendedor] = useState<Record<string, ConfigTelaVendedor>>({})
  const [painel, setPainel] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const alterada = salva !== null && JSON.stringify(salva) !== JSON.stringify(config)

  useEffect(() => {
    getConfigDosVendedores()
      .then((c) => {
        setSalva(c.todos)
        setConfig(c.todos)
        setPorVendedor(c.porVendedor)
      })
      .catch(() => {
        // servidor de antes desta configuração: começa do padrão
        setSalva(CONFIG_TELA_VENDEDOR_PADRAO)
      })
  }, [])

  async function fechar() {
    if (alterada && !(await confirmar('A configuração da tela dos vendedores foi mudada e não foi salva. Fechar sem salvar?', { confirmText: 'Fechar sem salvar' }))) return
    aoFechar()
  }
  useFecharComEsc(() => void fechar())

  async function salvar() {
    setSalvando(true)
    try {
      await salvarConfigTelaVendedor(config)
      setSalva(config)
      void avisar('Configuração salva — os vendedores já veem assim na próxima vez que a tela atualizar (menos os que têm permissões só deles).')
    } catch (err) {
      void avisar(err instanceof Error ? err.message : 'Erro ao salvar no servidor.')
    } finally {
      setSalvando(false)
    }
  }

  const usuario: UsuarioLogado = {
    login: `PREVIA ${vendedor}`,
    exibicao: '(visualização)',
    nome: '',
    papel: 'vendedor',
    vendedor,
    gestor: false,
    pendente: false,
    emailMascarado: '',
  }
  const doVendedor = porVendedor[vendedor]

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Visualização da tela do vendedor" className="fixed inset-0 z-[65] flex flex-col bg-ink-50">
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-200 bg-surface px-4 py-2">
        <p className="font-display text-sm font-semibold text-ink-900">Tela dos vendedores</p>
        <label className="flex items-center gap-2 text-sm text-ink-600">
          Ver como
          <select className="field-input w-auto py-1 text-sm" aria-label="Ver a tela de qual vendedor" value={vendedor} onChange={(e) => setVendedor(e.target.value)}>
            {VENDEDORES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">visualização — nada aqui é salvo</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            aria-expanded={painel}
            onClick={() => setPainel((p) => !p)}
            className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-medium text-ink-700 transition hover:bg-ink-50"
          >
            {painel ? 'Esconder configuração' : 'Configurar a tela'}
          </button>
          <button type="button" onClick={() => void fechar()} className="rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-semibold text-surface transition hover:opacity-90">
            Fechar
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="min-h-0 flex-1 overflow-y-auto" aria-label={`Tela do vendedor ${vendedor}`}>
          {/* key: trocar de vendedor começa a tela do zero */}
          <AppVendedor key={vendedor} usuario={usuario} previa={{ vendedor, config: doVendedor ?? config }} />
        </div>

        {painel && (
          <aside aria-label="Configurar a tela dos vendedores" className="max-h-[45vh] shrink-0 overflow-y-auto border-t border-ink-200 bg-surface p-4 lg:max-h-none lg:w-80 lg:border-l lg:border-t-0">
            <p className="mb-1 font-display text-sm font-semibold text-ink-900">O que os vendedores podem e veem</p>
            <p className="mb-3 text-xs text-ink-400">Vale pra todos. Aparece na hora aqui ao lado; pros vendedores, depois de salvar.</p>

            {doVendedor && (
              <p role="note" className="mb-3 rounded-lg bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                {vendedor} tem permissões só dele (Usuários › Permissões): a tela ao lado mostra as dele, não estas.
              </p>
            )}
            <EditorTelaVendedor valor={config} onChange={setConfig} />

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!alterada || salvando}
                onClick={() => void salvar()}
                className="rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-semibold text-surface transition hover:opacity-90 disabled:opacity-40"
              >
                Salvar pra todos os vendedores
              </button>
              <button
                type="button"
                disabled={!alterada || salvando}
                onClick={() => salva && setConfig(salva)}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-ink-500 transition hover:bg-ink-100 disabled:opacity-40"
              >
                Desfazer
              </button>
              <button
                type="button"
                disabled={salvando}
                onClick={() => setConfig(CONFIG_TELA_VENDEDOR_PADRAO)}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-ink-500 transition hover:bg-ink-100 disabled:opacity-40"
              >
                Mostrar tudo
              </button>
            </div>
          </aside>
        )}
      </div>
    </div>,
    document.body,
  )
}
