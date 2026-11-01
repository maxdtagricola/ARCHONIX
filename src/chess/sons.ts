// -----------------------------------------------------------------------
// Sons do xadrez — todos sintetizados na hora com a Web Audio API, sem nenhum
// arquivo de áudio: nada a mais pra baixar e nenhuma gravação de terceiros.
// Cada peça tem o seu passo, a sua "voz" ao ser selecionada e o seu golpe.
//
// O navegador só libera som depois de um clique ou tecla, então o contexto de
// áudio nasce em destravarSom. Até lá, tocarSom simplesmente não faz nada.
// -----------------------------------------------------------------------

type Contexto = BaseAudioContext

/** Onde um som toca: `t` é o instante de começar e `v`, uma variação sorteada de altura — o mesmo
 * som repetido não fica idêntico, como numa gravação em loop. */
export interface Saida {
  ctx: Contexto
  destino: AudioNode
  t: number
  v: number
}

const ruidosPorContexto = new WeakMap<Contexto, AudioBuffer>()

function ruidoBranco(ctx: Contexto): AudioBuffer {
  let buffer = ruidosPorContexto.get(ctx)
  if (!buffer) {
    buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const dados = buffer.getChannelData(0)
    for (let i = 0; i < dados.length; i++) dados[i] = Math.random() * 2 - 1
    ruidosPorContexto.set(ctx, buffer)
  }
  return buffer
}

/** Volume que sobe rápido até `pico` e cai até sumir. A rampa exponencial não aceita zero. */
function envelope(ctx: Contexto, t: number, ataque: number, dur: number, pico: number): GainNode {
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, pico), t + Math.max(0.001, ataque))
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.001, ataque) + dur)
  return g
}

interface OpcoesTom {
  tipo?: OscillatorType
  freq: number
  /** Frequência de chegada, se o tom desliza. */
  ate?: number
  inicio?: number
  ataque?: number
  dur: number
  vol: number
  /** Corta os agudos: deixa uma onda dura com som de metal abafado, de voz ou de sopro. */
  corte?: number
}

function tom(s: Saida, o: OpcoesTom) {
  const t = s.t + (o.inicio ?? 0)
  const ataque = o.ataque ?? 0.004
  const osc = s.ctx.createOscillator()
  osc.type = o.tipo ?? 'sine'
  osc.frequency.setValueAtTime(o.freq * s.v, t)
  if (o.ate) osc.frequency.exponentialRampToValueAtTime(o.ate * s.v, t + ataque + o.dur)
  const g = envelope(s.ctx, t, ataque, o.dur, o.vol)
  if (o.corte) {
    const filtro = s.ctx.createBiquadFilter()
    filtro.type = 'lowpass'
    filtro.frequency.value = o.corte
    osc.connect(filtro).connect(g)
  } else {
    osc.connect(g)
  }
  g.connect(s.destino)
  osc.start(t)
  osc.stop(t + ataque + o.dur + 0.02)
}

interface OpcoesSopro {
  inicio?: number
  ataque?: number
  dur: number
  vol: number
  filtro?: BiquadFilterType
  freq: number
  ate?: number
  q?: number
}

/** Ruído filtrado: ar, pano, poeira, estalo — depende do filtro e da duração. */
function sopro(s: Saida, o: OpcoesSopro) {
  const t = s.t + (o.inicio ?? 0)
  const ataque = o.ataque ?? 0.003
  const fonte = s.ctx.createBufferSource()
  fonte.buffer = ruidoBranco(s.ctx)
  fonte.loop = true
  const filtro = s.ctx.createBiquadFilter()
  filtro.type = o.filtro ?? 'bandpass'
  filtro.Q.value = o.q ?? 1
  filtro.frequency.setValueAtTime(o.freq * s.v, t)
  if (o.ate) filtro.frequency.exponentialRampToValueAtTime(o.ate * s.v, t + ataque + o.dur)
  const g = envelope(s.ctx, t, ataque, o.dur, o.vol)
  fonte.connect(filtro).connect(g).connect(s.destino)
  fonte.start(t, Math.random() * 1.5)
  fonte.stop(t + ataque + o.dur + 0.02)
}

