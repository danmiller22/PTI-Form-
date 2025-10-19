export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export function sleep(ms: number) {
  return new Promise(res => setTimeout(res, ms))
}

export function toChicagoISO(date = new Date()) {
  const tz = 'America/Chicago'
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  })
  const parts = fmt.formatToParts(date)
  const get = (t: string) => parts.find(p => p.type === t)?.value || ''
  const [month, day, year] = [get('month'), get('day'), get('year')]
  const [hour, minute, second] = [get('hour'), get('minute'), get('second')]
  return { human: `${year}-${month}-${day} ${hour}:${minute}:${second} America/Chicago`, iso: new Date(date).toISOString(), tz }
}
