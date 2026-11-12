import { chaveMes, labelDoMes } from '../notasFiscaisHelpers'

/** Meses que aparecem nos dados (chave "AAAA-MM"), do mais recente pro mais antigo — o mês atual
 * sempre entra, mesmo sem nada registrado ainda. */
export function mesesDisponiveis(chaves: Iterable<string>): string[] {
  const meses = new Set<string>(chaves)
  meses.add(chaveMes(new Date()))
  return Array.from(meses).sort((a, b) => (a < b ? 1 : -1))
}

/** Começo e fim (exclusivo) de um mês "AAAA-MM", em milissegundos. */
export function intervaloDoMes(mesKey: string): { inicio: number; fim: number } {
  const [ano, mes] = mesKey.split('-').map(Number)
  return { inicio: new Date(ano, mes - 1, 1).getTime(), fim: new Date(ano, mes, 1).getTime() }
}

/** "Mês de referência" dos Dashboards: escolhido, mostra só aquele mês (no lugar do Período). */
export function SeletorMesReferencia({
  meses,
  valor,
  onChange,
  textoVazio = '— usar o período acima —',
}: {
  meses: string[]
  valor: string
  onChange: (mesKey: string) => void
  textoVazio?: string
}) {
  return (
    <label className="block">
      <span className="field-label mb-1.5 block">Mês de referência</span>
      <select
        className={`field-input py-1.5 text-sm ${valor ? 'border-ink-400 bg-ink-100 font-semibold' : ''}`}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{textoVazio}</option>
        {meses.map((m) => (
          <option key={m} value={m}>
            {labelDoMes(m)}
          </option>
        ))}
      </select>
    </label>
  )
}