/** Batida grave que afunda rápido: pé no chão, tambor, pancada. */
function pancada(s: Saida, freq: number, ate: number, dur: number, vol: number, inicio = 0) {
  tom(s, { freq, ate, dur, vol, inicio, ataque: 0.002 })
  sopro(s, { inicio, dur: 0.02, vol: vol * 0.35, filtro: 'lowpass', freq: 1800 })
}

/** Parciais fora de proporção: é o que faz soar metal de sino, não uma nota comum. */
function sino(s: Saida, freq: number, dur: number, vol: number, inicio = 0) {
  const parciais: [number, number, number][] = [
    [1, 1, 1],
    [2.76, 0.5, 0.7],
    [5.4, 0.25, 0.45],
    [8.93, 0.12, 0.3],
  ]
  for (const [multiplo, ganho, duracao] of parciais) tom(s, { freq: freq * multiplo, dur: dur * duracao, vol: vol * ganho, inicio, ataque: 0.002 })
}

/** Corda dedilhada (koto): ataque seco e brilho que some antes do grave. */
function corda(s: Saida, freq: number, dur: number, vol: number, inicio = 0) {
  tom(s, { tipo: 'triangle', freq, dur, vol, inicio, ataque: 0.003 })
  tom(s, { tipo: 'sawtooth', freq: freq * 2, dur: dur * 0.3, vol: vol * 0.16, inicio, ataque: 0.002, corte: 3200 })
  sopro(s, { inicio, dur: 0.012, vol: vol * 0.25, freq: 3000, q: 0.7 })
}

/** Metal de sopro abafado (trompa): serra com os agudos cortados e entrada mais lenta. */
function trompa(s: Saida, freq: number, dur: number, vol: number, inicio = 0) {
  tom(s, { tipo: 'sawtooth', freq, dur, vol, inicio, ataque: 0.05, corte: 900 })
  tom(s, { tipo: 'sawtooth', freq: freq * 1.003, dur, vol: vol * 0.6, inicio, ataque: 0.06, corte: 900 })
}

// --- passos: um pé no chão de cada peça ------------------------------------------------------
function casco(s: Saida, vol: number, inicio = 0) {
  pancada(s, 320, 170, 0.05, vol, inicio)
  sopro(s, { inicio, dur: 0.03, vol: vol * 0.3, freq: 1100, q: 3 })
}

const PASSOS: Record<string, (s: Saida, indice: number) => void> = {
  // leve e rápido, com o tilintar da katana na bainha
  p: (s) => {
    pancada(s, 150, 95, 0.06, 0.2)
    sopro(s, { dur: 0.035, vol: 0.05, filtro: 'highpass', freq: 1500 })
    tom(s, { freq: 2500, dur: 0.03, vol: 0.012, inicio: 0.01 })
  },
  // pedra pesada no chão
  r: (s) => {
    pancada(s, 92, 44, 0.2, 0.55)
    sopro(s, { dur: 0.14, vol: 0.2, filtro: 'lowpass', freq: 320 })
    sopro(s, { dur: 0.06, vol: 0.05, freq: 900, q: 2 })
  },
  // galope: o par de batidas das patas
  n: (s) => {
    casco(s, 0.2)
    casco(s, 0.15, 0.07)
  },
  // manto arrastando e o cajado tocando o chão a cada dois passos
  b: (s, indice) => {
    sopro(s, { ataque: 0.03, dur: 0.14, vol: 0.05, freq: 1400, q: 0.8 })
    pancada(s, 115, 82, 0.07, 0.12)
    if (indice % 2 === 0) tom(s, { freq: 1500, dur: 0.05, vol: 0.02, inicio: 0.02 })
  },
  // salto fino e um brilho discreto
  q: (s) => {
    sopro(s, { dur: 0.03, vol: 0.09, freq: 2600, q: 2.5 })
    pancada(s, 170, 110, 0.05, 0.12)
    tom(s, { freq: 1760, dur: 0.12, vol: 0.01, inicio: 0.01 })
  },
  // bota pesada e cota de malha
  k: (s) => {
    pancada(s, 112, 58, 0.2, 0.42)
    sopro(s, { dur: 0.09, vol: 0.03, filtro: 'highpass', freq: 5200, inicio: 0.02 })
  },
}

/** Tempo entre um passo e outro, em segundos: quem pesa mais anda mais devagar. */
const RITMO_PASSOS: Record<string, number> = { p: 0.27, r: 0.44, n: 0.24, b: 0.38, q: 0.33, k: 0.46 }

