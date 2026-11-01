// Compila public/chess/games.pgn no livro que o site usa (public/chess/livro.json): pra cada posição, os
// lances bons jogados a partir dela e quantas vezes. Ler as partidas no navegador travaria a tela por
// vários segundos ao abrir o xadrez; o livro pronto carrega em milissegundos.
//
// Uso: node scripts/compilar-livro-xadrez.mjs
// Rodar de novo sempre que games.pgn mudar.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Chess } from 'chess.js'

const PASTA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'chess')
/** Só os primeiros 20 lances de cada lado: depois disso a partida quase nunca repete uma posição. */
const LIMITE_PLIES = 40

const chavePosicao = (fen) => fen.split(' ').slice(0, 4).join(' ')

/** Aceita PGN de fora também (Lichess e afins): comentários, variantes e números colados ao lance. */
function lancesDaPartida(texto) {
  return texto
    .split('\n')
    .filter((l) => !l.startsWith('['))
    .join(' ')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\([^()]*\)/g, ' ')
    .replace(/\$\d+/g, ' ')
    .replace(/\d+\.+/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !['1-0', '0-1', '1/2-1/2', '*'].includes(t))
}

const partidas = fs
  .readFileSync(path.join(PASTA, 'games.pgn'), 'utf8')
  .split(/\r?\n(?=\[Event\s)/)
  .map((p) => p.trim())
  .filter(Boolean)

const posicoes = new Map()
const assinaturas = new Set()
let lancesFracos = 0
for (const partida of partidas) {
  const chess = new Chess()
  const lances = lancesDaPartida(partida)
  // lance ilegal aqui é erro no arquivo: melhor parar do que publicar um livro quebrado
  lances.forEach((token, ply) => {
    const fraco = token.endsWith('?!')
    const san = token.replace(/[?!]+$/, '')
    const chave = chavePosicao(chess.fen())
    chess.move(san)
    if (fraco) lancesFracos++
    if (fraco || ply >= LIMITE_PLIES) return
    const lista = posicoes.get(chave) ?? []
    const existente = lista.find((e) => e[0] === san)
    if (existente) existente[1] += 1
    else lista.push([san, 1])
    posicoes.set(chave, lista)
  })
  assinaturas.add(lances.join(' '))
}
for (const lista of posicoes.values()) lista.sort((a, b) => b[1] - a[1])

const livro = { partidas: partidas.length, posicoes: Object.fromEntries(posicoes) }
const destino = path.join(PASTA, 'livro.json')
fs.writeFileSync(destino, JSON.stringify(livro))
console.log(`${partidas.length} partidas (${assinaturas.size} diferentes), ${lancesFracos} lances fracos de fora.`)
console.log(`${posicoes.size} posições em ${destino} (${(fs.statSync(destino).size / 1048576).toFixed(2)} MB).`)
if (assinaturas.size !== partidas.length) process.exitCode = 1
