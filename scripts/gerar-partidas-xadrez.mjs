// Gera as partidas de referência do xadrez (public/chess/games.pgn) com o Stockfish. Não faz parte do
// site: é uma ferramenta pra rodar à mão, e o motor fica fora do projeto.
//
// Uso: node scripts/gerar-partidas-xadrez.mjs <caminho do stockfish.js> [partidas=1000] [motores=2]
// Depois: node scripts/compilar-livro-xadrez.mjs
//
// Partidas sorteadas repetem os mesmos começos e cobrem pouco: a máquina saía do livro em 2 ou 3 lances.
// Por isso as partidas nascem de uma árvore: a máquina tem uma resposta firme e, onde é a vez da pessoa,
// a árvore abre primeiro as linhas que um jogador tem mais chance de escolher, até dar o número de
// partidas pedido. Cada ponta da árvore é depois jogada até o fim. Metade das partidas tem a máquina de
// brancas, metade de pretas.
//
// O lance fraco da pessoa sai no PGN com "?!": a máquina aprende a responder a ele, mas nunca a
// repeti-lo (ver compilar-livro-xadrez.mjs).
//
// O andamento fica fora do OneDrive: se o notebook desligar, rodar de novo continua de onde parou. Os
// motores rodam em prioridade baixa.

import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { Chess } from 'chess.js'

const [caminhoMotor, totalTexto = '1000', motoresTexto = '2'] = process.argv.slice(2)
if (!caminhoMotor) {
  console.error('Uso: node scripts/gerar-partidas-xadrez.mjs <caminho do stockfish.js> [partidas] [motores]')
  process.exit(1)
}
const TOTAL = Number(totalTexto)
const MOTORES = Number(motoresTexto)
const ARQUIVO_ARVORE = path.join(os.tmpdir(), `xadrez-arvore-${TOTAL}.json`)
const ANDAMENTO = path.join(os.tmpdir(), `xadrez-partidas-${TOTAL}.jsonl`)
const SAIDA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'chess', 'games.pgn')

/** Quanto pior que o melhor lance (centésimos de peão) ainda não conta como fraco. */
const MARGEM_LANCE_BOM = 25
/** Na primeira resposta a máquina pode ter dois lances, pra não jogar sempre igual. */
const MARGEM_SEGUNDA_RESPOSTA = 20
const MATE = 30000
const VANTAGEM_DECIDIDA = 700
const PLIES_PRA_DECIDIR = 6
const LIMITE_PLIES = 180

/** Com qual abertura a máquina começa, quando joga de brancas. */
const ABERTURAS_DA_MAQUINA = [
  ['e4', 0.7],
  ['d4', 0.3],
]
/** Quanto cada lance é popular nos primeiros lances; o motor sozinho ordenaria por força, não por costume. */
const LANCES_POPULARES = {
  '': { e4: 0.42, d4: 0.33, Nf3: 0.08, c4: 0.07, g3: 0.01, f4: 0.01, b3: 0.01, Nc3: 0.01 },
  e4: { e5: 0.33, c5: 0.27, e6: 0.1, c6: 0.1, d6: 0.05, d5: 0.05, Nf6: 0.03, g6: 0.03 },
  d4: { d5: 0.4, Nf6: 0.38, e6: 0.06, g6: 0.04, f5: 0.03, c5: 0.03, d6: 0.02 },
}
/** Depois disso, o peso de cada lance pela ordem do motor (o melhor primeiro). */
const PESO_POR_ORDEM = [0.36, 0.23, 0.16, 0.11, 0.08, 0.06]
/** Nos primeiros lances, uma fatia pra qualquer lance legal: é o que um iniciante faz. */
const PESO_LANCE_QUALQUER = 0.12
const PLIES_LANCE_QUALQUER = 4

