import { useEffect, useRef, useState } from 'react'
import { avisar } from '../dialogs'
import { itensDoTexto, type ItemLido } from './itensDoTexto'
import type { ArquivoParaAnexar } from './cotacaoDoVendedor'
import type { FormaDeImportar } from './telaVendedor'

// Importar os itens da cotação de onde o cliente mandou: planilha (Excel/CSV), foto ou print
// (arrastado, escolhido ou colado com Ctrl+V), PDF (com texto ou escaneado) ou texto colado
// (WhatsApp, e-mail). Os itens lidos entram na lista do formulário pra conferir antes de salvar, e o
// original vai junto pra cotação (a equipe vê o que o cliente mandou).

export interface ResultadoImportacao {
  itens: ItemLido[]
  cliente?: string
  maquina?: string
  /** O original (foto já reduzida, PDF) pra ir junto como anexo. */
  anexo?: ArquivoParaAnexar
  planilha?: { nomeArquivo: string; conteudoBase64: string }
  /** De onde veio, pra dizer ao vendedor ("print.png", "texto colado"). */
  origem: string
  /** Algo que o vendedor precisa saber (ex.: arquivo grande demais pra ir junto). */
  aviso?: string
}

const MAX_BYTES_ANEXO = 4 * 1024 * 1024
const MAX_BYTES_PLANILHA = 3 * 1024 * 1024
const LADO_MAXIMO_FOTO = 1800
const EH_PLANILHA = /\.(xlsx|xlsm|xls|ods|csv)$/i

async function blobParaBase64(blob: Blob): Promise<string> {
  const url = await new Promise<string>((resolve, reject) => {
    const leitor = new FileReader()
    leitor.onload = () => resolve(String(leitor.result))
    leitor.onerror = () => reject(new Error('Não consegui ler o arquivo.'))
    leitor.readAsDataURL(blob)
  })
  return url.slice(url.indexOf(',') + 1)
}

/** A foto reduzida (lado maior até 1800 px, JPEG) — um print de celular cai pra umas centenas de KB. */
async function fotoReduzida(arquivo: Blob): Promise<string> {
  const { imagemParaCanvas } = await import('../importacao/ocr')
  const origem = await imagemParaCanvas(arquivo)
  const escala = Math.min(1, LADO_MAXIMO_FOTO / Math.max(origem.width, origem.height))
  const destino = document.createElement('canvas')
  destino.width = Math.round(origem.width * escala)
  destino.height = Math.round(origem.height * escala)
  const ctx = destino.getContext('2d')
  if (!ctx) throw new Error('Não consegui preparar a imagem.')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, destino.width, destino.height)
  ctx.drawImage(origem, 0, 0, destino.width, destino.height)
  const blob = await new Promise<Blob | null>((resolve) => destino.toBlob(resolve, 'image/jpeg', 0.8))
  if (!blob) throw new Error('Não consegui preparar a imagem.')
  return blobParaBase64(blob)
}

async function lerImagem(arquivo: File): Promise<ResultadoImportacao> {
  const [{ ocrDeImagem }, { agruparEmLinhas }] = await Promise.all([import('../importacao/ocr'), import('../importacao/textoPosicionado')])
  const pagina = await ocrDeImagem(arquivo)
  const texto = agruparEmLinhas(pagina.trechos)
    .map((l) => l.texto)
    .join('\n')
  const nome = arquivo.name && arquivo.name !== 'image.png' ? arquivo.name : `print-${new Date().toLocaleString('pt-BR').replace(/[/:, ]+/g, '-')}.jpg`
  return {
    itens: itensDoTexto(texto),
    anexo: { nome: nome.replace(/\.[a-z0-9]+$/i, '') + '.jpg', tipo: 'image/jpeg', conteudoBase64: await fotoReduzida(arquivo) },
    origem: nome,
  }
}

