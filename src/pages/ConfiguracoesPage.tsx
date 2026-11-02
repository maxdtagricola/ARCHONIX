import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '../components/ui/Basics'
import { PercentField, SelectField, TextField } from '../components/ui/Field'
import { PreviaImportacao } from '../components/PreviaImportacao'
import {
  getPlanilhaAtivaIds,
  getStatusColors,
  listPlanilhas,
  salvarPlanilha,
  setPlanilhaAtivaId,
  setStatusColor,
  type PlanilhaImportada,
} from '../db/configRepo'
import { deleteEmpresa, listEmpresas, saveEmpresa } from '../db/empresasRepo'
import { definirTabelasCustomizadas } from '../calc/calculator'
import { lerPlanilhaMarkup, type ResultadoImportacao } from '../xlsxImport'
import { baixarWorkbookMarkup } from '../planilhaMarkupDownload'
import { formatDate } from '../utils'
import { gerarPreviaPlanilha, type PreviaPlanilha } from '../xlsxSheetUtil'
import { ESTADOS } from '../data/estados'
import { DEFAULT_EMPRESA, ESTADOS_DESTINO } from '../types'
import type { Empresa, EstadoDestino } from '../types'
import type { PricingGlobal } from '../db/configRepo'
import { verificarSenhaAdmin } from '../db/db'
import { avisar, pedirSenha } from '../dialogs'
import { UsuariosCard } from '../components/UsuariosCard'
import { TiposUsuarioCard } from '../components/TiposUsuarioCard'
import { DadoDoSamurai } from '../components/DadoDoSamurai'
import { EditorDeStatus } from '../components/EditorDeStatus'
import { listQuotes } from '../db/analysesRepo'
import { listNotasFiscais } from '../db/notasFiscaisRepo'
import { listNotasFiscaisGerais } from '../db/notasFiscaisGeraisRepo'
import type { TipoStatus } from '../statusConfig'
import { FeriadosCard } from '../components/FeriadosCard'
import { useSessao } from '../sessaoUsuario'
import { MinhaContaForm } from '../components/MinhaContaModal'
import { ICONES_CONFIG } from '../components/IconesConfiguracoes'
import { useFecharComEsc } from '../teclaEsc'
import { useEstadoPersistente } from '../estadoPersistente'
import {
  CHAVE_MINUTOS_SAIDA,
  MINUTOS_SAIDA_PADRAO,
  OPCOES_SAIDA_AUTOMATICA,
  textoDaSaida,
} from '../components/SaidaAutomatica'

const estadoOptions = ESTADOS.map((e) => ({ value: e.uf, label: `${e.uf} — ${e.nome}` }))

type SecaoConfig = keyof typeof ICONES_CONFIG

/** As partes de cada um (ou deste aparelho) — aparecem mesmo pra quem não tem as Configurações gerais. */
const SECOES_PESSOAIS: SecaoConfig[] = ['conta', 'saida', 'fundo']
/** Só pro gestor (o Max): quem usa o site, os tipos de usuário e os status. */
const SECOES_DO_GESTOR: SecaoConfig[] = ['usuarios', 'tiposUsuario', 'statusCotacoes', 'statusNotas']