function relincho(s: Saida, inicio = 0, vol = 0.2) {
  const t = s.t + inicio
  const osc = s.ctx.createOscillator()
  osc.type = 'sawtooth'
  const pontos: [number, number][] = [
    [0, 620],
    [0.1, 1150],
    [0.32, 1000],
    [0.55, 1080],
    [0.85, 640],
  ]
  osc.frequency.setValueAtTime(pontos[0][1] * s.v, t)
  for (const [quando, freq] of pontos.slice(1)) osc.frequency.linearRampToValueAtTime(freq * s.v, t + quando)
  // o tremor rápido é o que faz soar relincho, não apito
  const tremor = s.ctx.createOscillator()
  tremor.frequency.value = 13
  const forca = s.ctx.createGain()
  forca.gain.value = 70
  tremor.connect(forca).connect(osc.frequency)
  const voz = s.ctx.createBiquadFilter()
  voz.type = 'bandpass'
  voz.frequency.value = 1500
  voz.Q.value = 1.6
  const g = envelope(s.ctx, t, 0.05, 0.8, vol)
  osc.connect(voz).connect(g).connect(s.destino)
  osc.start(t)
  tremor.start(t)
  osc.stop(t + 0.9)
  tremor.stop(t + 0.9)
}

function queda(s: Saida, grave: number, vol: number) {
  pancada(s, grave * 1.5, grave * 0.6, 0.2, vol)
  sopro(s, { dur: 0.16, vol: vol * 0.3, filtro: 'lowpass', freq: 600 })
  pancada(s, grave * 1.2, grave * 0.7, 0.08, vol * 0.4, 0.17)
}

function quedaDe(grave: number, vol: number) {
  return (s: Saida) => {
    queda(s, grave, vol)
    return 0.4
  }
}

function taiko(s: Saida, vol: number, inicio = 0) {
  pancada(s, 135, 56, 0.42, vol, inicio)
  sopro(s, { inicio, dur: 0.05, vol: vol * 0.2, freq: 700, q: 0.8 })
}

