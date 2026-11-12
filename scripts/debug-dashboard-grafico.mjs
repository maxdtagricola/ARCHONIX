import { chromium } from 'playwright'

const BASE_URL = process.env.SCREENSHOT_BASE_URL ?? 'http://127.0.0.1:5173/ARCHONIX/'

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } })
  page.on('pageerror', (err) => console.log('[pageerror]', err.stack ?? err.message))
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[console.error]', msg.text())
  })

  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 60000 })
  await page.evaluate(() => localStorage.clear())
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Max', exact: true }).click()
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click()
  await page.waitForTimeout(1500)

  await page.screenshot({ path: 'scripts/screenshots/dashboard-novo.png', fullPage: true })
  console.log('screenshot salvo')

  // também testa trocar o filtro de vendedor
  await page.getByLabel('Vendedor', { exact: true }).selectOption({ index: 1 })
  await page.waitForTimeout(800)
  await page.screenshot({ path: 'scripts/screenshots/dashboard-filtro-vendedor.png', fullPage: true })

  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
