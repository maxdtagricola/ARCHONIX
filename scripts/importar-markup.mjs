import { chromium } from 'playwright'
import path from 'path'

const BASE_URL = process.env.SCREENSHOT_BASE_URL ?? 'http://127.0.0.1:5173/ARCHONIX/'
const SENHA = '11994044'
const DIR = 'C:/Users/madal/OneDrive/Desktop/Formacao_Preco_Geral/pricing-app'

const TODOS_ARQUIVOS = [
  { perfil: 'Rondônia', arquivo: path.join(DIR, 'Markup - Rondônia 5.0 (Atualizado 04-2026).xlsx') },
  { perfil: 'Acre', arquivo: path.join(DIR, 'Markup - Acre 5.0.xlsx') },
]
// roda um de cada vez — "node scripts/importar-markup.mjs RO" ou "AC"
const alvo = (process.argv[2] || '').toUpperCase()
const ARQUIVOS = alvo === 'RO'
  ? [TODOS_ARQUIVOS[0]]
  : alvo === 'AC'
    ? [TODOS_ARQUIVOS[1]]
    : TODOS_ARQUIVOS

async function importarUm(page, { perfil, arquivo }, indice) {
  console.log(`\n=== Importando ${perfil}: ${arquivo} ===`)

  await page.getByRole('button', { name: 'Configurações', exact: true }).click()
  await page.waitForTimeout(1000)

  const card = page.locator('.card', { hasText: 'Importar planilha de markup' })
  await card.scrollIntoViewIfNeeded()
  await card.getByLabel('Habilitar importação de planilha').check()
  await card.getByLabel('Perfil (estado de destino)').selectOption({ label: perfil })
  await card.getByLabel('Senha').fill(SENHA)
  await card.getByLabel('Arquivo (.xlsx)').setInputFiles(arquivo)
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `scripts/screenshots/markup-import-${indice}-previa.png`, fullPage: true })

  await card.getByRole('button', { name: 'Sim, é essa mesmo' }).click()
  await page.waitForTimeout(500)
  await card.getByRole('button', { name: 'Importar (só leitura)' }).click()
  await page.waitForTimeout(1000)
  await page.screenshot({ path: `scripts/screenshots/markup-import-${indice}-pendente.png`, fullPage: true })

  const textoPendente = await card.locator('text=NCMs na tabela RBC').textContent()
  console.log('Resumo lido:', textoPendente)

  await card.locator('input[placeholder="Senha"]').fill(SENHA)
  await card.getByRole('button', { name: 'Salvar nova planilha' }).click()
  await page.waitForTimeout(2000)
  await page.screenshot({ path: `scripts/screenshots/markup-import-${indice}-salvo.png`, fullPage: true })
}

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } })
  page.on('pageerror', (err) => console.log('[pageerror]', err.stack ?? err.message))
  page.on('dialog', async (dialog) => {
    console.log('[dialog]', dialog.message())
    await dialog.accept()
  })

  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 60000 })
  await page.evaluate(() => localStorage.clear())
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Max', exact: true }).click()
  await page.waitForTimeout(1000)

  for (let i = 0; i < ARQUIVOS.length; i++) {
    await importarUm(page, ARQUIVOS[i], i + 1)
  }

  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
