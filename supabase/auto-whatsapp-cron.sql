-- =========================================================
-- تفعيل الجدولة التلقائية (Cron Job) لإرسال تنبيهات الواتساب يومياً
-- الصق هذا الكود في Supabase -> SQL Editor واضغط Run
-- =========================================================

-- 1. تفعيل الإضافات المطلوبة
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2. إزالة أي جدولة قديمة بنفس الاسم
select cron.unschedule('powergym-daily-whatsapp-alerts')
where exists (select 1 from cron.job where jobname = 'powergym-daily-whatsapp-alerts');

-- 3. جدولة الفحص والإرسال التلقائي يومياً الساعة 10:00 صباحاً بتوقيت بغداد (07:00 UTC)
-- استبدل YOUR_CRON_SECRET بنفس القيمة التي وضعتها في Supabase Secrets
select cron.schedule(
  'powergym-daily-whatsapp-alerts',
  '0 7 * * *',
  $$
  select net.http_post(
    url := 'https://bpwjdjkqcfxerizrssbs.supabase.co/functions/v1/auto-whatsapp-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'YOUR_CRON_SECRET'
    ),
    body := jsonb_build_object('gym_id', 'powergym-main')
  );
  $$
);
