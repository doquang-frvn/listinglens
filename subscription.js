// subscription.js — ListingLens v1.4.5
// Plan model:
//   Free: 10 distinct ASINs/day (extract listing/reviews). No AI Analyze.
//   Pro ($39/mo): unlimited ASINs. 150 AI reports/month (BYO OpenAI/Gemini key).
//
// License verification is backend-driven (Polar-issued license key -> your
// license server). No backend exists yet, so verifyLicense() degrades
// gracefully: if the endpoint is unset/unreachable, the user stays on Free
// and sees a clear message — never a crash.
//
// This file defines plain functions attached to `window.LL_SUBSCRIPTION`
// so popup.js / app.html / options.js can all use it via a single <script> tag.

(function () {
  const PLAN_LIMITS = {
    free: { dailyAsinLimit: 10, monthlyReportLimit: 0,   label: 'Free' },
    pro:  { dailyAsinLimit: Infinity, monthlyReportLimit: 150, label: 'Pro' },
  };

  const STORAGE_KEYS = {
    licenseKey:      'listinglens_license_key',
    plan:             'listinglens_plan',
    licenseStatus:    'listinglens_license_status',     // 'free' | 'active' | 'expired' | 'invalid'
    expiresAt:        'listinglens_license_expires_at',
    lastCheck:        'listinglens_last_license_check',
    backendEndpoint:  'listinglens_backend_endpoint',
    // Usage tracking
    usageDay:         'listinglens_usage_day',           // 'YYYY-MM-DD'
    asinSeenToday:    'listinglens_asin_seen_today',      // array of ASINs
    usageMonth:       'listinglens_usage_month',          // 'YYYY-MM'
    reportsUsed:      'listinglens_reports_used',
  };

  const DEFAULT_BACKEND = ''; // not configured yet — set when Polar/license server exists

  function todayStr() { return new Date().toISOString().slice(0,10); }
  function monthStr() { return new Date().toISOString().slice(0,7); }

  // ── Load full subscription state ──────────────────────────────────────
  async function getState() {
    const k = STORAGE_KEYS;
    const items = await new Promise(r => chrome.storage.local.get(Object.values(k), r));

    const plan   = items[k.plan] || 'free';
    const status = items[k.licenseStatus] || 'free';
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

    // Roll over daily ASIN counter if day changed
    let usageDay = items[k.usageDay] || todayStr();
    let asinSeenToday = items[k.asinSeenToday] || [];
    if (usageDay !== todayStr()) { usageDay = todayStr(); asinSeenToday = []; }

    // Roll over monthly report counter if month changed
    let usageMonth = items[k.usageMonth] || monthStr();
    let reportsUsed = items[k.reportsUsed] || 0;
    if (usageMonth !== monthStr()) { usageMonth = monthStr(); reportsUsed = 0; }

    return {
      licenseKey:     items[k.licenseKey] || '',
      plan, status, limits,
      expiresAt:      items[k.expiresAt] || null,
      lastCheck:      items[k.lastCheck] || null,
      backendEndpoint:items[k.backendEndpoint] || DEFAULT_BACKEND,
      usageDay, asinSeenToday,
      usageMonth, reportsUsed,
    };
  }

  async function saveState(patch) {
    const flat = {};
    for (const [key, val] of Object.entries(patch)) {
      if (STORAGE_KEYS[key]) flat[STORAGE_KEYS[key]] = val;
    }
    await new Promise(r => chrome.storage.local.set(flat, r));
  }

  // ── Daily ASIN gate (Free plan) ────────────────────────────────────────
  // Call BEFORE extracting a listing/reviews for a given ASIN.
  // Returns { allowed, reason, asinSeenToday, dailyAsinLimit }
  async function checkAsinAllowed(asin) {
    const state = await getState();
    if (state.limits.dailyAsinLimit === Infinity) {
      return { allowed: true, asinSeenToday: state.asinSeenToday.length, dailyAsinLimit: Infinity };
    }
    const alreadySeen = state.asinSeenToday.includes(asin);
    if (alreadySeen) {
      return { allowed: true, asinSeenToday: state.asinSeenToday.length, dailyAsinLimit: state.limits.dailyAsinLimit };
    }
    if (state.asinSeenToday.length >= state.limits.dailyAsinLimit) {
      return {
        allowed: false,
        reason: `Free plan: ${state.limits.dailyAsinLimit} different products/day. You've checked ${state.asinSeenToday.length} today. Upgrade to Pro for unlimited products.`,
        asinSeenToday: state.asinSeenToday.length,
        dailyAsinLimit: state.limits.dailyAsinLimit,
      };
    }
    return { allowed: true, asinSeenToday: state.asinSeenToday.length, dailyAsinLimit: state.limits.dailyAsinLimit };
  }

  // Record that an ASIN was viewed today (call AFTER a successful extract).
  async function recordAsinSeen(asin) {
    if (!asin) return;
    const state = await getState();
    if (state.asinSeenToday.includes(asin)) {
      // still persist rollover-corrected day
      await saveState({ usageDay: state.usageDay, asinSeenToday: state.asinSeenToday });
      return;
    }
    const updated = [...state.asinSeenToday, asin];
    await saveState({ usageDay: state.usageDay, asinSeenToday: updated });
  }

  // ── Monthly AI report gate (Pro plan) ─────────────────────────────────
  // Free plan cannot use Analyze at all. Pro has a monthly cap.
  async function checkAnalyzeAllowed() {
    const state = await getState();
    if (state.plan === 'free') {
      return {
        allowed: false,
        reason: 'AI analysis is a Pro feature. Upgrade to ListingLens Pro ($39/mo) to unlock Analyze.',
        requiresUpgrade: true,
      };
    }
    if (state.status !== 'active') {
      return {
        allowed: false,
        reason: 'Your Pro license is not active. Check Settings → Subscription, or re-verify your license key.',
        requiresUpgrade: false,
      };
    }
    if (state.reportsUsed >= state.limits.monthlyReportLimit) {
      return {
        allowed: false,
        reason: `Monthly AI report limit reached (${state.limits.monthlyReportLimit}/month). Resets next month, or contact support for Agency limits.`,
        requiresUpgrade: false,
      };
    }
    return {
      allowed: true,
      remaining: state.limits.monthlyReportLimit - state.reportsUsed,
      used: state.reportsUsed,
      limit: state.limits.monthlyReportLimit,
    };
  }

  // Call ONLY after a successful AI report (never on failed/timeout calls).
  async function recordReportUsed() {
    const state = await getState();
    await saveState({ usageMonth: state.usageMonth, reportsUsed: state.reportsUsed + 1 });
  }

  // ── License verification (Polar-backed, backend not live yet) ─────────
  // POST { licenseKey, extensionVersion } -> backendEndpoint/api/license/verify
  // Expected response: { valid, plan, status, monthlyReportLimit, usedThisMonth, expiresAt }
  //
  // NOTE for future integration: Polar webhook should create/update the
  // license record server-side on subscription.created / .updated / .canceled.
  // This extension only ever calls the verify endpoint — it never talks to
  // Polar directly and never embeds any secret keys.
  async function verifyLicense(licenseKey) {
    const state = await getState();
    const endpoint = state.backendEndpoint;

    if (!licenseKey || !licenseKey.trim()) {
      return { ok: false, error: 'Enter a license key first.' };
    }
    if (!endpoint) {
      return {
        ok: false,
        error: 'License server is not configured yet. ListingLens Pro activation is coming soon — for now you can continue on the Free plan.',
      };
    }

    try {
      const res = await fetch(`${endpoint}/api/license/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licenseKey: licenseKey.trim(),
          extensionVersion: chrome.runtime.getManifest().version,
        }),
      });

      if (!res.ok) {
        if (res.status === 404) return { ok: false, error: 'License key not found. Check your key or contact support.' };
        if (res.status === 401 || res.status === 403) return { ok: false, error: 'License key is invalid or revoked.' };
        return { ok: false, error: `License server error (HTTP ${res.status}). Try again later.` };
      }

      const data = await res.json();
      if (!data.valid) {
        await saveState({ plan: 'free', licenseStatus: 'invalid', licenseKey: licenseKey.trim() });
        return { ok: false, error: 'License key is not valid or has expired.' };
      }

      await saveState({
        licenseKey:    licenseKey.trim(),
        plan:          data.plan || 'pro',
        licenseStatus: data.status || 'active',
        expiresAt:     data.expiresAt || null,
        lastCheck:     new Date().toISOString(),
        usageMonth:    monthStr(),
        reportsUsed:   data.usedThisMonth || 0,
      });

      return { ok: true, plan: data.plan, status: data.status, monthlyReportLimit: data.monthlyReportLimit, usedThisMonth: data.usedThisMonth, expiresAt: data.expiresAt };
    } catch (e) {
      return { ok: false, error: `Could not reach license server: ${e.message}. Staying on current plan.` };
    }
  }

  async function clearLicense() {
    await saveState({ licenseKey: '', plan: 'free', licenseStatus: 'free', expiresAt: null, lastCheck: null });
  }

  // Re-verify silently if cached license is older than 7 days. Falls back to
  // Free if verification fails — never blocks the UI, just degrades.
  async function refreshIfStale() {
    const state = await getState();
    if (state.plan === 'free' || !state.licenseKey) return state;
    const last = state.lastCheck ? new Date(state.lastCheck).getTime() : 0;
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    if (Date.now() - last < sevenDays) return state; // still fresh, e.g. "License cached"
    const result = await verifyLicense(state.licenseKey);
    if (!result.ok) {
      // Don't nuke Pro immediately on a single failed network check —
      // only downgrade if the server explicitly says invalid/expired.
      console.warn('ListingLens: license re-verify failed (kept previous plan):', result.error);
    }
    return getState();
  }

  window.LL_SUBSCRIPTION = {
    PLAN_LIMITS,
    getState,
    checkAsinAllowed,
    recordAsinSeen,
    checkAnalyzeAllowed,
    recordReportUsed,
    verifyLicense,
    clearLicense,
    refreshIfStale,
  };
})();
