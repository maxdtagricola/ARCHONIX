import { useEffect, useState } from 'react'
import { Button } from './ui/Basics'
import { EditorPermissoes } from './EditorPermissoes'
import { avisar, confirmar } from '../dialogs'
import { listarUsuarios, type UsuarioCadastrado } from '../auth'
import { ABAS_CONFIGURAVEIS } from '../abasPermitidas'
import { statusDe } from '../statusConfig'
import { makeId } from '../utils'
import { TODAS_AS_PARTES } from '../telaInicialPorUsuario'
import {
  PERMISSOES_ADMIN,
  PERMISSOES_PADRAO,
  abasEfetivas,
  aplicarPermissoes,
  carregarPermissoesGuardadas,
  getTiposUsuario,
  mesmasPermissoes,
  permissoesDoUsuario,
  salvarTiposUsuario,
  type PermissoesDoUsuario,
  type PermissoesGuardadas,
  type TipoUsuario,
} from '../tiposUsuario'
import type { PapelUsuario } from '../sessaoUsuario'

export const ROTULO_PAPEL: Record<PapelUsuario, string> = {
  xadrez: 'Sem função definida',
  admin: 'Administrador (site completo)',
  vendedor: 'Vendedor (só as cotações dele)',
}

/** Resumo do que uma função (ou usuário) pode: "administrador · 9 de 14 abas · status: 5 de 13 das
 * cotações, todos de frete e notas · Tela Inicial: 6 de 10 partes" (a Tela Inicial só entra quando não
 * é inteira). */
export function resumoPermissoes(p: PermissoesDoUsuario): string {
  const n = abasEfetivas(p).length
  const abas = n === ABAS_CONFIGURAVEIS.length ? 'todas as abas' : `${n} de ${ABAS_CONFIGURAVEIS.length} abas`
  const sc = p.statusCotacoes === null ? 'todos' : `${p.statusCotacoes.length} de ${statusDe('cotacoes').length}`
  const sn = p.statusNotas === null ? 'todos' : `${p.statusNotas.length} de ${statusDe('notas').length}`
  const tela = p.telaInicial ? ` · Tela Inicial: ${p.telaInicial.length} de ${TODAS_AS_PARTES.length} partes` : ''
  const admin = p.financeiro ? 'administrador (vê prejuízo e faturamento) · ' : 'sem prejuízo e faturamento · '
  return `${admin}${abas} · status: ${sc === 'todos' && sn === 'todos' ? 'todos' : `${sc} das cotações, ${sn} de frete e notas`}${tela}`
}

/** Configurações › Funções de usuário — só pro Max: o que cada função acessa. A função de cada um se
 * escolhe em Configurações › Usuários; mudar uma função aqui muda junto quem está nela. */
