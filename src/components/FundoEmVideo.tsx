import { useEffect, useMemo, useRef, useState } from 'react'
import { SamuraiNoFundo } from './SamuraiNoFundo'

// Vídeo de fundo de todas as abas, cobrindo a tela toda atrás do conteúdo, sem som. O
// original é 640×360 a 30 quadros, e bem comprimido; as versões em public/fundo foram feitas fora do
// site, por IA: cada quadro ampliado 4× pelo Real-ESRGAN (modelo x4plus-anime — entre os testados, o
// que deixou os contornos mais limpos e o céu liso, sem tremer de um quadro pro outro), os quadros do
// meio criados pelo RIFE (60 por segundo) e o último segundo fundido no começo, pro laço não dar tranco.
// O samurai foi tirado do vídeo (o fundo atrás dele, reconstruído pela IA LaMa): ele é desenhado por cima,
// num canvas (SamuraiNoFundo), respirando, com o manto no vento; a cada 5 minutos joga um dado e, com 3 ou
// 6, anda até a lua.
// Cada aparelho recebe a versão do tamanho da tela dele (até 4K), se der conta de tocar sem engasgar.

const BASE = `${import.meta.env.BASE_URL}fundo/`
const CAPA = `${BASE}samurai-hq-capa.jpg`

interface Versao {
  arquivo: string
  largura: number
  altura: number
  /** H.264 High, no nível de cada tamanho a 60 quadros (pro navegador dizer se toca liso). */
  codec: string
  /** Bits por segundo, mais ou menos (idem). */
  bitrate: number
}

const VERSOES: Versao[] = [
  { arquivo: 'samurai-hq-720p60.mp4', largura: 1280, altura: 720, codec: 'avc1.640020', bitrate: 600_000 },
  { arquivo: 'samurai-hq-1080p60.mp4', largura: 1920, altura: 1080, codec: 'avc1.64002a', bitrate: 1_100_000 },
  { arquivo: 'samurai-hq-1440p60.mp4', largura: 2560, altura: 1440, codec: 'avc1.640033', bitrate: 1_700_000 },
  { arquivo: 'samurai-hq-2160p60.mp4', largura: 3840, altura: 2160, codec: 'avc1.640034', bitrate: 3_100_000 },
]
/** Celular: no máximo a de 1440 (a de 4K não mostra mais detalhe na tela pequena e pesa no plano de dados). */
const MAXIMA_NO_CELULAR = 2

/** Quantos pixels de verdade de largura o vídeo precisa pra cobrir a tela (object-cover: manda o lado que
 * pede mais). Conta a tela inteira, não só a janela — a janela pode ser maximizada depois. */
function larguraNecessaria(): number {
  const w = Math.max(window.innerWidth, window.screen?.width ?? 0)
  const h = Math.max(window.innerHeight, window.screen?.height ?? 0)
  return Math.max(w, (h * 16) / 9) * (window.devicePixelRatio || 1)
}

/** A menor versão que cobre a tela sem esticar (a maior, se nenhuma cobrir). */
function versaoParaATela(): number {
  const precisa = larguraNecessaria()
  let i = VERSOES.findIndex((v) => v.largura >= precisa * 0.98)
  if (i < 0) i = VERSOES.length - 1
  const conexao = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  // "economia de dados" ligada no aparelho: a mais leve
  if (conexao?.saveData) return 0
  if (window.matchMedia?.('(pointer: coarse)').matches) i = Math.min(i, MAXIMA_NO_CELULAR)
  return i
}

/** O aparelho toca essa versão liso? Acima de 1080, só se for pelo chip de vídeo (sem esquentar o processador). */
async function tocaLiso(v: Versao): Promise<boolean> {
  if (!navigator.mediaCapabilities?.decodingInfo) return true
  try {
    const r = await navigator.mediaCapabilities.decodingInfo({
      type: 'file',
      video: { contentType: `video/mp4; codecs="${v.codec}"`, width: v.largura, height: v.altura, bitrate: v.bitrate, framerate: 60 },
    })
    return r.supported && r.smooth && (r.powerEfficient || v.altura <= 1080)
  } catch {
    return true
  }
}

export function FundoEmVideo({
  pausado,
  forte = false,
}: {
  pausado: boolean
  /** Película mais forte (abas de trabalho, com mais texto e tabela): o fundo fica mais discreto. */
  forte?: boolean
}) {
  const ref = useRef<HTMLVideoElement>(null)
  // quem pediu menos movimento no sistema fica só com a imagem parada
  const menosMovimento = useMemo(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, [])
  const [versao, setVersao] = useState(versaoParaATela)

  // se o aparelho não dá conta da versão do tamanho da tela, desce uma (raro: aparelho antigo)
  useEffect(() => {
    let cancelado = false
    void (async () => {
      let i = versao
      while (i > 0 && !(await tocaLiso(VERSOES[i]))) i--
      if (!cancelado && i !== versao) setVersao(i)
    })()
    return () => {
      cancelado = true
    }
    // só na primeira vez: trocar de versão depois recomeçaria o vídeo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const video = ref.current
    if (!video) return
    video.muted = true
    if (pausado || menosMovimento) video.pause()
    else void video.play().catch(() => {
      // navegador que bloqueia o play automático: fica a imagem de capa
    })
  }, [pausado, menosMovimento, versao])

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {menosMovimento ? (
        <img src={CAPA} alt="" className="h-full w-full object-cover" />
      ) : (
        <video
          ref={ref}
          className="h-full w-full object-cover"
          src={`${BASE}${VERSOES[versao].arquivo}`}
          poster={CAPA}
          muted
          loop
          playsInline
          autoPlay={!pausado}
          preload="auto"
          disablePictureInPicture
        />
      )}
      <SamuraiNoFundo animar={!pausado && !menosMovimento} noLugar={menosMovimento} />
      {/* película da cor do tema: o vídeo fica de fundo, sem brigar com o texto (clara no claro, escura no escuro) */}
      <div className={`absolute inset-0 transition-colors duration-500 ${forte ? 'bg-ink-50/75' : 'bg-ink-50/60'}`} />
    </div>
  )
}
