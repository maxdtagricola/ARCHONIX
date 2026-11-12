import { chromium } from 'playwright'

const BASE_URL = process.env.SCREENSHOT_BASE_URL ?? 'http://127.0.0.1:4321/ARCHONIX/'

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1600, height: 1400 } })
  const erros = []
  page.on('pageerror', (err) => erros.push(err.stack ?? err.message))
  page.on('console', (msg) => {
    if (msg.type() === 'error') erros.push(msg.text())
  })

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
  await page.getByLabel('Cliente').fill('TESTE-RESTRUCT')
  await page.getByLabel('Máquina').fill('TESTE')
  await page.getByRole('button', { name: 'Criar cotação e registrar itens' }).click()
  await page.waitForTimeout(1500)

  const bodyText = await page.locator('body').innerText()
  console.log('--- Verificações de remoção/adição ---')
  console.log('"Ratear frete por fornecedor" ainda aparece? (esperado: false)', bodyText.includes('Ratear frete por fornecedor'))
  console.log('"Dados do produto" ainda aparece? (esperado: false)', bodyText.includes('Dados do produto'))
  console.log('"Perfil de cálculo" aparece? (esperado: true)', bodyText.includes('Perfil de cálculo'))
  console.log('"Valores dos produtos" aparece? (esperado: true)', bodyText.includes('Valores dos produtos'))
  console.log('"Peso (kg)" aparece na tabela? (esperado: true)', bodyText.includes('Peso (kg)'))
  console.log('"Preço de venda" aparece na tabela? (esperado: true)', bodyText.includes('Preço de venda'))

  await page.screenshot({ path: 'scripts/screenshots/precificacao-restruct-full.png', fullPage: true })

  // preenche um item pra conferir se a tabela nova calcula direito
  const tabela = page.locator('table').filter({ has: page.locator('th', { hasText: 'Fornecedor' }) })
  const row = tabela.locator('tbody tr').nth(0)
  await row.locator('input').nth(0).fill('TESTE-RESTRUCT-001') // Interno
  await row.locator('input').nth(2).fill('PRODUTO TESTE RESTRUCT') // Descricao
  await row.locator('input').nth(3).fill('73181500') // NCM
  // Qtd, Peso, Valor unt agora nessa ordem
  const inputs = row.locator('input')
  const qtdIdx = 5 // apos interno, referencia, descricao, ncm, fornecedor -> uf eh select -> qtd input index?
  await page.waitForTimeout(300)

  // pega o valor de "Preco de venda" e "Total" calculados pra conferir que nao estao zerados/quebrados
  await page.screenshot({ path: 'scripts/screenshots/precificacao-restruct-item.png' })

  console.log('erros de console/pagina:', erros.length)
  for (const e of erros.slice(0, 10)) console.log('  -', e)

  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
