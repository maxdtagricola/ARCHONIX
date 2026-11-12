import { chromium } from 'playwright'

const BASE_URL = process.env.SCREENSHOT_BASE_URL ?? 'http://127.0.0.1:4321/ARCHONIX/'

async function pegarOrdemColunas(page) {
  const tabela = page.locator('table').filter({ has: page.locator('th', { hasText: 'Fornecedor' }) })
  return tabela.locator('thead th').allTextContents()
}

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
  await page.getByRole('button', { name: 'Max', exact: true }).click()
  await page.waitForTimeout(800)

  await page.getByRole('button', { name: 'Cotações', exact: true }).click()
  await page.waitForTimeout(1000)
  await page.getByLabel('Vendedor').selectOption('EDSON')
  await page.getByLabel('Cliente').fill('TESTE-REORDENAR')
  await page.getByLabel('Máquina').fill('TESTE')
  await page.getByRole('button', { name: 'Criar cotação e registrar itens' }).click()
  await page.waitForTimeout(1500)

  console.log('ordem antes de arrastar:', await pegarOrdemColunas(page))

  const tabela = page.locator('table').filter({ has: page.locator('th', { hasText: 'Fornecedor' }) })
  const thInterno = tabela.locator('thead th', { hasText: 'Interno' })
  const thTotal = tabela.locator('thead th', { hasText: 'Total' })

  // arrasta "Interno" pra cima de "Total" (vai pra perto do fim da tabela) — dragTo simula o
  // gesto de drag-and-drop HTML5 de verdade (dragstart/dragover/drop), diferente de só
  // mouse.down+move+up, que não dispara esses eventos nativos
  await thInterno.dragTo(thTotal)
  await page.waitForTimeout(500)

  const ordemDepois = await pegarOrdemColunas(page)
  console.log('ordem depois de arrastar Interno sobre Total:', ordemDepois)

  // recarrega a pagina inteira (sem limpar localStorage) pra conferir se a ordem persiste
  await page.reload({ waitUntil: 'load' })
  await page.waitForTimeout(1000)
  // pode aparecer um modal de "recuperar rascunho" (a cotacao ainda em edicao foi auto-salva
  // localmente) — descarta pra nao bloquear os cliques seguintes
  const descartarRascunho = page.getByRole('button', { name: /descartar|nova cota[cç][aã]o/i }).first()
  if (await descartarRascunho.count()) {
    await descartarRascunho.click().catch(() => {})
    await page.waitForTimeout(500)
  }
  await page.getByRole('button', { name: 'Cotações', exact: true }).click()
  await page.waitForTimeout(1000)
  await page.getByText('TESTE-REORDENAR').first().click().catch(() => {})
  await page.waitForTimeout(1200)

  const ordemAposReload = await pegarOrdemColunas(page)
  console.log('ordem apos reload (deve ser igual à de depois de arrastar):', ordemAposReload)
  console.log('ordem persistiu corretamente?', JSON.stringify(ordemDepois) === JSON.stringify(ordemAposReload))

  console.log('erros:', erros.length)
  for (const e of erros.slice(0, 10)) console.log('  -', e)

  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
