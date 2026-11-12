import { chromium } from 'playwright'

const BASE_URL = process.env.SCREENSHOT_BASE_URL ?? 'http://127.0.0.1:4321/ARCHONIX/'

const registros = new Map()
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1600, height: 1400 } })
  const erros = []
  page.on('pageerror', (err) => erros.push(err.stack ?? err.message))
  page.on('dialog', async (d) => {
    console.log('[dialog]', d.message())
    await d.dismiss().catch(() => {})
  })

  await page.route('http://100.112.41.57:3000/**', async (route) => {
    const method = route.request().method()
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS_HEADERS })
    if (method === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS_HEADERS, body: '[]' })
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS_HEADERS, body: '{}' })
  })
  await page.route('**/analises', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS_HEADERS })
    if (req.method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS_HEADERS, body: JSON.stringify([...registros.values()]) })
    }
    return route.continue()
  })
  await page.route('**/analises/*', async (route) => {
    const req = route.request()
    const id = decodeURIComponent(req.url().split('/analises/')[1])
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS_HEADERS })
    if (req.method() === 'PUT') {
      const body = JSON.parse(req.postData() ?? '{}')
      registros.set(id, body)
      return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS_HEADERS, body: JSON.stringify(body) })
    }
    if (req.method() === 'GET') {
      const achado = registros.get(id)
      if (!achado) return route.fulfill({ status: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'not-found' }) })
      return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS_HEADERS, body: JSON.stringify(achado) })
    }
    return route.continue()
  })

  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 60000 })
  await page.evaluate(() => localStorage.clear())
  await page.waitForTimeout(500)
  await page.reload({ waitUntil: 'load' })
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Max', exact: true }).click()
  await page.waitForTimeout(800)

  // === cria cotacao com 2 itens de fornecedores diferentes ===
  await page.getByRole('button', { name: 'Cotações', exact: true }).click()
  await page.waitForTimeout(1000)
  await page.getByLabel('Vendedor').selectOption('EDSON')
  await page.getByLabel('Cliente').fill('TESTE-MULTIFORN')
  await page.getByLabel('Máquina').fill('TESTE')
  await page.getByRole('button', { name: 'Criar cotação e registrar itens' }).click()
  await page.waitForTimeout(1200)

  const tabela = page.locator('table').filter({ has: page.locator('th', { hasText: 'Fornecedor' }) })
  const row0 = tabela.locator('tbody tr').nth(0)
  await row0.locator('input').nth(2).fill('PRODUTO A')
  await row0.locator('input').nth(4).fill('FORNECEDOR-A')
  await page.waitForTimeout(300)
  await page.locator('body').click({ position: { x: 10, y: 10 } })
  await row0.locator('input').nth(5).fill('10') // qtd
  await row0.locator('input').nth(7).fill('50') // valor unt (indice pode variar com ordem de colunas)

  await page.getByRole('button', { name: '+ Adicionar item', exact: true }).click()
  await page.waitForTimeout(500)
  const row1 = tabela.locator('tbody tr').nth(1)
  await row1.locator('input').nth(2).fill('PRODUTO B')
  await row1.locator('input').nth(4).fill('FORNECEDOR-B')
  await page.waitForTimeout(300)
  await page.locator('body').click({ position: { x: 10, y: 10 } })
  await row1.locator('input').nth(5).fill('5')
  await row1.locator('input').nth(7).fill('120')

  await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Salvar cotação', exact: true }).click()
  await page.waitForTimeout(1200)

  console.log('registros no backend fake:', registros.size)
  const idCotacao = [...registros.keys()][0]

  // === vai direto pra Pedido de Compra, busca a cotacao (ainda nao esta em PEDIDO DE COMPRA) e
  // muda o status por la mesmo (a propria tela ja tem esse controle) ===
  await page.getByRole('button', { name: 'Pedido de Compra', exact: true }).click()
  await page.waitForTimeout(1000)
  const buscaCotacao = page
    .locator('label')
    .filter({ has: page.locator('.field-label', { hasText: 'Ou busque qualquer cotação' }) })
    .locator('select')
  const valorBusca = await buscaCotacao.locator('option', { hasText: 'TESTE-MULTIFORN' }).first().getAttribute('value')
  await buscaCotacao.selectOption(valorBusca)
  await page.waitForTimeout(600)

  const selectStatusPC = page.locator('select').filter({ has: page.locator('option', { hasText: 'PEDIDO DE COMPRA' }) }).first()
  await selectStatusPC.selectOption('PEDIDO DE COMPRA')
  await page.waitForTimeout(500)
  const botaoConfirmar = page.getByRole('button', { name: 'Confirmar', exact: true })
  if (await botaoConfirmar.count()) {
    await botaoConfirmar.click()
    await page.waitForTimeout(1000)
  }
  console.log('status apos mudanca:', registros.get(idCotacao)?.status)

  // reseta a busca e confere se a cotacao aparece sozinha na lista de cima, sem precisar buscar
  await buscaCotacao.selectOption('')
  await page.waitForTimeout(500)
  const bodyPC = await page.locator('body').innerText()
  console.log('"TESTE-MULTIFORN" aparece na lista "Cotações em Pedido de Compra" sem busca manual?', bodyPC.includes('TESTE-MULTIFORN'))

  await page.getByText('TESTE-MULTIFORN').first().click()
  await page.waitForTimeout(800)
  await page.screenshot({ path: 'scripts/screenshots/pedido-compra-multifornecedor.png', fullPage: true })

  const bodyDepois = await page.locator('body').innerText()
  console.log('mostra "Fornecedor: FORNECEDOR-A"?', bodyDepois.includes('Fornecedor: FORNECEDOR-A'))
  console.log('mostra "Fornecedor: FORNECEDOR-B"?', bodyDepois.includes('Fornecedor: FORNECEDOR-B'))
  console.log('mostra "(2 fornecedores)"?', bodyDepois.includes('2 fornecedores'))
  console.log('mostra "Frete total"?', bodyDepois.includes('Frete total'))
  console.log('mostra "Frete unitário"?', bodyDepois.includes('Frete unitário'))

  // === testa o botao Voltar ===
  console.log('--- Botao Voltar ---')
  await page.getByRole('button', { name: 'Análise de Margens', exact: true }).click()
  await page.waitForTimeout(600)
  const botaoVoltar = page.getByTitle('Voltar pra tela anterior')
  console.log('botao Voltar existe?', await botaoVoltar.count())
  await page.screenshot({ path: 'scripts/screenshots/debug-antes-voltar.png', fullPage: true })
  console.log('texto da pagina antes de clicar Voltar:', (await page.locator('body').innerText()).slice(0, 400))
  await botaoVoltar.click()
  await page.waitForTimeout(600)
  const bodyAposVoltar = await page.locator('body').innerText()
  console.log('voltou pra Pedido de Compra (mostra "Cotações em Pedido de Compra")?', bodyAposVoltar.includes('Cotações em Pedido de Compra'))

  console.log('erros:', erros.length)
  for (const e of erros.slice(0, 10)) console.log('  -', e)

  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
