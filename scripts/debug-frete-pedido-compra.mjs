import { chromium } from 'playwright'

const BASE_URL = process.env.SCREENSHOT_BASE_URL ?? 'http://127.0.0.1:4321/ARCHONIX/'

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1600, height: 1300 } })
  const erros = []
  page.on('pageerror', (err) => erros.push(err.stack ?? err.message))
  page.on('console', (msg) => {
    if (msg.type() === 'error') erros.push(msg.text())
  })
  page.on('dialog', async (d) => {
    console.log('[dialog]', d.message())
    await d.dismiss().catch(() => {})
  })

  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 60000 })
  await page.evaluate(() => localStorage.clear())
  await page.waitForTimeout(500)
  await page.reload({ waitUntil: 'load' })
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Max', exact: true }).click()
  await page.waitForTimeout(800)

  // cria uma cotacao de teste com 1 item pra usar tanto em Frete quanto em Pedido de Compra
  await page.getByRole('button', { name: 'Cotações', exact: true }).click()
  await page.waitForTimeout(1000)
  await page.getByLabel('Vendedor').selectOption('EDSON')
  await page.getByLabel('Cliente').fill('TESTE-FRETE-PEDIDO')
  await page.getByLabel('Máquina').fill('TESTE')
  await page.getByRole('button', { name: 'Criar cotação e registrar itens' }).click()
  await page.waitForTimeout(1500)

  const tabela = page.locator('table').filter({ has: page.locator('th', { hasText: 'Fornecedor' }) })
  const row = tabela.locator('tbody tr').nth(0)
  await row.locator('input').nth(2).fill('PRODUTO TESTE FRETE PEDIDO')
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Salvar cotação', exact: true }).click()
  await page.waitForTimeout(1200)

  let idCotacaoTeste = ''

  async function selecionarCotacaoDeTeste(page) {
    const select = page.getByRole('combobox', { name: 'Cotação', exact: true })
    const valor = idCotacaoTeste || (await select.locator('option', { hasText: 'TESTE-FRETE-PEDIDO' }).first().getAttribute('value'))
    idCotacaoTeste = valor
    await select.selectOption(valor)
  }

  async function descartarModalRascunho(page) {
    const modal = page.locator('.fixed.inset-0.z-50')
    if (await modal.count()) {
      const botao = modal.getByRole('button').first()
      await botao.click().catch(() => {})
      await page.waitForTimeout(500)
    }
  }

  // === FRETE ===
  await page.getByRole('button', { name: 'Frete', exact: true }).click()
  await page.waitForTimeout(1000)
  await selecionarCotacaoDeTeste(page)
  await page.waitForTimeout(800)

  const cardEucatur = page.locator('.card', { hasText: 'EUCATUR' }).first()
  await cardEucatur.getByRole('button', { name: 'Gerar dados de pedido de frete' }).click()
  await page.waitForTimeout(500)
  console.log('card EUCATUR expandido, campo "Valor da cotação" existe?', await cardEucatur.locator('label', { hasText: 'Valor da cotação' }).count())

  const valorCotacaoInput = cardEucatur.locator('label', { hasText: 'Valor da cotação' }).locator('input')
  const numeroCotacaoInput = cardEucatur.locator('label', { hasText: 'Número da cotação' }).locator('input')
  await valorCotacaoInput.fill('452,90')
  await numeroCotacaoInput.fill('EUC-000123')
  const botaoSalvarFrete = cardEucatur.getByRole('button', { name: 'Salvar dados' })
  console.log('botao "Salvar dados" no card EUCATUR existe?', await botaoSalvarFrete.count())
  await botaoSalvarFrete.click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: 'scripts/screenshots/frete-apos-salvar-click.png' })

  const bodyTextFrete = await page.locator('body').innerText()
  console.log('"Salvo!" apareceu apos salvar no Frete?', bodyTextFrete.includes('Salvo!'))

  // confere direto na API (independente de qualquer timing da UI) se o dado realmente chegou no servidor
  const respostaApi = await page.evaluate(async (id) => {
    const r = await fetch(`http://100.112.41.57:3000/analises/${id}`)
    const q = await r.json()
    return { freteTransportadoras: q.freteTransportadoras }
  }, idCotacaoTeste)
  console.log('resposta da API pra essa cotacao especifica (freteTransportadoras):', JSON.stringify(respostaApi))

  // recarrega e confere se persistiu
  await page.reload({ waitUntil: 'load' })
  await page.waitForTimeout(3000)
  await descartarModalRascunho(page)
  await page.getByRole('button', { name: 'Frete', exact: true }).click().catch(() => {})
  await page.waitForTimeout(1000)
  await selecionarCotacaoDeTeste(page).catch((e) => console.log('erro ao selecionar cotacao apos reload:', e.message))
  await page.waitForTimeout(800)
  const bodyTextDepoisReload = await page.locator('body').innerText()
  console.log('resumo "Cotação: R$ 452,90" aparece no card (fechado) apos reload?', bodyTextDepoisReload.includes('452,90'))
  console.log('resumo "Nº EUC-000123" aparece no card apos reload?', bodyTextDepoisReload.includes('EUC-000123'))

  await page.screenshot({ path: 'scripts/screenshots/frete-salvo.png', fullPage: true })

  // === PEDIDO DE COMPRA ===
  console.log('--- Pedido de Compra ---')
  await descartarModalRascunho(page)
  const botaoPedidoCompra = page.getByRole('button', { name: 'Pedido de Compra', exact: true })
  console.log('aba "Pedido de Compra" existe no menu?', await botaoPedidoCompra.count())
  await botaoPedidoCompra.click()
  await page.waitForTimeout(1000)

  await selecionarCotacaoDeTeste(page)
  await page.waitForTimeout(800)
  await page.screenshot({ path: 'scripts/screenshots/pedido-compra-tela.png', fullPage: true })

  const tabelaPedido = page.locator('table').filter({ has: page.locator('th', { hasText: 'Negoc' }) })
  const linhaPedido = tabelaPedido.locator('tbody tr').nth(0)
  const inputValorFechado = linhaPedido.locator('input').nth(1) // qtd fechada eh input[0], valor unt fechado eh input[1]
  await inputValorFechado.fill('88.50')
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Salvar dados', exact: true }).click()
  await page.waitForTimeout(1000)
  const bodyTextPedido = await page.locator('body').innerText()
  console.log('"Salvo!" apareceu apos salvar no Pedido de Compra?', bodyTextPedido.includes('Salvo!'))

  const respostaApiPedido = await page.evaluate(async (id) => {
    const r = await fetch(`http://100.112.41.57:3000/analises/${id}`)
    const q = await r.json()
    return { itensFechados: q.itensFechados }
  }, idCotacaoTeste)
  console.log('resposta da API pra itensFechados:', JSON.stringify(respostaApiPedido))

  // muda o status por essa tela e confere se reflete na lista de Cotacoes tambem (mesmo registro)
  const selectStatus = page.locator('select').filter({ hasText: 'PENDENTE' }).first()
  await selectStatus.selectOption('ANALISANDO VALORES')
  await page.waitForTimeout(1000)

  await page.getByRole('button', { name: 'Cotações', exact: true }).click()
  await page.waitForTimeout(1000)
  const bodyTextCotacoes = await page.locator('body').innerText()
  console.log('status "ANALISANDO VALORES" aparece em Cotacoes apos mudar em Pedido de Compra (mesmo registro)?', bodyTextCotacoes.includes('ANALISANDO VALORES'))

  console.log('erros de console/pagina:', erros.length)
  for (const e of erros.slice(0, 10)) console.log('  -', e)

  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
