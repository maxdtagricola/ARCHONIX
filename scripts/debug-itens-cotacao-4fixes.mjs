import { chromium } from 'playwright'

const BASE_URL = process.env.SCREENSHOT_BASE_URL ?? 'http://127.0.0.1:5173/ARCHONIX/'

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } })
  page.on('pageerror', (err) => console.log('[pageerror]', err.stack ?? err.message))

  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 60000 })
  await page.evaluate(() => localStorage.clear())
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Max', exact: true }).click()
  await page.waitForTimeout(800)

  // fornecedor de teste com cidade/estado, pra conferir o autocomplete + auto-load de UF
  await page.getByRole('button', { name: 'Fornecedores', exact: true }).click()
  await page.waitForTimeout(1000)
  await page.getByLabel('Nome', { exact: true }).fill('TESTE-AUTOCOMPLETE-FORN')
  await page.getByLabel('Cidade', { exact: true }).fill('Curitiba')
  await page.getByRole('combobox', { name: 'Estado', exact: true }).selectOption('PR')
  await page.getByRole('button', { name: 'Adicionar fornecedor' }).click()
  await page.waitForTimeout(1000)
  console.log('fornecedor de teste criado')

  await page.getByRole('button', { name: 'Cotações', exact: true }).click()
  await page.waitForTimeout(1000)
  await page.getByLabel('Vendedor').selectOption('EDSON')
  await page.getByLabel('Cliente').fill('TESTE-4FIXES')
  await page.getByLabel('Máquina').fill('TESTE')
  await page.getByRole('button', { name: 'Criar cotação e registrar itens' }).click()
  await page.waitForTimeout(1500)

  console.log('status logo apos criar:', await page.getByText(/^PENDENTE$|^ANALISANDO VALORES$/).first().textContent().catch(() => '(nao achou o badge de status)'))

  const tabela = page.locator('table').filter({ has: page.locator('th', { hasText: 'Fornecedor' }) })

  // === FIX 1: digitar valor unitario promove o status ===
  await tabela.locator('tbody tr').nth(0).locator('input').nth(6).fill('50') // Valor unt.
  await page.waitForTimeout(1000)
  const statusDepois = await page.locator('body').innerText()
  console.log('"ANALISANDO VALORES" apareceu na tela apos digitar valor unitario?', statusDepois.includes('ANALISANDO VALORES'))

  // === FIX 2: screenshot da tabela pra conferir se UF nao esta mais sobreposto ===
  await page.screenshot({ path: 'scripts/screenshots/itens-cotacao-tabela.png' })

  // === FIX 3: seletor de frete %/R$ ===
  await tabela.locator('tbody tr').nth(0).locator('input').nth(5).fill('10') // Qtd
  await page.waitForTimeout(300)
  // troca pra modo R$ e digita um valor de frete
  await page.getByRole('button', { name: 'R$', exact: true }).click()
  await page.waitForTimeout(300)
  await tabela.locator('tbody tr').nth(0).locator('input').nth(7).fill('25') // Frete, agora em R$
  await page.waitForTimeout(300)
  // volta pra % e confere se o valor bate (25 / (10*50) = 5%)
  await page.getByRole('button', { name: '%', exact: true }).click()
  await page.waitForTimeout(300)
  const pctFrete = await tabela.locator('tbody tr').nth(0).locator('input').nth(7).inputValue()
  console.log('frete em % apos digitar R$25 (qtd=10, valorUnt=50 => esperado 5):', pctFrete)

  // === FIX 4: autocomplete de fornecedor ===
  await tabela.locator('tbody tr').nth(0).locator('input').nth(4).fill('TESTE-AUTOCOMPLETE') // Fornecedor
  await page.waitForTimeout(500)
  await page.screenshot({ path: 'scripts/screenshots/itens-cotacao-autocomplete.png' })
  const sugestao = page.getByRole('button', { name: /TESTE-AUTOCOMPLETE-FORN/ })
  console.log('sugestao de fornecedor apareceu?', await sugestao.count())
  await sugestao.click()
  await page.waitForTimeout(500)
  const ufAposSelecionar = await tabela.locator('tbody tr').nth(0).locator('select').inputValue()
  console.log('UF apos selecionar o fornecedor (esperado PR):', ufAposSelecionar)

  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
