import { useEffect, useState } from 'react'
import { cadastrarUsuario, definirPapel, excluirUsuario, liberarNovaSenha, listarUsuarios, type UsuarioCadastrado } from '../auth'
import { avisar, confirmar } from '../dialogs'
import {
  PERMISSOES_ADMIN,
  aplicarPermissoes,
  carregarPermissoesGuardadas,
  funcaoDoUsuario,
  getTiposUsuario,
  permissoesDoUsuario,
  type PermissoesDoUsuario,
  type PermissoesGuardadas,
  type TipoUsuario,
} from '../tiposUsuario'
import { EditorPermissoes } from './EditorPermissoes'
import { ROTULO_PAPEL, resumoPermissoes } from './TiposUsuarioCard'
import { VENDEDORES } from '../types'
import type { PapelUsuario } from '../sessaoUsuario'

const NOME_VALIDO = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{1,19}$/u

interface EscolhaDeFuncao {
  papel: PapelUsuario
  /** Do vendedor: de qual vendedor são as cotações dele. */
  vendedor?: string
  permissoes: PermissoesDoUsuario | null
  rotulo: string
}

/** O que uma escolha do campo "Função" vale: o papel no servidor e as permissões (sem função e
 * vendedor, nenhuma — o vendedor tem o site dele, ver vendedor/AppVendedor). */
function escolhaDaFuncao(valor: string, tipos: TipoUsuario[]): EscolhaDeFuncao | null {
  if (valor === 'xadrez') return { papel: 'xadrez', permissoes: null, rotulo: ROTULO_PAPEL.xadrez }
  if (valor === 'admin') return { papel: 'admin', permissoes: PERMISSOES_ADMIN, rotulo: ROTULO_PAPEL.admin }
  if (valor.startsWith('vendedor:') && valor.length > 'vendedor:'.length) {
    const vendedor = valor.slice('vendedor:'.length)
    return { papel: 'vendedor', vendedor, permissoes: null, rotulo: `Vendedor ${vendedor}` }
  }
  const tipo = tipos.find((t) => `tipo:${t.id}` === valor)
  if (!tipo) return null
  return { papel: tipo.papel, permissoes: tipo.papel === 'admin' ? tipo : null, rotulo: tipo.nome }
}

/** As opções do campo "Função": o Administrador, as funções criadas pelo Max, os vendedores e o "sem
 * função". `vendedorAtual`: o de quem já é vendedor, se não estiver mais na lista. */
function OpcoesDeFuncao({ tipos, personalizada = false, vendedorAtual }: { tipos: TipoUsuario[]; personalizada?: boolean; vendedorAtual?: string }) {
  const vendedores = vendedorAtual && !VENDEDORES.includes(vendedorAtual) ? [...VENDEDORES, vendedorAtual] : VENDEDORES
  return (
    <>
      <option value="admin">{ROTULO_PAPEL.admin}</option>
      {tipos.map((t) => (
        <option key={t.id} value={`tipo:${t.id}`}>
          {t.nome}
        </option>
      ))}
      <optgroup label={ROTULO_PAPEL.vendedor}>
        {vendedores.map((v) => (
          <option key={v} value={`vendedor:${v}`}>
            Vendedor {v}
          </option>
        ))}
      </optgroup>
      {personalizada && (
        <option value="personalizada" disabled>
          Personalizada (ajustada só pra ele)
        </option>
      )}
      <option value="xadrez">{ROTULO_PAPEL.xadrez}</option>
    </>
  )
}

/** Configurações › Usuários — só pro Max: cadastra quem vai usar o site, escolhe a função de cada um
 * (que define o que ele acessa — ver Funções de usuário), ajusta as permissões de alguém só pra ele,
 * libera senha nova, exclui. */
