import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

// Peças do Dashboard que se mexem: números que contam até o valor, pirulitos que crescem da base, linha
// que muda de forma quando troca o vendedor, anel que enche. Tudo num mecanismo só (useTransicao: leva
// uma lista de números do que está na tela até o valor novo), sem animar atributo de SVG por CSS. Quem
// pediu menos movimento no sistema (e os testes) vê direto o valor final.

function menosMovimento(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

const suave = (k: number) => 1 - Math.pow(1 - k, 3)

/** Leva os números da tela até `alvo`. Na primeira vez sai do zero (o gráfico "cresce"), a não ser com
 * `doZero: false`. `atraso`: ms entre um item e o próximo — os pirulitos sobem em cascata. */
export function useTransicao(alvo: number[], { duracao = 800, atraso = 0, doZero = true } = {}): number[] {
  const [atual, setAtual] = useState<number[]>(() => (doZero && !menosMovimento() ? alvo.map(() => 0) : alvo))
  const mostrado = useRef(atual)
  const chave = alvo.join('|')
  useEffect(() => {
    if (menosMovimento()) {
      mostrado.current = alvo
      setAtual(alvo)
      return
    }
    const de = mostrado.current
    const inicio = performance.now()
    const total = duracao + atraso * Math.max(0, alvo.length - 1)
    let quadro = 0
    const passo = (agora: number) => {
      const t = agora - inicio
      const v = alvo.map((a, i) => {
        const k = Math.min(1, Math.max(0, (t - i * atraso) / duracao))
        const d = de[i] ?? 0
        return d + (a - d) * suave(k)
      })
      mostrado.current = v
      setAtual(v)
      if (t < total) quadro = requestAnimationFrame(passo)
    }
    quadro = requestAnimationFrame(passo)
    return () => cancelAnimationFrame(quadro)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave])
  return atual
}

/** Número que conta até o valor (e de um valor pro outro quando o filtro muda). */
export function NumeroAnimado({ valor, formatar }: { valor: number; formatar: (v: number) => string }) {
  const [v] = useTransicao([valor], { duracao: 900 })
  return <>{formatar(v ?? valor)}</>
}

/** Largura do elemento, acompanhando a tela — os gráficos desenham em pixels de verdade (letra nítida). */
export function useLargura<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [largura, setLargura] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setLargura(el.clientWidth)
    const observador = new ResizeObserver(([e]) => setLargura(e.contentRect.width))
    observador.observe(el)
    return () => observador.disconnect()
  }, [])
  return [ref, largura] as const
}

/** Topo do eixo Y "redondo" (1/2/5 × potência de 10), em `divisoes` passos. */
export function escalaRedonda(max: number, divisoes = 4): { passo: number; topo: number } {
  const bruto = Math.max(max, 1e-9) / divisoes
  const potencia = Math.pow(10, Math.floor(Math.log10(bruto)))
  const n = bruto / potencia
  const passo = (n > 5 ? 10 : n > 2 ? 5 : n > 1 ? 2 : 1) * potencia
  return { passo, topo: passo * divisoes }
}

/** Espaço à esquerda pros rótulos do eixo Y (a etiqueta da média também cabe). */
function margemDoEixo(passo: number, formatar: (v: number) => string): number {
  const maior = Math.max(...[0, 1, 2, 3, 4].map((i) => formatar(i * passo).length))
  return Math.max(52, Math.ceil(maior * 6.6) + 14)
}

/** Curva suave pelos pontos, sem passar do vizinho (não inventa pico nem vale que não existe). */
function caminhoSuave(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return ''
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    const menor = Math.min(p1.y, p2.y)
    const maior = Math.max(p1.y, p2.y)
    const c1y = Math.min(maior, Math.max(menor, p1.y + (p2.y - p0.y) / 6))
    const c2y = Math.min(maior, Math.max(menor, p2.y - (p3.y - p1.y) / 6))
    d += ` C ${p1.x + (p2.x - p0.x) / 6} ${c1y}, ${p2.x - (p3.x - p1.x) / 6} ${c2y}, ${p2.x} ${p2.y}`
  }
  return d
}

