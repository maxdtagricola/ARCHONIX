import { MINUTOS_SAIDA_PADRAO, OPCOES_SAIDA_AUTOMATICA, textoDaSaida } from '../components/SaidaAutomatica'
import { FORMAS_DE_IMPORTAR, PARTES_DA_TELA_VENDEDOR, PODE_DO_VENDEDOR, type ConfigTelaVendedor } from './telaVendedor'

/** O que se escolhe pros vendedores (todos, ou um só): o que podem fazer, quanto tempo sem uso até sair,
 * o recado do topo, as partes de cada cotação e as formas de importar. O mesmo editor em Funções de
 * usuário › Vendedor, em Usuários › Permissões (de um vendedor) e na visualização da tela dos vendedores. */
export function EditorTelaVendedor({ valor, onChange }: { valor: ConfigTelaVendedor; onChange: (c: ConfigTelaVendedor) => void }) {
  const caixa = 'flex items-start gap-2 py-0.5 text-sm text-ink-700'
  return (
    <div className="space-y-3">
      <fieldset>
        <legend className="field-label">O que pode fazer</legend>
        {PODE_DO_VENDEDOR.map((p) => (
          <label key={p.key} className={caixa}>
            <input type="checkbox" className="mt-1" checked={valor.pode[p.key]} onChange={() => onChange({ ...valor, pode: { ...valor.pode, [p.key]: !valor.pode[p.key] } })} />
            {p.label}
          </label>
        ))}
      </fieldset>

      <label className="block">
        <span className="field-label">Saída automática (sem atividade, sai do site)</span>
        <select
          className="field-input w-auto text-sm"
          value={valor.minutosSaida === null ? 'padrao' : String(valor.minutosSaida)}
          onChange={(e) => onChange({ ...valor, minutosSaida: e.target.value === 'padrao' ? null : Number(e.target.value) })}
        >
          <option value="padrao">Padrão ({textoDaSaida(MINUTOS_SAIDA_PADRAO)})</option>
          {OPCOES_SAIDA_AUTOMATICA.map((m) => (
            <option key={m} value={String(m)}>
              {textoDaSaida(m)}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="field-label">Recado no topo da tela</span>
        <textarea
          className="field-input min-h-[4.5rem] text-sm"
          placeholder="Ex.: Mandem a planilha do cliente sempre que tiverem."
          maxLength={500}
          value={valor.mensagem}
          onChange={(e) => onChange({ ...valor, mensagem: e.target.value })}
        />
      </label>

      <fieldset>
        <legend className="field-label">Partes de cada cotação</legend>
        {PARTES_DA_TELA_VENDEDOR.map((p) => (
          <label key={p.key} className={caixa}>
            <input
              type="checkbox"
              className="mt-1"
              checked={valor.partes[p.key]}
              onChange={() => onChange({ ...valor, partes: { ...valor.partes, [p.key]: !valor.partes[p.key] } })}
            />
            {p.label}
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend className="field-label">Formas de importar os itens</legend>
        {FORMAS_DE_IMPORTAR.map((f) => (
          <label key={f.key} className={caixa}>
            <input
              type="checkbox"
              className="mt-1"
              aria-label={`Importar: ${f.label}`}
              checked={valor.importar[f.key]}
              onChange={() => onChange({ ...valor, importar: { ...valor.importar, [f.key]: !valor.importar[f.key] } })}
            />
            {f.label}
          </label>
        ))}
      </fieldset>
    </div>
  )
}
