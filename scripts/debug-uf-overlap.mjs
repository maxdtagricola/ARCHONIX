import { chromium } from 'playwright'

const BASE_URL = process.env.SCREENSHOT_BASE_URL ?? 'http://127.0.0.1:4321/ARCHONIX/'

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } })
  page.on('pageerror', (err) => console.log('[pageerror]', err.stack ?? err.message))

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
  await page.getByLabel('Cliente').fill('TESTE-UF-OVERLAP')
  await page.getByLabel('Máquina').fill('TESTE')
  await page.getByRole('button', { name: 'Criar cotação e registrar itens' }).click()
  await page.waitForTimeout(1500)

  const tabela = page.locator('table').filter({ has: page.locator('th', { hasText: 'Fornecedor' }) })
  await tabela.locator('tbody tr').nth(0).locator('input').nth(2).fill('PARAFUSO CAB.SEXTAVADA TESTE LONGO') // Descrição
  await page.waitForTimeout(300)
  await tabela.locator('tbody tr').nth(0).locator('input').nth(3).fill('BALDAN') // Fornecedor
  await page.waitForTimeout(500)
  await page.locator('body').click({ position: { x: 10, y: 10 } })
  await page.waitForTimeout(300)

  await page.screenshot({ path: 'scripts/screenshots/uf-overlap-full.png' })

  const info = await page.evaluate(() => {
    const table = [...document.querySelectorAll('table')].find((t) => [...t.querySelectorAll('th')].some((th) => th.textContent?.includes('Fornecedor')))
    if (!table) return { erro: 'tabela nao encontrada' }
    const ths = [...table.querySelectorAll('thead th')].map((th) => ({ texto: th.textContent, rect: th.getBoundingClientRect() }))
    const firstRow = table.querySelector('tbody tr')
    const tds = firstRow ? [...firstRow.querySelectorAll('td')].map((td, i) => {
      const rect = td.getBoundingClientRect()
      const select = td.querySelector('select')
      const input = td.querySelector('input')
      return {
        indice: i,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        temSelect: !!select,
        selectRect: select ? select.getBoundingClientRect() : null,
        selectValue: select ? select.value : null,
        selectOptions: select ? [...select.options].map((o) => o.value) : null,
        inputValue: input ? input.value : null,
      }
    }) : []
    return { ths: ths.map((t) => ({ texto: t.texto, x: t.rect.x, width: t.rect.width })), tds }
  })
  console.log(JSON.stringify(info, null, 2))

  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