/** Linhazinha de tendência dos cartões de cima. */
export function Sparkline({ valores, cor = 'rgb(var(--ink-500))', largura = 88, altura = 28 }: { valores: number[]; cor?: string; largura?: number; altura?: number }) {
  const anim = useTransicao(valores, { duracao: 1000 })
  if (valores.length < 2) return null
  const max = Math.max(1e-9, ...valores)
  const pts = valores.map((_, i) => ({ x: 2 + (i / (valores.length - 1)) * (largura - 4), y: altura - 3 - ((anim[i] ?? 0) / max) * (altura - 6) }))
  const ultimo = pts[pts.length - 1]
  return (
    <svg width={largura} height={altura} aria-hidden="true" className="shrink-0 overflow-visible">
      <path d={caminhoSuave(pts)} fill="none" stroke={cor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={ultimo.x} cy={ultimo.y} r={2.5} fill={cor} />
    </svg>
  )
}

/** Caixinha que aparece em cima do ponto apontado. `x`/`y` em pixels dentro do gráfico. */
function Dica({ x, y, largura, children }: { x: number; y: number; largura: number; children: ReactNode }) {
  // perto das bordas, a caixa encosta pra dentro em vez de sair do cartão
  const lado = x < 90 ? '0%' : x > largura - 90 ? '-100%' : '-50%'
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 whitespace-nowrap rounded-lg border border-ink-100 bg-surface px-3 py-2 text-xs text-ink-700 shadow-lg"
      style={{ left: x, top: y, transform: `translate(${lado}, calc(-100% - 12px))` }}
    >
      {children}
    </div>
  )
}

export interface PontoDoGrafico {
  rotulo: string
  rotuloLongo: string
  valor: number
  /** Linha extra na caixinha (ex.: o valor em reais quando o gráfico mostra a quantidade). */
  detalhe?: string
  hoje?: boolean
}

const COR_ACIMA = '#eb6834'
const COR_ACIMA_ESCURA = '#c2410c' // fundo da etiqueta da média: branco lê bem em cima

/** Pirulitos (um por dia/semana/mês) contra uma linha de referência tracejada — colorido é o que passou
 * dela, cinza o que ficou abaixo. Sobem em cascata e mudam de altura quando o filtro muda. */