/** Cada som do jogo. Devolve quanto tempo dura, em segundos. */
export const SONS: Record<string, (s: Saida) => number> = {
  // --- a voz de cada peça, ao ser selecionada
  'selecionar:p': (s) => {
    sopro(s, { dur: 0.1, vol: 0.2, freq: 4500, ate: 6500, q: 4 })
    tom(s, { freq: 3100, dur: 0.16, vol: 0.05, inicio: 0.06 })
    return 0.3
  },
  'selecionar:r': (s) => {
    pancada(s, 180, 80, 0.12, 0.4)
    sopro(s, { dur: 0.09, vol: 0.1, filtro: 'lowpass', freq: 900 })
    return 0.25
  },
  'selecionar:n': (s) => {
    sopro(s, { ataque: 0.02, dur: 0.22, vol: 0.14, freq: 700, ate: 300, q: 1.5 })
    casco(s, 0.2, 0.05)
    return 0.35
  },
  'selecionar:b': (s) => {
    sino(s, 880, 0.7, 0.09)
    return 0.8
  },
  'selecionar:q': (s) => {
    for (const [i, nota] of [1319, 1760, 2349].entries()) tom(s, { freq: nota, dur: 0.3, vol: 0.05, inicio: i * 0.05 })
    return 0.5
  },
  'selecionar:k': (s) => {
    trompa(s, 147, 0.34, 0.14)
    trompa(s, 220, 0.3, 0.1, 0.05)
    return 0.5
  },
  recusa: (s) => {
    pancada(s, 170, 105, 0.07, 0.2)
    pancada(s, 135, 85, 0.09, 0.2, 0.1)
    return 0.25
  },

  // --- movimento especial
  'salto:n': (s) => {
    relincho(s)
    sopro(s, { inicio: 0.35, ataque: 0.15, dur: 0.4, vol: 0.09, freq: 500, ate: 1400, q: 0.8 })
    return 1
  },
  'pouso:n': (s) => {
    casco(s, 0.3)
    casco(s, 0.26, 0.05)
    pancada(s, 100, 48, 0.22, 0.4, 0.03)
    return 0.35
  },
  roque: (s) => {
    sopro(s, { ataque: 0.15, dur: 0.75, vol: 0.2, filtro: 'lowpass', freq: 240, q: 2 })
    for (let i = 0; i < 6; i++) sopro(s, { inicio: 0.08 + i * 0.1, dur: 0.05, vol: 0.05, freq: 1800, q: 4 })
    pancada(s, 96, 46, 0.3, 0.42, 0.75)
    return 1.15
  },

  // --- golpes: o de cada peça
  'espada:saca': (s) => {
    sopro(s, { ataque: 0.02, dur: 0.26, vol: 0.26, freq: 3800, ate: 7500, q: 3 })
    sino(s, 3100, 0.5, 0.07, 0.22)
    return 0.75
  },
  'golpe:p': (s) => {
    sopro(s, { ataque: 0.05, dur: 0.1, vol: 0.2, freq: 900, ate: 3600, q: 1.2 })
    tom(s, { freq: 2600, ate: 1900, dur: 0.22, vol: 0.05, inicio: 0.12 })
    pancada(s, 180, 80, 0.09, 0.28, 0.12)
    return 0.4
  },
  'marreta:ergue': (s) => {
    // a força de levantar e, no fim, o peso descendo: casa com o tempo do golpe (ver poseDaMarreta)
    sopro(s, { inicio: 0.24, ataque: 0.2, dur: 0.22, vol: 0.09, freq: 180, ate: 520, q: 1 })
    tom(s, { tipo: 'sawtooth', freq: 62, ate: 82, inicio: 0.24, ataque: 0.25, dur: 0.25, vol: 0.05, corte: 260 })
    sopro(s, { inicio: 0.78, ataque: 0.1, dur: 0.05, vol: 0.28, freq: 300, ate: 1900, q: 0.9 })
    return 0.95
  },
  'marreta:impacto': (s) => {
    pancada(s, 104, 27, 0.75, 0.8)
    sopro(s, { dur: 0.5, vol: 0.42, filtro: 'lowpass', freq: 1900, ate: 130 })
    // a madeira rachando e as lascas caindo
    for (let i = 0; i < 7; i++) {
      sopro(s, { inicio: 0.03 + i * 0.075 + Math.random() * 0.03, dur: 0.018, vol: 0.09 - i * 0.008, freq: 1500 + Math.random() * 2200, q: 5 })
    }
    return 1
  },
  esmagado: (s) => {
    tom(s, { tipo: 'sawtooth', freq: 330, ate: 62, dur: 0.17, vol: 0.13, corte: 900 })
    return 0.25
  },
  'golpe:n': (s) => {
    relincho(s, 0, 0.13)
    pancada(s, 105, 44, 0.32, 0.72)
    casco(s, 0.3, 0.02)
    sopro(s, { inicio: 0.08, ataque: 0.12, dur: 0.55, vol: 0.11, freq: 1000, ate: 300, q: 0.9 })
    return 1
  },
  'magia:b': (s) => {
    tom(s, { freq: 320, ate: 1500, ataque: 0.1, dur: 0.4, vol: 0.08 })
    tom(s, { freq: 480, ate: 2250, ataque: 0.1, dur: 0.4, vol: 0.04 })
    sopro(s, { ataque: 0.1, dur: 0.42, vol: 0.06, freq: 900, ate: 3200, q: 1.5 })
    for (let i = 0; i < 4; i++) tom(s, { freq: 2200 + i * 420, dur: 0.12, vol: 0.016, inicio: 0.1 + i * 0.09 })
    return 0.65
  },
  'explosao:b': (s) => {
    sopro(s, { dur: 0.58, vol: 0.34, filtro: 'lowpass', freq: 3200, ate: 170 })
    pancada(s, 122, 40, 0.42, 0.55)
    sino(s, 1400, 0.65, 0.05)
    return 0.8
  },
  'raio:q': (s) => {
    sopro(s, { dur: 0.04, vol: 0.5, filtro: 'highpass', freq: 2500 })
    sopro(s, { inicio: 0.05, dur: 0.05, vol: 0.32, filtro: 'highpass', freq: 3500 })
    tom(s, { tipo: 'sawtooth', freq: 92, ate: 58, dur: 0.3, vol: 0.13, corte: 2400 })
    // o trovão vem logo atrás
    sopro(s, { inicio: 0.1, ataque: 0.05, dur: 1.3, vol: 0.32, filtro: 'lowpass', freq: 420, ate: 70, q: 0.7 })
    return 1.55
  },
  'onda:k': (s) => {
    pancada(s, 66, 30, 0.8, 0.62)
    sino(s, 98, 2.2, 0.17)
    sopro(s, { ataque: 0.04, dur: 0.75, vol: 0.14, freq: 700, ate: 200, q: 0.8 })
    return 2.3
  },
  // a queda da vítima: quanto maior a peça, mais grave
  'queda:p': quedaDe(150, 0.25),
  'queda:n': quedaDe(120, 0.3),
  'queda:b': quedaDe(125, 0.28),
  'queda:r': quedaDe(85, 0.4),
  'queda:q': quedaDe(110, 0.32),
  'voo:vitima': (s) => {
    sopro(s, { ataque: 0.2, dur: 0.6, vol: 0.17, freq: 1300, ate: 380, q: 1 })
    return 0.85
  },

  // --- efeitos especiais
  honra: (s) => {
    sino(s, 294, 3.2, 0.14)
    // flauta de bambu: sopro de ar com a nota tremendo de leve
    tom(s, { freq: 587, ate: 622, inicio: 0.7, ataque: 0.4, dur: 1.5, vol: 0.05, tipo: 'triangle' })
    sopro(s, { inicio: 0.7, ataque: 0.4, dur: 1.4, vol: 0.022, freq: 1200, q: 2 })
    return 3.3
  },
  promocao: (s) => {
    const notas = [294, 440, 587, 740, 880, 1175]
    notas.forEach((nota, i) => {
      tom(s, { freq: nota, inicio: i * 0.13, ataque: 0.02, dur: 1, vol: 0.075 })
      tom(s, { tipo: 'triangle', freq: nota * 2, inicio: i * 0.13, ataque: 0.02, dur: 0.6, vol: 0.022 })
    })
    sino(s, 1175, 1.5, 0.08, 0.8)
    sopro(s, { ataque: 0.7, dur: 0.9, vol: 0.05, freq: 2500, ate: 6000, q: 0.7 })
    return 2.3
  },
  xeque: (s) => {
    trompa(s, 110, 0.32, 0.19)
    trompa(s, 116.5, 0.32, 0.19)
    taiko(s, 0.42)
    trompa(s, 110, 0.5, 0.19, 0.36)
    trompa(s, 123.5, 0.5, 0.19, 0.36)
    taiko(s, 0.5, 0.36)
    return 0.95
  },
  vitoria: (s) => {
    ;[0, 0.17, 0.34, 0.51].forEach((inicio, i) => taiko(s, 0.3 + i * 0.09, inicio))
    const acordes: [number, number[]][] = [
      [0.68, [294, 370, 440]],
      [1.04, [392, 494, 587]],
      [1.4, [440, 587, 740, 880]],
    ]
    for (const [inicio, notas] of acordes) for (const nota of notas) trompa(s, nota, inicio > 1.3 ? 1.35 : 0.34, 0.075, inicio)
    sino(s, 880, 1.8, 0.07, 1.4)
    return 3
  },
  derrota: (s) => {
    taiko(s, 0.45)
    ;[294, 262, 233, 220].forEach((nota, i) => tom(s, { tipo: 'triangle', freq: nota, inicio: 0.25 + i * 0.55, ataque: 0.05, dur: i === 3 ? 1.5 : 0.6, vol: 0.13 }))
    tom(s, { freq: 73, inicio: 0.25, ataque: 0.5, dur: 2.5, vol: 0.14 })
    return 3.3
  },
  empate: (s) => {
    sino(s, 440, 1.4, 0.09)
    sino(s, 440, 1.4, 0.07, 0.5)
    return 2
  },
  giro: (s) => {
    sopro(s, { ataque: 0.6, dur: 0.75, vol: 0.14, freq: 280, ate: 150, q: 0.9 })
    sopro(s, { ataque: 0.55, dur: 0.7, vol: 0.06, freq: 1100, ate: 700, q: 1.2 })
    return 1.4
  },
  inicio: (s) => {
    taiko(s, 0.45)
    taiko(s, 0.34, 0.24)
    trompa(s, 147, 0.75, 0.12, 0.42)
    trompa(s, 220, 0.75, 0.09, 0.42)
    return 1.3
  },
}

