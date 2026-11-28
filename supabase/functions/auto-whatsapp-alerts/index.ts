// Supabase Edge Function: auto-whatsapp-alerts (v4.0 — Reads Normalized Relational Tables)
// ترسل تنبيهات الواتساب تلقائياً عبر Meta WhatsApp Cloud API بدون تدخل بشري
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function todayBaghdad(): string {
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
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
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
    const authHeader = req.headers.get('Authorization') || '';

    const adminClient = createClient(supabaseUrl, serviceKey);

    // التحقق من الصلاحية: إما CRON_SECRET من pg_cron أو جلسة مستخدم موثق ينتمي للقاعة عبر Google/Supabase Auth
    let authorized = Boolean(cronSecret && reqSecret === cronSecret);
    if (!authorized && authHeader.startsWith('Bearer ') && anonKey) {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } }
      });
      const { data: userData } = await userClient.auth.getUser();
      if (userData?.user?.id) {
        const { data: mem } = await adminClient
          .from('pg_gym_memberships')
          .select('role')
          .eq('gym_id', gymId)
          .eq('user_id', userData.user.id)
          .eq('is_active', true)
          .maybeSingle();
        if (mem) authorized = true;
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

    // قراءة البيانات من الجداول العلائقية المهيكلة الجديدة
    const [{ data: gymRow }, { data: members }, { data: freezes }, { data: sentRows }] = await Promise.all([
      adminClient.from('pg_gyms').select('gym_name').eq('gym_id', gymId).maybeSingle(),
      adminClient.from('pg_members').select('id, name, phone, end_date').eq('gym_id', gymId).is('deleted_at', null),
      adminClient.from('pg_member_freezes').select('member_id').eq('gym_id', gymId).is('ended_at', null),
      adminClient.from('pg_whatsapp_logs').select('log_key, sent_date').eq('gym_id', gymId)
    ]);

    const gymName = String(gymRow?.gym_name || 'Power Gym');
    const today = todayBaghdad();
    const frozenIds = new Set((freezes || []).map((f: any) => String(f.member_id)));
    const sentTodaySet = new Set(
      (sentRows || [])
        .filter((s: any) => String(s.sent_date).slice(0, 10) === today)
        .map((s: any) => String(s.log_key))
    );

    const results: any[] = [];
    const newLogs: any[] = [];
    let sentCount = 0;
    let failedCount = 0;

    for (const p of members || []) {
      if (!p || !p.end_date || frozenIds.has(String(p.id))) continue;
      const intl = toIntlPhone(p.phone);
      if (!intl) continue;

      const endDate = String(p.end_date).slice(0, 10);
      const left = dayDiff(today, endDate);
      let kind: 'soon' | 'expired' | null = null;
      if (left >= 0 && left <= 3) kind = 'soon';
      else if (left < 0 && left >= -7) kind = 'expired';
      if (!kind) continue;

      const logKey = `${kind}_${p.id}`;
      if (sentTodaySet.has(logKey)) continue;

      const templateName = kind === 'soon' ? tplSoon : tplExpired;
      const vars = kind === 'soon'
        ? [p.name || 'كابتن', gymName, endDate, String(left)]
        : [p.name || 'كابتن', gymName, endDate];

      const fallbackText = kind === 'soon'
        ? `السلام عليكم كابتن ${p.name}، نذكرك بأن اشتراكك في ${gymName} ينتهي بتاريخ ${endDate} (باقي ${left} يوم).`
        : `السلام عليكم كابتن ${p.name}، انتهى اشتراكك في ${gymName} بتاريخ ${endDate}. بانتظارك للتجديد!`;

      if (dryRun) {
        results.push({ id: p.id, name: p.name, phone: intl, kind, endDate, status: 'would_send' });
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
        newLogs.push({
          gym_id: gymId,
          log_key: logKey,
          sent_date: today,
          sent_by: 'النظام التلقائي (Meta)',
          updated_at: new Date().toISOString()
        });
        sentCount++;
        results.push({ id: p.id, name: p.name, phone: intl, kind, status: 'sent' });
      } catch (e: any) {
        failedCount++;
        results.push({ id: p.id, name: p.name, phone: intl, kind, status: 'error', error: e.message });
      }
    }

    if (!dryRun && newLogs.length > 0) {
      await adminClient.from('pg_whatsapp_logs').upsert(newLogs, { onConflict: 'gym_id,log_key' });
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