class Motor {
  constructor(caminho) {
    this.proc = spawn(process.execPath, [caminho], { cwd: os.tmpdir(), stdio: ['pipe', 'pipe', 'ignore'] })
    os.setPriority(this.proc.pid, os.constants.priority.PRIORITY_BELOW_NORMAL)
    this.resto = ''
    this.aoLer = null
    this.proc.stdout.setEncoding('utf8')
    this.proc.stdout.on('data', (d) => {
      this.resto += d
      const linhas = this.resto.split('\n')
      this.resto = linhas.pop()
      for (const l of linhas) this.aoLer?.(l.trim())
    })
  }
  enviar(t) {
    this.proc.stdin.write(t + '\n')
  }
  esperar(fim) {
    return new Promise((resolve) => {
      this.aoLer = (l) => {
        if (fim(l)) resolve(l)
      }
    })
  }
  async iniciar() {
    this.enviar('uci')
    await this.esperar((l) => l === 'uciok')
    this.enviar('setoption name Hash value 16')
    this.enviar('isready')
    await this.esperar((l) => l === 'readyok')
  }
  /** Os melhores lances da posição, do melhor pro pior, com a nota do ponto de vista de quem joga. */
  async analisar(lances, profundidade, linhas) {
    this.enviar(`setoption name MultiPV value ${linhas}`)
    this.enviar(`position startpos${lances.length ? ` moves ${lances.join(' ')}` : ''}`)
    const porLinha = new Map()
    const lido = new Promise((resolve) => {
      this.aoLer = (l) => {
        if (l.startsWith('bestmove')) return resolve()
        const m = l.match(/^info .*\bmultipv (\d+) score (cp|mate) (-?\d+).* pv (\S+)/)
        if (!m) return
        const valor = Number(m[3])
        const cp = m[2] === 'cp' ? valor : Math.sign(valor) * (MATE - Math.abs(valor))
        porLinha.set(Number(m[1]), { uci: m[4], cp })
      }
    })
    this.enviar(`go depth ${profundidade}`)
    await lido
    return [...porLinha.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v)
  }
  encerrar() {
    this.enviar('quit')
  }
}

function reproduzir(uci) {
  const chess = new Chess()
  for (const u of uci) chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] })
  return chess
}

function acrescentar(no, uci, fraco, prob) {
  const chess = reproduzir(no.uci)
  const feito = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
  return {
    uci: [...no.uci, uci],
    sans: [...no.sans, feito.san],
    lances: [...no.lances, fraco ? `${feito.san}?!` : feito.san],
    prob,
    fim: chess.isGameOver(),
  }
}

/** Os lances que a pessoa pode fazer, cada um com a chance de ela escolhê-lo. */
async function lancesDaPessoa(motor, no) {
  const analise = await motor.analisar(no.uci, 10, 6)
  const melhor = analise[0].cp
  const ehFraco = (u) => {
    const nota = analise.find((a) => a.uci === u)
    return !nota || melhor - nota.cp > MARGEM_LANCE_BOM
  }
  const legais = reproduzir(no.uci).moves({ verbose: true })
  const pesos = new Map()
  const populares = LANCES_POPULARES[no.sans.join(' ')]
  if (populares) {
    for (const l of legais) if (populares[l.san]) pesos.set(l.lan, populares[l.san])
  } else {
    analise.forEach((a, i) => pesos.set(a.uci, PESO_POR_ORDEM[i] ?? 0.02))
  }
  const fatiaLivre = no.uci.length < PLIES_LANCE_QUALQUER ? PESO_LANCE_QUALQUER : 0
  const soma = [...pesos.values()].reduce((s, p) => s + p, 0)
  const opcoes = [...pesos].map(([uci, p]) => ({ uci, prob: (p / soma) * (1 - fatiaLivre) }))
  const outros = legais.filter((l) => !pesos.has(l.lan))
  for (const l of outros) opcoes.push({ uci: l.lan, prob: fatiaLivre / outros.length })
  return opcoes.filter((o) => o.prob > 0).map((o) => ({ ...o, fraco: ehFraco(o.uci) }))
}