export function GraficoPirulitos({
  pontos,
  referencia,
  rotuloReferencia,
  formatar,
  formatarEixo = formatar,
  altura = 280,
}: {
  pontos: PontoDoGrafico[]
  referencia: number
  rotuloReferencia: string
  formatar: (v: number) => string
  formatarEixo?: (v: number) => string
  altura?: number
}) {
  const [ref, largura] = useLargura<HTMLDivElement>()
  const [apontado, setApontado] = useState<number | null>(null)
  const { passo, topo } = escalaRedonda(Math.max(referencia, ...pontos.map((p) => p.valor)))
  const [topoAnim, refAnim] = useTransicao([topo, referencia], { doZero: false })
  const alturas = useTransicao(
    pontos.map((p) => p.valor),
    { duracao: 650, atraso: Math.min(40, 600 / Math.max(1, pontos.length)) },
  )

  const esq = margemDoEixo(passo, formatarEixo)
  const dir = 12
  const cima = 18
  const baixo = 30
  const plotW = Math.max(0, largura - esq - dir)
  const plotH = altura - cima - baixo
  const faixa = pontos.length > 0 ? plotW / pontos.length : 0
  const xDe = (i: number) => esq + faixa * (i + 0.5)
  const yDe = (v: number) => cima + plotH - (Math.max(0, v) / Math.max(topoAnim, 1e-9)) * plotH
  // com muitos dias, só alguns rótulos embaixo (sempre o último)
  const cadaQuantos = Math.max(1, Math.ceil(pontos.length / Math.max(1, Math.floor(plotW / 44))))
  const yRef = yDe(refAnim)

  return (
    <div ref={ref} className="relative" onMouseLeave={() => setApontado(null)}>
      {largura > 0 && (
        <svg width={largura} height={altura} role="img" aria-label={`Gráfico: ${pontos.map((p) => `${p.rotuloLongo} ${formatar(p.valor)}`).join('; ')}`}>
          <defs>
            <linearGradient id="pirulito-acima" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COR_ACIMA} />
              <stop offset="100%" stopColor={COR_ACIMA} stopOpacity={0.08} />
            </linearGradient>
            <linearGradient id="pirulito-abaixo" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(var(--ink-400))" />
              <stop offset="100%" stopColor="rgb(var(--ink-400))" stopOpacity={0.08} />
            </linearGradient>
          </defs>
          {[0, 1, 2, 3, 4].map((i) => {
            const y = yDe(i * passo * (topoAnim / topo))
            return (
              <g key={i}>
                <line x1={esq} x2={largura - dir} y1={y} y2={y} stroke="rgb(var(--ink-100))" strokeWidth={1} />
                <text x={esq - 8} y={y} textAnchor="end" dominantBaseline="middle" fontSize="11" style={{ fill: 'rgb(var(--ink-400))' }}>
                  {formatarEixo(i * passo)}
                </text>
              </g>
            )
          })}

          {pontos.map((p, i) => {
            const v = alturas[i] ?? 0
            const acima = p.valor > 0 && p.valor >= referencia
            const cor = acima ? COR_ACIMA : 'rgb(var(--ink-400))'
            const x = xDe(i)
            const y = yDe(v)
            const apagado = apontado !== null && apontado !== i
            return (
              <g key={i} style={{ opacity: apagado ? 0.35 : 1, transition: 'opacity 150ms' }}>
                <rect x={x - 1.5} y={y} width={3} height={Math.max(0, cima + plotH - y)} rx={1.5} fill={`url(#pirulito-${acima ? 'acima' : 'abaixo'})`} />
                {acima && <circle cx={x} cy={y} r={11} fill={COR_ACIMA} opacity={0.18} />}
                <circle
                  cx={x}
                  cy={y}
                  r={p.hoje ? 6 : 5.5}
                  fill={p.hoje ? 'rgb(var(--surface))' : cor}
                  stroke={p.hoje ? 'rgb(var(--ink-900))' : 'rgb(var(--surface))'}
                  strokeWidth={2}
                />
              </g>
            )
          })}

          {referencia > 0 && (
            <g>
              <line x1={esq} x2={largura - dir} y1={yRef} y2={yRef} stroke={COR_ACIMA} strokeWidth={1.5} strokeDasharray="4 4" />
              <rect x={esq - 46} y={yRef - 10} width={44} height={20} rx={6} fill={COR_ACIMA_ESCURA} />
              <text x={esq - 24} y={yRef} textAnchor="middle" dominantBaseline="central" fontSize="10.5" fontWeight="700" fill="#fff">
                {rotuloReferencia}
              </text>
            </g>
          )}

          {pontos.map((p, i) =>
            i % cadaQuantos === (pontos.length - 1) % cadaQuantos ? (
              <text
                key={i}
                x={xDe(i)}
                y={altura - 10}
                textAnchor="middle"
                fontSize="11"
                fontWeight={p.hoje ? 700 : 400}
                style={{ fill: p.hoje ? COR_ACIMA_ESCURA : 'rgb(var(--ink-500))' }}
              >
                {p.rotulo}
              </text>
            ) : null,
          )}

          {/* alvo do mouse: a coluna inteira de cada ponto, bem maior que a bolinha */}
          {pontos.map((_, i) => (
            <rect key={i} x={esq + faixa * i} y={cima} width={faixa} height={plotH} fill="transparent" onMouseEnter={() => setApontado(i)} />
          ))}
        </svg>
      )}
      {apontado !== null && pontos[apontado] && (
        <Dica x={xDe(apontado)} y={yDe(pontos[apontado].valor)} largura={largura}>
          <p className="font-semibold text-ink-900">{pontos[apontado].rotuloLongo}</p>
          <p className="tabular-nums">{formatar(pontos[apontado].valor)}</p>
          {pontos[apontado].detalhe && <p className="tabular-nums text-ink-500">{pontos[apontado].detalhe}</p>}
        </Dica>
      )}
    </div>
  )
}

