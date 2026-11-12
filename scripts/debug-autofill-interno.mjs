import { chromium } from 'playwright'

const BASE_URL = process.env.SCREENSHOT_BASE_URL ?? 'http://127.0.0.1:4321/ARCHONIX/'

// backend fake em memoria (o celular/Tailscale esta fora do ar agora) — imita o contrato REST
// real usado por src/db/db.ts: GET /analises (lista tudo), PUT /analises/:id (upsert), DELETE
const registros = new Map()

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } })
  page.on('pageerror', (err) => console.log('[pageerror]', err.stack ?? err.message))
  page.on('dialog', async (d) => {
    console.log('[dialog]', d.message())
    await d.dismiss().catch(() => {})
  })

  // pega qualquer outra chamada pro backend real (fornecedores, configuracoes, etc.) que o
  // teste nao precisa simular de verdade — responde vazio/ok em vez de deixar tentar o servidor
  // inalcancavel. Registrada primeiro: as rotas mais especificas abaixo tem prioridade por cima
  // dela (Playwright roda a ultima rota registrada primeiro, com fallback pras anteriores).
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
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: CORS_HEADERS,
        body: JSON.stringify([...registros.values()]),
      })
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
    if (req.method() === 'DELETE') {
      registros.delete(id)
      return route.fulfill({ status: 204, headers: CORS_HEADERS })
    }
    return route.continue()
  })

  // configuracoes/fornecedores tambem sao lidos ao montar as paginas — evita ficar tentando o
  // servidor real inalcancavel (so deixa vazio, nao afeta o teste)
  await page.route('**/configuracoes/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: CORS_HEADERS, body: '{}' }))
  await page.route('**/fornecedores', (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: CORS_HEADERS, body: '[]' }))

  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 60000 })
  await page.evaluate(() => localStorage.clear())
  await page.waitForTimeout(500)
  await page.reload({ waitUntil: 'load' })
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Max', exact: true }).click()
  await page.waitForTimeout(800)

  // === Cotacao 1: cria e preenche todos os dados do item ===
  await page.getByRole('button', { name: 'Cotações', exact: true }).click()
  await page.waitForTimeout(1000)
  await page.getByLabel('Vendedor').selectOption('EDSON')
  await page.getByLabel('Cliente').fill('TESTE-AUTOFILL-ORIGEM')
  await page.getByLabel('Máquina').fill('TESTE')
  await page.getByRole('button', { name: 'Criar cotação e registrar itens' }).click()
  await page.waitForTimeout(1200)

  const tabela1 = page.locator('table').filter({ has: page.locator('th', { hasText: 'Fornecedor' }) })
  const row1 = tabela1.locator('tbody tr').nth(0)
  await row1.locator('input').nth(0).fill('TESTE-AUTOFILL-001') // Interno
  await row1.locator('input').nth(1).fill('REF-AUTOFILL-001') // Referencia
  await row1.locator('input').nth(2).fill('DESCRICAO ORIGINAL AUTOFILL') // Descricao
  await row1.locator('input').nth(3).fill('73181500') // NCM
  await row1.locator('input').nth(4).fill('FORNECEDOR-AUTOFILL') // Fornecedor
  await page.waitForTimeout(300)
  await page.locator('body').click({ position: { x: 10, y: 10 } })
  await row1.locator('select').selectOption('PR')
  await row1.locator('input').nth(5).fill('7') // Qtd
  await row1.locator('input').nth(6).fill('123.45') // Valor unt.
  await page.waitForTimeout(300)

  await page.getByRole('button', { name: 'Salvar cotação', exact: true }).click()
  await page.waitForTimeout(1000)
  console.log('registros no backend fake apos salvar cotacao 1:', registros.size)

  // === Cotacao 2: item novo, digita o mesmo Interno e confere o autofill ===
  await page.getByRole('button', { name: 'Nova cotação', exact: true }).click()
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: 'Cotações', exact: true }).click()
  await page.waitForTimeout(800)
  await page.getByLabel('Vendedor').selectOption('EDSON')
  await page.getByLabel('Cliente').fill('TESTE-AUTOFILL-DESTINO')
  await page.getByLabel('Máquina').fill('TESTE2')
  await page.getByRole('button', { name: 'Criar cotação e registrar itens' }).click()
  await page.waitForTimeout(1200)

  const tabela2 = page.locator('table').filter({ has: page.locator('th', { hasText: 'Fornecedor' }) })
  const row2 = tabela2.locator('tbody tr').nth(0)
  await row2.locator('input').nth(0).fill('TESTE-AUTOFILL-001')
  await row2.locator('input').nth(0).blur()
  await page.waitForTimeout(1000)

  const referenciaDepois = await row2.locator('input').nth(1).inputValue()
  const descricaoDepois = await row2.locator('input').nth(2).inputValue()
  const ncmDepois = await row2.locator('input').nth(3).inputValue()
  const fornecedorDepois = await row2.locator('input').nth(4).inputValue()
  const ufDepois = await row2.locator('select').inputValue()
  const valorUntDepois = await row2.locator('input').nth(6).inputValue()
  const qtdDepois = await row2.locator('input').nth(5).inputValue()

  console.log('--- resultado do autofill por Interno ---')
  console.log('referencia (esperado REF-AUTOFILL-001):', referenciaDepois)
  console.log('descricao (esperado DESCRICAO ORIGINAL AUTOFILL):', descricaoDepois)
  console.log('ncm (esperado 73181500):', ncmDepois)
  console.log('fornecedor (esperado FORNECEDOR-AUTOFILL):', fornecedorDepois)
  console.log('uf (esperado PR):', ufDepois)
  console.log('valorUnt (esperado 123.45):', valorUntDepois)
  console.log('qtd (esperado continuar 1, NAO virar 7):', qtdDepois)

  // === Cotacao 3: testa o autofill pela Referencia tambem ===
  await page.getByRole('button', { name: 'Nova cotação', exact: true }).click()
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: 'Cotações', exact: true }).click()
  await page.waitForTimeout(800)
  await page.getByLabel('Vendedor').selectOption('EDSON')
  await page.getByLabel('Cliente').fill('TESTE-AUTOFILL-DESTINO-REF')
  await page.getByLabel('Máquina').fill('TESTE3')
  await page.getByRole('button', { name: 'Criar cotação e registrar itens' }).click()
  await page.waitForTimeout(1200)

  const tabela3 = page.locator('table').filter({ has: page.locator('th', { hasText: 'Fornecedor' }) })
  const row3 = tabela3.locator('tbody tr').nth(0)
  await row3.locator('input').nth(1).fill('REF-AUTOFILL-001')
  await row3.locator('input').nth(1).blur()
  await page.waitForTimeout(1000)

  console.log('--- resultado do autofill por Referencia ---')
  console.log('interno (esperado TESTE-AUTOFILL-001):', await row3.locator('input').nth(0).inputValue())
  console.log('descricao (esperado DESCRICAO ORIGINAL AUTOFILL):', await row3.locator('input').nth(2).inputValue())

  await page.screenshot({ path: 'scripts/screenshots/autofill-interno-resultado.png' })

  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
