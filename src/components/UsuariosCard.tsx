import { useEffect, useState } from 'react'
import { cadastrarUsuario, definirPapel, excluirUsuario, liberarNovaSenha, listarUsuarios, type UsuarioCadastrado } from '../auth'
import { avisar, confirmar } from '../dialogs'
import { ABAS_PADRAO, getAbasPorUsuario } from '../abasPermitidas'
import { getPermissoesStatus, type PermissoesStatusDoUsuario } from '../statusConfig'
import { getTelaInicialPorUsuario, type ParteTelaInicial } from '../telaInicialPorUsuario'
import { aplicarPermissoes, getTiposUsuario, mesmasPermissoes, type PermissoesDoUsuario, type TipoUsuario } from '../tiposUsuario'
import { EditorPermissoes } from './EditorPermissoes'
import { ROTULO_PAPEL, resumoPermissoes } from './TiposUsuarioCard'
import type { TabKey } from './Layout'
import type { PapelUsuario } from '../sessaoUsuario'

const NOME_VALIDO = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{1,19}$/u

/** Configurações › Usuários — só pro Max: cadastra quem vai usar o site (escolhendo um tipo, ou a
 * função), define as permissões de cada um (abas, Tela Inicial e status), libera senha nova, exclui. */
/** `embutido`: dentro da janela de Configurações, que já tem a moldura e o título. */
export function UsuariosCard({ embutido = false }: { embutido?: boolean } = {}) {
  const [usuarios, setUsuarios] = useState<UsuarioCadastrado[]>([])
  const [carregando, setCarregando] = useState(true)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [abasPorUsuario, setAbasPorUsuario] = useState<Record<string, TabKey[]>>({})
  const [statusPorUsuario, setStatusPorUsuario] = useState<Record<string, PermissoesStatusDoUsuario>>({})
  const [telaPorUsuario, setTelaPorUsuario] = useState<Record<string, ParteTelaInicial[]>>({})
  const [tipos, setTipos] = useState<TipoUsuario[]>([])
  const [editando, setEditando] = useState<{ login: string; permissoes: PermissoesDoUsuario } | null>(null)
  const [nomeNovo, setNomeNovo] = useState('')
  const [tipoNovo, setTipoNovo] = useState('')
  const [papelNovo, setPapelNovo] = useState<PapelUsuario>('admin')

  async function recarregar() {
    setCarregando(true)
    try {
      const [lista, abas, status, tela, listaTipos] = await Promise.all([
        listarUsuarios(),
        getAbasPorUsuario(),
        getPermissoesStatus(),
        getTelaInicialPorUsuario(),
        getTiposUsuario(),
      ])
      // quem espera uma definição primeiro, depois na ordem do cadastro
      setUsuarios(lista.sort((a, b) => Number(b.pendente) - Number(a.pendente) || a.criadoEm.localeCompare(b.criadoEm)))
      setAbasPorUsuario(abas)
      setStatusPorUsuario(status)
      setTelaPorUsuario(tela)
      setTipos(listaTipos)
    } catch (err) {
      void avisar(err instanceof Error ? err.message : 'Erro ao carregar os usuários.')
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    void recarregar()
  }, [])

  async function executar(login: string, acao: () => Promise<void>, sucesso: string) {
    setOcupado(login)
    try {
      await acao()
      await recarregar()
      void avisar(sucesso)
    } catch (err) {
      void avisar(err instanceof Error ? err.message : 'Erro ao salvar no servidor.')
    } finally {
      setOcupado(null)
    }
  }

  function permissoesDe(login: string): PermissoesDoUsuario {
    const status = statusPorUsuario[login]
    return {
      abas: abasPorUsuario[login] ?? ABAS_PADRAO,
      statusCotacoes: status?.cotacoes ?? null,
      statusNotas: status?.notas ?? null,
      telaInicial: telaPorUsuario[login] ?? null,
    }
  }

  function tipoDe(u: UsuarioCadastrado): TipoUsuario | undefined {
    if (u.papel !== 'admin') return undefined
    const p = permissoesDe(u.login)
    return tipos.find((t) => t.papel === 'admin' && mesmasPermissoes(t, p))
  }

  async function handleCadastrar() {
    const nome = nomeNovo.trim().replace(/\s+/g, ' ')
    if (!NOME_VALIDO.test(nome)) {
      void avisar('O nome de usuário precisa ter de 2 a 20 letras ou números (pode ter espaço, ponto, hífen ou _).')
      return
    }
    const tipo = tipos.find((t) => t.id === tipoNovo)
    const papel = tipo ? tipo.papel : papelNovo
    await executar(
      '__novo__',
      async () => {
        const { login } = await cadastrarUsuario(nome, papel)
        if (tipo && tipo.papel === 'admin') await aplicarPermissoes(login, tipo)
        setNomeNovo('')
      },
      `${nome} cadastrado como ${tipo ? `"${tipo.nome}"` : `"${ROTULO_PAPEL[papel]}"`}. No primeiro acesso, ele digita o nome de usuário e cria a própria senha` +
        (papel === 'admin' ? ' — as permissões dele dá pra ajustar aqui, em "Permissões".' : '.'),
    )
  }

  async function handlePapel(u: UsuarioCadastrado, papel: PapelUsuario) {
    if (!(await confirmar(`Definir ${u.exibicao} como "${ROTULO_PAPEL[papel]}"?`))) return
    await executar(u.login, () => definirPapel(u.login, papel), `${u.exibicao} agora é "${ROTULO_PAPEL[papel]}".`)
  }

  async function handleLiberarSenha(u: UsuarioCadastrado) {
    const ok = await confirmar(
      `Apagar a senha de ${u.exibicao}? Ele sai de todos os aparelhos e, no próximo acesso, cria uma senha nova (e informa o e-mail de recuperação de novo).`,
      { confirmText: 'Liberar nova senha' },
    )
    if (!ok) return
    await executar(u.login, () => liberarNovaSenha(u.login), `Senha de ${u.exibicao} liberada — ele cria uma nova no próximo acesso.`)
  }

  async function handleExcluir(u: UsuarioCadastrado) {
    const ok = await confirmar(`Excluir o usuário ${u.exibicao}?`, {
      confirmText: 'Excluir',
      tone: 'danger',
    })
    if (!ok) return
    await executar(u.login, () => excluirUsuario(u.login), `Usuário ${u.exibicao} excluído.`)
  }

  async function handleSalvarPermissoes(u: UsuarioCadastrado) {
    if (!editando) return
    const permissoes = editando.permissoes
    await executar(
      u.login,
      async () => {
        await aplicarPermissoes(u.login, permissoes)
        setEditando(null)
      },
      `Permissões de ${u.exibicao} salvas — valem na próxima vez que ele abrir o site.`,
    )
  }

  const tipoEscolhido = tipos.find((t) => t.id === tipoNovo)

  return (
    <div className={embutido ? undefined : 'card'}>
      {!embutido && <h3 className="font-display text-base font-semibold text-ink-900 mb-1">Usuários</h3>}
      <p className="text-sm text-ink-400 mb-4">
        Só você cadastra quem vai usar o site. Aqui também ficam a função e as permissões (abas, Tela Inicial e status) de cada um — os modelos
        prontos ficam em Configurações › Tipos de usuário.
      </p>

      <form
        className="mb-5 flex flex-wrap items-end gap-2 rounded-xl border border-ink-100 p-3"
        onSubmit={(e) => {
          e.preventDefault()
          void handleCadastrar()
        }}
      >
        <label className="min-w-[10rem] flex-1">
          <span className="field-label">Novo usuário</span>
          <input
            className="field-input"
            maxLength={20}
            autoComplete="off"
            placeholder="Nome de usuário"
            value={nomeNovo}
            onChange={(e) => setNomeNovo(e.target.value)}
          />
        </label>
        <label>
          <span className="field-label">Tipo</span>
          <select className="field-input w-auto" aria-label="Tipo do novo usuário" value={tipoNovo} onChange={(e) => setTipoNovo(e.target.value)}>
            <option value="">— sem tipo (escolher a função) —</option>
            {tipos.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nome}
              </option>
            ))}
          </select>
        </label>
        {!tipoEscolhido && (
          <label>
            <span className="field-label">Função</span>
            <select
              className="field-input w-auto"
              aria-label="Função do novo usuário"
              value={papelNovo}
              onChange={(e) => setPapelNovo(e.target.value as PapelUsuario)}
            >
              <option value="admin">{ROTULO_PAPEL.admin}</option>
              <option value="xadrez">{ROTULO_PAPEL.xadrez}</option>
            </select>
          </label>
        )}
        <button
          type="submit"
          disabled={ocupado === '__novo__' || !nomeNovo.trim()}
          className="rounded-lg bg-ink-900 px-4 py-2 text-sm font-medium text-surface transition hover:opacity-90 disabled:opacity-50"
        >
          Cadastrar
        </button>
        <p className="w-full text-xs text-ink-400">
          {tipoEscolhido
            ? `Tipo "${tipoEscolhido.nome}": ${ROTULO_PAPEL[tipoEscolhido.papel]}${tipoEscolhido.papel === 'admin' ? ` · ${resumoPermissoes(tipoEscolhido)}` : ''}. `
            : ''}
          A pessoa entra com esse nome e cria a própria senha (e o e-mail de recuperação) no primeiro acesso.
        </p>
      </form>

      {carregando && usuarios.length === 0 ? (
        <p className="text-sm text-ink-400">Carregando…</p>
      ) : (
        <div className="divide-y divide-ink-100">
          {usuarios.map((u) => {
            const permissoes = permissoesDe(u.login)
            const tipo = tipoDe(u)
            const aberto = editando?.login === u.login ? editando : null
            return (
              <div key={u.login} className="py-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink-900">
                      {u.exibicao}
                      {u.nome !== u.exibicao && <span className="font-normal text-ink-400"> · no app: {u.nome}</span>}
                      {tipo && <span className="ml-2 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800">{tipo.nome}</span>}
                      {u.pendente && (
                        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">aguardando função</span>
                      )}
                      {!u.temSenha && <span className="ml-2 rounded-full bg-ink-100 px-2 py-0.5 text-xs text-ink-600">ainda sem senha</span>}
                    </p>
                    <p className="text-xs text-ink-400">
                      {u.email || 'sem e-mail de recuperação'}
                      {u.criadoEm && ` · desde ${u.criadoEm.slice(0, 10).split('-').reverse().join('/')}`}
                      {!u.gestor && u.papel === 'admin' && ` · ${resumoPermissoes(permissoes)}`}
                    </p>
                  </div>
                  {u.gestor ? (
                    <span className="text-xs text-ink-400">Administrador (gerencia os usuários, pode tudo)</span>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        className="field-input w-auto py-1.5 text-sm"
                        aria-label={`Função de ${u.exibicao}`}
                        value={u.papel}
                        disabled={ocupado === u.login}
                        onChange={(e) => void handlePapel(u, e.target.value as PapelUsuario)}
                      >
                        <option value="xadrez">{ROTULO_PAPEL.xadrez}</option>
                        <option value="admin">{ROTULO_PAPEL.admin}</option>
                      </select>
                      {u.papel === 'admin' && (
                        <button
                          type="button"
                          aria-expanded={!!aberto}
                          disabled={ocupado === u.login}
                          onClick={() => setEditando(aberto ? null : { login: u.login, permissoes })}
                          className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50"
                        >
                          Permissões
                        </button>
                      )}
                      {u.pendente && (
                        <button
                          type="button"
                          disabled={ocupado === u.login}
                          onClick={() => void handlePapel(u, u.papel)}
                          className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50"
                        >
                          Manter sem função
                        </button>
                      )}
                      {u.temSenha && (
                        <button
                          type="button"
                          disabled={ocupado === u.login}
                          onClick={() => void handleLiberarSenha(u)}
                          className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50"
                        >
                          Liberar nova senha
                        </button>
                      )}
                      {!u.semente && (
                        <button
                          type="button"
                          disabled={ocupado === u.login}
                          onClick={() => void handleExcluir(u)}
                          className="rounded-lg px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50"
                        >
                          Excluir
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {aberto && (
                  <div className="mt-3 space-y-3 rounded-xl border border-ink-200 bg-ink-50/60 p-3" aria-label={`Permissões de ${u.exibicao}`}>
                    {tipos.some((t) => t.papel === 'admin') && (
                      <label className="flex flex-wrap items-center gap-2 text-sm text-ink-700">
                        Copiar de um tipo:
                        <select
                          className="field-input w-auto py-1 text-sm"
                          aria-label={`Copiar permissões de um tipo para ${u.exibicao}`}
                          value=""
                          onChange={(e) => {
                            const t = tipos.find((x) => x.id === e.target.value)
                            if (t) setEditando({ login: u.login, permissoes: { abas: t.abas, statusCotacoes: t.statusCotacoes, statusNotas: t.statusNotas, telaInicial: t.telaInicial ?? null } })
                          }}
                        >
                          <option value="">— escolher —</option>
                          {tipos
                            .filter((t) => t.papel === 'admin')
                            .map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.nome}
                              </option>
                            ))}
                        </select>
                        <span className="text-xs text-ink-400">(preenche as caixinhas — confira e salve)</span>
                      </label>
                    )}
                    <EditorPermissoes valor={aberto.permissoes} onChange={(p) => setEditando({ login: u.login, permissoes: p })} />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={ocupado === u.login}
                        onClick={() => void handleSalvarPermissoes(u)}
                        className="rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-semibold text-surface transition hover:opacity-90"
                      >
                        Salvar permissões
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditando(null)}
                        className="rounded-lg px-3 py-1.5 text-xs font-medium text-ink-500 hover:bg-ink-100"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
