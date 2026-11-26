// Supabase Edge Function: auto-whatsapp-alerts
// ترسل تنبيهات الواتساب تلقائياً عبر Meta WhatsApp Cloud API بدون تدخل بشري
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function todayBaghdad(): string {
  // توقيت بغداد UTC+3
  const now = new Date(Date.now() + 3 * 3600 * 1000);
  return now.toISOString().slice(0, 10);
}

function dayDiff(fromDate: string, toDate: string): number {
  const a = new Date(String(fromDate).slice(0, 10) + 'T00:00:00Z').getTime();
  const b = new Date(String(toDate).slice(0, 10) + 'T00:00:00Z').getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 999;
  return Math.round((b - a) / 86400000);
}

function toIntlPhone(phone: string): string {
  let d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('07') && d.length === 11) d = '964' + d.slice(1);
  else if (d.startsWith('7') && d.length === 10) d = '964' + d;
  return /^9647\d{9}$/.test(d) ? d : '';
}

async function sendMetaWhatsApp(params: {
  token: string;
  phoneNumberId: string;
  to: string;
  templateName: string;
  lang: string;
  variables: string[];
  fallbackText: string;
  useTextMode: boolean;
}) {
  const url = `https://graph.facebook.com/v21.0/${params.phoneNumberId}/messages`;
  const body = params.useTextMode
    ? {
        messaging_product: 'whatsapp',
        to: params.to,
        type: 'text',
        text: { body: params.fallbackText }
      }
    : {
        messaging_product: 'whatsapp',
        to: params.to,
        type: 'template',
        template: {
          name: params.templateName,
          language: { code: params.lang },
          components: [
            {
              type: 'body',
              parameters: params.variables.map(v => ({ type: 'text', text: String(v || '-') }))
            }
          ]
        }
      };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `Meta API HTTP ${res.status}`);
  }
  return data;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const waToken = Deno.env.get('WHATSAPP_TOKEN') || '';
    const waPhoneId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') || '';
    const cronSecret = Deno.env.get('CRON_SECRET') || '';

    const tplSoon = Deno.env.get('WA_TEMPLATE_SOON') || 'gym_sub_soon';
    const tplExpired = Deno.env.get('WA_TEMPLATE_EXPIRED') || 'gym_sub_expired';
    const tplLang = Deno.env.get('WA_TEMPLATE_LANG') || 'ar';
    const useTextMode = Deno.env.get('WA_USE_TEXT') === 'true';

    const payload = await req.json().catch(() => ({}));
    const gymId = String(payload.gym_id || Deno.env.get('DEFAULT_GYM_ID') || 'powergym-main');
    const dryRun = Boolean(payload.dryRun);
    const reqSecret = req.headers.get('x-cron-secret') || '';

    const supabase = createClient(supabaseUrl, serviceKey);

    // التحقق من الصلاحية: إما CRON_SECRET أو syncSecret الخاص بالقاعة
    let authorized = Boolean(cronSecret && reqSecret === cronSecret);
    if (!authorized && payload.sync_secret) {
      const { data: accessRow } = await supabase
        .from('gym_access')
        .select('secret')
        .eq('gym_id', gymId)
        .maybeSingle();
      if (accessRow && accessRow.secret === String(payload.sync_secret)) {
        authorized = true;
      }
    }
    if (!authorized) {
      return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!dryRun && (!waToken || !waPhoneId)) {
      return new Response(JSON.stringify({ ok: false, error: 'missing_whatsapp_env' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // قراءة بيانات القاعة من gym_sync
    const { data: rows, error: fetchErr } = await supabase
      .from('gym_sync')
      .select('storage_key, payload')
      .eq('gym_id', gymId)
      .in('storage_key', ['power_gym_players_v1', 'power_gym_profile_v2', 'pg_freezes_v1', 'pg_whatsapp_sent_v1']);

    if (fetchErr) throw fetchErr;

    const map: Record<string, string> = {};
    (rows || []).forEach(r => { map[r.storage_key] = r.payload; });

    const players = JSON.parse(map['power_gym_players_v1'] || '[]');
    const profile = JSON.parse(map['power_gym_profile_v2'] || '{}');
    const freezes = JSON.parse(map['pg_freezes_v1'] || '[]');
    const sentLog = JSON.parse(map['pg_whatsapp_sent_v1'] || '{}');

    const gymName = String(profile.gymName || 'Power Gym');
    const today = todayBaghdad();
    const frozenIds = new Set(
      (Array.isArray(freezes) ? freezes : [])
        .filter((f: any) => !f.endedAt)
        .map((f: any) => String(f.playerId))
    );

    const results: any[] = [];
    let sentCount = 0;
    let failedCount = 0;

    for (const p of Array.isArray(players) ? players : []) {
      if (!p || !p.endDate || frozenIds.has(String(p.id))) continue;
      const intl = toIntlPhone(p.phone);
      if (!intl) continue;

      const left = dayDiff(today, p.endDate);
      let kind: 'soon' | 'expired' | null = null;
      if (left >= 0 && left <= 3) kind = 'soon';
      else if (left < 0 && left >= -7) kind = 'expired'; // المنتهين خلال آخر 7 أيام فقط
      if (!kind) continue;

      const logKey = `${kind}_${p.id}`;
      if (sentLog[logKey] && sentLog[logKey].date === today) continue;

      const templateName = kind === 'soon' ? tplSoon : tplExpired;
      const vars = kind === 'soon'
        ? [p.name || 'كابتن', gymName, p.endDate, String(left)]
        : [p.name || 'كابتن', gymName, p.endDate];

      const fallbackText = kind === 'soon'
        ? `السلام عليكم كابتن ${p.name}، نذكرك بأن اشتراكك في ${gymName} ينتهي بتاريخ ${p.endDate} (باقي ${left} يوم).`
        : `السلام عليكم كابتن ${p.name}، انتهى اشتراكك في ${gymName} بتاريخ ${p.endDate}. بانتظارك للتجديد!`;

      if (dryRun) {
        results.push({ id: p.id, name: p.name, phone: intl, kind, endDate: p.endDate, status: 'would_send' });
        continue;
      }

      try {
        await sendMetaWhatsApp({
          token: waToken,
          phoneNumberId: waPhoneId,
          to: intl,
          templateName,
          lang: tplLang,
          variables: vars,
          fallbackText,
          useTextMode
        });
        sentLog[logKey] = { date: today, by: 'النظام التلقائي (Meta)' };
        sentCount++;
        results.push({ id: p.id, name: p.name, phone: intl, kind, status: 'sent' });
      } catch (e: any) {
        failedCount++;
        results.push({ id: p.id, name: p.name, phone: intl, kind, status: 'error', error: e.message });
      }
    }

    if (!dryRun && sentCount > 0) {
      await supabase.from('gym_sync').upsert({
        gym_id: gymId,
        storage_key: 'pg_whatsapp_sent_v1',
        payload: JSON.stringify(sentLog),
        updated_by: 'auto-whatsapp-cron',
        updated_at: new Date().toISOString()
      }, { onConflict: 'gym_id,storage_key' });
    }

    return new Response(JSON.stringify({
      ok: true,
      date: today,
      dryRun,
      sentCount,
      failedCount,
      results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: err?.message || 'unknown_error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
