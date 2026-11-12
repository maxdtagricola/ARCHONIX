import { chromium } from 'playwright'

const BASE_URL = process.env.SCREENSHOT_BASE_URL ?? 'http://127.0.0.1:5173/ARCHONIX/'

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1400, height: 1400 } })
  page.on('pageerror', (err) => console.log('[pageerror]', err.stack ?? err.message))
  page.on('dialog', (d) => {
    console.log('[dialog]', d.message())
    d.accept()
  })
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[console.error]', msg.text())
  })

  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 60000 })
  await page.evaluate(() => localStorage.clear())
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Max', exact: true }).click()
  await page.waitForTimeout(800)

  await page.getByRole('button', { name: 'Cotações', exact: true }).click()
  await page.waitForTimeout(1000)
  await page.getByLabel('Vendedor').selectOption('EDSON')
  await page.getByLabel('Cliente').fill('TESTE-REFACTOR-PRECIF')
  await page.getByLabel('Máquina').fill('TESTE')
  await page.getByRole('button', { name: 'Criar cotação e registrar itens' }).click()
  await page.waitForTimeout(1500)

  console.log('=== checagens de ausência ===')
  console.log('"Refere-se a" ainda existe?', await page.getByText('Refere-se a', { exact: true }).count())
  console.log('"Itens a cotar" ainda existe?', await page.getByText('Itens a cotar', { exact: true }).count())
  console.log('"Formação de preço" ainda existe?', await page.getByText('Formação de preço', { exact: true }).count())
  console.log('coluna "Peso (kg)" ainda existe?', await page.getByText('Peso (kg)', { exact: true }).count())

  console.log('=== checagens de presença ===')
  console.log('coluna NCM existe?', await page.locator('th', { hasText: 'NCM' }).count())
  console.log('coluna UF existe?', await page.locator('th', { hasText: 'UF' }).count())
  console.log('coluna Frete existe?', await page.locator('th', { hasText: 'Frete' }).count())
  console.log('botão "Comparar fornecedores" existe?', await page.getByRole('button', { name: 'Comparar fornecedores' }).count())
  console.log('seletor de margem (pill 25%) existe?', await page.getByRole('button', { name: '25%' }).count())

  // preenche qtd e valor unitário pra conferir o Total = qtd*valorUnt (custo, nao venda)
  // ordem das <input> na linha: Interno(0) Referencia(1) Descricao(2) NCM(3) Fornecedor(4) [UF é <select>] Qtd(5) ValorUnt(6) Frete(7) Prazo(8)
  const tabela = page.locator('table').filter({ has: page.locator('th', { hasText: 'Fornecedor' }) })
  await tabela.locator('tbody tr').nth(0).locator('input').nth(5).fill('10') // Qtd
  await page.waitForTimeout(200)
  await tabela.locator('tbody tr').nth(0).locator('input').nth(6).fill('7.5') // Valor unt.
  await page.waitForTimeout(300)
  const celulas = tabela.locator('tbody tr').nth(0).locator('td')
  const totalTexto = await celulas.nth((await celulas.count()) - 2).innerText()
  console.log('valor da coluna Total (deve ser 75,00, ou seja 10*7,5):', totalTexto)

  // testa a data de solicitacao + Atualizar cotacao + reabrir
  await page.locator('input[type="date"]').fill('2026-09-20')
  await page.waitForTimeout(200)
  await page.getByRole('button', { name: 'Atualizar cotação' }).click()
  await page.waitForTimeout(1200)
  await page.screenshot({ path: 'scripts/screenshots/apos-atualizar.png' })

  await page.getByRole('button', { name: 'Cotações', exact: true }).click()
  await page.waitForTimeout(1500)
  await page.getByText('PENDENTE', { exact: true }).first().click()
  await page.waitForTimeout(500)
  await page.getByText('TESTE-REFACTOR-PRECIF', { exact: false }).first().click({ timeout: 15000 })
  await page.waitForTimeout(1200)
  const dataSalva = await page.locator('input[type="date"]').inputValue()
  console.log('data de solicitacao apos reabrir a cotacao (deve ser 2026-09-20):', dataSalva)

  // testa comparar fornecedores
  await page.getByRole('button', { name: 'Comparar fornecedores' }).click()
  await page.waitForTimeout(1000)
  console.log('titulo "Comparar fornecedores" na pagina?', await page.getByRole('heading', { name: 'Comparar fornecedores' }).count())
  await page.getByLabel('Fornecedor', { exact: true }).fill('FORNECEDOR TESTE X')
  // rótulo "Valor unitário" inclui o prefixo "R$" no texto acessível — getByLabel exato não bate
  await page
    .locator('label')
    .filter({ has: page.locator('.field-label', { hasText: /^Valor unitário$/ }) })
    .locator('input')
    .fill('5.50')
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click()
  await page.waitForTimeout(800)
  console.log('"Melhor preço" apareceu?', await page.getByText('Melhor preço', { exact: false }).count())

  await page.getByRole('button', { name: 'Voltar para Precificação' }).click()
  await page.waitForTimeout(1000)
  const fornecedorCelula = await tabela.locator('tbody tr').nth(0).locator('input').nth(4).inputValue()
  console.log('fornecedor do item apos comparar (deve ser FORNECEDOR TESTE X):', fornecedorCelula)
  const valorUntCelula = await tabela.locator('tbody tr').nth(0).locator('input').nth(6).inputValue()
  console.log('valor unitario do item apos comparar (deve ser 5.5):', valorUntCelula)

  await page.screenshot({ path: 'scripts/screenshots/precificacao-refactor.png', fullPage: true })

  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