/** Linha com área embaixo; trocando a série (outro vendedor), a linha muda de forma até a nova. */
export function GraficoLinha({
  pontos,
  cor,
  formatar,
  formatarEixo = formatar,
  altura = 240,
}: {
  pontos: PontoDoGrafico[]
  cor: string
  formatar: (v: number) => string
  formatarEixo?: (v: number) => string
  altura?: number
}) {
  const [ref, largura] = useLargura<HTMLDivElement>()
  const [apontado, setApontado] = useState<number | null>(null)
  const { passo, topo } = escalaRedonda(Math.max(...pontos.map((p) => p.valor), 0))
  const [topoAnim] = useTransicao([topo], { doZero: false })
  const valores = useTransicao(
    pontos.map((p) => p.valor),
    { duracao: 700 },
  )

  const esq = margemDoEixo(passo, formatarEixo)
  const dir = 16
  const cima = 14
  const baixo = 30
  const plotW = Math.max(0, largura - esq - dir)
  const plotH = altura - cima - baixo
  const xDe = (i: number) => (pontos.length > 1 ? esq + (i / (pontos.length - 1)) * plotW : esq + plotW / 2)
  const yDe = (v: number) => cima + plotH - (Math.max(0, v) / Math.max(topoAnim, 1e-9)) * plotH
  const pts = pontos.map((_, i) => ({ x: xDe(i), y: yDe(valores[i] ?? 0) }))
  const linha = caminhoSuave(pts)
  const area = pts.length > 1 ? `${linha} L ${pts[pts.length - 1].x} ${cima + plotH} L ${pts[0].x} ${cima + plotH} Z` : ''
  const cadaQuantos = Math.max(1, Math.ceil(pontos.length / Math.max(1, Math.floor(plotW / 48))))

  function aoMover(e: React.MouseEvent<SVGRectElement>) {
    const caixa = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - caixa.left
    const i = pontos.length > 1 ? Math.round((x / caixa.width) * (pontos.length - 1)) : 0
    setApontado(Math.min(pontos.length - 1, Math.max(0, i)))
  }

  return (
    <div ref={ref} className="relative" onMouseLeave={() => setApontado(null)}>
      {largura > 0 && (
        <svg width={largura} height={altura} role="img" aria-label={`Gráfico: ${pontos.map((p) => `${p.rotuloLongo} ${formatar(p.valor)}`).join('; ')}`}>
          <defs>
            <linearGradient id="linha-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={cor} stopOpacity={0.22} />
              <stop offset="100%" stopColor={cor} stopOpacity={0} />
            </linearGradient>
          </defs>
          {[0, 1, 2, 3, 4].map((i) => {
            const y = yDe(i * passo * (topoAnim / topo))
            return (
              <g key={i}>
                <line x1={esq} x2={largura - dir} y1={y} y2={y} stroke="rgb(var(--ink-100))" strokeWidth={1} strokeDasharray={i === 0 ? undefined : '3 5'} />
                <text x={esq - 8} y={y} textAnchor="end" dominantBaseline="middle" fontSize="11" style={{ fill: 'rgb(var(--ink-400))' }}>
                  {formatarEixo(i * passo)}
                </text>
              </g>
            )
          })}
          {pontos.map((p, i) =>
            i % cadaQuantos === (pontos.length - 1) % cadaQuantos ? (
              <text key={i} x={xDe(i)} y={altura - 10} textAnchor="middle" fontSize="11" style={{ fill: 'rgb(var(--ink-500))' }}>
                {p.rotulo}
              </text>
            ) : null,
          )}
          {area && <path d={area} fill="url(#linha-area)" style={{ transition: 'fill 300ms' }} />}
          <path d={linha} fill="none" stroke={cor} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" style={{ transition: 'stroke 300ms' }} />
          {apontado !== null && pts[apontado] && (
            <g>
              <line x1={pts[apontado].x} x2={pts[apontado].x} y1={cima} y2={cima + plotH} stroke="rgb(var(--ink-300))" strokeWidth={1} />
              <circle cx={pts[apontado].x} cy={pts[apontado].y} r={6} fill={cor} stroke="rgb(var(--surface))" strokeWidth={2} />
            </g>
          )}
          <rect x={esq} y={cima} width={plotW} height={plotH} fill="transparent" onMouseMove={aoMover} />
        </svg>
      )}
      {apontado !== null && pontos[apontado] && pts[apontado] && (
        <Dica x={pts[apontado].x} y={pts[apontado].y} largura={largura}>
          <p className="font-semibold text-ink-900">{pontos[apontado].rotuloLongo}</p>
          <p className="tabular-nums">{formatar(pontos[apontado].valor)}</p>
          {pontos[apontado].detalhe && <p className="tabular-nums text-ink-500">{pontos[apontado].detalhe}</p>}
        </Dica>
      )}
    </div>
  )
}