/** `embutido`: dentro da janela de Configurações, que já tem a moldura e o título. */
export function UsuariosCard({ embutido = false }: { embutido?: boolean } = {}) {
  const [usuarios, setUsuarios] = useState<UsuarioCadastrado[]>([])
  const [carregando, setCarregando] = useState(true)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [guardadas, setGuardadas] = useState<PermissoesGuardadas>({ abas: {}, status: {}, telaInicial: {}, financeiro: {} })
  const [tipos, setTipos] = useState<TipoUsuario[]>([])
  const [editando, setEditando] = useState<{ login: string; permissoes: PermissoesDoUsuario } | null>(null)
  const [nomeNovo, setNomeNovo] = useState('')
  const [funcaoNova, setFuncaoNova] = useState('admin')

  async function recarregar() {
    setCarregando(true)
    try {
      const [lista, g, listaTipos] = await Promise.all([listarUsuarios(), carregarPermissoesGuardadas(), getTiposUsuario()])
      // quem espera uma definição primeiro, depois na ordem do cadastro
      setUsuarios(lista.sort((a, b) => Number(b.pendente) - Number(a.pendente) || a.criadoEm.localeCompare(b.criadoEm)))
      setGuardadas(g)
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

  async function handleCadastrar() {
    const nome = nomeNovo.trim().replace(/\s+/g, ' ')
    if (!NOME_VALIDO.test(nome)) {
      void avisar('O nome de usuário precisa ter de 2 a 20 letras ou números (pode ter espaço, ponto, hífen ou _).')
      return
    }
    const funcao = escolhaDaFuncao(funcaoNova, tipos)
    if (!funcao) return void avisar('Escolha a função do novo usuário.')
    await executar(
      '__novo__',
      async () => {
        const { login } = await cadastrarUsuario(nome, funcao.papel, funcao.vendedor)
        if (funcao.permissoes) await aplicarPermissoes(login, funcao.permissoes)
        setNomeNovo('')
      },
      `${nome} cadastrado como "${funcao.rotulo}". No primeiro acesso, ele digita o nome de usuário e cria a própria senha.`,
    )
  }

  /** Muda a função: o papel no servidor e, com função, as permissões dela. */
  async function handleFuncao(u: UsuarioCadastrado, valor: string) {
    const funcao = escolhaDaFuncao(valor, tipos)
    if (!funcao) return
    if (!(await confirmar(`Definir ${u.exibicao} como "${funcao.rotulo}"?`))) return
    await executar(
      u.login,
      async () => {
        if (funcao.papel !== u.papel || u.pendente || funcao.papel === 'vendedor') await definirPapel(u.login, funcao.papel, funcao.vendedor)
        if (funcao.permissoes) await aplicarPermissoes(u.login, funcao.permissoes)
        setEditando(null)
      },
      `${u.exibicao} agora é "${funcao.rotulo}"` + (funcao.permissoes ? ' — vale na próxima vez que ele abrir o site.' : '.'),
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

  const funcaoEscolhida = escolhaDaFuncao(funcaoNova, tipos)

  return (
    <div className={embutido ? undefined : 'card'}>
      {!embutido && <h3 className="font-display text-base font-semibold text-ink-900 mb-1">Usuários</h3>}
      <p className="text-sm text-ink-400 mb-4">
        Só você cadastra quem vai usar o site. A função de cada um define o que ele acessa — se é administrador (vê prejuízo e
        faturamento), as abas, a Tela Inicial e os status. As funções ficam em Configurações › Funções de usuário; pra ajustar
        alguém só pra ele, use "Permissões" (ele fica como "Personalizada").
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
          <span className="field-label">Função</span>
          <select className="field-input w-auto" aria-label="Função do novo usuário" value={funcaoNova} onChange={(e) => setFuncaoNova(e.target.value)}>
            <OpcoesDeFuncao tipos={tipos} />
          </select>
        </label>
        <button
          type="submit"
          disabled={ocupado === '__novo__' || !nomeNovo.trim()}
          className="rounded-lg bg-ink-900 px-4 py-2 text-sm font-medium text-surface transition hover:opacity-90 disabled:opacity-50"
        >
          Cadastrar
        </button>
        <p className="w-full text-xs text-ink-400">
          {funcaoEscolhida?.permissoes
            ? `"${funcaoEscolhida.rotulo}": ${resumoPermissoes(funcaoEscolhida.permissoes)}. `
            : funcaoEscolhida?.papel === 'vendedor'
              ? `"${funcaoEscolhida.rotulo}": registra cotações e acompanha só as que estão no nome de ${funcaoEscolhida.vendedor}; vê os valores depois que a cotação é enviada. `
              : funcaoEscolhida
                ? 'Sem função, a pessoa só vê a própria conta. '
                : ''}
          A pessoa entra com esse nome e cria a própria senha (e o e-mail de recuperação) no primeiro acesso.
        </p>
      </form>

      {carregando && usuarios.length === 0 ? (
        <p className="text-sm text-ink-400">Carregando…</p>
      ) : (
        <div className="divide-y divide-ink-100">
          {usuarios.map((u) => {
            const permissoes = permissoesDoUsuario(guardadas, u)
            const funcao = funcaoDoUsuario(u.papel, permissoes, tipos, u.vendedor)
            const aberto = editando?.login === u.login ? editando : null
            return (
              <div key={u.login} className="py-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink-900">
                      {u.exibicao}
                      {u.nome !== u.exibicao && <span className="font-normal text-ink-400"> · no app: {u.nome}</span>}
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
                        value={funcao}
                        disabled={ocupado === u.login}
                        onChange={(e) => void handleFuncao(u, e.target.value)}
                      >
                        <OpcoesDeFuncao tipos={tipos} personalizada={funcao === 'personalizada'} vendedorAtual={u.vendedor || undefined} />
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
                    <p className="text-xs text-ink-400">
                      Ajuste só pra {u.exibicao}: se não bater com nenhuma função, ele fica como "Personalizada" e não muda quando as
                      funções mudarem.
                    </p>
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