// --- ao vivo -----------------------------------------------------------------------------------
const VOLUME_DO_AMBIENTE = 0.34
const FOLGA_DE_AGENDA_S = 0.02

let contexto: AudioContext | null = null
let geral: GainNode | null = null
let efeitos: GainNode | null = null
let trilha: GainNode | null = null
let somLigado = true
let ambienteLigado = true
let volumeGeral = 0.6
let querAmbiente = false
let pararAmbienteAtual: (() => void) | null = null

// só nos testes: o que tocou, na ordem
const tocados: string[] = []
if (import.meta.env.DEV) (window as unknown as { __sonsTocados?: string[] }).__sonsTocados = tocados

/** Monta o contexto no primeiro gesto da pessoa: antes disso o navegador recusaria o som. Um limitador
 * no fim da cadeia segura vários sons juntos sem estourar. */
export function destravarSom() {
  if (!contexto) {
    contexto = new AudioContext()
    geral = contexto.createGain()
    geral.gain.value = somLigado ? volumeGeral : 0
    const limite = contexto.createDynamicsCompressor()
    limite.threshold.value = -9
    limite.ratio.value = 10
    limite.attack.value = 0.003
    limite.release.value = 0.2
    geral.connect(limite).connect(contexto.destination)
    efeitos = contexto.createGain()
    efeitos.connect(geral)
    trilha = contexto.createGain()
    trilha.gain.value = VOLUME_DO_AMBIENTE
    trilha.connect(geral)
  }
  if (contexto.state === 'suspended') void contexto.resume()
  atualizarAmbiente()
}

