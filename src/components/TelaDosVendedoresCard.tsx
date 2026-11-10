import { lazy, Suspense, useState } from 'react'
import { VENDEDORES } from '../types'

// a tela do vendedor (e o que ela carrega) só vem quando o Max abre a visualização
const PreviaTelaVendedor = lazy(() => import('../vendedor/PreviaTelaVendedor').then((m) => ({ default: m.PreviaTelaVendedor })))

/** O botão que abre a tela de um vendedor (ver PreviaTelaVendedor) — em Configurações e em Usuários. */
export function BotaoVerTelaDoVendedor({ vendedor, rotulo, className }: { vendedor: string; rotulo: string; className: string }) {
  const [aberta, setAberta] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setAberta(true)} className={className}>
        {rotulo}
      </button>
      {aberta && (
        <Suspense fallback={null}>
          <PreviaTelaVendedor vendedorInicial={vendedor} aoFechar={() => setAberta(false)} />
        </Suspense>
      )}
    </>
  )
}

/** Configurações › Tela dos vendedores — só pro Max. */
export function TelaDosVendedoresCard() {
  const [vendedor, setVendedor] = useState(VENDEDORES[0])
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-500">
        Veja a tela de um vendedor exatamente como ele vê — as cotações no nome dele, sem custos nem fornecedores — e escolha o que aparece
        pra todos: um recado no topo, as partes de cada cotação e as formas de importar os itens (planilha, foto/print, PDF, texto). Na
        visualização dá pra testar tudo, até a importação; nada é salvo.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label>
          <span className="field-label">Vendedor</span>
          <select className="field-input w-auto" aria-label="Vendedor pra ver a tela" value={vendedor} onChange={(e) => setVendedor(e.target.value)}>
            {VENDEDORES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <BotaoVerTelaDoVendedor
          vendedor={vendedor}
          rotulo="Ver a tela do vendedor"
          className="rounded-lg bg-ink-900 px-4 py-2 text-sm font-semibold text-surface transition hover:opacity-90"
        />
      </div>
    </div>
  )
}