async function lerPdfDoCliente(arquivo: File): Promise<ResultadoImportacao> {
  const { lerPdf } = await import('../importacao/leitorPdf')
  const lido = await lerPdf(arquivo, { ocr: true })
  const vaiJunto = arquivo.size <= MAX_BYTES_ANEXO
  return {
    itens: itensDoTexto(lido.texto),
    anexo: vaiJunto ? { nome: arquivo.name, tipo: 'application/pdf', conteudoBase64: await blobParaBase64(arquivo) } : undefined,
    origem: arquivo.name,
    aviso: vaiJunto ? undefined : 'O PDF é grande demais pra ir junto (até 4 MB) — só os itens foram lidos.',
  }
}

async function lerPlanilha(arquivo: File): Promise<ResultadoImportacao> {
  const vaiJunto = arquivo.size <= MAX_BYTES_PLANILHA
  const planilha = vaiJunto ? { nomeArquivo: arquivo.name, conteudoBase64: await blobParaBase64(arquivo) } : undefined
  const aviso = vaiJunto ? undefined : 'A planilha é grande demais pra ir junto (até 3 MB) — só os itens foram lidos.'
  try {
    // o mesmo leitor da equipe (acha a tabela, o cliente e a máquina), mas com todas as linhas
    const { lerPlanilhaCotacao } = await import('../quoteImport')
    const lida = await lerPlanilhaCotacao(arquivo, { soMarcadosCotar: false })
    if (lida.itens.length > 0) {
      return {
        itens: lida.itens.map((i) => ({ referencia: i.referencia, descricao: i.descricao, quantidade: i.quantidade || 1 })),
        cliente: lida.cliente,
        maquina: lida.equipamento,
        planilha,
        origem: arquivo.name,
        aviso,
      }
    }
  } catch {
    // planilha fora do modelo: lê as linhas como texto, abaixo
  }
  const XLSX = await import('xlsx')
  const livro = XLSX.read(await arquivo.arrayBuffer(), { type: 'array' })
  const texto = livro.SheetNames.map((nome) => XLSX.utils.sheet_to_csv(livro.Sheets[nome], { FS: ' ', blankrows: false })).join('\n')
  return { itens: itensDoTexto(texto), planilha, origem: arquivo.name, aviso }
}

/** Lê um arquivo qualquer (planilha, imagem, PDF) — ou explica o que não dá pra ler. */
async function lerArquivo(arquivo: File, formas: Record<FormaDeImportar, boolean>): Promise<ResultadoImportacao> {
  if (EH_PLANILHA.test(arquivo.name) && formas.planilha) return lerPlanilha(arquivo)
  if (arquivo.type.startsWith('image/') && formas.imagem) return lerImagem(arquivo)
  if ((arquivo.type === 'application/pdf' || /\.pdf$/i.test(arquivo.name)) && formas.pdf) return lerPdfDoCliente(arquivo)
  throw new Error(`Não sei ler "${arquivo.name || 'esse arquivo'}" aqui. Mande uma planilha, uma foto/print ou um PDF.`)
}

