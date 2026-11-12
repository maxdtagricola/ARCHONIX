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
  await page.waitForTimeout(1000)

  const loc = page.getByLabel('Estado', { exact: true })
  console.log('count:', await loc.count())
  const box = await loc.boundingBox()
  console.log('boundingBox:', JSON.stringify(box))
  const elAtPoint = await page.evaluate(({x,y}) => {
    const el = document.elementFromPoint(x, y)
    return el ? { tag: el.tagName, id: el.id, class: el.className } : null
  }, { x: box.x + box.width/2, y: box.y + box.height/2 })
  console.log('elemento no centro do select:', JSON.stringify(elAtPoint))

  try {
    await loc.selectOption('SP', { timeout: 5000 })
    console.log('selectOption OK')
  } catch (e) {
    console.log('selectOption falhou:', e.message.split('\n')[0])
  }
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
