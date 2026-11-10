import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { avisar, confirmar } from '../dialogs'
import { useFecharComEsc } from '../teclaEsc'
import { VENDEDORES } from '../types'
import type { UsuarioLogado } from '../sessaoUsuario'
import { AppVendedor } from './AppVendedor'
import {
  CONFIG_TELA_VENDEDOR_PADRAO,
  FORMAS_DE_IMPORTAR,
  PARTES_DA_TELA_VENDEDOR,
  getConfigTelaVendedor,
  salvarConfigTelaVendedor,
  type ConfigTelaVendedor,
} from './telaVendedor'

/** A tela de um vendedor como ele vê (as cotações dele, pelo mesmo filtro do servidor), com o painel
 * pra escolher o que aparece pra todos os vendedores — vale ao vivo aqui e, salvo, pra eles. Só pro
 * Max; nada que se faça na tela em si é salvo. */
export function PreviaTelaVendedor({ vendedorInicial, aoFechar }: { vendedorInicial?: string; aoFechar: () => void }) {
  const [vendedor, setVendedor] = useState(vendedorInicial && VENDEDORES.includes(vendedorInicial) ? vendedorInicial : VENDEDORES[0])
  const [salva, setSalva] = useState<ConfigTelaVendedor | null>(null)
  const [config, setConfig] = useState<ConfigTelaVendedor>(CONFIG_TELA_VENDEDOR_PADRAO)
  const [painel, setPainel] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const alterada = salva !== null && JSON.stringify(salva) !== JSON.stringify(config)

  useEffect(() => {
    getConfigTelaVendedor()
      .then((c) => {
        setSalva(c)
        setConfig(c)
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
      void avisar('Configuração salva — os vendedores já veem assim na próxima vez que a tela atualizar.')
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
  const caixa = 'flex items-start gap-2 py-0.5 text-sm text-ink-700'

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
          <AppVendedor key={vendedor} usuario={usuario} previa={{ vendedor, config }} />
        </div>

        {painel && (
          <aside aria-label="Configurar a tela dos vendedores" className="max-h-[45vh] shrink-0 overflow-y-auto border-t border-ink-200 bg-surface p-4 lg:max-h-none lg:w-80 lg:border-l lg:border-t-0">
            <p className="mb-1 font-display text-sm font-semibold text-ink-900">O que os vendedores veem</p>
            <p className="mb-3 text-xs text-ink-400">Vale pra todos. Aparece na hora aqui ao lado; pros vendedores, depois de salvar.</p>

            <label className="block">
              <span className="field-label">Recado no topo da tela</span>
              <textarea
                className="field-input min-h-[4.5rem] text-sm"
                placeholder="Ex.: Mandem a planilha do cliente sempre que tiverem."
                maxLength={500}
                value={config.mensagem}
                onChange={(e) => setConfig({ ...config, mensagem: e.target.value })}
              />
            </label>

            <fieldset className="mt-3">
              <legend className="field-label">Partes de cada cotação</legend>
              {PARTES_DA_TELA_VENDEDOR.map((p) => (
                <label key={p.key} className={caixa}>
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={config.partes[p.key]}
                    onChange={() => setConfig({ ...config, partes: { ...config.partes, [p.key]: !config.partes[p.key] } })}
                  />
                  {p.label}
                </label>
              ))}
            </fieldset>

            <fieldset className="mt-3">
              <legend className="field-label">Formas de importar os itens</legend>
              {FORMAS_DE_IMPORTAR.map((f) => (
                <label key={f.key} className={caixa}>
                  <input
                    type="checkbox"
                    className="mt-1"
                    aria-label={`Importar: ${f.label}`}
                    checked={config.importar[f.key]}
                    onChange={() => setConfig({ ...config, importar: { ...config.importar, [f.key]: !config.importar[f.key] } })}
                  />
                  {f.label}
                </label>
              ))}
            </fieldset>

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