export function TiposUsuarioCard() {
  const [tipos, setTipos] = useState<TipoUsuario[]>([])
  const [usuarios, setUsuarios] = useState<UsuarioCadastrado[]>([])
  const [guardadas, setGuardadas] = useState<PermissoesGuardadas | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [editando, setEditando] = useState<TipoUsuario | null>(null)
  const [salvando, setSalvando] = useState(false)

  async function recarregar() {
    const [lista, todos, g] = await Promise.all([getTiposUsuario(), listarUsuarios(), carregarPermissoesGuardadas()])
    setTipos(lista)
    setUsuarios(todos)
    setGuardadas(g)
  }

  useEffect(() => {
    recarregar()
      .catch((err) => void avisar(err instanceof Error ? err.message : 'Erro ao carregar as funções de usuário.'))
      .finally(() => setCarregando(false))
  }, [])

  /** Quem está nessa função (tem exatamente as permissões dela). */
  function usuariosNa(p: PermissoesDoUsuario, lista = usuarios, g = guardadas): UsuarioCadastrado[] {
    if (!g) return []
    return lista.filter((u) => !u.gestor && u.papel === 'admin' && mesmasPermissoes(permissoesDoUsuario(g, u), p))
  }

  async function handleSalvar() {
    if (!editando) return
    const nome = editando.nome.trim().replace(/\s+/g, ' ')
    if (nome.length < 2) return void avisar('Dê um nome à função (ex.: Vendedor).')
    if (Object.values(ROTULO_PAPEL).some((rotulo) => rotulo.toUpperCase() === nome.toUpperCase())) {
      return void avisar(`"${nome}" já existe sempre — dê outro nome.`)
    }
    if (tipos.some((t) => t.id !== editando.id && t.nome.toUpperCase() === nome.toUpperCase())) return void avisar('Já existe uma função com esse nome.')
    const tipo: TipoUsuario = { ...editando, nome, papel: 'admin', abas: abasEfetivas(editando), financeiro: !!editando.financeiro }
    // cada função com permissões só dela: é assim que se sabe a função de cada usuário
    const igual = tipos.find((t) => t.id !== tipo.id && t.papel === 'admin' && mesmasPermissoes(t, tipo))
    if (igual) return void avisar(`A função "${igual.nome}" já tem exatamente essas permissões — mude alguma caixinha ou use a "${igual.nome}".`)
    if (mesmasPermissoes(tipo, PERMISSOES_ADMIN)) {
      return void avisar(`Essas são as permissões do "${ROTULO_PAPEL.admin}", que já existe — mude alguma caixinha.`)
    }
    const anterior = tipos.find((t) => t.id === tipo.id)
    const lista = anterior ? tipos.map((t) => (t.id === tipo.id ? tipo : t)) : [...tipos, tipo]
    setSalvando(true)
    try {
      await salvarTiposUsuario(lista)
      // quem estava nessa função acompanha a mudança (lido de novo agora, pra não usar o que já mudou)
      let atualizados = 0
      if (anterior && anterior.papel === 'admin' && !mesmasPermissoes(anterior, tipo)) {
        const [todos, g] = await Promise.all([listarUsuarios(), carregarPermissoesGuardadas()])
        for (const u of usuariosNa(anterior, todos, g)) {
          await aplicarPermissoes(u.login, tipo)
          atualizados++
        }
      }
      setEditando(null)
      await recarregar()
      void avisar(
        `Função "${nome}" salva — já aparece em Usuários.` +
          (atualizados === 1
            ? ' O usuário que está nela foi atualizado (vale na próxima vez que ele abrir o site).'
            : atualizados > 1
              ? ` Os ${atualizados} usuários que estão nela foram atualizados (vale na próxima vez que abrirem o site).`
              : ''),
      )
    } catch (err) {
      void avisar(err instanceof Error ? err.message : 'Erro ao salvar no servidor.')
    } finally {
      setSalvando(false)
    }
  }

  async function handleExcluir(t: TipoUsuario) {
    const ok = await confirmar(`Excluir a função "${t.nome}"? Quem está nela continua com as mesmas permissões, como "Personalizada".`, {
      confirmText: 'Excluir',
      tone: 'danger',
    })
    if (!ok) return
    setSalvando(true)
    try {
      const lista = tipos.filter((x) => x.id !== t.id)
      await salvarTiposUsuario(lista)
      setTipos(lista)
      setEditando(null)
      void avisar(`Função "${t.nome}" excluída.`)
    } catch (err) {
      void avisar(err instanceof Error ? err.message : 'Erro ao salvar no servidor.')
    } finally {
      setSalvando(false)
    }
  }

  const contagem = (lista: UsuarioCadastrado[]) =>
    lista.length === 0 ? 'ninguém nela ainda' : lista.map((u) => u.exibicao).join(', ')

  return (
    <div>
      <p className="mb-4 text-sm text-ink-400">
        Cada função define o que a pessoa acessa: se é administrador (vê prejuízo e faturamento), as abas, o que aparece na Tela
        Inicial e os status que pode usar. Em Usuários, é só escolher a função de cada um — e, ao mudar uma função aqui, quem está
        nela muda junto. O "{ROTULO_PAPEL.admin}", o "{ROTULO_PAPEL.vendedor}" e o "{ROTULO_PAPEL.xadrez}" existem sempre.
      </p>

      {carregando ? (
        <p className="text-sm text-ink-400">Carregando…</p>
      ) : (
        <div className="divide-y divide-ink-100">
          <div className="py-3">
            <p className="text-sm font-medium text-ink-900">{ROTULO_PAPEL.admin}</p>
            <p className="text-xs text-ink-400">
              {resumoPermissoes(PERMISSOES_ADMIN)} · {contagem(usuariosNa(PERMISSOES_ADMIN))}
            </p>
          </div>
          <div className="py-3">
            <p className="text-sm font-medium text-ink-900">{ROTULO_PAPEL.vendedor}</p>
            <p className="text-xs text-ink-400">
              registra cotações e acompanha as que estão no nome dele; vê os valores só depois de enviada; nada de custos,
              fornecedores, margens ou faturamento ·{' '}
              {contagem(usuarios.filter((u) => u.papel === 'vendedor').map((u) => ({ ...u, exibicao: `${u.exibicao} (${u.vendedor || '?'})` })))}
            </p>
          </div>
          {tipos.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink-900">{t.nome}</p>
                <p className="text-xs text-ink-400">
                  {t.papel === 'admin' ? `${resumoPermissoes(t)} · ${contagem(usuariosNa(t))}` : ROTULO_PAPEL[t.papel]}
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
        <div className="mt-4 space-y-4 rounded-xl border border-ink-200 bg-ink-50/60 p-4" aria-label="Função de usuário">
          <label className="block max-w-sm">
            <span className="field-label">Nome da função</span>
            <input
              className="field-input"
              maxLength={30}
              placeholder="Ex.: Vendedor"
              value={editando.nome}
              onChange={(e) => setEditando({ ...editando, nome: e.target.value })}
            />
          </label>
          <EditorPermissoes valor={editando} onChange={(p) => setEditando({ ...editando, ...p })} />
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => void handleSalvar()} disabled={salvando}>
              Salvar função
            </Button>
            <Button variant="ghost" onClick={() => setEditando(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <Button variant="secondary" onClick={() => setEditando({ id: makeId(), nome: '', papel: 'admin', ...PERMISSOES_PADRAO })}>
            + Nova função
          </Button>
        </div>
      )}
    </div>
  )
}
