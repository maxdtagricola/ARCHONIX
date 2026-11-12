import { chromium } from 'playwright'

const BASE_URL = process.env.SCREENSHOT_BASE_URL ?? 'http://127.0.0.1:5173/ARCHONIX/'

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } })
  page.on('pageerror', (err) => console.log('[pageerror]', err.stack ?? err.message))

  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 60000 })
  await page.evaluate(() => localStorage.clear())
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Max', exact: true }).click()
  await page.waitForTimeout(800)

  // 1) cria empresa de teste com e-mail
  await page.getByRole('button', { name: 'Configurações', exact: true }).click()
  await page.waitForTimeout(1000)
  await page.getByLabel('Nome / Razão social').fill('TESTE-EMPRESA-FRETE')
  await page.getByLabel('CEP', { exact: true }).fill('76800-000')
  await page.getByLabel('Município').fill('Porto Velho')
  // UF já vem "RO" por padrão (DEFAULT_EMPRESA.uf) — não precisa trocar pra esse teste
  await page.getByLabel('E-mail').fill('teste@empresafrete.com.br')
  await page.getByLabel('Senha pra salvar').fill('11994044')
  await page.getByRole('button', { name: 'Adicionar empresa' }).click()
  await page.waitForTimeout(1000)
  console.log('empresa criada')

  // 2) cria fornecedor de teste com cidade/estado/cep
  await page.getByRole('button', { name: 'Fornecedores', exact: true }).click()
  await page.waitForTimeout(1000)
  await page.getByLabel('Nome', { exact: true }).fill('TESTE-FORNECEDOR-FRETE')
  await page.getByLabel('CEP', { exact: true }).fill('01310-000')
  await page.getByLabel('Cidade', { exact: true }).fill('São Paulo')
  await page.getByRole('combobox', { name: 'Estado', exact: true }).selectOption('SP')
  await page.getByRole('button', { name: 'Adicionar fornecedor' }).click()
  await page.waitForTimeout(1000)
  console.log('fornecedor criado')

  // 3) cria cotação, define empresa destino e fornecedor do item
  await page.getByRole('button', { name: 'Cotações', exact: true }).click()
  await page.waitForTimeout(1000)
  await page.getByLabel('Vendedor').selectOption('EDSON')
  await page.getByLabel('Cliente').fill('TESTE-COTACAO-FRETE')
  await page.getByLabel('Máquina').fill('TESTE')
  await page.getByRole('button', { name: 'Criar cotação e registrar itens' }).click()
  await page.waitForTimeout(1500)

  // esse campo tem "hint", que o FieldWrapper bota dentro do mesmo <label> — o nome acessível
  // inclui o texto do hint junto, então nome exato não bate; usa o texto do rótulo em si
  const empresaSelect = page
    .locator('label')
    .filter({ has: page.locator('.field-label', { hasText: /^Empresa \(destinatário\)$/ }) })
    .locator('select')
  await empresaSelect.selectOption({ label: 'TESTE-EMPRESA-FRETE' })
  await page.waitForTimeout(300)
  const tabela = page.locator('table').filter({ has: page.locator('th', { hasText: 'Fornecedor' }) })
  await tabela.locator('tbody tr').nth(0).locator('input').nth(4).fill('TESTE-FORNECEDOR-FRETE')
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Salvar cotação' }).click()
  await page.waitForTimeout(1200)
  console.log('cotação salva com empresa e fornecedor definidos')

  // 4) vai pra Frete com essa cotação
  await page.getByRole('button', { name: 'Ir para Frete' }).click()
  await page.waitForTimeout(1500)
  const fornecedorSelect = page
    .locator('label')
    .filter({ has: page.locator('.field-label', { hasText: /^Fornecedor \(remetente\)$/ }) })
    .locator('select')
  await fornecedorSelect.selectOption({ label: 'TESTE-FORNECEDOR-FRETE' })
  await page.waitForTimeout(500)

  // abre o formulario da VAPTLOG
  const cardVaptlog = page.locator('.card', { has: page.locator('h3', { hasText: 'VAPTLOG' }) })
  await cardVaptlog.getByRole('button', { name: 'Gerar dados de pedido de frete' }).click()
  await page.waitForTimeout(500)

  const cepOrigemVal = await cardVaptlog.getByLabel('CEP de origem').inputValue()
  const cidadeOrigemVal = await cardVaptlog.getByLabel('Cidade origem').inputValue()
  const emailVal = await cardVaptlog.getByLabel('E-mail').inputValue()
  console.log('VAPTLOG CEP de origem (esperado 01310-000):', cepOrigemVal)
  console.log('VAPTLOG Cidade origem (esperado "São Paulo / SP"):', cidadeOrigemVal)
  console.log('VAPTLOG E-mail (esperado teste@empresafrete.com.br):', emailVal)

  await page.screenshot({ path: 'scripts/screenshots/frete-vaptlog.png', fullPage: true })

  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
