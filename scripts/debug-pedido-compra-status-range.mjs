import { chromium } from 'playwright'

const BASE_URL = process.env.SCREENSHOT_BASE_URL ?? 'http://127.0.0.1:4321/ARCHONIX/'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function itemBase(id, valorUnt) {
  return {
    id,
    product: {
      perfil: 'RO',
      referencia: '',
      ncm: '',
      interno: '',
      fornecedor: 'FORN',
      marca: '',
      freteRate: 0.1,
      estadoOrigem: 'SP',
      qtd: 1,
      descricao: 'ITEM TESTE',
      valorUnt,
      peso: 0,
      prazoEntrega: '',
      stRetido: 0,
      outrasDespesas: 0,
      desconto: 0,
      ipi: 0,
      freteAdicional: 0,
      credIcmsFrete: 0,
    },
    pricing: { impFedPct: 0.03, outrosPct: 0, comissaoPct: 0.04, custoFixoPct: 0.1, lucroPct: 0.2 },
  }
}

function quoteBase(id, codigo, cliente, status) {
  return {
    id,
    codigo,
    criadoPor: 'Max',
    vendedor: 'EDSON',
    tipoReferencia: 'itens',
    cliente,
    maquina: 'TESTE',
    empresaId: '',
    items: [itemBase(`${id}-item1`, 100)],
    itensPreRegistro: [],
    status,
    responsavelStatus: '',
    statusHistory: [{ status, changedAt: Date.now() }],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    summary: { totalItens: 1, precoVendaTotalGeral: 0 },
  }
}

const registros = new Map()
for (const [id, codigo, cliente, status] of [
  ['q-pendente', 'COT-P1', 'TESTE-PENDENTE', 'PENDENTE'],
  ['q-enviado', 'COT-P2', 'TESTE-ENVIADO', 'ENVIADO'],
  ['q-pedidocompra', 'COT-P3', 'TESTE-PEDIDOCOMPRA', 'PEDIDO DE COMPRA'],
  ['q-confirmado', 'COT-P4', 'TESTE-CONFIRMADO', 'PEDIDO CONFIRMADO'],
  ['q-transporte', 'COT-P5', 'TESTE-TRANSPORTE', 'EM TRANSPORTE'],
  ['q-entregue', 'COT-P6', 'TESTE-ENTREGUE', 'ENTREGUE'],
  ['q-arquivo', 'COT-P7', 'TESTE-ARQUIVO', 'ARQUIVO'],
]) {
  registros.set(id, quoteBase(id, codigo, cliente, status))
}

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } })
  const erros = []
  page.on('pageerror', (err) => erros.push(err.stack ?? err.message))

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

  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 60000 })
  await page.evaluate(() => localStorage.clear())
  await page.waitForTimeout(500)
  await page.reload({ waitUntil: 'load' })
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Max', exact: true }).click()
  await page.waitForTimeout(800)

  await page.getByRole('button', { name: 'Pedido de Compra', exact: true }).click()
  await page.waitForTimeout(1000)
  const bodyText = await page.locator('body').innerText()

  console.log('--- Esperado aparecer (PEDIDO DE COMPRA em diante) ---')
  console.log('TESTE-PEDIDOCOMPRA aparece?', bodyText.includes('TESTE-PEDIDOCOMPRA'))
  console.log('TESTE-CONFIRMADO aparece?', bodyText.includes('TESTE-CONFIRMADO'))
  console.log('TESTE-TRANSPORTE aparece?', bodyText.includes('TESTE-TRANSPORTE'))
  console.log('TESTE-ENTREGUE aparece?', bodyText.includes('TESTE-ENTREGUE'))
  console.log('TESTE-ARQUIVO aparece?', bodyText.includes('TESTE-ARQUIVO'))

  console.log('--- Esperado NAO aparecer (antes de PEDIDO DE COMPRA) ---')
  console.log('TESTE-PENDENTE aparece? (esperado false)', bodyText.includes('TESTE-PENDENTE'))
  console.log('TESTE-ENVIADO aparece? (esperado false)', bodyText.includes('TESTE-ENVIADO'))

  await page.screenshot({ path: 'scripts/screenshots/pedido-compra-status-range.png', fullPage: true })

  console.log('erros:', erros.length)
  for (const e of erros.slice(0, 10)) console.log('  -', e)

  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