export function somDestravado(): boolean {
  return contexto !== null
}

export function ambienteTocando(): boolean {
  return pararAmbienteAtual !== null
}

export function configurarSom(c: { ligado: boolean; ambiente: boolean; volume: number }) {
  somLigado = c.ligado
  ambienteLigado = c.ambiente
  volumeGeral = c.volume
  if (contexto && geral) geral.gain.setTargetAtTime(somLigado ? volumeGeral : 0, contexto.currentTime, 0.03)
  atualizarAmbiente()
}

function saidaAoVivo(atraso = 0): Saida | null {
  if (!contexto || !efeitos || !somLigado || contexto.state !== 'running') return null
  return { ctx: contexto, destino: efeitos, t: contexto.currentTime + FOLGA_DE_AGENDA_S + atraso, v: 1 + (Math.random() - 0.5) * 0.07 }
}

export function tocarSom(nome: string, atraso = 0) {
  const s = saidaAoVivo(atraso)
  const som = SONS[nome]
  if (!s || !som) return
  if (import.meta.env.DEV) tocados.push(nome)
  som(s)
}

/** Os passos de uma caminhada de `duracao` segundos; correndo, o ritmo aperta. */
export function tocarPassos(tipo: string, duracao: number, correndo = false) {
  const passo = PASSOS[tipo]
  const s = saidaAoVivo()
  if (!passo || !s) return
  if (import.meta.env.DEV) tocados.push(`passos:${tipo}`)
  const ritmo = (RITMO_PASSOS[tipo] ?? 0.32) * (correndo ? 0.72 : 1)
  const quantos = Math.max(1, Math.round(duracao / ritmo))
  for (let i = 0; i < quantos; i++) passo({ ...s, t: s.t + i * ritmo + (Math.random() - 0.5) * 0.012, v: 1 + (Math.random() - 0.5) * 0.09 }, i)
}

/** Um passo solto, só pra medir nos testes. */
export function passoDe(tipo: string, s: Saida) {
  PASSOS[tipo](s, 0)
}

// --- som ambiente: vento nos campos, um grave de fundo bem baixo e, de vez em quando, notas soltas de
// koto na escala japonesa "in", como o cenário do samurai ------------------------------------------
const ESCALA_IN = [294, 311, 392, 440, 466, 587, 622, 784]