/** As partes da aba, na ordem dos símbolos (as mais usadas primeiro). */
const SECOES: { id: SecaoConfig; titulo: string; resumo: string; icone: ReactNode }[] = [
  { id: 'conta', titulo: 'Minha conta', resumo: 'Trocar a sua senha e o e-mail de recuperação', icone: ICONES_CONFIG.conta },
  { id: 'saida', titulo: 'Saída automática', resumo: 'Sair sozinho depois de um tempo sem uso', icone: ICONES_CONFIG.saida },
  { id: 'usuarios', titulo: 'Usuários', resumo: 'Cadastrar, função, permissões e nova senha', icone: ICONES_CONFIG.usuarios },
  { id: 'tiposUsuario', titulo: 'Tipos de usuário', resumo: 'Modelos de função, abas e status pra reaproveitar', icone: ICONES_CONFIG.tiposUsuario },
  { id: 'statusCotacoes', titulo: 'Status das cotações', resumo: 'Nome, cor, ordem e status novos', icone: ICONES_CONFIG.statusCotacoes },
  { id: 'statusNotas', titulo: 'Status de frete e notas', resumo: 'Nome, cor, ordem e status novos', icone: ICONES_CONFIG.statusNotas },
  { id: 'formacao', titulo: 'Formação de preço', resumo: 'Imposto federal, comissão e custo fixo', icone: ICONES_CONFIG.formacao },
  { id: 'empresas', titulo: 'Empresas', resumo: 'Empresas do grupo que recebem os materiais', icone: ICONES_CONFIG.empresas },
  { id: 'importarMarkup', titulo: 'Importar planilha de markup', resumo: 'Nova versão das tabelas RBC e ICMS-ST', icone: ICONES_CONFIG.importarMarkup },
  { id: 'planilhas', titulo: 'Planilhas importadas', resumo: 'Histórico, baixar ou voltar a usar uma anterior', icone: ICONES_CONFIG.planilhas },
  { id: 'feriados', titulo: 'Feriados', resumo: 'Estaduais e municipais, pros dias úteis', icone: ICONES_CONFIG.feriados },
  { id: 'fundo', titulo: 'Vídeo de fundo', resumo: 'Animar ou pausar o samurai ao fundo', icone: ICONES_CONFIG.fundo },
]

