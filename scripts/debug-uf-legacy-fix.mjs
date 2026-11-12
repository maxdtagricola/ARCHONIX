import { chromium } from 'playwright'

const BASE_URL = process.env.SCREENSHOT_BASE_URL ?? 'http://127.0.0.1:4321/ARCHONIX/'

// Registro de cotação real (formato atual, com "items"), mas com um item cujo estadoOrigem
// ficou vazio — simula um item salvo antes do seletor de UF existir de fato, ou nunca preenchido.
const registroComUfVazia = {
  id: 'teste-legacy-uf',
  codigo: 'COT-TESTE-LEGACY',
  criadoPor: 'Max',
  vendedor: 'EDSON',
  tipoReferencia: 'itens',
  cliente: 'CLIENTE-LEGACY',
  maquina: 'MAQ-LEGACY',
  empresaId: '',
  items: [
    {
      id: 'item-legacy-1',
      product: {
        perfil: 'RO',
        referencia: 'REF-LEGACY',
        ncm: '73181500',
        interno: '48993',
        fornecedor: 'BALDAN',
        marca: '',
        estadoOrigem: '', // <- o campo problematico
        freteRate: 0,
        qtd: 30,
        descricao: 'PARAFUSO CAB.SEXTAVADA LEGACY',
        valorUnt: 9.78,
        peso: 0,
        stRetido: 0,
        outrasDespesas: 0,
        desconto: 0,
        ipi: 0,
        freteAdicional: 0,
        credIcmsFrete: 0,
      },
      pricing: { lucroPct: 25 },
    },
  ],
  itensPreRegistro: [],
  status: 'PENDENTE',
  responsavelStatus: '',
  statusHistory: [{ status: 'PENDENTE', changedAt: Date.now() }],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  summary: { totalItens: 1, precoVendaTotalGeral: 0 },
}

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } })
  page.on('pageerror', (err) => console.log('[pageerror]', err.stack ?? err.message))
  page.on('console', (msg) => console.log('[console]', msg.type(), msg.text()))
  page.on('requestfailed', (req) => console.log('[requestfailed]', req.method(), req.url(), req.failure()?.errorText))
  page.on('response', (res) => {
    if (res.url().includes('analises')) console.log('[response]', res.request().method(), res.url(), res.status())
  })

  // intercepta a leitura da lista de cotações pra injetar o registro "legacy" direto,
  // sem precisar de acesso de escrita ao servidor real (inclui o preflight CORS, já que é
  // fetch cross-origin com Content-Type: application/json — não é "simple request")
  await page.route('**/analises', (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      })
    }
    if (req.method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify([registroComUfVazia]),
      })
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

  await page.getByRole('button', { name: 'Cotações', exact: true }).click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: 'scripts/screenshots/uf-legacy-lista.png' })
  console.log('texto da pagina apos abrir Cotacoes:', (await page.locator('body').innerText()).slice(0, 800))
  await page.getByText('PENDENTE', { exact: true }).first().click()
  await page.waitForTimeout(800)
  await page.getByText('CLIENTE-LEGACY').first().click()
  await page.waitForTimeout(1200)

  const tabela = page.locator('table').filter({ has: page.locator('th', { hasText: 'Fornecedor' }) })
  const select = tabela.locator('tbody tr').nth(0).locator('select')
  const valorSelecionado = await select.inputValue()
  console.log('valor selecionado no <select> de UF apos carregar item legacy (esperado: SP):', JSON.stringify(valorSelecionado))

  await page.screenshot({ path: 'scripts/screenshots/uf-legacy-fix.png' })

  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
