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
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: 'scripts/screenshots/red-dot-zoom.png', clip: { x: 340, y: 580, width: 120, height: 120 } })

  // inspeciona o DOM naquela regiao
  const info = await page.evaluate(() => {
    const el = document.elementFromPoint(390, 641)
    if (!el) return null
    return {
      tag: el.tagName,
      className: el.className?.toString?.() ?? el.getAttribute?.('class'),
      outerHTML: el.outerHTML?.slice(0, 300),
      rect: el.getBoundingClientRect(),
    }
  })
  console.log(JSON.stringify(info, null, 2))
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
