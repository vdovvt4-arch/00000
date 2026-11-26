# دليل تفعيل الإرسال التلقائي للواتساب (24/7 بدون تدخل بشري)

تم تجهيز دالة السيرفر `supabase/functions/auto-whatsapp-alerts/index.ts` وملف الجدولة `supabase/auto-whatsapp-cron.sql`. اتبع هذه الخطوات لمرة واحدة فقط لتعمل المنظومة تلقائياً كل يوم:

---

## الخطوة 1: تجهيز Meta WhatsApp Cloud API
1. ادخل إلى **developers.facebook.com** وأنشئ تطبيقاً من نوع **Business** وأضف له منتج **WhatsApp**.
2. من **WhatsApp → API Setup**:
   - انسخ **Phone Number ID**.
   - أنشئ **Permanent System User Token** (من Business Settings → System Users) حتى لا ينتهي كل 24 ساعة.
3. من **WhatsApp Manager → Message Templates** أنشئ قالبين باللغة العربية (`ar`):
   - **القالب الأول اسمه `gym_sub_soon`**:
     `السلام عليكم كابتن {{1}}، نذكرك بأن اشتراكك في {{2}} ينتهي بتاريخ {{3}} (باقي {{4}} يوم). يسعدنا تجديدك للاستمرار معنا.`
   - **القالب الثاني اسمه `gym_sub_expired`**:
     `السلام عليكم كابتن {{1}}، اشتراكك في {{2}} انتهى بتاريخ {{3}}. بانتظارك في القاعة لتجديد الاشتراك!`

---

## الخطوة 2: رفع الدالة إلى Supabase
من جهازك (بعد تثبيت Supabase CLI أو من لوحة Supabase → Edge Functions):
```bash
supabase login
supabase link --project-ref bpwjdjkqcfxerizrssbs
supabase secrets set WHATSAPP_TOKEN="EAAxxxx..." WHATSAPP_PHONE_NUMBER_ID="123456789..." CRON_SECRET="pg_cron_2026_secret"
supabase functions deploy auto-whatsapp-alerts --no-verify-jwt
```

---

## الخطوة 3: تفعيل الجدولة اليومية (Cron)
1. افتح ملف `supabase/auto-whatsapp-cron.sql`.
2. استبدل `YOUR_CRON_SECRET` بنفس `CRON_SECRET` الذي وضعته في الخطوة 2.
3. الصق الكود في **Supabase → SQL Editor** واضغط **Run**.

بعدها سيعمل السيرفر يومياً الساعة **10:00 صباحاً بتوقيت بغداد** تلقائياً، ويفحص اللاعبين ويرسل لهم الرسائل عبر واتساب الرسمي ويسجل الإرسال في قاعدة البيانات حتى لا يتكرر!
يمكنك أيضاً اختبار الإرسال أو معاينة المستحقين مباشرة من داخل الموقع: **مركز إشعارات الواتساب ← الإرسال التلقائي (Meta API)**.
