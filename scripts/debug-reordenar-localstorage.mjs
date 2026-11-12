import { chromium } from 'playwright'

const BASE_URL = process.env.SCREENSHOT_BASE_URL ?? 'http://127.0.0.1:4321/ARCHONIX/'

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } })

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
  await page.getByLabel('Cliente').fill('TESTE-LS')
  await page.getByLabel('Máquina').fill('TESTE')
  await page.getByRole('button', { name: 'Criar cotação e registrar itens' }).click()
  await page.waitForTimeout(1500)

  const tabela = page.locator('table').filter({ has: page.locator('th', { hasText: 'Fornecedor' }) })
  const thInterno = tabela.locator('thead th', { hasText: 'Interno' })
  const thTotal = tabela.locator('thead th', { hasText: 'Total' })
  await thInterno.dragTo(thTotal)
  await page.waitForTimeout(500)

  const valorLS = await page.evaluate(() => localStorage.getItem('itensCotacao:ordemColunas'))
  console.log('localStorage logo apos arrastar:', valorLS)

  await page.reload({ waitUntil: 'load' })
  await page.waitForTimeout(1000)

  const valorLSDepoisReload = await page.evaluate(() => localStorage.getItem('itensCotacao:ordemColunas'))
  console.log('localStorage apos reload (deve ser igual):', valorLSDepoisReload)
  console.log('bate?', valorLS === valorLSDepoisReload)

  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