export function ImportarItens({ formas, onImportado }: { formas: Record<FormaDeImportar, boolean>; onImportado: (r: ResultadoImportacao) => void }) {
  const [lendo, setLendo] = useState<string | null>(null)
  const [colando, setColando] = useState(false)
  const [texto, setTexto] = useState('')
  const [arrastando, setArrastando] = useState(false)
  const entradaPlanilha = useRef<HTMLInputElement>(null)
  const entradaImagem = useRef<HTMLInputElement>(null)
  const entradaPdf = useRef<HTMLInputElement>(null)
  const ocupado = useRef(false)
  // a função de importar mais recente, pro "colar" (ouvinte do documento inteiro) não usar uma velha
  const importarRef = useRef<(arquivos: File[]) => Promise<void>>(async () => {})

  async function importar(arquivos: File[]) {
    if (ocupado.current || arquivos.length === 0) return
    ocupado.current = true
    try {
      for (const arquivo of arquivos) {
        setLendo(arquivo.name || 'imagem colada')
        try {
          const r = await lerArquivo(arquivo, formas)
          onImportado(r)
        } catch (err) {
          void avisar(err instanceof Error ? err.message : `Não consegui ler "${arquivo.name}".`)
        }
      }
    } finally {
      ocupado.current = false
      setLendo(null)
    }
  }
  importarRef.current = importar

  // print colado com Ctrl+V em qualquer lugar do formulário (texto colado num campo continua normal)
  useEffect(() => {
    if (!formas.imagem) return
    function aoColar(e: ClipboardEvent) {
      const imagens = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'))
      if (imagens.length === 0) return
      e.preventDefault()
      void importarRef.current(imagens)
    }
    document.addEventListener('paste', aoColar)
    return () => document.removeEventListener('paste', aoColar)
  }, [formas.imagem])

  function lerTexto() {
    const itens = itensDoTexto(texto)
    if (itens.length === 0) return void avisar('Não achei itens nesse texto. Deixe um item por linha (código, descrição e quantidade).')
    onImportado({ itens, origem: 'texto colado' })
    setTexto('')
    setColando(false)
  }

  if (!formas.planilha && !formas.imagem && !formas.pdf && !formas.texto) return null
  const escolher = (ref: React.RefObject<HTMLInputElement | null>) => ref.current?.click()
  const botao = 'rounded-lg border border-ink-200 bg-surface px-3 py-1.5 text-xs font-medium text-ink-700 transition hover:bg-ink-50 disabled:opacity-50'
  const aoEscolher = (e: React.ChangeEvent<HTMLInputElement>) => {
    const arquivos = Array.from(e.target.files ?? [])
    e.target.value = ''
    void importar(arquivos)
  }

  return (
    <section
      aria-label="Importar itens"
      onDragOver={(e) => {
        e.preventDefault()
        setArrastando(true)
      }}
      onDragLeave={() => setArrastando(false)}
      onDrop={(e) => {
        e.preventDefault()
        setArrastando(false)
        void importar(Array.from(e.dataTransfer.files))
      }}
      className={`rounded-xl border-2 border-dashed px-3 py-3 transition ${arrastando ? 'border-ink-500 bg-ink-100' : 'border-ink-200 bg-ink-50/60'}`}
    >
      <p className="text-sm font-medium text-ink-800">Importar os itens</p>
      <p className="mb-2 text-xs text-ink-500">
        Arraste o arquivo pra cá{formas.imagem ? ', cole um print (Ctrl+V)' : ''} ou escolha abaixo. Os itens lidos entram na lista pra você conferir, e o
        original vai junto pra cotação.
      </p>
      <div className="flex flex-wrap gap-2">
        {formas.planilha && (
          <button type="button" className={botao} disabled={!!lendo} onClick={() => escolher(entradaPlanilha)}>
            Planilha
          </button>
        )}
        {formas.imagem && (
          <button type="button" className={botao} disabled={!!lendo} onClick={() => escolher(entradaImagem)}>
            Foto ou print
          </button>
        )}
        {formas.pdf && (
          <button type="button" className={botao} disabled={!!lendo} onClick={() => escolher(entradaPdf)}>
            PDF
          </button>
        )}
        {formas.texto && (
          <button type="button" className={botao} disabled={!!lendo} aria-expanded={colando} onClick={() => setColando((c) => !c)}>
            Colar texto
          </button>
        )}
      </div>
      <input ref={entradaPlanilha} type="file" hidden accept=".xlsx,.xlsm,.xls,.ods,.csv" aria-label="Escolher planilha" onChange={aoEscolher} />
      <input ref={entradaImagem} type="file" hidden accept="image/*" multiple aria-label="Escolher foto ou print" onChange={aoEscolher} />
      <input ref={entradaPdf} type="file" hidden accept="application/pdf,.pdf" aria-label="Escolher PDF" onChange={aoEscolher} />
      {lendo && (
        <p role="status" className="mt-2 text-xs text-ink-600">
          Lendo “{lendo}”… foto e PDF escaneado levam alguns segundos.
        </p>
      )}
      {colando && (
        <div className="mt-2 space-y-2">
          <textarea
            className="field-input min-h-[6rem] font-mono text-xs"
            aria-label="Texto com os itens"
            placeholder={'Um item por linha, ex.:\n2x filtro de óleo RE504836\nRolamento 6205-2RS qtd 3'}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
          <button type="button" className={botao} onClick={lerTexto}>
            Ler itens do texto
          </button>
        </div>
      )}
    </section>
  )
}