/** A resposta da máquina: uma só, a não ser no primeiro lance dela, com dois lances equivalentes. */
async function respostasDaMaquina(motor, no) {
  const primeira = no.uci.length <= 1
  const analise = await motor.analisar(no.uci, 12, primeira ? 2 : 1)
  return analise.filter((a) => analise[0].cp - a.cp <= MARGEM_SEGUNDA_RESPOSTA).map((a) => a.uci)
}

/** Abre a árvore de um dos papéis, sempre pela linha mais provável, até ter `pontas` linhas. */
async function montarArvore(motor, papelMaquina, pontas) {
  const raiz = { uci: [], sans: [], lances: [], prob: 1, fim: false }
  let aberta = []
  if (papelMaquina === 'w') {
    const chess = new Chess()
    for (const [san, prob] of ABERTURAS_DA_MAQUINA) aberta.push(acrescentar(raiz, chess.moves({ verbose: true }).find((m) => m.san === san).lan, false, prob))
  } else {
    aberta = [raiz]
  }
  const fechadas = []
  while (aberta.length + fechadas.length < pontas) {
    aberta.sort((a, b) => b.prob - a.prob)
    const no = aberta.shift()
    for (const op of await lancesDaPessoa(motor, no)) {
      const filho = acrescentar(no, op.uci, op.fraco, no.prob * op.prob)
      if (filho.fim) {
        fechadas.push(filho)
        continue
      }
      const respostas = await respostasDaMaquina(motor, filho)
      for (const r of respostas) {
        const neto = acrescentar(filho, r, false, filho.prob / respostas.length)
        ;(neto.fim ? fechadas : aberta).push(neto)
      }
    }
    if ((aberta.length + fechadas.length) % 50 < 6) console.log(`árvore ${papelMaquina}: ${aberta.length + fechadas.length}/${pontas} linhas`)
  }
  return [...fechadas, ...aberta]
    .sort((a, b) => b.prob - a.prob)
    .slice(0, pontas)
    .map((p) => ({ papelMaquina, uci: p.uci, lances: p.lances }))
}

/** Do fim da linha da árvore até o fim da partida, com os dois lados jogando o melhor lance. */
async function jogarAteOFim(motor, ponta) {
  const chess = reproduzir(ponta.uci)
  const uci = [...ponta.uci]
  const lances = [...ponta.lances]
  let seguidasDecididas = 0
  let seguidasEmpatadas = 0

  while (!chess.isGameOver() && uci.length < LIMITE_PLIES) {
    const ply = uci.length
    const [melhor] = await motor.analisar(uci, ply < 40 ? 10 : 8, 1)
    const feito = chess.move({ from: melhor.uci.slice(0, 2), to: melhor.uci.slice(2, 4), promotion: melhor.uci[4] })
    uci.push(melhor.uci)
    lances.push(feito.san)

    const proBranco = (ply % 2 === 0 ? 1 : -1) * melhor.cp
    seguidasDecididas = Math.abs(proBranco) >= VANTAGEM_DECIDIDA ? seguidasDecididas + 1 : 0
    seguidasEmpatadas = ply >= 100 && Math.abs(proBranco) <= 20 ? seguidasEmpatadas + 1 : 0
    if (seguidasDecididas >= PLIES_PRA_DECIDIR) return { lances, resultado: proBranco > 0 ? '1-0' : '0-1', termino: 'adjudication' }
    if (seguidasEmpatadas >= 10) return { lances, resultado: '1/2-1/2', termino: 'adjudication' }
  }

  if (chess.isCheckmate()) return { lances, resultado: chess.turn() === 'w' ? '0-1' : '1-0', termino: 'normal' }
  return { lances, resultado: '1/2-1/2', termino: chess.isGameOver() ? 'normal' : 'adjudication' }
}

