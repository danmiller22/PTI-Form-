self.onmessage = async (e) => {
  const { file, maxW = 1920, maxH = 1920, quality = 0.72 } = e.data
  const blob = file
  const imgBitmap = await createImageBitmap(blob)
  const ratio = Math.min(maxW / imgBitmap.width, maxH / imgBitmap.height, 1)
  const w = Math.round(imgBitmap.width * ratio)
  const h = Math.round(imgBitmap.height * ratio)
  const off = new OffscreenCanvas(w, h)
  const ctx = off.getContext('2d')
  ctx.drawImage(imgBitmap, 0, 0, w, h)
  const webp = await off.convertToBlob({ type: 'image/webp', quality })
  const arrBuf = await webp.arrayBuffer()
  const base64 = btoa(String.fromCharCode(...new Uint8Array(arrBuf)))
  postMessage({ base64, bytes: webp.size, w, h, mime: 'image/webp' })
}
