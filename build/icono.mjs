// Genera el ícono de Nautilus desde el Escudo (resources/logo.png, fondo transparente).
// Escribe build/icon.ico (16 a 256 px, entradas PNG) y build/icon.png (512 px).
// Uso: npm run icon
import { app, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const SIZES = [16, 24, 32, 48, 64, 128, 256]
const logo = 'data:image/png;base64,' + readFileSync(join(here, '../resources/logo.png')).toString('base64')

function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(pngs.length, 4)
  let offset = head.length
  pngs.forEach(([size, data], i) => {
    const e = 6 + 16 * i
    head.writeUInt8(size % 256, e)
    head.writeUInt8(size % 256, e + 1)
    head.writeUInt16LE(1, e + 4)
    head.writeUInt16LE(32, e + 6)
    head.writeUInt32LE(data.length, e + 8)
    head.writeUInt32LE(offset, e + 12)
    offset += data.length
  })
  return Buffer.concat([head, ...pngs.map(([, d]) => d)])
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false })
  await win.loadURL('about:blank')
  const render = (size) =>
    win.webContents.executeJavaScript(`new Promise((ok) => {
      const img = new Image()
      img.onload = () => {
        const c = document.createElement('canvas')
        c.width = c.height = ${size}
        const g = c.getContext('2d')
        g.imageSmoothingQuality = 'high'
        g.drawImage(img, 0, 0, ${size}, ${size})
        ok(c.toDataURL('image/png'))
      }
      img.src = ${JSON.stringify(logo)}
    })`)
  const png = async (size) => Buffer.from((await render(size)).split(',')[1], 'base64')
  const pngs = []
  for (const s of SIZES) pngs.push([s, await png(s)])
  writeFileSync(join(here, 'icon.ico'), ico(pngs))
  writeFileSync(join(here, 'icon.png'), await png(512))
  console.log('icon.ico', SIZES.join(','), '+ icon.png 512')
  app.quit()
})
