import { chromium } from 'playwright'

const BASE_URL = process.env.SCREENSHOT_BASE_URL ?? 'http://127.0.0.1:5173/ARCHONIX/'

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.on('pageerror', (err) => console.log('[pageerror]', err.stack ?? err.message))

  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 60000 })
  await page.evaluate(() => localStorage.clear())
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Max', exact: true }).click()
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: 'Cotações', exact: true }).click()
  await page.waitForTimeout(1000)
  await page.getByLabel('Vendedor').selectOption('EDSON')
  await page.getByLabel('Cliente').fill('TESTE-DATA-ANO')
  await page.getByLabel('Máquina').fill('TESTE')
  await page.getByRole('button', { name: 'Criar cotação e registrar itens' }).click()
  await page.waitForTimeout(1500)

  const dateInput = page.locator('input[type="date"]')
  await dateInput.click()
  await page.screenshot({ path: 'scripts/screenshots/data-01-apos-click.png', clip: (await dateInput.boundingBox()) ?? undefined })
  // o clique centralizado cai direto no segmento "yyyy" (o mais à direita) — ou seja, o cenário
  // real do usuário é digitar o ANO PRIMEIRO, com dia/mês ainda vazios. É exatamente aí que o bug
  // antigo aparecia: cada dígito do ano, com dia/mês vazios, fazia o .value geral ficar "" (data
  // incompleta) — e no código antigo (controlado) isso zerava dataSolicitacao e o campo voltava
  // pro vazio a cada tecla, impedindo digitar mais de 1 dígito do ano seguido.

  let n = 0
  async function digitar(label, teclas) {
    for (const tecla of teclas) {
      await page.keyboard.press(tecla)
      await page.waitForTimeout(150)
    }
    n += 1
    console.log(`apos digitar ${label}:`, JSON.stringify(await dateInput.inputValue()))
    const box = await dateInput.boundingBox()
    if (box) {
      await page.screenshot({
        path: `scripts/screenshots/data-0${n + 1}-${label.replace(/[^a-z0-9]/gi, '')}.png`,
        clip: { x: box.x - 5, y: box.y - 5, width: box.width + 10, height: box.height + 10 },
      })
    }
  }

  // digita o ANO primeiro (dia/mês ainda em branco) — o cenário real que reproduzia o bug
  await digitar('ano-2', ['2'])
  await digitar('ano-0', ['0'])
  await digitar('ano-2', ['2'])
  await digitar('ano-6', ['6'])
  // só depois dia e mês
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await digitar('dia-2', ['2'])
  await digitar('dia-0', ['0'])
  await digitar('mes-0', ['0'])
  await digitar('mes-9', ['9'])

  const valorFinal = await dateInput.inputValue()
  console.log('valor final apos digitar ano-primeiro depois dia/mes:', valorFinal)
  console.log(valorFinal === '2026-09-20' ? 'OK — ano completo digitado corretamente' : '*** FALHOU — o ano nao foi digitado corretamente ***')

  await page.screenshot({ path: 'scripts/screenshots/data-solicitacao-digitada.png' })

  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