/** Anel de risquinhos que vai enchendo até a fração (0 a 1), com o que vier no meio. */
export function AnelDeProgresso({ fracao, cor = COR_ACIMA, tamanho = 176, children }: { fracao: number; cor?: string; tamanho?: number; children?: ReactNode }) {
  const [f] = useTransicao([Math.min(1, Math.max(0, fracao))], { duracao: 1100 })
  const riscos = 44
  const abertura = 70 // graus vazios embaixo
  const c = tamanho / 2
  const rFora = c - 4
  const rDentro = c - 20
  return (
    <div className="relative shrink-0" style={{ width: tamanho, height: tamanho }}>
      <svg width={tamanho} height={tamanho} aria-hidden="true">
        {Array.from({ length: riscos }, (_, i) => {
          // ângulo no sentido do relógio a partir do meio-dia: começa embaixo à esquerda, passa pelo topo
          const angulo = ((180 + abertura / 2 + (i / (riscos - 1)) * (360 - abertura)) * Math.PI) / 180
          const aceso = (i + 0.5) / riscos <= (f ?? 0)
          return (
            <line
              key={i}
              x1={c + Math.sin(angulo) * rDentro}
              y1={c - Math.cos(angulo) * rDentro}
              x2={c + Math.sin(angulo) * rFora}
              y2={c - Math.cos(angulo) * rFora}
              stroke={aceso ? cor : 'rgb(var(--ink-200))'}
              strokeWidth={3.5}
              strokeLinecap="round"
            />
          )
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  )
}

/** Barra de proporção: um pedaço por parte, do tamanho da fatia, com folga entre eles. */
export function BarraDeProporcao({ partes }: { partes: { chave: string; valor: number; cor: string; titulo: string }[] }) {
  const total = partes.reduce((s, p) => s + p.valor, 0)
  const larguras = useTransicao(
    partes.map((p) => (total > 0 ? p.valor / total : 0)),
    { duracao: 900, atraso: 60 },
  )
  return (
    <div className="flex h-2.5 w-full gap-[3px]" aria-hidden="true">
      {partes.map((p, i) => (
        <div key={p.chave} title={p.titulo} className="h-full rounded-full" style={{ width: `${(larguras[i] ?? 0) * 100}%`, backgroundColor: p.cor, minWidth: (larguras[i] ?? 0) > 0 ? 4 : 0 }} />
      ))}
    </div>
  )
}

/** Barra horizontal que cresce até a fração; `fantasma`: a do período anterior, cinza, por baixo. */
export function BarraHorizontal({ fracao, cor, fantasma }: { fracao: number; cor: string; fantasma?: number }) {
  const [f, g] = useTransicao([fracao, fantasma ?? 0], { duracao: 900 })
  return (
    <div className="relative h-2 w-full rounded-full bg-ink-100" aria-hidden="true">
      {fantasma !== undefined && <div className="absolute inset-y-0 left-0 rounded-full bg-ink-300/60" style={{ width: `${(g ?? 0) * 100}%` }} />}
      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(f ?? 0) * 100}%`, backgroundColor: cor }} />
    </div>
  )
}

/** Botões lado a lado com o "selecionado" deslizando de um pro outro. */
export function Segmentado<T extends string>({
  opcoes,
  valor,
  onChange,
  rotulo,
}: {
  opcoes: { valor: T; rotulo: string }[]
  valor: T | ''
  onChange: (v: T) => void
  rotulo: string
}) {
  const caixa = useRef<HTMLDivElement>(null)
  const [marca, setMarca] = useState<{ left: number; width: number } | null>(null)
  useLayoutEffect(() => {
    const el = caixa.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
    setMarca(el ? { left: el.offsetLeft, width: el.offsetWidth } : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor, opcoes.map((o) => o.rotulo).join('|')])
  return (
    <div ref={caixa} role="group" aria-label={rotulo} className="relative inline-flex max-w-full overflow-x-auto sem-barra-rolagem rounded-full bg-ink-100 p-1">
      {marca && (
        <div className="absolute top-1 bottom-1 rounded-full bg-surface dark:bg-ink-200 shadow-sm transition-all duration-300 ease-out motion-reduce:transition-none" style={marca} />
      )}
      {opcoes.map((o) => (
        <button
          key={o.valor}
          type="button"
          aria-pressed={valor === o.valor}
          onClick={() => onChange(o.valor)}
          className={`relative shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${valor === o.valor ? 'text-ink-900' : 'text-ink-500 hover:text-ink-800'}`}
        >
          {o.rotulo}
        </button>
      ))}
    </div>
  )
}
