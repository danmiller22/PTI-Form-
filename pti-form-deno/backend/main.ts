const BOT = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID')!
const THREAD_ID = Deno.env.get('TELEGRAM_THREAD_ID')
const DELAY = Number(Deno.env.get('GROUP_DELAY_MS') ?? '1500')
const API = `https://api.telegram.org/bot${BOT}`

if (!BOT || !CHAT_ID) {
  throw new Error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID')
}

type Summary = {
  driver: { firstName: string, lastName: string },
  unit: { truck: string, trailer: string },
  comment?: string,
  time: { human: string, iso: string, tz: string },
  location?: { lat?: number, lon?: number, accuracy?: number, text?: string, method?: string }
}

type GroupPayload = {
  unit: { truck: string, trailer: string },
  index: number,
  total: number,
  media: { filename: string, mime: string, data: string }[]
}

async function sendMessage(text: string) {
  const body: Record<string, unknown> = { chat_id: CHAT_ID, text, parse_mode: 'Markdown' }
  if (THREAD_ID) body.message_thread_id = Number(THREAD_ID)
  const r = await fetch(`${API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!r.ok) {
    const t = await r.text()
    throw new Error('sendMessage failed: ' + t)
  }
  return await r.json()
}

function toFormDataForMediaGroup(media: GroupPayload['media'], captionPrefix: string) {
  const fd = new FormData()
  const inputs = media.map((m, i) => {
    const name = `file${i+1}`
    const bin = Uint8Array.from(atob(m.data), c => c.charCodeAt(0))
    const file = new File([bin], m.filename || name, { type: m.mime || 'image/webp' })
    fd.append(name, file)
    const obj: any = {
      type: 'photo',
      media: `attach://${name}`,
      caption: `${captionPrefix} #${i+1}`
    }
    return obj
  })
  fd.append('chat_id', CHAT_ID)
  if (THREAD_ID) fd.append('message_thread_id', String(THREAD_ID))
  fd.append('media', JSON.stringify(inputs))
  return fd
}

async function sendMediaGroup(payload: GroupPayload) {
  const prefix = `(${payload.index}/${payload.total}) ${payload.unit.truck}/${payload.unit.trailer}`
  const fd = toFormDataForMediaGroup(payload.media, prefix)
  const r = await fetch(`${API}/sendMediaGroup`, { method: 'POST', body: fd })
  if (!r.ok) {
    const t = await r.text()
    throw new Error('sendMediaGroup failed: ' + t)
  }
  return await r.json()
}

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' } })
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url)
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }})
    }

    if (req.method === 'POST' && url.pathname === '/relay/summary') {
      const body = await req.json() as Summary
      const lines = [
        `*PTI*`,
        `Driver: ${body.driver.firstName} ${body.driver.lastName}`,
        `Unit: ${body.unit.truck} / ${body.unit.trailer}`,
        `Time: ${body.time.human}`,
      ]
      if (body.location) {
        const { lat, lon, text, method } = body.location
        const locStr = lat && lon ? `${lat.toFixed(5)}, ${lon.toFixed(5)}` : (text || 'n/a')
        lines.push(`Location: ${locStr}${method ? ' (' + method + ')' : ''}`)
      }
      if (body.comment) lines.push(`Comment: ${body.comment}`)
      await sendMessage(lines.join('\n'))
      return new Response('ok', { status: 200, headers: { 'Access-Control-Allow-Origin': '*' } })
    }

    if (req.method === 'POST' && url.pathname === '/relay/group') {
      const gp = await req.json() as GroupPayload
      const res = await sendMediaGroup(gp)
      await new Promise(r => setTimeout(r, DELAY))
      return json(200, { ok: true, result: res })
    }

    return json(404, { error: 'not found' })
  } catch (e) {
    return json(500, { error: String(e) })
  }
})
