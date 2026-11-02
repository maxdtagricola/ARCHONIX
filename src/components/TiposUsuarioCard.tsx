import { useEffect, useState } from 'react'
import { Button } from './ui/Basics'
import { EditorPermissoes } from './EditorPermissoes'
import { avisar, confirmar } from '../dialogs'
import { ABAS_CONFIGURAVEIS } from '../abasPermitidas'
import { statusDe } from '../statusConfig'
import { makeId } from '../utils'
import { TODAS_AS_PARTES } from '../telaInicialPorUsuario'
import { PERMISSOES_PADRAO, getTiposUsuario, salvarTiposUsuario, type PermissoesDoUsuario, type TipoUsuario } from '../tiposUsuario'
import type { PapelUsuario } from '../sessaoUsuario'

export const ROTULO_PAPEL: Record<PapelUsuario, string> = {
  xadrez: 'Sem função definida',
  admin: 'Administrador (site completo)',
}

/** Resumo do que um tipo (ou usuário) pode: "9 de 14 abas · status: 5 de 13 das cotações, todos de
 * frete e notas · Tela Inicial: 6 de 10 partes" (a Tela Inicial só entra quando não é inteira). */
export function resumoPermissoes(p: PermissoesDoUsuario): string {
  const abas = p.abas.length === ABAS_CONFIGURAVEIS.length ? 'todas as abas' : `${p.abas.length} de ${ABAS_CONFIGURAVEIS.length} abas`
  const sc = p.statusCotacoes === null ? 'todos' : `${p.statusCotacoes.length} de ${statusDe('cotacoes').length}`
  const sn = p.statusNotas === null ? 'todos' : `${p.statusNotas.length} de ${statusDe('notas').length}`
  const tela = p.telaInicial ? ` · Tela Inicial: ${p.telaInicial.length} de ${TODAS_AS_PARTES.length} partes` : ''
  return `${abas} · status: ${sc === 'todos' && sn === 'todos' ? 'todos' : `${sc} das cotações, ${sn} de frete e notas`}${tela}`
}

/** Configurações › Tipos de usuário — só pro Max: modelos de função + abas + status pra reaproveitar
 * ao cadastrar alguém (Configurações › Usuários). */
export function TiposUsuarioCard() {
  const [tipos, setTipos] = useState<TipoUsuario[]>([])
  const [carregando, setCarregando] = useState(true)
  const [editando, setEditando] = useState<TipoUsuario | null>(null)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    getTiposUsuario()
      .then(setTipos)
      .catch((err) => void avisar(err instanceof Error ? err.message : 'Erro ao carregar os tipos de usuário.'))
      .finally(() => setCarregando(false))
  }, [])

  async function gravar(lista: TipoUsuario[], aviso: string) {
    setSalvando(true)
    try {
      await salvarTiposUsuario(lista)
      setTipos(lista)
      setEditando(null)
      void avisar(aviso)
    } catch (err) {
      void avisar(err instanceof Error ? err.message : 'Erro ao salvar no servidor.')
    } finally {
      setSalvando(false)
    }
  }

  async function handleSalvar() {
    if (!editando) return
    const nome = editando.nome.trim().replace(/\s+/g, ' ')
    if (nome.length < 2) return void avisar('Dê um nome ao tipo (ex.: Vendedor).')
    if (tipos.some((t) => t.id !== editando.id && t.nome.toUpperCase() === nome.toUpperCase())) return void avisar('Já existe um tipo com esse nome.')
    const tipo = { ...editando, nome }
    const lista = tipos.some((t) => t.id === tipo.id) ? tipos.map((t) => (t.id === tipo.id ? tipo : t)) : [...tipos, tipo]
    await gravar(lista, `Tipo "${nome}" salvo — já aparece no cadastro de usuários. Quem já foi cadastrado com ele não muda.`)
  }

  async function handleExcluir(t: TipoUsuario) {
    const ok = await confirmar(`Excluir o tipo "${t.nome}"? Os usuários cadastrados com ele continuam com as permissões que têm.`, {
      confirmText: 'Excluir',
      tone: 'danger',
    })
    if (!ok) return
    await gravar(
      tipos.filter((x) => x.id !== t.id),
      `Tipo "${t.nome}" excluído.`,
    )
  }

  return (
    <div>
      <p className="mb-4 text-sm text-ink-400">
        Monte aqui os modelos (ex.: Vendedor, Comprador) com a função, as abas, o que aparece na Tela Inicial e os status que
        cada um pode usar. Ao cadastrar
        alguém em Usuários, é só escolher o tipo — e dá pra copiar um tipo pra quem já existe.
      </p>

      {carregando ? (
        <p className="text-sm text-ink-400">Carregando…</p>
      ) : tipos.length === 0 && !editando ? (
        <p className="py-4 text-center text-sm text-ink-400">Nenhum tipo criado ainda.</p>
      ) : (
        <div className="divide-y divide-ink-100">
          {tipos.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink-900">{t.nome}</p>
                <p className="text-xs text-ink-400">
                  {ROTULO_PAPEL[t.papel]}
                  {t.papel === 'admin' && ` · ${resumoPermissoes(t)}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditando({ ...t })}
                className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50"
              >
                Editar
              </button>
              <button type="button" onClick={() => void handleExcluir(t)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50">
                Excluir
              </button>
            </div>
          ))}
        </div>
      )}

      {editando ? (
        <div className="mt-4 space-y-4 rounded-xl border border-ink-200 bg-ink-50/60 p-4" aria-label="Tipo de usuário">
          <div className="flex flex-wrap gap-3">
            <label className="min-w-[12rem] flex-1">
              <span className="field-label">Nome do tipo</span>
              <input
                className="field-input"
                maxLength={30}
                placeholder="Ex.: Vendedor"
                value={editando.nome}
                onChange={(e) => setEditando({ ...editando, nome: e.target.value })}
              />
            </label>
            <label>
              <span className="field-label">Função</span>
              <select
                className="field-input w-auto"
                aria-label="Função do tipo"
                value={editando.papel}
                onChange={(e) => setEditando({ ...editando, papel: e.target.value as PapelUsuario })}
              >
                <option value="admin">{ROTULO_PAPEL.admin}</option>
                <option value="xadrez">{ROTULO_PAPEL.xadrez}</option>
              </select>
            </label>
          </div>
          {editando.papel === 'admin' ? (
            <EditorPermissoes valor={editando} onChange={(p) => setEditando({ ...editando, ...p })} />
          ) : (
            <p className="text-xs text-ink-400">Sem função, a pessoa só vê a própria conta — não há abas nem status a escolher.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => void handleSalvar()} disabled={salvando}>
              Salvar tipo
            </Button>
            <Button variant="ghost" onClick={() => setEditando(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <Button variant="secondary" onClick={() => setEditando({ id: makeId(), nome: '', papel: 'admin', ...PERMISSOES_PADRAO })}>
            + Novo tipo
          </Button>
        </div>
      )}
    </div>
  )
}
