import { chromium } from 'playwright'
const BASE_URL = process.env.SCREENSHOT_BASE_URL ?? 'http://127.0.0.1:5173/ARCHONIX/'
async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } })
  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 60000 })
  await page.evaluate(() => localStorage.clear())
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Max', exact: true }).click()
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: 'Fornecedores', exact: true }).click()
  await page.waitForTimeout(1500)

  const byRole = page.getByRole('combobox', { name: 'Estado', exact: true })
  console.log('getByRole combobox count:', await byRole.count())

  // acessa direto pelo <select> dentro do label que contem o texto "Estado"
  const direto = page.locator('label').filter({ has: page.locator('.field-label', { hasText: /^Estado$/ }) }).locator('select')
  console.log('locator direto count:', await direto.count())
  await direto.selectOption('SP')
  console.log('selecionou SP via locator direto, valor agora:', await direto.inputValue())

  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
