import { chromium } from 'playwright'
const BASE_URL = process.env.SCREENSHOT_BASE_URL ?? 'http://127.0.0.1:5173/ARCHONIX/'
async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } })
  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 60000 })
  await page.evaluate(() => localStorage.clear())
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Max', exact: true }).click()
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: 'Fornecedores', exact: true }).click()
  await page.waitForTimeout(1500)

  const labels = await page.evaluate(() =>
    Array.from(document.querySelectorAll('label')).map((l) => ({
      text: l.querySelector('.field-label')?.textContent ?? l.textContent?.slice(0, 40),
      hasSelect: !!l.querySelector('select'),
    })),
  )
  console.log(JSON.stringify(labels, null, 2))
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
