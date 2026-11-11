import { avisar } from '../dialogs'
import { baixarBlob, linkEmail, linkWhatsApp } from '../planilhaCliente'
import { arquivoDoTexto } from '../textoDaCotacao'

// A cotação em texto (textoDaCotacao.ts): a prévia e o que dá pra fazer com ela — compartilhar, copiar,
// baixar o .txt, WhatsApp e e-mail. Na janela "Enviar cotação" da Precificação e na tela do vendedor.

// acima disso o link do WhatsApp pode não abrir com o texto inteiro — aí é copiar e colar
const MAX_TEXTO_NO_LINK = 3500

export function PreviaDoTexto({ texto }: { texto: string }) {
  return (
    <>
      <p className="my-2 text-xs text-ink-400">Os itens com marca, prazo e valores, pra mandar ao cliente sem anexar planilha.</p>
      <pre
        aria-label="Prévia do texto"
        className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-lg border border-ink-100 bg-ink-50 p-3 font-mono text-xs text-ink-800"
      >
        {texto}
      </pre>
    </>
  )
}

/** Os botões do texto. `onEnviado`: chamado quando o texto sai pro cliente (compartilhar, WhatsApp,
 * e-mail) — na Precificação, é o que marca a cotação como enviada; copiar e baixar não contam. */
export function BotoesDoTexto({
  texto,
  titulo,
  nomeArquivo,
  mensagemCurta,
  onEnviado,
}: {
  texto: string
  titulo: string
  nomeArquivo: string
  /** O que vai no link do WhatsApp quando o texto é grande demais pra ele. */
  mensagemCurta: string
  onEnviado?: () => void
}) {
  const podeCompartilhar = typeof navigator.share === 'function'
  const grandeDemais = texto.length > MAX_TEXTO_NO_LINK

  async function compartilhar() {
    try {
      await navigator.share({ title: titulo, text: texto })
      onEnviado?.()
    } catch (err) {
      // fechar a folha de compartilhamento não é erro (e não conta como enviada)
      if (err instanceof Error && err.name === 'AbortError') return
      void avisar('Não consegui compartilhar direto — use "Copiar texto" e cole na conversa.')
    }
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto)
      void avisar('Texto copiado — é só colar na conversa com o cliente.')
    } catch {
      void avisar('O navegador não deixou copiar. Selecione o texto da prévia e copie com Ctrl+C.')
    }
  }

  const botao = 'rounded-lg border border-ink-200 px-3 py-2 text-sm font-medium text-ink-700 transition hover:bg-ink-50 disabled:opacity-50'
  const principal = 'rounded-lg bg-ink-900 px-3 py-2 text-sm font-semibold text-surface transition hover:opacity-90 disabled:opacity-50'
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {podeCompartilhar && (
          <button type="button" onClick={() => void compartilhar()} className={principal}>
            Compartilhar texto
          </button>
        )}
        <button type="button" onClick={() => void copiar()} className={podeCompartilhar ? botao : principal}>
          Copiar texto
        </button>
        <button type="button" onClick={() => baixarBlob(arquivoDoTexto(texto), nomeArquivo)} className={botao}>
          Baixar texto (.txt)
        </button>
        <a href={linkWhatsApp(grandeDemais ? mensagemCurta : texto)} target="_blank" rel="noreferrer" onClick={onEnviado} className={botao}>
          WhatsApp{grandeDemais ? ' (mensagem)' : ' (com o texto)'}
        </a>
        <a href={linkEmail(titulo, texto)} onClick={onEnviado} className={botao}>
          E-mail
        </a>
      </div>
      {grandeDemais && <p className="mt-2 text-[11px] text-ink-400">Texto grande demais pro link do WhatsApp: use “Copiar texto” e cole na conversa.</p>}
    </>
  )
}
