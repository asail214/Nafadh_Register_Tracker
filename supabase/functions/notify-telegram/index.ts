// DRAFT — not deployed. See docs/TELEGRAM_PLAN.md. Runs on Supabase Edge Functions (Deno).
// Triggered by a Database Webhook on INSERT into status_updates / tickets.
// Sends no names, emails or descriptions to Telegram — only type, reference and category.

const KIND: Record<string, string> = { issue: 'مشكلة', suggestion: 'اقتراح' };

Deno.serve(async (req) => {
  if (req.headers.get('x-webhook-secret') !== Deno.env.get('WEBHOOK_SECRET')) {
    return new Response('forbidden', { status: 403 });
  }
  const { table, record } = await req.json();
  const time = new Date(record.created_at).toLocaleString('ar-OM-u-nu-latn', { timeZone: 'Asia/Muscat' });
  const text =
    table === 'tickets'
      ? `📩 ${KIND[record.kind] ?? 'بلاغ'} جديد NF-${String(record.id).padStart(4, '0')}` +
        (record.category ? ` — التصنيف: ${record.category}` : '') +
        (record.blocking ? ' — يمنع الإكمال' : '') +
        `\n${time}`
      : `🔄 تحديث حالة حساب جديد (S-${record.id})\n${time}`;

  const res = await fetch(`https://api.telegram.org/bot${Deno.env.get('TELEGRAM_BOT_TOKEN')}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: Deno.env.get('TELEGRAM_CHAT_ID'), text }),
  });
  return new Response(res.ok ? 'ok' : 'telegram_error', { status: res.ok ? 200 : 502 });
});
