// options.js — ListingLens v1.4.4
// AI Provider: OpenAI | Gemini (free tier). AI Mode: BYO | Cloud (coming soon).

const apiKeyInput        = document.getElementById('apiKey');
const btnToggleKey       = document.getElementById('btn-toggle-key');
const keyDisplay         = document.getElementById('key-display');
const geminiKeyInput     = document.getElementById('geminiApiKey');
const btnToggleGeminiKey = document.getElementById('btn-toggle-gemini-key');
const geminiKeyDisplay   = document.getElementById('gemini-key-display');
const modelSelect        = document.getElementById('model');
const geminiModelSelect  = document.getElementById('geminiModel');
const maxTokensInput     = document.getElementById('maxTokens');
const tempInput          = document.getElementById('temperature');
const btnSave            = document.getElementById('btn-save');
const btnTest            = document.getElementById('btn-test');
const btnClearKey        = document.getElementById('btn-clear-key');
const testResult         = document.getElementById('test-result');
const saveStatus         = document.getElementById('save-status');
const sectionByo         = document.getElementById('section-byo');
const sectionCloud       = document.getElementById('section-cloud');
const modeRadios         = document.querySelectorAll('input[name="aiMode"]');
const providerRadios     = document.querySelectorAll('input[name="provider"]');
const openaiFields        = document.getElementById('openai-fields');
const geminiFields         = document.getElementById('gemini-fields');
const usageNoteText       = document.getElementById('usage-note-text');

function maskKey(key) {
  if (!key || key.length < 10) return '(saved)';
  return key.substring(0,5) + '…' + key.substring(key.length-4);
}

// ── Load saved settings ──────────────────────────────────────────────────
chrome.storage.local.get(['apiKey','geminiApiKey','provider','model','geminiModel','maxTokens','temperature','aiMode'], items => {
  if (items.apiKey) {
    apiKeyInput.placeholder = maskKey(items.apiKey);
    keyDisplay.textContent  = maskKey(items.apiKey);
    keyDisplay.classList.remove('hidden');
  }
  if (items.geminiApiKey) {
    geminiKeyInput.placeholder = maskKey(items.geminiApiKey);
    geminiKeyDisplay.textContent = maskKey(items.geminiApiKey);
    geminiKeyDisplay.classList.remove('hidden');
  }
  if (items.model) modelSelect.value = items.model;
  if (items.geminiModel) geminiModelSelect.value = items.geminiModel;
  maxTokensInput.value = items.maxTokens || 2200;
  tempInput.value      = items.temperature !== undefined ? items.temperature : 0.4;

  const provider = items.provider || 'openai';
  const providerRadio = document.querySelector(`input[name="provider"][value="${provider}"]`);
  if (providerRadio) providerRadio.checked = true;
  updateProviderUI(provider);

  const mode = items.aiMode || 'byo';
  const modeRadio = document.querySelector(`input[name="aiMode"][value="${mode}"]`);
  if (modeRadio) modeRadio.checked = true;
  updateModeUI(mode);
});

// ── Provider toggle ───────────────────────────────────────────────────────
providerRadios.forEach(r => r.addEventListener('change', () => updateProviderUI(r.value)));

function updateProviderUI(provider) {
  if (provider === 'gemini') {
    openaiFields.classList.add('hidden');
    geminiFields.classList.remove('hidden');
    usageNoteText.innerHTML = '<strong>Gemini mode:</strong> Gemini may offer a free tier depending on your region/account. Usage limits are controlled by Google.';
  } else {
    openaiFields.classList.remove('hidden');
    geminiFields.classList.add('hidden');
    usageNoteText.innerHTML = '<strong>OpenAI mode:</strong> Usage is billed directly to your OpenAI account. gpt-4o-mini typically costs $0.01–0.05 per analysis.';
  }
}

// ── AI Mode toggle (BYO vs Cloud) ───────────────────────────────────────────
modeRadios.forEach(r => r.addEventListener('change', () => updateModeUI(r.value)));

function updateModeUI(mode) {
  if (mode === 'byo') {
    sectionByo.classList.remove('hidden');
    sectionCloud.classList.add('hidden');
  } else {
    sectionByo.classList.add('hidden');
    sectionCloud.classList.remove('hidden');
  }
}

// ── Toggle key visibility ─────────────────────────────────────────────────
btnToggleKey.addEventListener('click', () => {
  apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
  btnToggleKey.textContent = apiKeyInput.type === 'password' ? '👁' : '🙈';
});
btnToggleGeminiKey.addEventListener('click', () => {
  geminiKeyInput.type = geminiKeyInput.type === 'password' ? 'text' : 'password';
  btnToggleGeminiKey.textContent = geminiKeyInput.type === 'password' ? '👁' : '🙈';
});