export function ConfiguracoesPage({
  currentAdmin,
  pricingGlobal,
  onSavePricingGlobal,
  onTabelasAtualizadas,
  fundoPausado,
  onAlternarFundo,
  configuracoesGerais,
}: {
  currentAdmin: string
  pricingGlobal: PricingGlobal
  onSavePricingGlobal: (valores: PricingGlobal) => Promise<void>
  /** A planilha de markup em uso mudou — quem mostra cálculos refaz a conta com as tabelas novas. */
  onTabelasAtualizadas: () => void
  /** Vídeo de fundo parado (só neste aparelho) — o único lugar onde se pausa/volta a animar. */
  fundoPausado: boolean
  onAlternarFundo: () => void
  /** Sem isso (Configurações > Usuários > Abas), só as partes pessoais: minha conta, saída, vídeo. */
  configuracoesGerais: boolean
}) {
  // (o tema claro/escuro saiu daqui — agora é um botão fixo na barra lateral, ver Layout.tsx)

  // a lista de usuários (definir função de quem se cadastrou) é só pro Max
  const sessao = useSessao()
  const gerenciaUsuarios = sessao?.usuario.gestor ?? false
  const [aberta, setAberta] = useState<SecaoConfig | null>(null)
  // por aparelho — o SaidaAutomatica (App) lê o mesmo valor a cada segundo
  const [minutosSaida, setMinutosSaida] = useEstadoPersistente<number>(CHAVE_MINUTOS_SAIDA, MINUTOS_SAIDA_PADRAO)

  // --- cores dos status -------------------------------------------------------
  const [coresStatus, setCoresStatus] = useState<Record<string, string>>({})

  useEffect(() => {
    getStatusColors()
      .then(setCoresStatus)
      .catch(() => {
        // cor customizada é só um extra visual — se falhar, usa a paleta padrão
      })
  }, [])

  async function handleCorStatusChange(status: string, cor: string) {
    setCoresStatus((prev) => ({ ...prev, [status]: cor }))
    try {
      await setStatusColor(status, cor)
    } catch (err) {
      void avisar(err instanceof Error ? err.message : 'Erro ao salvar a cor no servidor.')
    }
  }

  async function contarUso(tipo: TipoStatus, status: string): Promise<number> {
    if (tipo === 'cotacoes') return (await listQuotes()).filter((q) => q.status === status).length
    const [notas, gerais] = await Promise.all([listNotasFiscais(), listNotasFiscaisGerais()])
    return [...notas, ...gerais].filter((n) => n.status === status).length
  }

  // --- formação de preço global -----------------------------------------------
  const [rascunhoGlobal, setRascunhoGlobal] = useState<PricingGlobal>(pricingGlobal)
  const [salvandoGlobal, setSalvandoGlobal] = useState(false)

  useEffect(() => {
    setRascunhoGlobal(pricingGlobal)
  }, [pricingGlobal])

  async function handleSalvarGlobal() {
    setSalvandoGlobal(true)
    try {
      await onSavePricingGlobal(rascunhoGlobal)
    } catch (err) {
      void avisar(err instanceof Error ? err.message : 'Erro ao salvar no servidor.')
    } finally {
      setSalvandoGlobal(false)
    }
  }

  // --- empresas que recebem os materiais (destino do frete automático) --------
  const cardEmpresasRef = useRef<HTMLDivElement>(null)
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [carregandoEmpresas, setCarregandoEmpresas] = useState(true)
  const [formEmpresa, setFormEmpresa] = useState(DEFAULT_EMPRESA)
  const [editingEmpresaId, setEditingEmpresaId] = useState<string | undefined>(undefined)
  const [senhaEmpresa, setSenhaEmpresa] = useState('')
  const [salvandoEmpresa, setSalvandoEmpresa] = useState(false)

  async function refreshEmpresas() {
    setCarregandoEmpresas(true)
    try {
      setEmpresas(await listEmpresas())
    } catch (err) {
      void avisar(err instanceof Error ? err.message : 'Erro ao carregar empresas do servidor.')
    } finally {
      setCarregandoEmpresas(false)
    }
  }

  useEffect(() => {
    refreshEmpresas()
  }, [])

  function patchEmpresa(p: Partial<typeof formEmpresa>) {
    setFormEmpresa((prev) => ({ ...prev, ...p }))
  }

  function handleCancelEditEmpresa() {
    setFormEmpresa(DEFAULT_EMPRESA)
    setEditingEmpresaId(undefined)
    setSenhaEmpresa('')
  }

  async function handleSubmitEmpresa() {
    if (!formEmpresa.nome.trim()) {
      void avisar('Informe pelo menos o nome da empresa.')
      return
    }
    setSalvandoEmpresa(true)
    try {
      await saveEmpresa(formEmpresa, editingEmpresaId, senhaEmpresa)
      handleCancelEditEmpresa()
      await refreshEmpresas()
    } catch (err) {
      void avisar(err instanceof Error ? err.message : 'Erro ao salvar a empresa no servidor.')
    } finally {
      setSalvandoEmpresa(false)
    }
  }

  function handleEditEmpresa(e: Empresa) {
    setFormEmpresa({
      nome: e.nome,
      cnpj: e.cnpj,
      endereco: e.endereco,
      bairro: e.bairro,
      cep: e.cep,
      municipio: e.municipio,
      uf: e.uf,
      email: e.email ?? '',
    })
    setEditingEmpresaId(e.id)
    cardEmpresasRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function handleDeleteEmpresa(id: string) {
    const senha = await pedirSenha('Excluir esta empresa? Essa ação não pode ser desfeita.\nDigite a senha para confirmar.', {
      titulo: 'Excluir empresa',
      confirmText: 'Excluir',
    })
    if (senha === null) return
    try {
      await deleteEmpresa(id, senha)
      if (editingEmpresaId === id) handleCancelEditEmpresa()
      await refreshEmpresas()
    } catch (err) {
      void avisar(err instanceof Error ? err.message : 'Erro ao excluir a empresa no servidor.')
    }
  }

  // --- importação de planilha de markup ---------------------------------------
  const [habilitado, setHabilitado] = useState(false)
  const [perfilImportacao, setPerfilImportacao] = useState<EstadoDestino>('RO')
  const [senhaImportar, setSenhaImportar] = useState('')
  const [arquivo, setArquivo] = useState<File | undefined>(undefined)
  const [lendoPrevia, setLendoPrevia] = useState(false)
  const [previaArquivo, setPreviaArquivo] = useState<PreviaPlanilha | undefined>(undefined)
  const [arquivoConfirmado, setArquivoConfirmado] = useState(false)
  const [importando, setImportando] = useState(false)
  const [pendente, setPendente] = useState<(ResultadoImportacao & { nomeArquivo: string }) | undefined>(undefined)
  const [senhaSalvar, setSenhaSalvar] = useState('')
  const [salvandoPlanilha, setSalvandoPlanilha] = useState(false)

  const [planilhas, setPlanilhas] = useState<PlanilhaImportada[]>([])
  const [planilhaAtivaIds, setPlanilhaAtivaIds] = useState<Partial<Record<EstadoDestino, string>>>({})
  const [carregandoPlanilhas, setCarregandoPlanilhas] = useState(true)

  async function refreshPlanilhas() {
    setCarregandoPlanilhas(true)
    try {
      const [lista, ativas] = await Promise.all([listPlanilhas(), getPlanilhaAtivaIds()])
      setPlanilhas(lista)
      setPlanilhaAtivaIds(ativas)
    } catch (err) {
      void avisar(err instanceof Error ? err.message : 'Erro ao carregar planilhas importadas do servidor.')
    } finally {
      setCarregandoPlanilhas(false)
    }
  }

  useEffect(() => {
    refreshPlanilhas()
  }, [])

  async function handleArquivoSelecionado(file: File | undefined) {
    setArquivo(file)
    setArquivoConfirmado(false)
    setPreviaArquivo(undefined)
    if (!file) return
    setLendoPrevia(true)
    try {
      setPreviaArquivo(await gerarPreviaPlanilha(file))
    } catch (err) {
      void avisar(err instanceof Error ? err.message : 'Erro ao ler a planilha.')
      setArquivo(undefined)
    } finally {
      setLendoPrevia(false)
    }
  }

  async function handleImportar() {
    if (!habilitado) return
    if (!arquivo) {
      void avisar('Selecione o arquivo da planilha.')
      return
    }
    if (!arquivoConfirmado) {
      void avisar('Confirme que é a planilha certa antes de importar.')
      return
    }
    setImportando(true)
    try {
      await verificarSenhaAdmin(senhaImportar)
      const resultado = await lerPlanilhaMarkup(arquivo)
      setPendente({ ...resultado, nomeArquivo: arquivo.name })
      setSenhaImportar('')
    } catch (err) {
      void avisar(err instanceof Error ? err.message : 'Erro ao ler a planilha.')
    } finally {
      setImportando(false)
    }
  }

  async function handleSalvarNovaPlanilha() {
    if (!pendente) return
    setSalvandoPlanilha(true)
    try {
      const registro = await salvarPlanilha({
        perfil: perfilImportacao,
        nomeArquivo: pendente.nomeArquivo,
        importadoPor: currentAdmin,
        rbc: pendente.rbc,
        icmsSt: pendente.icmsSt,
        pisCofins: pendente.pisCofins,
        ncmsLista: pendente.ncmsLista,
      }, senhaSalvar)
      await setPlanilhaAtivaId(perfilImportacao, registro.id, senhaSalvar)
      definirTabelasCustomizadas(perfilImportacao, registro)
      onTabelasAtualizadas()
      setPendente(undefined)
      setSenhaSalvar('')
      setArquivo(undefined)
      setPreviaArquivo(undefined)
      setArquivoConfirmado(false)
      setHabilitado(false)
      await refreshPlanilhas()
      void avisar('Planilha salva e aplicada com sucesso.')
    } catch (err) {
      void avisar(err instanceof Error ? err.message : 'Erro ao salvar a planilha no servidor.')
    } finally {
      setSalvandoPlanilha(false)
    }
  }

  // --- trocar planilha ativa / baixar planilha — as duas pedem senha antes -----
  const [acaoPlanilhaPendente, setAcaoPlanilhaPendente] = useState<
    { tipo: 'usar' | 'baixar'; planilha: PlanilhaImportada } | undefined
  >(undefined)
  const [senhaAcaoPlanilha, setSenhaAcaoPlanilha] = useState('')
  const [executandoAcaoPlanilha, setExecutandoAcaoPlanilha] = useState(false)

  function handleCancelarAcaoPlanilha() {
    setAcaoPlanilhaPendente(undefined)
    setSenhaAcaoPlanilha('')
  }

  async function handleConfirmarAcaoPlanilha() {
    if (!acaoPlanilhaPendente) return
    const { tipo, planilha } = acaoPlanilhaPendente
    setExecutandoAcaoPlanilha(true)
    try {
      if (tipo === 'usar') {
        await setPlanilhaAtivaId(planilha.perfil, planilha.id, senhaAcaoPlanilha)
        definirTabelasCustomizadas(planilha.perfil, planilha)
        onTabelasAtualizadas()
        setPlanilhaAtivaIds((prev) => ({ ...prev, [planilha.perfil]: planilha.id }))
        void avisar(`Planilha "${planilha.nomeArquivo}" aplicada pro perfil ${planilha.perfil}.`)
      } else {
        await verificarSenhaAdmin(senhaAcaoPlanilha)
        baixarWorkbookMarkup(planilha)
      }
      handleCancelarAcaoPlanilha()
    } catch (err) {
      void avisar(err instanceof Error ? err.message : 'Erro ao concluir a ação.')
    } finally {
      setExecutandoAcaoPlanilha(false)
    }
  }

  // cada parte das configurações é um símbolo; clicar abre só ela, numa janela (fecha no ✕ ou no Esc)
  const secoes = SECOES.filter((s) =>
    SECOES_DO_GESTOR.includes(s.id) ? gerenciaUsuarios : configuracoesGerais || SECOES_PESSOAIS.includes(s.id),
  )
  const secaoAberta = secoes.find((s) => s.id === aberta)

  function conteudoDa(secao: SecaoConfig): ReactNode {
    switch (secao) {
      case 'conta':
        return sessao ? <MinhaContaForm usuario={sessao.usuario} /> : null
      case 'saida':
        return (
          <fieldset>
            <legend className="text-xs text-ink-400 mb-4">
              Sem mexer no site (mouse, toque ou teclado) por esse tempo, você sai sozinho — e precisa entrar de novo.
              Um minuto antes aparece um aviso. Vale só neste aparelho; o que estava sendo editado numa cotação não se
              perde (ao entrar, o site oferece recuperar).
            </legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {OPCOES_SAIDA_AUTOMATICA.map((m) => (
                <label
                  key={m}
                  className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition ${
                    minutosSaida === m ? 'border-ink-900 bg-ink-100 font-semibold text-ink-900' : 'border-ink-200 text-ink-700 hover:bg-ink-50'
                  }`}
                >
                  <input type="radio" name="saida-automatica" checked={minutosSaida === m} onChange={() => setMinutosSaida(m)} />
                  {textoDaSaida(m)}
                  {m === MINUTOS_SAIDA_PADRAO && <span className="text-[10px] font-normal text-ink-400">(padrão)</span>}
                </label>
              ))}
            </div>
          </fieldset>
        )
      case 'usuarios':
        return <UsuariosCard embutido />
      case 'feriados':
        return <FeriadosCard embutido />
      case 'fundo':
        return (
          <>
            <p className="text-xs text-ink-400 mb-4">
              A animação do samurai atrás das telas (e na tela de entrada). Vale só neste aparelho — cada um escolhe o seu.
              Parada, fica a imagem fixa no lugar do vídeo, e o samurai para onde estiver.
            </p>
            <label className="relative flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-ink-100 px-4 py-3">
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink-900">Animar o vídeo de fundo</span>
                <span className="block text-xs text-ink-400">{fundoPausado ? 'Pausado agora' : 'Animando agora'}</span>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={!fundoPausado}
                onChange={onAlternarFundo}
                aria-label="Animar o vídeo de fundo"
                className="peer sr-only"
              />
              <span
                aria-hidden
                className="relative h-6 w-11 shrink-0 rounded-full bg-ink-300 transition peer-checked:bg-emerald-600 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-500 after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-5"
              />
            </label>
            <DadoDoSamurai />
          </>
        )
      case 'tiposUsuario':
        return <TiposUsuarioCard />
      case 'statusCotacoes':
      case 'statusNotas': {
        const tipo = secao === 'statusCotacoes' ? 'cotacoes' : 'notas'
        return <EditorDeStatus key={tipo} tipo={tipo} cores={coresStatus} onCor={handleCorStatusChange} contarUso={(status) => contarUso(tipo, status)} />
      }
      case 'formacao':
        return (
          <>
            <p className="text-xs text-ink-400 mb-4">
              Imposto federal, comissão e custo fixo valem pra todas as cotações — não são mais definidos item a item.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <PercentField
                label="Imposto federal"
                value={rascunhoGlobal.impFedPct}
                onChange={(v) => setRascunhoGlobal((prev) => ({ ...prev, impFedPct: v }))}
              />
              <PercentField
                label="Comissão"
                value={rascunhoGlobal.comissaoPct}
                onChange={(v) => setRascunhoGlobal((prev) => ({ ...prev, comissaoPct: v }))}
              />
              <PercentField
                label="Custo fixo"
                value={rascunhoGlobal.custoFixoPct}
                onChange={(v) => setRascunhoGlobal((prev) => ({ ...prev, custoFixoPct: v }))}
              />
            </div>
            <Button variant="primary" onClick={handleSalvarGlobal} disabled={salvandoGlobal}>
              Salvar formação de preço
            </Button>
          </>
        )
      case 'empresas':
        return (
          <div ref={cardEmpresasRef}>
            <p className="text-xs text-ink-400 mb-4">
              Dados completos de cada empresa do grupo — vão ser usados na aba Frete como destino, pra gerar o frete
              automático por transportadora.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <TextField label="Nome / Razão social" value={formEmpresa.nome} onChange={(v) => patchEmpresa({ nome: v })} />
              <TextField label="CNPJ / CPF" value={formEmpresa.cnpj} onChange={(v) => patchEmpresa({ cnpj: v })} placeholder="00.000.000/0000-00" />
              <TextField label="Endereço" value={formEmpresa.endereco} onChange={(v) => patchEmpresa({ endereco: v })} className="sm:col-span-2" />
              <TextField label="Bairro / Distrito" value={formEmpresa.bairro} onChange={(v) => patchEmpresa({ bairro: v })} />
              <TextField label="CEP" value={formEmpresa.cep} onChange={(v) => patchEmpresa({ cep: v })} placeholder="00000-000" />
              <TextField label="Município" value={formEmpresa.municipio} onChange={(v) => patchEmpresa({ municipio: v })} />
              <SelectField label="UF" value={formEmpresa.uf} onChange={(v) => patchEmpresa({ uf: v })} options={estadoOptions} />
              <TextField
                label="E-mail"
                value={formEmpresa.email}
                onChange={(v) => patchEmpresa({ email: v })}
                placeholder="contato@empresa.com.br"
                hint="Carrega sozinho no pedido de frete, quando o modelo da transportadora pedir e-mail"
              />
            </div>

            <label className="block mt-4 max-w-[12rem]">
              <span className="field-label">Senha pra salvar</span>
              <input type="password" className="field-input" value={senhaEmpresa} onChange={(e) => setSenhaEmpresa(e.target.value)} />
            </label>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="primary" onClick={handleSubmitEmpresa} disabled={salvandoEmpresa}>
                {editingEmpresaId ? 'Salvar alterações' : 'Adicionar empresa'}
              </Button>
              {editingEmpresaId && (
                <>
                  <Button variant="secondary" onClick={handleCancelEditEmpresa}>
                    Cancelar edição
                  </Button>
                  <button
                    type="button"
                    onClick={() => handleDeleteEmpresa(editingEmpresaId)}
                    className="inline-flex items-center justify-center rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-500"
                  >
                    Excluir empresa
                  </button>
                </>
              )}
            </div>

            {carregandoEmpresas ? (
              <p className="text-sm text-ink-400 text-center py-6">Carregando…</p>
            ) : empresas.length === 0 ? (
              <p className="text-sm text-ink-400 text-center py-6">Nenhuma empresa cadastrada ainda.</p>
            ) : (
              <div className="mt-4 divide-y divide-ink-100 border-t border-ink-100">
                {empresas.map((e) => (
                  <div key={e.id} className="py-3">
                    <button type="button" onClick={() => handleEditEmpresa(e)} className="w-full min-w-0 text-left hover:opacity-80">
                      <p className="text-sm font-medium text-ink-900 truncate">{e.nome}</p>
                      <p className="text-xs text-ink-400 truncate">
                        CNPJ {e.cnpj || '—'} · {e.endereco || '—'} · {e.municipio || '—'}
                        {e.municipio && e.uf ? ' - ' : ''}
                        {e.uf || ''}
                      </p>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      case 'importarMarkup':
        return (
          <>
            <p className="text-xs text-ink-400 mb-4">
              Se os impostos ou tabelas da planilha original (RBC, ICMS-ST) mudarem, importe a nova versão aqui em vez de
              alterar tudo manualmente. A importação só faz a leitura — nada muda até você clicar em "Salvar nova
              planilha" e confirmar a senha de novo.
            </p>

            <label className="flex items-center gap-2 mb-4 text-sm text-ink-700">
              <input type="checkbox" checked={habilitado} onChange={(e) => setHabilitado(e.target.checked)} className="h-4 w-4" />
              Habilitar importação de planilha
            </label>

            <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4 ${habilitado ? '' : 'opacity-40 pointer-events-none'}`}>
              <SelectField
                label="Perfil (estado de destino)"
                value={perfilImportacao}
                onChange={(v) => setPerfilImportacao(v as EstadoDestino)}
                options={ESTADOS_DESTINO.map((e) => ({ value: e.value, label: e.label }))}
              />
              <label className="block">
                <span className="field-label">Senha</span>
                <input
                  type="password"
                  className="field-input"
                  value={senhaImportar}
                  onChange={(e) => setSenhaImportar(e.target.value)}
                  disabled={!habilitado}
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="field-label">Arquivo (.xlsx)</span>
                <input
                  type="file"
                  accept=".xlsx"
                  onChange={(e) => handleArquivoSelecionado(e.target.files?.[0])}
                  disabled={!habilitado}
                  className="field-input"
                />
              </label>
            </div>

            {lendoPrevia && <p className="text-sm text-ink-400 mb-4">Lendo planilha…</p>}

            {habilitado && previaArquivo && arquivo && !arquivoConfirmado && (
              <div className="mb-4">
                <PreviaImportacao
                  nomeArquivo={arquivo.name}
                  previa={previaArquivo}
                  onConfirmar={() => setArquivoConfirmado(true)}
                  onCancelar={() => handleArquivoSelecionado(undefined)}
                />
              </div>
            )}

            <Button variant="secondary" onClick={handleImportar} disabled={!habilitado || !arquivoConfirmado || importando}>
              Importar (só leitura)
            </Button>

            {pendente && (
              <div className="mt-5 rounded-xl border border-brand-200 bg-brand-50 p-4">
                <p className="text-sm font-medium text-ink-900 mb-1">
                  Planilha lida: {pendente.nomeArquivo} (perfil {perfilImportacao})
                </p>
                <p className="text-xs text-ink-600 mb-3">
                  {pendente.totalNcmsRbc} NCMs na tabela RBC · {pendente.totalNcmsIcmsSt} NCMs na tabela ICMS-ST ·{' '}
                  {pendente.totalNcmsPisCofins} NCMs com PIS/COFINS monofásico
                  {pendente.ncmsLista.length > 0 ? ` · ${pendente.ncmsLista.length} NCMs na lista de NCMs` : ''}. Ainda não
                  foi aplicada — confirme a senha de novo pra substituir a planilha atual desse perfil.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="password"
                    className="field-input max-w-[10rem]"
                    placeholder="Senha"
                    aria-label="Senha"
                    value={senhaSalvar}
                    onChange={(e) => setSenhaSalvar(e.target.value)}
                  />
                  <Button variant="primary" onClick={handleSalvarNovaPlanilha} disabled={salvandoPlanilha}>
                    Salvar nova planilha
                  </Button>
                  <Button variant="ghost" onClick={() => setPendente(undefined)}>
                    Descartar
                  </Button>
                </div>
              </div>
            )}
          </>
        )
      case 'planilhas':
        return (
          <>
            <p className="text-xs text-ink-400 mb-4">Histórico de todas as planilhas já salvas — dá pra voltar a usar uma anterior.</p>
            {carregandoPlanilhas ? (
              <p className="text-sm text-ink-400 text-center py-6">Carregando…</p>
            ) : planilhas.length === 0 ? (
              <p className="text-sm text-ink-400 text-center py-6">Nenhuma planilha importada ainda.</p>
            ) : (
              <div className="divide-y divide-ink-100">
                {planilhas.map((p) => {
                  const ativa = planilhaAtivaIds[p.perfil] === p.id
                  return (
                    <div key={p.id} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink-900 truncate">
                          {p.nomeArquivo}
                          {ativa && (
                            <span className="ml-2 inline-flex items-center rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-semibold text-ink-800">
                              Ativa
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-ink-400">
                          Perfil {p.perfil} · importado por {p.importadoPor || '—'} em {formatDate(p.importadoEm)}
                        </p>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Button variant="secondary" onClick={() => setAcaoPlanilhaPendente({ tipo: 'baixar', planilha: p })}>
                          Baixar
                        </Button>
                        {!ativa && (
                          <Button variant="secondary" onClick={() => setAcaoPlanilhaPendente({ tipo: 'usar', planilha: p })}>
                            Usar esta
                          </Button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {acaoPlanilhaPendente && (
              <div className="mt-4 rounded-xl border border-brand-200 bg-brand-50 p-4">
                <p className="text-sm text-ink-900 mb-3">
                  {acaoPlanilhaPendente.tipo === 'usar'
                    ? `Confirme a senha pra usar "${acaoPlanilhaPendente.planilha.nomeArquivo}" no perfil ${acaoPlanilhaPendente.planilha.perfil}.`
                    : `Confirme a senha pra baixar "${acaoPlanilhaPendente.planilha.nomeArquivo}".`}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="password"
                    className="field-input max-w-[10rem]"
                    placeholder="Senha"
                    aria-label="Senha"
                    value={senhaAcaoPlanilha}
                    onChange={(e) => setSenhaAcaoPlanilha(e.target.value)}
                  />
                  <Button variant="primary" onClick={handleConfirmarAcaoPlanilha} disabled={executandoAcaoPlanilha}>
                    Confirmar
                  </Button>
                  <Button variant="ghost" onClick={handleCancelarAcaoPlanilha}>
                    Cancelar
                  </Button>
                </div>
              </div>
            )}
          </>
        )
    }
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <h2 className="font-display text-lg font-semibold text-ink-900 mb-1">Configurações</h2>
        <p className="text-sm text-ink-400">
          Clique num símbolo pra abrir — fecha no ✕ ou com a tecla Esc. Minha conta é só sua, e Saída automática e Vídeo
          de fundo valem só neste aparelho; o resto vale pra todos os admins.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {secoes.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setAberta(s.id)}
            aria-haspopup="dialog"
            className="card group flex flex-col items-center gap-2 !p-4 text-center transition hover:-translate-y-0.5 hover:border-ink-300 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100 text-ink-800 transition group-hover:bg-ink-200 group-hover:text-ink-950">
              {s.icone}
            </span>
            <span className="text-sm font-semibold leading-tight text-ink-900">{s.titulo}</span>
            <span className="text-[11px] leading-snug text-ink-400">{s.resumo}</span>
          </button>
        ))}
      </div>

      {secaoAberta && (
        <PainelConfiguracao titulo={secaoAberta.titulo} icone={secaoAberta.icone} onFechar={() => setAberta(null)}>
          {conteudoDa(secaoAberta.id)}
        </PainelConfiguracao>
      )}
    </div>
  )
}

/** A parte aberta das configurações, numa janela por cima — fecha no ✕, no Esc ou clicando fora. O que
 * estava preenchido continua lá se ela for aberta de novo (fica guardado na página). */
function PainelConfiguracao({
  titulo,
  icone,
  onFechar,
  children,
}: {
  titulo: string
  icone: ReactNode
  onFechar: () => void
  children: ReactNode
}) {
  useFecharComEsc(onFechar)
  const caixaRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    caixaRef.current?.focus()
  }, [])
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 sm:p-4 animate-[dialog-fade-in_0.15s_ease-out]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onFechar()
      }}
    >
      <div
        ref={caixaRef}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        tabIndex={-1}
        className="card flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden !p-0 outline-none animate-[dialog-pop-in_0.18s_cubic-bezier(0.16,1,0.3,1)]"
      >
        <div className="flex items-center gap-3 border-b border-ink-100 px-5 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ink-100 text-ink-800 [&_svg]:h-5 [&_svg]:w-5">
            {icone}
          </span>
          <h3 className="min-w-0 flex-1 truncate font-display text-lg font-semibold text-ink-900">{titulo}</h3>
          <button
            type="button"
            onClick={onFechar}
            title="Fechar (Esc)"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-ink-200 px-2.5 py-1.5 text-sm text-ink-600 transition hover:bg-ink-100 hover:text-ink-900"
          >
            <span aria-hidden>✕</span> Fechar
            <kbd className="hidden rounded border border-ink-200 px-1 font-mono text-[10px] text-ink-400 sm:inline">Esc</kbd>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  )
}
