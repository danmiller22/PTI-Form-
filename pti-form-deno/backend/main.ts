const BOT = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;
const THREAD_ID = Deno.env.get("TELEGRAM_THREAD_ID");
const DELAY = Number(Deno.env.get("GROUP_DELAY_MS") ?? "600"); // быстрее по умолчанию
const API = `https://api.telegram.org/bot${BOT}`;
if (!BOT || !CHAT_ID) throw new Error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID");

type Summary = {
  driver: { firstName: string; lastName: string };
  unit: { truck: string; trailer: string };
  comment?: string;
  time: { human: string; iso: string; tz: string };
  location?: { lat?: number; lon?: number; accuracy?: number; text?: string; method?: string };
};
type GroupPayload = {
  unit: { truck: string; trailer: string };
  index: number;
  total: number;
  media: { filename: string; mime: string; data: string }[];
};

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

async function sendMessage(text: string) {
  const body: Record<string, unknown> = { chat_id: CHAT_ID, text, parse_mode: "Markdown" };
  if (THREAD_ID) body.message_thread_id = Number(THREAD_ID);
  const r = await fetch(`${API}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(await r.text());
  return await r.json();
}

function toFormDataForMediaGroup(media: GroupPayload["media"], captionPrefix: string) {
  const fd = new FormData();
  const inputs = media.map((m, i) => {
    const name = `file${i + 1}`;
    const bin = Uint8Array.from(atob(m.data), (c) => c.charCodeAt(0));
    const file = new File([bin], m.filename || name, { type: m.mime || "image/webp" });
    fd.append(name, file);
    return { type: "photo", media: `attach://${name}`, caption: `${captionPrefix} #${i + 1}` };
  });
  fd.append("chat_id", CHAT_ID);
  if (THREAD_ID) fd.append("message_thread_id", String(THREAD_ID));
  fd.append("media", JSON.stringify(inputs));
  return fd;
}

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function sendMediaGroupOnce(payload: GroupPayload) {
  const prefix = `(${payload.index}/${payload.total}) ${payload.unit.truck}/${payload.unit.trailer}`;
  const fd = toFormDataForMediaGroup(payload.media, prefix);
  const r = await fetch(`${API}/sendMediaGroup`, { method: "POST", body: fd });
  const text = await r.text();
  let json: any; try { json = JSON.parse(text); } catch { json = { ok: r.ok, raw: text }; }
  return { ok: r.ok, status: r.status, json, raw: text };
}

async function sendMediaGroupRetry(payload: GroupPayload, maxAttempts = 5) {
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt++;
    const res = await sendMediaGroupOnce(payload);
    if (res.ok) return res.json;

    const retryAfter =
      (res.json?.parameters?.retry_after as number | undefined) ??
      (res.json?.retry_after as number | undefined);

    if (res.status === 429 && typeof retryAfter === "number") {
      await sleep(Math.ceil(retryAfter * 1000 * 1.15)); // адаптивно
      continue;
    }
    if (res.status === 400 && /Too Many Requests|retry_after/i.test(res.raw)) {
      const m = res.raw.match(/retry_after[^\d]*(\d+)/i);
      const wait = m ? Number(m[1]) : 5;
      await sleep(Math.ceil(wait * 1000 * 1.15));
      continue;
    }
    throw new Error(`sendMediaGroup failed: ${res.raw}`);
  }
  throw new Error("sendMediaGroup failed: max retry attempts reached");
}

function escapeMd(s: string) { return s.replace(/([_*`])/g, "\\$1"); }
function mapLink(lat: number, lon: number) { return `https://maps.google.com/?q=${lat},${lon}`; }

function buildSummaryMessage(b: Summary) {
  const L: string[] = [];
  L.push(`*PTI*  •  \`${escapeMd(b.unit.truck)}\` / \`${escapeMd(b.unit.trailer)}\``);
  L.push(`👤 ${escapeMd(b.driver.firstName)} ${escapeMd(b.driver.lastName)}  •  🕒 ${escapeMd(b.time.human)} (${b.time.tz})`);
  if (b.location?.lat != null && b.location?.lon != null) {
    const acc = typeof b.location.accuracy === "number" ? ` ±${Math.round(b.location.accuracy)}m` : "";
    L.push(`📍 [Map](${mapLink(b.location.lat, b.location.lon)}) \`${b.location.lat.toFixed(5)}, ${b.location.lon.toFixed(5)}${acc}\``);
  }
  if (b.comment) L.push(`— Notes: ${escapeMd(b.comment)}`);
  L.push(`— Photos: sides, *all tires*, lights, undercarriage, *registration + annuals* (truck & trailer), defects.`);
  return L.join('\n');
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (req.method === "POST" && url.pathname === "/relay/summary") {
      const body = (await req.json()) as Summary;
      await sendMessage(buildSummaryMessage(body));
      return new Response("ok", { status: 200, headers: { "Access-Control-Allow-Origin": "*" } });
    }

    if (req.method === "POST" && url.pathname === "/relay/group") {
      const gp = (await req.json()) as GroupPayload;
      const result = await sendMediaGroupRetry(gp, 5);
      await sleep(DELAY); // короткая пауза, 429 ловим ретраями
      return json(200, { ok: true, result });
    }

    return json(404, { error: "not found" });
  } catch (e) {
    return json(500, { error: String(e) });
  }
});
