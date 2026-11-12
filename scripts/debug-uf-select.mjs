import { chromium } from 'playwright'
const BASE_URL = process.env.SCREENSHOT_BASE_URL ?? 'http://127.0.0.1:5173/ARCHONIX/'
async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 60000 })
  await page.evaluate(() => localStorage.clear())
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Max', exact: true }).click()
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: 'Cotações', exact: true }).click()
  await page.waitForTimeout(1000)
  await page.getByLabel('Vendedor').selectOption('EDSON')
  await page.getByLabel('Cliente').fill('TESTE-UF-SELECT')
  await page.getByLabel('Máquina').fill('TESTE')
  await page.getByRole('button', { name: 'Criar cotação e registrar itens' }).click()
  await page.waitForTimeout(1500)
  const select = page.locator('table').filter({ has: page.locator('th', { hasText: 'Fornecedor' }) }).locator('tbody tr').nth(0).locator('select')
  console.log('valor do <select>:', await select.inputValue())
  console.log('texto exibido (selected option):', await select.locator('option:checked').innerText())
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