// ── Save ──────────────────────────────────────────────────────────────────
btnSave.addEventListener('click', () => {
  const newOpenaiKey = apiKeyInput.value.trim();
  const newGeminiKey = geminiKeyInput.value.trim();
  const model        = modelSelect.value;
  const geminiModel  = geminiModelSelect.value;
  const maxTokens    = parseInt(maxTokensInput.value, 10) || 2200;
  const temperature  = parseFloat(tempInput.value) || 0.4;
  const aiMode       = document.querySelector('input[name="aiMode"]:checked')?.value || 'byo';
  const provider     = document.querySelector('input[name="provider"]:checked')?.value || 'openai';

  if (maxTokens < 500 || maxTokens > 8192) { showTest('Max tokens must be 500–8192.', false); return; }
  if (temperature < 0 || temperature > 2)  { showTest('Temperature must be 0–2.', false); return; }

  const toSave = { model, geminiModel, maxTokens, temperature, aiMode, provider };

  if (newOpenaiKey) {
    if (!newOpenaiKey.startsWith('sk-')) { showTest('OpenAI API key should start with "sk-". Check your key.', false); return; }
    toSave.apiKey = newOpenaiKey;
    apiKeyInput.value = '';
    apiKeyInput.placeholder = maskKey(newOpenaiKey);
    keyDisplay.textContent  = maskKey(newOpenaiKey);
    keyDisplay.classList.remove('hidden');
  }

  if (newGeminiKey) {
    toSave.geminiApiKey = newGeminiKey;
    geminiKeyInput.value = '';
    geminiKeyInput.placeholder = maskKey(newGeminiKey);
    geminiKeyDisplay.textContent = maskKey(newGeminiKey);
    geminiKeyDisplay.classList.remove('hidden');
  }

  chrome.storage.local.set(toSave, () => {
    saveStatus.classList.remove('hidden');
    setTimeout(() => saveStatus.classList.add('hidden'), 2000);
  });
});

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err && err.name === 'AbortError') throw new Error(`Request timed out after ${Math.round(timeoutMs/1000)} seconds.`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── Test API Key ───────────────────────────────────────────────────────────
btnTest.addEventListener('click', async () => {
  testResult.className = 'feedback hidden';
  btnTest.disabled = true;
  btnTest.textContent = 'Testing…';

  const provider = document.querySelector('input[name="provider"]:checked')?.value || 'openai';

  if (provider === 'gemini') {
    let keyToTest = geminiKeyInput.value.trim();
    if (!keyToTest) {
      const stored = await new Promise(r => chrome.storage.local.get(['geminiApiKey'], r));
      keyToTest = stored.geminiApiKey || '';
    }
    if (!keyToTest) { showTest('No Gemini API key found. Enter and save your key first.', false); btnTest.disabled=false; btnTest.textContent='Test API Key'; return; }

    try {
      const res = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models?key=${keyToTest}`, {}, 15000);
      if (res.ok) showTest('✓ Gemini API key is valid and working.', true);
      else if (res.status===400||res.status===403) showTest('✗ Invalid Gemini API key. Check that you copied it correctly.', false);
      else if (res.status===429) showTest('✓ Key valid but rate limited right now. You can still use it.', true);
      else showTest(`✗ Unexpected error: HTTP ${res.status}`, false);
    } catch(err) { showTest(`✗ Network error: ${err.message}`, false); }

  } else {
    let keyToTest = apiKeyInput.value.trim();
    if (!keyToTest) {
      const stored = await new Promise(r => chrome.storage.local.get(['apiKey'], r));
      keyToTest = stored.apiKey || '';
    }
    if (!keyToTest) { showTest('No OpenAI API key found. Enter and save your key first.', false); btnTest.disabled=false; btnTest.textContent='Test API Key'; return; }

    try {
      const res = await fetchWithTimeout('https://api.openai.com/v1/models', { headers: {'Authorization':`Bearer ${keyToTest}`} }, 15000);
      if (res.ok) showTest('✓ OpenAI API key is valid and working.', true);
      else if (res.status===401) showTest('✗ Invalid API key. Check that you copied it correctly.', false);
      else if (res.status===429) showTest('✓ Key valid but rate limited. You can still use it.', true);
      else showTest(`✗ Unexpected error: HTTP ${res.status}`, false);
    } catch(err) { showTest(`✗ Network error: ${err.message}`, false); }
  }

  btnTest.disabled = false; btnTest.textContent = 'Test API Key';
});

function showTest(msg, ok) {
  testResult.textContent = msg;
  testResult.className   = 'feedback ' + (ok ? 'success' : 'error');
}

// ── Clear Key ─────────────────────────────────────────────────────────────
btnClearKey.addEventListener('click', () => {
  const provider = document.querySelector('input[name="provider"]:checked')?.value || 'openai';
  const label = provider === 'gemini' ? 'Gemini' : 'OpenAI';
  if (!confirm(`Remove your saved ${label} API key?`)) return;

  if (provider === 'gemini') {
    chrome.storage.local.remove(['geminiApiKey'], () => {
      geminiKeyInput.value=''; geminiKeyInput.placeholder='AIza...';
      geminiKeyDisplay.textContent=''; geminiKeyDisplay.classList.add('hidden');
      showTest('Gemini API key cleared.', true);
    });
  } else {
    chrome.storage.local.remove(['apiKey'], () => {
      apiKeyInput.value=''; apiKeyInput.placeholder='sk-...';
      keyDisplay.textContent=''; keyDisplay.classList.add('hidden');
      showTest('OpenAI API key cleared.', true);
    });
  }
});

// ── Subscription / License (v1.4.5) ─────────────────────────────────────
const subPlanEl        = document.getElementById('sub-plan');
const subLicenseStatus = document.getElementById('sub-license-status');
const subAsinUsage     = document.getElementById('sub-asin-usage');
const subReportsRow    = document.getElementById('sub-reports-row');
const subReportsUsage  = document.getElementById('sub-reports-usage');
const licenseKeyInput  = document.getElementById('licenseKey');
const btnVerifyLicense = document.getElementById('btn-verify-license');
const btnClearLicense  = document.getElementById('btn-clear-license');
const licenseResult    = document.getElementById('license-result');
const btnUpgradePro    = document.getElementById('btn-upgrade-pro');
const btnManageSub     = document.getElementById('btn-manage-sub');

const PRICING_URL = 'https://clingogo.com/listinglens/pricing';
const ACCOUNT_URL = 'https://clingogo.com/listinglens/account';

async function refreshSubscriptionUI() {
  if (!window.LL_SUBSCRIPTION) return;
  const state = await window.LL_SUBSCRIPTION.getState();

  subPlanEl.textContent = state.limits.label;
  subPlanEl.className = 'sub-plan-badge ' + (state.plan === 'pro' ? 'sub-plan-pro' : 'sub-plan-free');

  const statusLabelMap = { free:'Free plan', active:'Active', expired:'Expired', invalid:'Invalid key' };
  subLicenseStatus.textContent = statusLabelMap[state.status] || state.status;

  if (state.plan === 'free') {
    subAsinUsage.textContent = `${state.asinSeenToday.length} / ${state.limits.dailyAsinLimit}`;
    subReportsRow.classList.add('hidden');
  } else {
    subAsinUsage.textContent = 'Unlimited';
    subReportsRow.classList.remove('hidden');
    subReportsUsage.textContent = `${state.reportsUsed} / ${state.limits.monthlyReportLimit}`;
  }

  if (state.licenseKey) licenseKeyInput.placeholder = '••••••••' + state.licenseKey.slice(-4);
}

refreshSubscriptionUI();

btnVerifyLicense.addEventListener('click', async () => {
  if (!window.LL_SUBSCRIPTION) return;
  const key = licenseKeyInput.value.trim();
  licenseResult.className = 'feedback hidden';
  btnVerifyLicense.disabled = true;
  btnVerifyLicense.textContent = 'Verifying…';

  const result = await window.LL_SUBSCRIPTION.verifyLicense(key);
  if (result.ok) {
    licenseResult.textContent = `✓ License active — ${result.plan} plan.`;
    licenseResult.className = 'feedback success';
    licenseKeyInput.value = '';
  } else {
    licenseResult.textContent = `✗ ${result.error}`;
    licenseResult.className = 'feedback error';
  }
  btnVerifyLicense.disabled = false;
  btnVerifyLicense.textContent = 'Verify License';
  await refreshSubscriptionUI();
});

btnClearLicense.addEventListener('click', async () => {
  if (!window.LL_SUBSCRIPTION) return;
  if (!confirm('Remove your license and return to the Free plan?')) return;
  await window.LL_SUBSCRIPTION.clearLicense();
  licenseKeyInput.value = ''; licenseKeyInput.placeholder = 'Enter your Pro license key';
  licenseResult.textContent = 'License cleared. Back on Free plan.';
  licenseResult.className = 'feedback success';
  await refreshSubscriptionUI();
});

btnUpgradePro.addEventListener('click', () => { chrome.tabs.create({ url: PRICING_URL }); });
btnManageSub.addEventListener('click', () => { chrome.tabs.create({ url: ACCOUNT_URL }); });
