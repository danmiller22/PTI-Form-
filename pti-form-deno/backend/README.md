# PTI Relay (Deno Deploy)

Env:
- TELEGRAM_BOT_TOKEN
- TELEGRAM_CHAT_ID
- TELEGRAM_THREAD_ID (optional)
- GROUP_DELAY_MS (optional, default 1500)

POST /relay/summary  -> sendMessage with Markdown
POST /relay/group    -> sendMediaGroup up to 10 photos (base64 JSON -> multipart)

No storage.
