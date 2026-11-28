/* =========================================================
   js/auth.js — Supabase Auth (Google OAuth + Email/Password)
   + Protected Routes Gate + Gym Ownership & Staff Invite Onboarding
   ========================================================= */
(function () {
  'use strict';

  const SUPABASE_URL = 'https://bpwjdjkqcfxerizrssbs.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_GwS8ghvuEC6cCFb4GJ0j5Q_NBpXAgKO';
  const DEFAULT_GYM_ID = 'powergym-main';
  const MEMBERSHIP_CACHE_KEY = 'pg_auth_membership_v2';
  const PENDING_INVITE_KEY = 'pg_pending_invite_token_v1';

  const isCoachMode = new URLSearchParams(window.location.search).get('pgCoach') === '1';

  // حفظ رمز الدعوة من الرابط قبل التوجيه إلى Google OAuth
  (function captureInviteFromUrl() {
    const sp = new URLSearchParams(window.location.search);
    const inv = sp.get('pgInvite');
    if (inv && /^inv_[a-zA-Z0-9]+$/.test(inv)) {
      try { sessionStorage.setItem(PENDING_INVITE_KEY, inv); } catch { /* ignore */ }
      sp.delete('pgInvite');
      const cleanSearch = sp.toString();
      const nextUrl = window.location.pathname + (cleanSearch ? '?' + cleanSearch : '') + window.location.hash;
      window.history.replaceState({}, '', nextUrl);
    }
  })();

  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    console.error('Supabase JS SDK is not loaded.');
    return;
  }

  const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'pg_supabase_auth_token_v2'
    }
  });

  window.pgSupabase = supabaseClient;
  window.PG_SUPABASE_CONFIG = Object.freeze({
    url: SUPABASE_URL,
    publishableKey: SUPABASE_PUBLISHABLE_KEY,
    defaultGymId: DEFAULT_GYM_ID
  });

  let currentUser = null;
  let currentMembership = null;
  let authMode = 'signin'; // 'signin' | 'signup'
  let authChecking = false;

  function esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function readCachedMembership() {
    try {
      const raw = localStorage.getItem(MEMBERSHIP_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function writeCachedMembership(mem) {
    try {
      if (mem) localStorage.setItem(MEMBERSHIP_CACHE_KEY, JSON.stringify(mem));
      else localStorage.removeItem(MEMBERSHIP_CACHE_KEY);
    } catch { /* ignore */ }
  }

  function setAppProtectedLock(locked) {
    if (isCoachMode) return;
    document.documentElement.classList.toggle('pg-auth-locked', Boolean(locked));
    const gate = document.getElementById('pgAuthGate');
    if (gate) {
      gate.classList.toggle('hidden', !locked);
    }
  }

  function ensureAuthGateDom() {
    if (isCoachMode || document.getElementById('pgAuthGate')) return;
    const gate = document.createElement('div');
    gate.id = 'pgAuthGate';
    gate.className = 'fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-[#060609] p-4';
    gate.innerHTML = `
      <div class="pointer-events-none fixed inset-0 opacity-50" style="background: radial-gradient(circle at 50% 22%, rgba(245, 158, 11, 0.18), transparent 55%), radial-gradient(circle at 18% 85%, rgba(16, 185, 129, 0.10), transparent 50%);"></div>
      <div id="pgAuthGateCard" class="relative w-full max-w-md rounded-3xl border border-amber-500/30 bg-zinc-950/95 p-6 sm:p-7 shadow-[0_28px_90px_rgba(0,0,0,0.85)] backdrop-blur-xl"></div>
    `;
    document.body.appendChild(gate);
  }

  function renderAuthGateLogin(errorMsg = '') {
    ensureAuthGateDom();
    setAppProtectedLock(true);
    const card = document.getElementById('pgAuthGateCard');
    if (!card) return;

    const pendingInvite = (() => {
      try { return sessionStorage.getItem(PENDING_INVITE_KEY) || ''; } catch { return ''; }
    })();

    card.innerHTML = `
      <div class="text-center mb-5">
        <div class="mx-auto mb-3 flex h-20 w-20 items-center justify-center rounded-2xl border-2 border-amber-400/60 bg-zinc-900 p-2 shadow-xl">
          <img src="logo.svg" alt="Power Gym" class="h-full w-full object-contain">
        </div>
        <span class="inline-flex items-center gap-1.5 rounded-full border border-amber-400/35 bg-amber-500/15 px-3 py-0.5 text-[11px] font-black text-amber-300">
          <i class="fa-solid fa-shield-halved"></i> بوابة الإدارة المحمية
        </span>
        <h2 class="mt-2 text-2xl font-black text-white">Power Gym <span class="text-amber-400">| بور جم</span></h2>
        <p class="mt-1 text-xs font-semibold text-zinc-400">سجّل دخولك بحساب Google للوصول إلى قاعدة البيانات السحابية وإدارة القاعة</p>
        ${pendingInvite ? `<p class="mt-2 rounded-xl border border-emerald-500/35 bg-emerald-950/30 px-3 py-1.5 text-[11px] font-bold text-emerald-300">✨ تم اكتشاف دعوة إشراف جاهزة للتفعيل فور تسجيل الدخول</p>` : ''}
      </div>

      ${errorMsg ? `<div id="pgAuthErrorBox" class="mb-4 rounded-2xl border border-rose-500/40 bg-rose-950/30 p-3 text-xs font-bold text-rose-200 text-right">${esc(errorMsg)}</div>` : '<div id="pgAuthErrorBox" class="hidden mb-4"></div>'}

      <button type="button" id="pgGoogleSignInBtn" onclick="pgSignInWithGoogle()" class="flex w-full items-center justify-center gap-3 rounded-2xl bg-white hover:bg-zinc-100 px-4 py-3.5 text-sm font-black text-zinc-900 shadow-lg transition">
        <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
          <path fill="#FF3D00" d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
          <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
          <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>
        </svg>
        <span>المتابعة باستخدام حساب Google</span>
      </button>

      <div class="my-4 flex items-center gap-3 text-[11px] font-bold text-zinc-500">
        <div class="h-px flex-1 bg-zinc-800"></div>
        <span>أو عبر البريد الإلكتروني</span>
        <div class="h-px flex-1 bg-zinc-800"></div>
      </div>

      <form onsubmit="pgSubmitEmailAuth(event)" class="space-y-3">
        <div>
          <label class="mb-1 block text-[11px] font-bold text-zinc-300">البريد الإلكتروني</label>
          <input id="pgAuthEmail" type="email" required autocomplete="email" dir="ltr" placeholder="captain@example.com" class="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3.5 py-2.5 text-xs text-white focus:border-amber-400 focus:outline-none">
        </div>
        <div>
          <label class="mb-1 block text-[11px] font-bold text-zinc-300">كلمة المرور</label>
          <input id="pgAuthPassword" type="password" required minlength="6" autocomplete="current-password" dir="ltr" placeholder="••••••••" class="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3.5 py-2.5 text-xs text-white focus:border-amber-400 focus:outline-none">
        </div>
        <button type="submit" id="pgEmailSubmitBtn" class="w-full gold-gradient rounded-xl py-3 text-xs font-black">
          ${authMode === 'signup' ? 'إنشاء حساب جديد والدخول' : 'تسجيل الدخول بالبريد'}
        </button>
      </form>

      <div class="mt-4 flex items-center justify-between text-[11px] font-bold text-zinc-400">
        <button type="button" onclick="pgToggleEmailAuthMode()" class="text-amber-400 hover:underline">
          ${authMode === 'signup' ? 'لديك حساب بالفعل؟ تسجيل الدخول' : 'ليس لديك حساب؟ إنشاء حساب جديد'}
        </button>
        <a href="store.html" class="text-emerald-400 hover:underline flex items-center gap-1">
          <i class="fa-solid fa-store"></i> تصفح المتجر
        </a>
      </div>
    `;
  }

  function renderInviteRequiredGate(email, errorMsg = '') {
    ensureAuthGateDom();
    setAppProtectedLock(true);
    const card = document.getElementById('pgAuthGateCard');
    if (!card) return;

    card.innerHTML = `
      <div class="text-center space-y-2 mb-5">
        <div class="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/15 border border-amber-400/40 text-amber-400 text-2xl">
          <i class="fa-solid fa-user-lock"></i>
        </div>
        <h2 class="text-xl font-black text-white">الحساب بحاجة إلى دعوة مشرف</h2>
        <p class="text-xs text-zinc-400 leading-6">
          تم تسجيل الدخول بالحساب <strong class="text-amber-300" dir="ltr">${esc(email)}</strong>، لكن هذه القاعة مملوكة لمدير آخر. أدخل كود الدعوة المرسل من الكابتن للانضمام.
        </p>
      </div>

      ${errorMsg ? `<div class="mb-3 rounded-xl border border-rose-500/40 bg-rose-950/30 p-3 text-xs font-bold text-rose-200">${esc(errorMsg)}</div>` : ''}

      <form onsubmit="pgRedeemManualInvite(event)" class="space-y-3">
        <input id="pgInviteCodeInput" required dir="ltr" placeholder="inv_xxxxxxxxxxxxxxxx" class="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-2.5 text-center text-xs font-bold text-white focus:border-amber-400 focus:outline-none">
        <button type="submit" class="w-full gold-gradient rounded-xl py-3 text-xs font-black">تفعيل الدعوة والدخول</button>
      </form>

      <button type="button" onclick="pgSignOut()" class="mt-3 w-full rounded-xl bg-zinc-900 border border-zinc-800 py-2.5 text-xs font-bold text-rose-300 hover:bg-zinc-800">
        تسجيل الخروج وتبديل الحساب
      </button>
    `;
  }

  function renderAccountBadgeInSidebar() {
    if (!currentUser || !currentMembership) return;
    const header = document.getElementById('sidebarBrandHeader');
    if (!header) return;

    let box = document.getElementById('pgAuthAccountCard');
    if (!box) {
      box = document.createElement('div');
      box.id = 'pgAuthAccountCard';
      box.className = 'mt-3 rounded-2xl border border-zinc-800 bg-zinc-900/90 p-2.5';
      header.appendChild(box);
    }

    const roleLabels = {
      owner: ['المالك (مدير عام)', 'text-amber-300 bg-amber-500/15 border-amber-500/35'],
      captain: ['كابتن مدير', 'text-sky-300 bg-sky-500/15 border-sky-500/35'],
      supervisor: ['مشرف القاعة', 'text-emerald-300 bg-emerald-500/15 border-emerald-500/35']
    };
    const [rText, rCls] = roleLabels[currentMembership.role] || roleLabels.supervisor;
    const avatar = currentMembership.avatar_url || currentUser.user_metadata?.avatar_url || currentUser.user_metadata?.picture || '';
    const dispName = currentMembership.display_name || currentUser.user_metadata?.full_name || currentUser.email || 'الكابتن';

    box.innerHTML = `
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 min-w-0">
          ${avatar
            ? `<img src="${esc(avatar)}" alt="" referrerpolicy="no-referrer" class="h-8 w-8 rounded-xl object-cover border border-amber-400/40 shrink-0">`
            : `<div class="h-8 w-8 rounded-xl bg-amber-500/20 text-amber-300 flex items-center justify-center text-xs font-black shrink-0"><i class="fa-solid fa-user-check"></i></div>`
          }
          <div class="min-w-0">
            <p class="truncate text-xs font-black text-white">${esc(dispName)}</p>
            <p class="truncate text-[10px] text-zinc-400" dir="ltr">${esc(currentUser.email || '')}</p>
          </div>
        </div>
        <button type="button" onclick="pgSignOut()" title="تسجيل الخروج" class="rounded-lg bg-zinc-800 hover:bg-rose-950/70 px-2 py-1.5 text-[10px] font-bold text-rose-300 transition shrink-0">
          <i class="fa-solid fa-right-from-bracket"></i>
        </button>
      </div>
      <div class="mt-2 flex items-center justify-between gap-1 text-[10px]">
        <span class="rounded-full border px-2 py-0.5 font-black ${rCls}">${rText}</span>
        <button type="button" onclick="pgCloudSyncNow?.()" id="pgCloudStatusBadge" class="flex items-center gap-1 rounded-lg bg-zinc-950 border border-zinc-800 px-2 py-0.5 font-bold text-emerald-300 hover:border-amber-400/40">
          <i class="fa-solid fa-cloud-check"></i><span>متصل بقاعدة البيانات</span>
        </button>
      </div>
    `;
  }

  async function verifyGymMembershipAndUnlock(user) {
    if (!user || isCoachMode) return;
    currentUser = user;

    // في وضع الأوفلاين: استخدم العضوية المخزنة محلياً إن كانت لنفس المستخدم
    if (!navigator.onLine) {
      const cached = readCachedMembership();
      if (cached && cached.userId === user.id && cached.gym_id) {
        currentMembership = cached;
        setAppProtectedLock(false);
        renderAccountBadgeInSidebar();
        window.dispatchEvent(new CustomEvent('pg-auth-ready', { detail: { user, membership: currentMembership, offline: true } }));
        return;
      }
    }

    let pendingInvite = null;
    try { pendingInvite = sessionStorage.getItem(PENDING_INVITE_KEY) || null; } catch { /* ignore */ }

    const { data, error } = await supabaseClient.rpc('pg_claim_or_join_gym', {
      p_gym: DEFAULT_GYM_ID,
      p_invite_token: pendingInvite
    });

    if (error) {
      console.warn('pg_claim_or_join_gym error:', error);
      const cached = readCachedMembership();
      if (cached && cached.userId === user.id) {
        currentMembership = cached;
        setAppProtectedLock(false);
        renderAccountBadgeInSidebar();
        window.dispatchEvent(new CustomEvent('pg-auth-ready', { detail: { user, membership: currentMembership } }));
        return;
      }
      renderAuthGateLogin('تعذر التحقق من صلاحية القاعة: ' + (error.message || 'خطأ في الاتصال'));
      return;
    }

    if (!data || !data.ok) {
      if (data && data.reason === 'invalid_or_expired_invite') {
        try { sessionStorage.removeItem(PENDING_INVITE_KEY); } catch { /* ignore */ }
        renderInviteRequiredGate(user.email || '', 'رابط أو كود الدعوة غير صالح أو منتهي الصلاحية.');
        return;
      }
      renderInviteRequiredGate(user.email || '');
      return;
    }

    try { sessionStorage.removeItem(PENDING_INVITE_KEY); } catch { /* ignore */ }

    currentMembership = {
      userId: user.id,
      gym_id: data.gym_id || DEFAULT_GYM_ID,
      role: data.role || 'supervisor',
      display_name: data.display_name || user.user_metadata?.full_name || user.email || 'الكابتن',
      email: data.email || user.email || '',
      avatar_url: data.avatar_url || user.user_metadata?.avatar_url || ''
    };
    writeCachedMembership(currentMembership);

    setAppProtectedLock(false);
    if (typeof dismissSplashScreenNow === 'function') dismissSplashScreenNow();
    renderAccountBadgeInSidebar();

    if (data.claimed_owner && typeof showToast === 'function') {
      showToast('تم ربط حسابك كمالك ومدير عام لقاعة Power Gym بنجاح 👑', 'success');
    }

    window.dispatchEvent(new CustomEvent('pg-auth-ready', {
      detail: { user: currentUser, membership: currentMembership }
    }));
  }

  window.pgToggleEmailAuthMode = function () {
    authMode = authMode === 'signin' ? 'signup' : 'signin';
    renderAuthGateLogin();
  };

  window.pgSignInWithGoogle = async function () {
    const btn = document.getElementById('pgGoogleSignInBtn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>جارٍ التحويل إلى Google...</span>';
    }
    const redirectUrl = window.location.origin + window.location.pathname;
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUrl,
        queryParams: {
          prompt: 'select_account'
        }
      }
    });
    if (error) {
      let msg = error.message || 'تعذر بدء تسجيل الدخول عبر Google';
      if (/provider is not enabled|Unsupported provider/i.test(msg)) {
        msg = 'مزود Google قيد التفعيل في إعدادات Supabase Auth — يمكنك الدخول مؤقتاً بالبريد الإلكتروني أدناه أو إكمال ربط Client ID الخاص بـ Google.';
      }
      renderAuthGateLogin(msg);
    }
  };

  window.pgSubmitEmailAuth = async function (event) {
    event.preventDefault();
    const email = (document.getElementById('pgAuthEmail')?.value || '').trim();
    const password = document.getElementById('pgAuthPassword')?.value || '';
    const btn = document.getElementById('pgEmailSubmitBtn');
    if (!email || !password) return;

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'جارٍ التحقق...';
    }

    try {
      const res = authMode === 'signup'
        ? await supabaseClient.auth.signUp({ email, password })
        : await supabaseClient.auth.signInWithPassword({ email, password });

      if (res.error) {
        renderAuthGateLogin(res.error.message || 'فشل تسجيل الدخول');
        return;
      }
      if (res.data?.user && !res.data?.session) {
        renderAuthGateLogin('تم إنشاء الحساب! يرجى تأكيد البريد الإلكتروني من الرسالة الواردة ثم تسجيل الدخول.');
        return;
      }
      if (res.data?.user) {
        await verifyGymMembershipAndUnlock(res.data.user);
      }
    } catch (err) {
      renderAuthGateLogin(err?.message || 'حدث خطأ في الاتصال بالسيرفر');
    }
  };

  window.pgRedeemManualInvite = async function (event) {
    event.preventDefault();
    const code = (document.getElementById('pgInviteCodeInput')?.value || '').trim();
    if (!code || !currentUser) return;
    try { sessionStorage.setItem(PENDING_INVITE_KEY, code); } catch { /* ignore */ }
    await verifyGymMembershipAndUnlock(currentUser);
  };

  window.pgSignOut = async function () {
    if (!confirm('هل تريد تسجيل الخروج من الحساب الحالي؟')) return;
    await supabaseClient.auth.signOut().catch(() => {});
    currentUser = null;
    currentMembership = null;
    writeCachedMembership(null);
    renderAuthGateLogin();
  };

  window.pgAuth = {
    getClient: () => supabaseClient,
    getUser: () => currentUser,
    getMembership: () => currentMembership,
    getGymId: () => (currentMembership && currentMembership.gym_id) || DEFAULT_GYM_ID,
    getRole: () => (currentMembership && currentMembership.role) || 'supervisor',
    isManager: () => Boolean(currentMembership && (currentMembership.role === 'owner' || currentMembership.role === 'captain')),
    isAuthenticated: () => Boolean(currentUser && currentMembership),
    refreshBadge: renderAccountBadgeInSidebar
  };

  async function bootAuthGuard() {
    if (isCoachMode || authChecking) return;
    authChecking = true;
    ensureAuthGateDom();
    setAppProtectedLock(true);

    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (session?.user) {
        // تحقق فعلي من المستخدم عبر السيرفر إن توفر الإنترنت
        if (navigator.onLine) {
          const { data: userRes, error: userErr } = await supabaseClient.auth.getUser();
          if (userErr || !userRes?.user) {
            await supabaseClient.auth.signOut().catch(() => {});
            renderAuthGateLogin();
            return;
          }
          await verifyGymMembershipAndUnlock(userRes.user);
        } else {
          await verifyGymMembershipAndUnlock(session.user);
        }
      } else {
        if (typeof dismissSplashScreenNow === 'function') dismissSplashScreenNow();
        renderAuthGateLogin();
      }
    } catch {
      renderAuthGateLogin();
    } finally {
      authChecking = false;
    }

    supabaseClient.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session?.user) {
        currentUser = null;
        currentMembership = null;
        renderAuthGateLogin();
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        if (!currentMembership || currentUser?.id !== session.user.id) {
          verifyGymMembershipAndUnlock(session.user);
        }
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootAuthGuard);
  } else {
    bootAuthGuard();
  }
})();
