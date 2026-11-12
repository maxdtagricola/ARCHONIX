import { chromium } from 'playwright'

const BASE_URL = process.env.SCREENSHOT_BASE_URL ?? 'http://127.0.0.1:4321/ARCHONIX/'

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } })
  const erros = []
  page.on('pageerror', (err) => erros.push(err.stack ?? err.message))

  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 60000 })
  await page.evaluate(() => localStorage.clear())
  await page.waitForTimeout(500)
  await page.reload({ waitUntil: 'load' })
  await page.waitForTimeout(500)

  await page.getByPlaceholder('Adicionar novo jogador').fill('TESTE-VERIFICAR')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.waitForTimeout(2000)
  await page.getByRole('button', { name: 'Pausar demonstração', exact: true }).click().catch(() => {})
  await page.waitForTimeout(500)

  async function lance(san) {
    return page.evaluate((s) => new Promise((resolve) => window.__debugExecutarLance(s, resolve)), san)
  }

  await lance('e4')
  await page.waitForTimeout(1200)
  await lance('d5')
  await page.waitForTimeout(1200)

  // dispara a captura SEM esperar, e fica consultando o estado a cada 60ms
  const promessa = lance('exd5')
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(60)
    const estado = await page.evaluate(() => {
      const grupo = window.__debugPiecesGroup
      if (!grupo) return null
      const todas = []
      for (const peca of grupo.children) {
        const acoes = peca.userData.acoesRPG
        if (!acoes?.Attack) continue
        const mao = peca.userData.maoDireitaRPG
        todas.push({
          cor: peca.userData.cor,
          attackRunning: acoes.Attack.isRunning(),
          attackWeight: Number(acoes.Attack.getEffectiveWeight().toFixed(2)),
          maoTemFilhos: mao ? mao.children.length : null,
        })
      }
      const atacando = todas.find((p) => p.attackRunning)
      return atacando ?? { semNenhumAtacando: true, totalComAttack: todas.length }
    })
    console.log(`t=${i * 60}ms`, JSON.stringify(estado))
  }
  await promessa

  console.log('erros:', erros.length)
  for (const e of erros.slice(0, 10)) console.log('  -', e)

  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