function montarPgn(p, numero, data) {
  const corpo = []
  p.lances.forEach((lance, i) => corpo.push(i % 2 === 0 ? `${i / 2 + 1}. ${lance}` : lance))
  corpo.push(p.resultado)
  const linhas = []
  let linha = ''
  for (const pedaco of corpo) {
    if (linha.length + pedaco.length + 1 > 90) {
      linhas.push(linha)
      linha = pedaco
    } else linha = linha ? `${linha} ${pedaco}` : pedaco
  }
  linhas.push(linha)
  return [
    `[Event "Partida de referência do Archonix"]`,
    `[Site "Gerada com Stockfish 17.1"]`,
    `[Date "${data}"]`,
    `[Round "${numero}"]`,
    `[White "${p.papelMaquina === 'w' ? 'Máquina' : 'Pessoa'}"]`,
    `[Black "${p.papelMaquina === 'b' ? 'Máquina' : 'Pessoa'}"]`,
    `[Result "${p.resultado}"]`,
    `[Termination "${p.termino}"]`,
    '',
    linhas.join('\n'),
    '',
  ].join('\n')
}

function lerAndamento() {
  if (!fs.existsSync(ANDAMENTO)) return new Map()
  const prontas = new Map()
  for (const linha of fs.readFileSync(ANDAMENTO, 'utf8').split('\n')) {
    if (!linha) continue
    try {
      const r = JSON.parse(linha)
      prontas.set(r.indice, r)
    } catch {
      // última linha cortada por um desligamento
    }
  }
  return prontas
}

const motores = Array.from({ length: MOTORES }, () => new Motor(caminhoMotor))
await Promise.all(motores.map((m) => m.iniciar()))

let pontas
if (fs.existsSync(ARQUIVO_ARVORE)) {
  pontas = JSON.parse(fs.readFileSync(ARQUIVO_ARVORE, 'utf8'))
  console.log(`Árvore já pronta: ${pontas.length} linhas.`)
} else {
  const metade = Math.ceil(TOTAL / 2)
  const [brancas, pretas] = await Promise.all([montarArvore(motores[0], 'w', metade), montarArvore(motores[MOTORES - 1 > 0 ? 1 : 0], 'b', TOTAL - metade)])
  pontas = [...brancas, ...pretas]
  fs.writeFileSync(ARQUIVO_ARVORE, JSON.stringify(pontas))
  console.log(`Árvore pronta: ${pontas.length} linhas.`)
}

const prontas = lerAndamento()
const inicio = Date.now()
let feitasNestaRodada = 0
let proxima = 0
console.log(`${prontas.size} partidas já prontas; faltam ${pontas.length - prontas.size}.`)

async function trabalhar(motor) {
  while (proxima < pontas.length) {
    const indice = proxima++
    if (prontas.has(indice)) continue
    const ponta = pontas[indice]
    const registro = { indice, papelMaquina: ponta.papelMaquina, ...(await jogarAteOFim(motor, ponta)) }
    prontas.set(indice, registro)
    fs.appendFileSync(ANDAMENTO, JSON.stringify(registro) + '\n')
    feitasNestaRodada++
    if (prontas.size % 50 === 0) {
      const porPartida = (Date.now() - inicio) / 1000 / feitasNestaRodada
      console.log(`${prontas.size}/${pontas.length} partidas | ${porPartida.toFixed(1)} s por partida`)
    }
  }
  motor.encerrar()
}

await Promise.all(motores.map(trabalhar))

const hoje = new Date()
const data = `${hoje.getFullYear()}.${String(hoje.getMonth() + 1).padStart(2, '0')}.${String(hoje.getDate()).padStart(2, '0')}`
const finais = [...prontas.values()].sort((a, b) => a.indice - b.indice)
fs.writeFileSync(SAIDA, finais.map((p, i) => montarPgn(p, i + 1, data)).join('\n'))
console.log(`Pronto: ${finais.length} partidas em ${SAIDA}`)