function iniciarAmbiente(ctx: AudioContext, destino: GainNode): () => void {
  const volume = ctx.createGain()
  volume.gain.setValueAtTime(0.0001, ctx.currentTime)
  volume.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 3)
  volume.connect(destino)

  // a nota dedilhada volta num eco curto, como em campo aberto
  const eco = ctx.createDelay(1)
  eco.delayTime.value = 0.42
  const retorno = ctx.createGain()
  retorno.gain.value = 0.36
  eco.connect(retorno).connect(eco)
  eco.connect(volume)

  const vento = ctx.createBufferSource()
  vento.buffer = ruidoBranco(ctx)
  vento.loop = true
  const filtroVento = ctx.createBiquadFilter()
  filtroVento.type = 'bandpass'
  filtroVento.frequency.value = 420
  filtroVento.Q.value = 0.6
  const volumeVento = ctx.createGain()
  volumeVento.gain.value = 0.1
  // rajadas: o filtro e o volume oscilam bem devagar, em ritmos diferentes, pra nunca repetir igual
  const rajada = ctx.createOscillator()
  rajada.frequency.value = 0.07
  const forcaRajada = ctx.createGain()
  forcaRajada.gain.value = 180
  rajada.connect(forcaRajada).connect(filtroVento.frequency)
  const sopros = ctx.createOscillator()
  sopros.frequency.value = 0.113
  const forcaSopros = ctx.createGain()
  forcaSopros.gain.value = 0.05
  sopros.connect(forcaSopros).connect(volumeVento.gain)
  vento.connect(filtroVento).connect(volumeVento).connect(volume)

  const graves = [73.4, 110].map((freq) => {
    const osc = ctx.createOscillator()
    osc.frequency.value = freq
    const g = ctx.createGain()
    g.gain.value = freq < 100 ? 0.06 : 0.025
    osc.connect(g).connect(volume)
    osc.start()
    return osc
  })
  vento.start()
  rajada.start()
  sopros.start()

  let temporizador: number | undefined
  function proximaFrase() {
    temporizador = window.setTimeout(() => {
      const s: Saida = { ctx, destino: eco, t: ctx.currentTime + 0.05, v: 1 }
      const inicio = Math.floor(Math.random() * ESCALA_IN.length)
      const notas = 1 + Math.floor(Math.random() * 3)
      for (let i = 0; i < notas; i++) {
        const nota = ESCALA_IN[Math.min(ESCALA_IN.length - 1, Math.max(0, inicio + (i === 0 ? 0 : Math.floor(Math.random() * 5) - 2)))]
        corda({ ...s, destino: volume }, nota, 1.6, 0.11, i * 0.42)
        corda(s, nota, 1.6, 0.07, i * 0.42)
      }
      // de vez em quando, um sino distante
      if (Math.random() < 0.14) sino({ ...s, destino: eco }, 147, 3.5, 0.05, 1)
      proximaFrase()
    }, 3500 + Math.random() * 6500)
  }
  proximaFrase()

  return () => {
    window.clearTimeout(temporizador)
    const agora = ctx.currentTime
    volume.gain.cancelScheduledValues(agora)
    volume.gain.setValueAtTime(Math.max(0.0001, volume.gain.value), agora)
    volume.gain.exponentialRampToValueAtTime(0.0001, agora + 0.7)
    window.setTimeout(() => {
      for (const fonte of [vento, rajada, sopros, ...graves]) fonte.stop()
      volume.disconnect()
      eco.disconnect()
      retorno.disconnect()
    }, 800)
  }
}

function atualizarAmbiente() {
  const deveTocar = querAmbiente && somLigado && ambienteLigado && contexto !== null && trilha !== null
  if (deveTocar && !pararAmbienteAtual && contexto && trilha) pararAmbienteAtual = iniciarAmbiente(contexto, trilha)
  else if (!deveTocar && pararAmbienteAtual) {
    pararAmbienteAtual()
    pararAmbienteAtual = null
  }
}

/** Com a aba do navegador escondida, tudo para: ninguém quer som de um jogo que não está vendo. */
function aoMudarVisibilidade() {
  if (!contexto) return
  if (document.hidden) void contexto.suspend()
  else void contexto.resume()
}

/** Liga o som ambiente enquanto o tabuleiro está na tela; devolve a função que desliga. */
export function ambienteDoTabuleiro(): () => void {
  querAmbiente = true
  atualizarAmbiente()
  document.addEventListener('visibilitychange', aoMudarVisibilidade)
  return () => {
    querAmbiente = false
    atualizarAmbiente()
    document.removeEventListener('visibilitychange', aoMudarVisibilidade)
  }
}
