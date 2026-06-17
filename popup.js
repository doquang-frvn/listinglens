// popup.js — ListingLens v1.4.4
// Fixes: UNKNOWN cache bug, marketplace URL, section rename, category checklists,
//        compliance section, auto-collect limits, source badges, CSV source_url,
//        AI Mode architecture (BYO key + Cloud AI coming soon), manual-assisted capture, fetch timeouts, full-app mode

// ── Category checklists ────────────────────────────────────────────────────
const CATEGORY_CHECKLISTS = {
  custom_pod: ['personalization clarity','preview/mockup expectation','size/dimensions','material quality','waterproof/durability','production & shipping time expectation','gift occasion angle','emotional/identity angle'],
  beauty:     ['skin type compatibility','shade/color expectation accuracy','ingredient clarity','texture/finish description','scent description','sensitive skin caution','how to use steps','before-after expectation'],
  supplement: ['ingredient clarity','serving size & count','dosage instructions','flavor options','diet compatibility (vegan/keto/etc)','third-party testing only if claimed with proof','avoid disease/cure/treat/prevent claims','safety disclaimer language'],
  electronics:['device compatibility & model numbers','wattage/voltage/specs','connector type & cable included','certifications only if verified','what is included in box','setup/install steps','warranty & support info','return-risk: version/region mismatch'],
  home_kitchen:['exact dimensions & capacity','material & durability','cleaning/care instructions','storage requirements','dishwasher/oven/microwave safe only if true','primary use cases','comparison vs alternatives','assembly required notice'],
  pet:        ['pet size & weight range','breed-specific fit if relevant','safety materials (non-toxic)','washability & care','durability/chew level','fit guide for wearables','primary use case','supervision warning if needed'],
  baby:       ['age range & developmental stage','safety standards & materials','exact size/dimensions','cleaning & care','primary parent benefit','gift angle','supervision requirement','avoid unverified safety claims'],
  apparel:    ['size chart & fit guidance','material & fabric care','color accuracy vs photos','occasion & use case','gender/audience clarity','comfort & stretch info','return-risk: sizing clarity is critical','seasonal/temperature guidance'],
  tools:      ['compatibility & model fit','exact dimensions & weight/load capacity','material & build quality','safety standards if claimed','primary use cases','setup/install steps','what is included','warranty/support'],
  generic:    ['size & dimensions','material & quality signals','what is included','compatibility & use cases','trust signals & proof points','expectation clarity for photos vs reality','care & use instructions','return-risk clarity'],
};

// ── State ──────────────────────────────────────────────────────────────────
const JOB_KEY  = 'listinglens_active_job';
const cacheKey = asin => `listinglens_cache_${asin}`;

let currentAsin    = null;
let currentListing = null;
let currentReport  = null;
let pollTimer      = null;

// ── DOM refs ───────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const statusBadge       = $('page-status');
const btnExtract        = $('btn-extract');
const btnExtractReviews = $('btn-extract-reviews');
const btnAnalyze        = $('btn-analyze');
const errorBanner       = $('error-banner');
const infoBanner        = $('info-banner');
const cacheNotice       = $('cache-notice');
const cacheMsg          = $('cache-msg');
const btnLoadCache      = $('btn-load-cache');
const btnIgnoreCache    = $('btn-ignore-cache');
const tabsEl            = $('tabs');
const listingContent    = $('listing-content');
const btnOpenReviewPage = $('btn-open-review-page');
const btnOpenFullApp    = $('btn-open-full-app');
const btnOpenFullAppFooter = $('btn-open-full-app-footer');
const btnExportJson     = $('btn-export-json');
const reviewSummary     = $('review-summary');
const reviewList        = $('review-list');
const btnExportCsv      = $('btn-export-csv');
const btnClearReviews   = $('btn-clear-reviews');
const pasteInput        = $('paste-input');
const btnAddPasted      = $('btn-add-pasted');
const reportContent     = $('report-content');
const btnCopyReport     = $('btn-copy-report');
const btnExportMd       = $('btn-export-md');
const categorySelect    = $('category-select');
const loadingEl         = $('loading');
const loadingMsg        = $('loading-msg');
const btnSettings       = $('btn-settings');
// Data quality
const dataQualityBar    = $('data-quality-bar');
const dqListingDot      = $('dq-listing-dot');
const dqListingEl       = $('dq-listing');
const dqReviewsDot      = $('dq-reviews-dot');
const dqReviewsEl       = $('dq-reviews');
const dqPasteDot        = $('dq-paste-dot');
const dqPasteEl         = $('dq-paste');
const dqStrengthBadge   = $('dq-strength-badge');
const dqLimitedNotice   = $('dq-limited-notice');
// Advanced
const advUnderstand     = $('adv-understand');
const advControls       = $('adv-controls');
const btnStartCollect   = $('btn-start-collect');
const btnStopCollect    = $('btn-stop-collect');
const advStatus         = $('adv-status');

// ── Tabs ───────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  ['listing','reviews','report'].forEach(n => $(`tab-${n}`).classList.toggle('hidden', n !== name));
  if (name === 'reviews') updateDataQuality();
}

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  const isExtensionApp = location.protocol === 'chrome-extension:' && location.pathname.endsWith('/app.html');
  if (isExtensionApp) {
    setStatus('Full App','ok');
    document.body.classList.add('full-app');
    const params = new URLSearchParams(location.search);
    let asin = (params.get('asin') || '').toUpperCase();
    if (!asin) {
      const stored = await new Promise(r => chrome.storage.local.get(['listinglens_last_asin'], r));
      asin = (stored.listinglens_last_asin || '').toUpperCase();
    }
    if (asin) {
      currentAsin = asin;
      await refreshFromCache(asin);
      checkCache(asin);
      tabsEl.classList.remove('hidden');
      showInfo('Full App mode loaded. This page stays open during long AI analysis.');
    } else {
      showInfo('Full App mode. Extract a listing from the popup first, then reopen Full App.');
    }
    btnExtract.disabled = true;
    btnExtractReviews.disabled = true;
    if (currentAsin) btnAnalyze.disabled = false;
    await refreshJobStatus();
    startPolling();
    advUnderstand.addEventListener('change', () => requestAutoCollectPermission());
    await syncAutoCollectCheckboxState();
    await refreshPlanBadge();
    return;
  }

  const tab = await getActiveTab();
  if (!tab || !isAmazonPage(tab.url)) {
    setStatus('Not an Amazon page','bad');
    showError('Open an Amazon product page or review page to use ListingLens.');
    return;
  }

  const pageType = getPageTypeFromUrl(tab.url);

  if (pageType === 'reviews') {
    setStatus('Review page','reviews');
    btnExtract.disabled        = false;
    btnExtractReviews.disabled = false;
    showInfo('Manual assisted mode: click Amazon “Show 10 more reviews” by hand until enough reviews are visible, then click “Capture Visible Reviews”.');
  } else if (pageType === 'product') {
    setStatus('Product page','ok');
    btnExtract.disabled = false;
    // Extract Reviews on product page means "go to review page"
    btnExtractReviews.disabled = false;
    showInfo('Extract the listing, then open the review page. Manually load more reviews, then capture visible reviews.');
  } else {
    setStatus('Unsupported page','bad');
    showError('Navigate to an Amazon product (/dp/) or review page (/product-reviews/).');
    return;
  }

  const m = tab.url.match(/\/(?:dp|product-reviews|gp\/product)\/([A-Z0-9]{10})/i);
  if (m) { currentAsin = m[1].toUpperCase(); checkCache(currentAsin); await refreshFromCache(currentAsin); }

  await refreshJobStatus();
  startPolling();

  advUnderstand.addEventListener('change', () => requestAutoCollectPermission());
  await syncAutoCollectCheckboxState();
  await refreshPlanBadge();
}

// Reflect already-granted 'tabs' permission in the checkbox/UI on load,
// so returning users don't have to re-confirm every time they open the popup.
async function syncAutoCollectCheckboxState() {
  try {
    const hasTabs = await new Promise(resolve => chrome.permissions.contains({ permissions: ['tabs'] }, resolve));
    advUnderstand.checked = !!hasTabs;
    advControls.classList.toggle('disabled-overlay', !hasTabs);
    btnStartCollect.disabled = !hasTabs;
  } catch (e) {
    advUnderstand.checked = false;
    advControls.classList.add('disabled-overlay');
    btnStartCollect.disabled = true;
  }
}

function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

// ── Advanced Auto Collect requires the 'tabs' permission, which is optional
// and only requested at runtime when the user explicitly opts in. This keeps
// the install-time permission prompt minimal for the core (non-Advanced) flow.
async function requestAutoCollectPermission() {
  if (!advUnderstand.checked) {
    advControls.classList.add('disabled-overlay');
    btnStartCollect.disabled = true;
    return;
  }
  try {
    const granted = await new Promise(resolve =>
      chrome.permissions.request({ permissions: ['tabs'] }, resolve)
    );
    if (granted) {
      advControls.classList.remove('disabled-overlay');
      btnStartCollect.disabled = false;
    } else {
      advUnderstand.checked = false;
      advControls.classList.add('disabled-overlay');
      btnStartCollect.disabled = true;
      showInfo('Auto Collect needs the "tabs" permission to track the review page in the background. Permission was not granted, so this feature stays off.');
    }
  } catch (e) {
    advUnderstand.checked = false;
    advControls.classList.add('disabled-overlay');
    btnStartCollect.disabled = true;
    showError('Could not request permission: ' + e.message);
  }
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    await refreshJobStatus();
    if (currentAsin) await refreshFromCache(currentAsin);
  }, 1500);
}

// ── Plan badge + upgrade banner ────────────────────────────────────────────
const PRICING_URL = 'https://clingogo.com/listinglens/pricing';

async function refreshPlanBadge() {
  if (!window.LL_SUBSCRIPTION) return;
  const planBadgeEl  = document.getElementById('plan-badge');
  const planUsageEl  = document.getElementById('plan-usage');
  const btnUpgradeTop= document.getElementById('btn-upgrade');
  if (!planBadgeEl) return;

  const state = await window.LL_SUBSCRIPTION.refreshIfStale();

  if (state.plan === 'pro') {
    planBadgeEl.textContent = 'Pro Plan';
    planBadgeEl.className = 'plan-badge plan-pro';
    planUsageEl.textContent = `${state.reportsUsed} / ${state.limits.monthlyReportLimit} AI reports this month`;
    btnUpgradeTop.classList.add('hidden');
  } else {
    planBadgeEl.textContent = 'Free Plan';
    planBadgeEl.className = 'plan-badge plan-free';
    planUsageEl.textContent = `${state.asinSeenToday.length} / ${state.limits.dailyAsinLimit} products today`;
    btnUpgradeTop.classList.remove('hidden');
    btnUpgradeTop.onclick = () => chrome.tabs.create({ url: PRICING_URL });
  }
}

function showUpgradeBanner() {
  const banner = document.getElementById('upgrade-banner');
  if (!banner) return;
  banner.classList.remove('hidden');
  const btn = document.getElementById('btn-upgrade-banner');
  if (btn) btn.onclick = () => chrome.tabs.create({ url: PRICING_URL });
}

// ── Build review URL using current marketplace domain ──────────────────────
function buildReviewUrl(asin, referenceUrl) {
  const base = referenceUrl ? (() => { try { const u=new URL(referenceUrl); return `${u.protocol}//${u.hostname}`; } catch { return 'https://www.amazon.com'; } })() : 'https://www.amazon.com';
  return `${base}/product-reviews/${asin}/ref=cm_cr_dp_d_show_all_top?_encoding=UTF8&ie=UTF8&reviewerType=all_reviews`;
}

// ── Job status (Advanced collector) ───────────────────────────────────────
async function refreshJobStatus() {
  const job = await new Promise(r => chrome.runtime.sendMessage({action:'GET_JOB'}, res => r(res?.job)));
  if (!job) { btnStopCollect.classList.add('hidden'); btnStartCollect.classList.remove('hidden'); return; }
  if (job.running) {
    btnStartCollect.classList.add('hidden');
    btnStopCollect.classList.remove('hidden');
    advStatus.classList.remove('hidden');
    advStatus.textContent = `${job.status} · ${job.collectedCount||0} reviews · ${job.clicksCompleted||0} clicks`;
  } else {
    btnStartCollect.classList.remove('hidden');
    btnStopCollect.classList.add('hidden');
    if (job.note || job.lastError) { advStatus.classList.remove('hidden'); advStatus.textContent = job.note||job.lastError||''; }
  }
}

// ── Cache ──────────────────────────────────────────────────────────────────
function checkCache(asin) {
  chrome.storage.local.get(cacheKey(asin), items => {
    const c = items[cacheKey(asin)];
    if (!c || (!c.reviews?.length && !c.listingData && !c.aiReport)) return;
    const d   = new Date(c.lastCollectedAt||c.savedAt||Date.now()).toLocaleDateString();
    const rev = (c.reviews?.length||0)+(c.manualPastedReviews?.length||0);
    cacheMsg.textContent = `Cache: ${asin} (${d}) — ${rev} reviews`;
    cacheNotice.classList.remove('hidden');
    btnLoadCache.onclick   = () => { cacheNotice.classList.add('hidden'); loadFromCache(c); };
    btnIgnoreCache.onclick = () => cacheNotice.classList.add('hidden');
  });
}

async function refreshFromCache(asin) {
  if (!asin) return;
  const cache = await new Promise(r => chrome.storage.local.get(cacheKey(asin), d => r(d[cacheKey(asin)])));
  if (!cache) return;
  if (cache.listingData && !currentListing) {
    currentListing = cache.listingData;
    renderListingData(currentListing);
    tabsEl.classList.remove('hidden');
    btnExportJson.disabled = false;
    btnAnalyze.disabled    = false;
  }
  const allReviews = [...(cache.reviews||[]),...(cache.manualPastedReviews||[])];
  if (allReviews.length > 0) {
    renderReviews(allReviews); btnExportCsv.disabled=false; btnClearReviews.disabled=false; btnAnalyze.disabled=false; tabsEl.classList.remove('hidden'); updateDataQuality(cache);
  }
  if (cache.aiReport && !currentReport) { currentReport=cache.aiReport; renderReport(currentReport); btnCopyReport.disabled=false; btnExportMd.disabled=false; }
  if (cache.limitedReviews) dqLimitedNotice.classList.remove('hidden');
  if (cache.listingData) {
    const tab = await getActiveTab();
    btnOpenReviewPage.onclick = () => chrome.tabs.create({url:buildReviewUrl(currentAsin, tab?.url), active:true});
    btnOpenReviewPage.classList.remove('hidden');
  }
}

function loadFromCache(c) {
  if (c.listingData) { currentListing=c.listingData; currentAsin=currentListing.asin||currentAsin; renderListingData(currentListing); tabsEl.classList.remove('hidden'); btnExportJson.disabled=false; btnAnalyze.disabled=false; }
  const all=[...(c.reviews||[]),...(c.manualPastedReviews||[])];
  if (all.length) { renderReviews(all); btnExportCsv.disabled=false; btnClearReviews.disabled=false; btnAnalyze.disabled=false; updateDataQuality(c); }
  if (c.aiReport) { currentReport=c.aiReport; renderReport(currentReport); btnCopyReport.disabled=false; btnExportMd.disabled=false; }
  switchTab('listing');
}

async function saveToCache(patch) {
  if (!currentAsin) return;
  const existing = await new Promise(r => chrome.storage.local.get(cacheKey(currentAsin), d => r(d[cacheKey(currentAsin)]||{})));
  await new Promise(r => chrome.storage.local.set({[cacheKey(currentAsin)]:{...existing,...patch,savedAt:Date.now()}}, r));
}

// ── Data quality indicator ─────────────────────────────────────────────────
function updateDataQuality(cache) {
  if (!cache && currentAsin) { chrome.storage.local.get(cacheKey(currentAsin), d => updateDataQuality(d[cacheKey(currentAsin)]||{})); return; }
  if (!cache) return;
  dataQualityBar.classList.remove('hidden');
  const hasListing   = !!(cache.listingData?.title);
  const visibleCount = cache.reviews?.length||0;
  const pastedCount  = cache.manualPastedReviews?.length||0;
  const total = visibleCount + pastedCount;
  dqListingDot.textContent = hasListing?'●':'○'; dqListingDot.style.color = hasListing?'var(--success)':'var(--muted)'; dqListingEl.textContent = hasListing?'Yes':'No';
  dqReviewsDot.textContent = visibleCount>0?'●':'○'; dqReviewsDot.style.color = visibleCount>0?'var(--primary)':'var(--muted)'; dqReviewsEl.textContent = String(visibleCount);
  dqPasteDot.textContent   = pastedCount>0?'●':'○';  dqPasteDot.style.color   = pastedCount>0?'var(--secondary)':'var(--muted)'; dqPasteEl.textContent   = String(pastedCount);
  let strength,cls;
  if (total===0&&!hasListing){strength='No data';        cls='dq-none';}
  else if(total===0)          {strength='Listing only';  cls='dq-listing';}
  else if(total<=4)           {strength='Weak signal';   cls='dq-weak';}
  else if(total<=19)          {strength='Useful sample'; cls='dq-ok';}
  else                        {strength='Strong sample'; cls='dq-strong';}
  dqStrengthBadge.textContent=strength; dqStrengthBadge.className=`dq-strength ${cls}`;
  if(cache.limitedReviews) dqLimitedNotice.classList.remove('hidden');
  else dqLimitedNotice.classList.add('hidden');
}

// ── Helpers ────────────────────────────────────────────────────────────────
function setStatus(t,c){statusBadge.textContent=t;statusBadge.className=`status-badge status-${c}`;}
function showError(m){errorBanner.textContent=m;errorBanner.classList.remove('hidden');}
function clearError(){errorBanner.textContent='';errorBanner.classList.add('hidden');}
function showInfo(m){infoBanner.innerHTML='';infoBanner.appendChild(document.createTextNode(m));infoBanner.classList.remove('hidden');}
function clearInfo(){infoBanner.innerHTML='';infoBanner.classList.add('hidden');}
function showLoading(m='Working…'){loadingMsg.textContent=m;loadingEl.classList.remove('hidden');}
function hideLoading(){loadingEl.classList.add('hidden');}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function isAmazonPage(url){if(!url)return false;const hosts=['amazon.com','amazon.co.uk','amazon.ca','amazon.de','amazon.fr','amazon.co.jp','amazon.com.au'];try{const u=new URL(url);return hosts.some(h=>u.hostname===h||u.hostname==='www.'+h);}catch{return false;}}
function getPageTypeFromUrl(url){try{const p=new URL(url).pathname;if(p.includes('/product-reviews/'))return'reviews';if(p.includes('/dp/')||p.includes('/gp/product/'))return'product';}catch{}return'unknown';}
function getAsinFromUrl(url){try{const p=new URL(url).pathname;const m=p.match(/\/(?:dp|product-reviews|gp\/product)\/([A-Z0-9]{10})/i);return m?m[1].toUpperCase():null;}catch{return null;}}
async function getActiveTab(){return new Promise(r=>chrome.tabs.query({active:true,currentWindow:true},t=>r(t[0]||null)));}
async function sendToTab(tabId,msg){
  const res=await new Promise(r=>{chrome.tabs.sendMessage(tabId,msg,x=>{if(chrome.runtime.lastError)r(null);else r(x);});});
  if(res)return res;
  try{await chrome.scripting.executeScript({target:{tabId},files:['content.js']});await new Promise(r=>setTimeout(r,350));}catch(e){return{success:false,error:'inject:'+e.message};}
  return new Promise(r=>{chrome.tabs.sendMessage(tabId,msg,x=>{if(chrome.runtime.lastError)r({success:false,error:chrome.runtime.lastError.message});else r(x||{success:false,error:'no response'});});});
}

// ── Extract Listing ────────────────────────────────────────────────────────
btnExtract.addEventListener('click', async () => {
  clearError(); clearInfo();
  const tab = await getActiveTab();
  const asinFromUrl = getAsinFromUrl(tab.url);

  // Free-plan gate: 10 distinct ASINs/day
  if (asinFromUrl && window.LL_SUBSCRIPTION) {
    const gate = await window.LL_SUBSCRIPTION.checkAsinAllowed(asinFromUrl);
    if (!gate.allowed) {
      showError(gate.reason);
      showUpgradeBanner();
      return;
    }
  }

  showLoading('Extracting listing…');
  btnExtract.disabled = true;
  try {
    const res = await sendToTab(tab.id, {action:'extractListing'});
    if (!res?.success) throw new Error(res?.error||'Could not extract listing data.');
    if (!res.data.title && !res.data.asin) throw new Error('No product data found. Make sure you\'re on an Amazon /dp/ page.');
    currentListing=res.data; currentAsin=currentListing.asin;
    if (currentAsin && window.LL_SUBSCRIPTION) await window.LL_SUBSCRIPTION.recordAsinSeen(currentAsin);
    renderListingData(currentListing);
    tabsEl.classList.remove('hidden');
    btnAnalyze.disabled=false; btnExportJson.disabled=false; btnExtractReviews.disabled=false;
    btnOpenReviewPage.onclick = () => chrome.tabs.create({url:buildReviewUrl(currentAsin, tab.url), active:true});
    btnOpenReviewPage.classList.remove('hidden');
    await saveToCache({listingData:currentListing});
    await new Promise(r=>chrome.storage.local.set({listinglens_last_asin: currentAsin}, r));
    checkCache(currentAsin);
    switchTab('listing');
    btnExtract.textContent='↺ Re-extract';
    updateDataQuality({listingData:currentListing});
    setStatus('Listing extracted','ok');
    await refreshPlanBadge();
  } catch(err){showError(err.message);}
  finally{hideLoading();btnExtract.disabled=false;}
});

// ── Extract Visible Reviews ────────────────────────────────────────────────
btnExtractReviews.addEventListener('click', async () => {
  clearError(); clearInfo();
  const tab = await getActiveTab();
  const pageType = getPageTypeFromUrl(tab.url);

  // On product page → open review page
  if (pageType === 'product' || pageType === 'unknown') {
    if (!currentAsin) { showError('Extract the listing first to get the ASIN.'); return; }
    chrome.tabs.create({url:buildReviewUrl(currentAsin, tab.url), active:true});
    showInfo('Opening review page. Manually click “Show 10 more reviews” until enough reviews are visible, then click “Capture Visible Reviews”.');
    return;
  }

  // On review page → extract DOM reviews
  showLoading('Capturing visible reviews…');
  btnExtractReviews.disabled = true;
  try {
    const res = await sendToTab(tab.id, {action:'extractReviews'});
    if (!res?.success) {
      if (res?.loginRequired) throw new Error('Amazon requires sign-in. Use a separate buyer-only browser profile (not Seller Central).');
      if (res?.captcha) throw new Error('CAPTCHA detected. Solve it first, then try again.');
      throw new Error(res?.error||'Could not extract reviews.');
    }
    if (!currentAsin && res.asin) currentAsin = res.asin;
    // Merge into cache
    const existing = await new Promise(r=>chrome.storage.local.get(cacheKey(currentAsin),d=>r(d[cacheKey(currentAsin)]||{})));
    if (!Array.isArray(existing.reviews)) existing.reviews=[];
    const priorReviews = [...(existing.reviews||[]), ...(existing.manualPastedReviews||[])];
    const urlSeen  = new Set(priorReviews.filter(r=>r.reviewUrl).map(r=>r.reviewUrl));
    const hashSeen = new Set(priorReviews.map(r=>`${r.rating}|${(r.title||'').substring(0,30)}|${(r.body||'').substring(0,60)}|${r.date}|${r.variant||''}`));
    const newOnes  = (res.reviews||[]).filter(r=>{if(r.reviewUrl&&urlSeen.has(r.reviewUrl))return false;return !hashSeen.has(`${r.rating}|${(r.title||'').substring(0,30)}|${(r.body||'').substring(0,60)}|${r.date}|${r.variant||''}`);});
    const merged   = [...existing.reviews, ...newOnes];
    const updated  = {...existing, reviews:merged, limitedReviews:res.limitedReviews, totalReviewCount:res.totalReviewCount, lastCollectedAt:new Date().toISOString()};
    if (!updated.listingData && currentListing) updated.listingData=currentListing;
    await new Promise(r=>chrome.storage.local.set({[cacheKey(currentAsin)]:updated, listinglens_last_asin: currentAsin},r));
    renderReviews(merged);
    tabsEl.classList.remove('hidden');
    btnExportCsv.disabled=false; btnClearReviews.disabled=false; btnAnalyze.disabled=false;
    switchTab('reviews');
    updateDataQuality(updated);
    setStatus(`${merged.length} reviews saved`,'reviews');
    const limitMsg = res.limitedReviews ? ' Amazon is showing a limited review selection — you can paste additional reviews manually below.' : '';
    showInfo(`Found ${(res.reviews||[]).length} visible reviews. Added ${newOnes.length} new reviews. Saved total: ${merged.length}.${limitMsg}`);
  } catch(err){showError(err.message);}
  finally{hideLoading();btnExtractReviews.disabled=false;}
});

// ── Manual Paste Reviews ───────────────────────────────────────────────────
btnAddPasted.addEventListener('click', async () => {
  // GUARD: must have ASIN first
  if (!currentAsin) {
    showError('Extract a listing first so pasted reviews can be attached to an ASIN.');
    return;
  }
  const raw = pasteInput.value.trim();
  if (!raw) { showError('Nothing to paste. Add some review text first.'); return; }
  clearError();

  const blocks = raw.split(/\n{2,}/).map(b=>b.trim()).filter(b=>b.length>10);
  if (!blocks.length) { showError('Could not parse any reviews. Separate multiple reviews with a blank line.'); return; }

  const parsed = blocks.map(block => {
    const starMatch  = block.match(/★+|☆+/);
    const starCount  = (block.match(/★/g)||[]).length;
    const numRating  = block.match(/(\d(?:\.\d)?)\s*(?:out of\s*5|\/5|stars?)/i);
    const rating     = starCount > 0 ? starCount : (numRating ? parseFloat(numRating[1]) : null);
    const lines      = block.split('\n').map(l=>l.trim()).filter(Boolean);
    const title      = lines.length > 1 && lines[0].length < 100 ? lines[0].replace(/^[★☆\s\d\/outfsa-z]+/i,'').trim() : '';
    const body       = title ? lines.slice(1).join(' ') : block;
    return {
      title, body:body.substring(0,1000),
      rating:rating&&rating>0&&rating<=5?rating:null, ratingText:'',
      date:'', verified:false, helpfulVotes:0, variant:'',
      reviewUrl:'', sourceUrl:'manual_paste',
      collectMode:'manual_paste', collectedAt:new Date().toISOString(),
    };
  });

  const existing = await new Promise(r=>chrome.storage.local.get(cacheKey(currentAsin),d=>r(d[cacheKey(currentAsin)]||{})));
  if (!Array.isArray(existing.manualPastedReviews)) existing.manualPastedReviews=[];
  const bodySet = new Set(existing.manualPastedReviews.map(r=>r.body.substring(0,60)));
  const newOnes = parsed.filter(r=>!bodySet.has(r.body.substring(0,60)));
  existing.manualPastedReviews = [...existing.manualPastedReviews, ...newOnes];
  if (!existing.listingData && currentListing) existing.listingData=currentListing;
  await new Promise(r=>chrome.storage.local.set({[cacheKey(currentAsin)]:existing, listinglens_last_asin: currentAsin},r));

  const allReviews = [...(existing.reviews||[]),...existing.manualPastedReviews];
  renderReviews(allReviews);
  btnExportCsv.disabled=false; btnClearReviews.disabled=false; btnAnalyze.disabled=false;
  updateDataQuality(existing);
  pasteInput.value='';
  showInfo(`${newOnes.length} pasted reviews added (${parsed.length-newOnes.length} duplicate${parsed.length-newOnes.length!==1?'s':''} skipped).`);
});

// ── Clear Reviews ──────────────────────────────────────────────────────────
btnClearReviews.addEventListener('click', async () => {
  if (!confirm(`Clear all captured reviews for ${currentAsin}?`)) return;
  const existing = await new Promise(r=>chrome.storage.local.get(cacheKey(currentAsin),d=>r(d[cacheKey(currentAsin)]||{})));
  existing.reviews=[]; existing.manualPastedReviews=[]; existing.limitedReviews=false;
  await new Promise(r=>chrome.storage.local.set({[cacheKey(currentAsin)]:existing, listinglens_last_asin: currentAsin},r));
  reviewList.innerHTML=''; reviewSummary.classList.add('hidden');
  btnExportCsv.disabled=true; btnClearReviews.disabled=true;
  updateDataQuality(existing); showInfo('Reviews cleared.');
});

btnOpenReviewPage.addEventListener('click', async e => {
  e.preventDefault();
  if (!currentAsin) return;
  const tab = await getActiveTab();
  chrome.tabs.create({url:buildReviewUrl(currentAsin, tab?.url), active:true});
});

// ── Render Listing ─────────────────────────────────────────────────────────
function renderListingData(d) {
  listingContent.innerHTML='';
  function addRow(key,val,mono=false){if(!val)return;const k=document.createElement('div');k.className='listing-key';k.textContent=key;const v=document.createElement('div');v.className='listing-val'+(mono?' mono':'');v.textContent=val;listingContent.appendChild(k);listingContent.appendChild(v);}
  function addHeading(t){const h=document.createElement('div');h.className='listing-section-heading';h.textContent=t;listingContent.appendChild(h);}
  addRow('ASIN',d.asin,true);addRow('Title',d.title);addRow('Brand',d.brand);addRow('Price',d.price);addRow('Rating',d.rating);addRow('Reviews',d.reviewCount);
  if(d.bullets?.length){addHeading('Features');const ul=document.createElement('ul');ul.className='bullet-list';ul.style.gridColumn='1/-1';d.bullets.forEach(b=>{const li=document.createElement('li');li.textContent=b;ul.appendChild(li);});listingContent.appendChild(ul);}
  if(d.description){addHeading('Description');const v=document.createElement('div');v.className='listing-val';v.style.cssText='grid-column:1/-1;font-size:11px;color:var(--muted);';v.textContent=d.description;listingContent.appendChild(v);}
  if(d.productDetails){const entries=Object.entries(d.productDetails).slice(0,12);if(entries.length){addHeading('Product Details');entries.forEach(([k,v])=>addRow(k,v));}}
}

// ── Render Reviews ─────────────────────────────────────────────────────────
function renderReviews(reviews) {
  if (!reviews?.length) return;
  const pos=reviews.filter(r=>r.rating>=4).length,neg=reviews.filter(r=>r.rating!==null&&r.rating<=2).length;
  const ratings=reviews.filter(r=>r.rating!==null).map(r=>r.rating);
  const avg=ratings.length?(ratings.reduce((a,b)=>a+b,0)/ratings.length).toFixed(1):'—';
  reviewSummary.innerHTML=`
    <div class="review-stat"><div class="review-stat-val">${esc(String(reviews.length))}</div><div class="review-stat-lbl">Total</div></div>
    <div class="review-stat"><div class="review-stat-val" style="color:var(--success)">${esc(String(pos))}</div><div class="review-stat-lbl">★4–5</div></div>
    <div class="review-stat"><div class="review-stat-val" style="color:var(--error)">${esc(String(neg))}</div><div class="review-stat-lbl">★1–2</div></div>
    <div class="review-stat"><div class="review-stat-val" style="color:var(--warning)">${esc(String(avg))}</div><div class="review-stat-lbl">Avg</div></div>
  `;
  reviewSummary.classList.remove('hidden');
  reviewList.innerHTML='';
  reviews.forEach(r=>{
    const card=document.createElement('div');card.className='review-card';
    const n=Math.round(r.rating||0),stars='★'.repeat(Math.min(5,n))+'☆'.repeat(Math.max(0,5-n));
    // Source badge: treat click/url/auto_collect all as "auto"
    const isAuto=['auto_collect','click','url'].includes(r.collectMode);
    const sourceBadge=r.collectMode==='manual_paste'?'<span class="badge-page">pasted</span>':isAuto?'<span class="badge-page">auto</span>':'';
    const badges=[r.verified?'<span class="badge-verified">VERIFIED</span>':'',r.variant?`<span class="badge-variant">${esc(r.variant)}</span>`:'',r.helpfulVotes>0?`<span class="badge-helpful">${esc(String(r.helpfulVotes))} helpful</span>`:'',sourceBadge].join('');
    card.innerHTML=`<div class="review-card-header"><span class="review-stars">${stars}</span><div class="review-meta">${badges}<span>${esc(r.date)}</span></div></div>${r.title?`<div class="review-title">${esc(r.title)}</div>`:''}<div class="review-body">${esc(r.body)}</div>`;
    reviewList.appendChild(card);
  });
}

// ── Analyze ────────────────────────────────────────────────────────────────
btnAnalyze.addEventListener('click', async () => {
  clearError();

  // Pro-plan gate: Free cannot Analyze at all; Pro has a monthly cap.
  if (window.LL_SUBSCRIPTION) {
    const gate = await window.LL_SUBSCRIPTION.checkAnalyzeAllowed();
    if (!gate.allowed) {
      showError(gate.reason);
      if (gate.requiresUpgrade) showUpgradeBanner();
      return;
    }
  }

  const settings = await loadSettings();

  // AI Mode check
  if (settings.aiMode === 'cloud') {
    showError('ListingLens Cloud AI is coming soon. Please use OpenAI or Gemini with your own API key for now.');
    return;
  }
  const providerKey = settings.provider === 'gemini' ? settings.geminiApiKey : settings.apiKey;
  if (!providerKey) {
    const providerName = settings.provider === 'gemini' ? 'Gemini' : 'OpenAI';
    showError(`${providerName} API key missing. Open Settings → enter your ${providerName} API key.`);
    return;
  }

  const cache = currentAsin ? await new Promise(r=>chrome.storage.local.get(cacheKey(currentAsin),d=>r(d[cacheKey(currentAsin)]||{}))) : {};
  const listing       = currentListing||cache.listingData||null;
  const visibleReviews= cache.reviews||[];
  const pastedReviews = cache.manualPastedReviews||[];
  const allReviews    = [...visibleReviews,...pastedReviews];

  if (!listing && !allReviews.length) { showError('Extract a listing or add reviews first.'); return; }

  const category  = categorySelect.value;
  const checklist = CATEGORY_CHECKLISTS[category] || CATEGORY_CHECKLISTS.generic;

  showLoading('Analyzing — generating insights… (20–90s). Keep this window open, or use Full App for long reports.');
  btnAnalyze.disabled = true;
  stopPolling();
  try {
    const report = await callAI(listing, allReviews, visibleReviews.length, pastedReviews.length, cache.limitedReviews, category, checklist, settings);
    currentReport=report; renderReport(report); btnCopyReport.disabled=false; btnExportMd.disabled=false; switchTab('report');
    await saveToCache({aiReport:report});
    // Only count successful reports toward the monthly Pro limit
    if (window.LL_SUBSCRIPTION) await window.LL_SUBSCRIPTION.recordReportUsed();
    await refreshPlanBadge();
  } catch(err){showError(err.message);}
  finally{hideLoading();btnAnalyze.disabled=false;startPolling();}
});

async function loadSettings() {
  return new Promise(r=>chrome.storage.local.get(['apiKey','geminiApiKey','provider','model','geminiModel','maxTokens','temperature','aiMode','cloudEndpoint','cloudToken'],items=>r({
    apiKey:       items.apiKey||'',
    geminiApiKey: items.geminiApiKey||'',
    provider:     items.provider||'openai',    // 'openai' | 'gemini'
    model:        items.model||'gpt-4o-mini',
    geminiModel:  items.geminiModel||'gemini-2.5-flash',
    maxTokens:    items.maxTokens||2200,
    temperature:  items.temperature!==undefined?items.temperature:0.4,
    aiMode:       items.aiMode||'byo',         // 'byo' | 'cloud'
    cloudEndpoint:items.cloudEndpoint||'',
    cloudToken:   items.cloudToken||'',
  })));
}

// ── Evidence-based AI prompt with category checklist ──────────────────────
function buildPrompts(listing, reviews, visibleCount, pastedCount, limitedReviews, category, checklist) {
  const total = reviews.length;
  let dqNote;
  if(total===0&&!listing)      dqNote=`No listing or review data.`;
  else if(total===0)           dqNote=`Listing data only — all insights are listing-inferred. No reviews available.`;
  else if(total<=4)            dqNote=`Weak review signal (${total} reviews). Insights are partially review-backed, partially inferred.`;
  else if(total<=19)           dqNote=`Useful review sample (${total} reviews — ${visibleCount} visible, ${pastedCount} pasted).`;
  else                         dqNote=`Strong review sample (${total} reviews — ${visibleCount} visible, ${pastedCount} pasted).`;
  if(limitedReviews) dqNote+=' Amazon showed a limited review selection for this session.';

  const sorted=[...reviews].sort((a,b)=>{
    const aN=a.rating!==null&&a.rating<=2,bN=b.rating!==null&&b.rating<=2;
    if(aN&&!bN)return -1;if(!aN&&bN)return 1;
    return(b.helpfulVotes||0)-(a.helpfulVotes||0);
  }).slice(0,50);

  const payload={
    listingData:listing?{asin:listing.asin,title:listing.title,brand:listing.brand,price:listing.price,rating:listing.rating,reviewCount:listing.reviewCount,bullets:listing.bullets,description:listing.description?.substring(0,800),productDetails:listing.productDetails}:null,
    reviewData:{totalReviews:total,visibleCount,pastedCount,limitedReviews:!!limitedReviews,dataQualityNote:dqNote,reviews:sorted.map(r=>({rating:r.rating,title:r.title,body:r.body.substring(0,600),verified:r.verified,helpfulVotes:r.helpfulVotes,variant:r.variant,source:r.collectMode||'visible_dom'}))},
    category:category==='auto'?'auto-detect from listing':category,
    categoryChecklist:checklist,
  };

  const systemPrompt=`You are an expert Amazon listing conversion strategist, review mining specialist, and return-risk copywriter.

Your role: analyze Amazon listing data and customer reviews, then generate evidence-based insights and ready-to-use copy that reduces expectation gaps, lowers return risk, and improves listing clarity.

CRITICAL RULES:
1. Tag EVERY insight: [listing] [review] or [inferred] + confidence: High / Medium / Low
2. Do NOT invent review quotes. Only use language from provided reviews.
3. Turn every gap into a specific actionable fix.
4. For supplements/health/baby: never write unverified medical/cure/treat claims.
5. If fewer than 5 reviews: state "review signal is limited" but still give listing-based insights.
6. In "Complaint Counter" section: if no competitor data is provided, use product-type objections and label [inferred]. Do not claim competitor-specific weaknesses without evidence.
7. Prioritize expectation gaps → return-risk signals → conversion copy.`;

  const userPrompt=`Analyze this Amazon listing and ${total} customer reviews.

CATEGORY: ${category} (${category === 'auto' ? 'auto-detect' : category})
CATEGORY CHECKLIST (prioritize these areas): ${checklist.join(', ')}

DATA QUALITY: ${dqNote}

Return analysis in EXACTLY this structure:

## 1. Executive Summary
4–5 bullets:
- Main buyer motivation [source]
- Main conversion blocker [source]
- Biggest expectation gap [source]
- Top copy opportunity
- Return-risk warning (if detected) [source]

## 2. Data Quality Note
- Listing extracted: Yes/No
- Visible reviews: ${visibleCount}
- Pasted reviews: ${pastedCount}
- Signal strength: (No data / Listing only / Weak / Useful / Strong)
- Amazon limited review state: ${limitedReviews?'Yes':'No'}
- Category focus: ${category}

## 3. Listing Gap Finder
For each gap — prioritize category checklist items:
**Gap:** [name]
**Evidence:** [what triggered this]
**Source:** [listing / review / inferred]
**Confidence:** [High / Medium / Low]
**Fix:** [specific change]

## 4. Negative Review Shield
For each complaint pattern (or likely for this product type if no reviews):
**Complaint/Risk:** [description]
**Why it matters:** [return/conversion impact]
**Bullet fix:** [ready-to-use bullet text]
**Image text fix:** [image copy suggestion]
**Expectation note:** [what buyer should know upfront]

## 5. Complaint Counter & Positioning Opportunities
If no competitor listing/review data is provided, use product-type objections and label [inferred].
List 4–6 common objections for this product type, then for each:
**Objection:** [what buyers worry about]
**Counter:** [how to address in listing copy]

## 6. Copy Output

### 6A. Title Rewrite Options
1. **SEO-balanced:** [keywords + main benefit]
2. **Conversion-focused:** [strongest benefit first]
3. **Clarity/expectation-safe:** [explicit, reduces mismatch risk]

### 6B. Bullet Point Rewrites
5 bullets labeled: [Benefit] [Material/Quality] [Use case] [Process/Installation] [Risk reducer]

### 6C. Image Text Ideas
Image 1–8 covering: main benefit, size/specs, steps/process, use cases, material, what's in box, gift/occasion, comparison/why-us

### 6D. Review-to-Ad Angles
8 angles: problem-solution, gift, emotional, practical, objection-counter, before-after, urgency/occasion, category-specific angle

## 7. Compliance & Claim Risk
For each risk found:
**Risk:** [description]
**Evidence:** [what triggered this]
**Source:** [listing / review / inferred]
**Confidence:** [High / Medium / Low]
**Fix:** [specific change]

Check: medical/cure claims, unsupported certifications, misleading guarantees, keyword stuffing, competitor brand mentions, exaggerated superlatives without proof, special characters

## 8. Final Listing Score
For each: Score /10 | Reason (1 sentence) | Fast fix (1 action)
- **Clarity:** /10
- **Trust:** /10
- **Differentiation:** /10
- **Expectation Match:** /10
- **Conversion Potential:** /10
- **Return-Risk Control:** /10

---
Data:
${JSON.stringify(payload,null,2)}`;

  return { systemPrompt, userPrompt };
}

// ── Provider dispatcher ─────────────────────────────────────────────────
async function callAI(listing, reviews, visibleCount, pastedCount, limitedReviews, category, checklist, settings) {
  const { systemPrompt, userPrompt } = buildPrompts(listing, reviews, visibleCount, pastedCount, limitedReviews, category, checklist);
  if (settings.provider === 'gemini') {
    return callGemini(systemPrompt, userPrompt, settings);
  }
  return callOpenAI(systemPrompt, userPrompt, settings);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 90000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error(`AI request timed out after ${Math.round(timeoutMs/1000)} seconds. Try again, reduce Max Tokens, or switch model/provider.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── OpenAI provider ────────────────────────────────────────────────────
async function callOpenAI(systemPrompt, userPrompt, settings) {
  const body = JSON.stringify({model:settings.model,max_tokens:settings.maxTokens,temperature:settings.temperature,messages:[{role:'system',content:systemPrompt},{role:'user',content:userPrompt}]});

  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${settings.apiKey}`},
      body,
    }, 90000);

    if (res.ok) {
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (!text) throw new Error('OpenAI returned an empty response.');
      return text;
    }

    const errBody = await res.json().catch(()=>({}));
    const msg = errBody?.error?.message || `HTTP ${res.status}`;

    if (res.status === 401) throw new Error('Invalid OpenAI API key. Check Settings.');
    if (res.status === 400) throw new Error(`OpenAI rejected the request: ${msg}`);

    if (res.status === 429) {
      if (/quota|insufficient_quota|billing/i.test(msg)) {
        throw new Error('OpenAI quota exceeded. Add a payment method at platform.openai.com/settings/billing — or switch to Gemini (free) in Settings.');
      }
      lastErr = new Error('Rate limit reached. Retrying…');
      if (attempt < 2) { await new Promise(r => setTimeout(r, 1500 * Math.pow(2, attempt))); continue; }
      throw new Error('OpenAI rate limit reached after retries. New keys without billing have very low limits — add billing, or switch to Gemini (free) in Settings.');
    }

    throw new Error(`OpenAI error: ${msg}`);
  }
  throw lastErr || new Error('OpenAI request failed after retries.');
}

// ── Gemini provider (free tier) ──────────────────────────────────────────
async function callGemini(systemPrompt, userPrompt, settings) {
  const model = settings.geminiModel || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${settings.geminiApiKey}`;
  const body = JSON.stringify({
    contents: [{ role:'user', parts:[{ text: userPrompt }] }],
    systemInstruction: { parts:[{ text: systemPrompt }] },
    generationConfig: { temperature: settings.temperature, maxOutputTokens: settings.maxTokens },
  });

  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetchWithTimeout(url, { method:'POST', headers:{'Content-Type':'application/json'}, body }, 90000);

    if (res.ok) {
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.map(p=>p.text).join('') || '';
      if (!text) throw new Error('Gemini returned an empty response. Try again or switch model in Settings.');
      return text;
    }

    const errBody = await res.json().catch(()=>({}));
    const msg = errBody?.error?.message || `HTTP ${res.status}`;

    if (res.status === 400 && /API key not valid/i.test(msg)) throw new Error('Invalid Gemini API key. Check Settings.');
    if (res.status === 403) throw new Error('Gemini API key rejected (403). Check it is enabled at aistudio.google.com.');

    if (res.status === 429) {
      lastErr = new Error('Gemini rate limit reached. Retrying…');
      if (attempt < 2) { await new Promise(r => setTimeout(r, 1500 * Math.pow(2, attempt))); continue; }
      throw new Error('Gemini free tier rate limit reached (15 requests/min). Wait a minute and try again.');
    }

    throw new Error(`Gemini error: ${msg}`);
  }
  throw lastErr || new Error('Gemini request failed after retries.');
}

// ── Render Report ──────────────────────────────────────────────────────────
function renderReport(t){
  reportContent.innerHTML='';
  const parts=t.split(/^(##\s+.+)$/gm);
  if(parts.length<=1){const p=document.createElement('div');p.style.whiteSpace='pre-wrap';p.textContent=t;reportContent.appendChild(p);return;}
  if(parts[0].trim()){const p=document.createElement('div');p.style.cssText='color:var(--muted);margin-bottom:10px;font-size:12px;white-space:pre-wrap;';p.textContent=parts[0].trim();reportContent.appendChild(p);}
  for(let i=1;i<parts.length;i+=2){
    const h=(parts[i]||'').replace(/^##\s*/,'').trim(),b=(parts[i+1]||'').trim();
    const title=document.createElement('div');title.className='report-section-title';title.textContent=h;reportContent.appendChild(title);
    if(/final listing score/i.test(h)){reportContent.appendChild(renderScoreSection(b));}
    else{reportContent.appendChild(renderMarkdownLite(b));}
  }
}
function renderMarkdownLite(text){
  const w=document.createElement('div');w.style.cssText='font-size:12px;line-height:1.7;color:#d1d8e8;';
  const parts=text.split(/^(###\s+.+)$/gm);
  parts.forEach(part=>{
    if(part.startsWith('###')){const h=document.createElement('div');h.style.cssText='font-size:11px;font-weight:700;color:var(--secondary);margin:10px 0 4px;text-transform:uppercase;letter-spacing:0.05em;';h.textContent=part.replace(/^###\s*/,'').trim();w.appendChild(h);}
    else if(part.trim()){const p=document.createElement('div');p.style.whiteSpace='pre-wrap';p.innerHTML=esc(part.trim()).replace(/\*\*([^*]+)\*\*/g,'<strong style="color:var(--text)">$1</strong>');w.appendChild(p);}
  });
  return w;
}
function renderScoreSection(text){
  const w=document.createElement('div');
  const P=[{key:'Clarity',re:/\*\*clarity[:\s*]+(\d+(?:\.\d+)?)\s*\/\s*10/i},{key:'Trust',re:/\*\*trust[:\s*]+(\d+(?:\.\d+)?)\s*\/\s*10/i},{key:'Differentiation',re:/\*\*differentiation[:\s*]+(\d+(?:\.\d+)?)\s*\/\s*10/i},{key:'Expectation',re:/\*\*expectation[^:*]*[:\s*]+(\d+(?:\.\d+)?)\s*\/\s*10/i},{key:'Conversion',re:/\*\*conversion[^:*]*[:\s*]+(\d+(?:\.\d+)?)\s*\/\s*10/i},{key:'Return-Risk',re:/\*\*return[^:*]*[:\s*]+(\d+(?:\.\d+)?)\s*\/\s*10/i}];
  const scores=P.map(p=>{const m=text.match(p.re);return m?{label:p.key,value:m[1]}:null;}).filter(Boolean);
  if(scores.length){const g=document.createElement('div');g.className='score-grid';g.style.gridTemplateColumns='repeat(3,1fr)';scores.forEach(({label,value})=>{const n=parseFloat(value),color=n>=8?'var(--success)':n>=6?'var(--warning)':'var(--error)';const c=document.createElement('div');c.className='score-card';c.innerHTML=`<div class="score-label">${esc(label)}</div><div class="score-value" style="color:${color}">${esc(value)}/10</div>`;g.appendChild(c);});w.appendChild(g);}
  w.appendChild(renderMarkdownLite(text));
  return w;
}

// ── Export JSON ────────────────────────────────────────────────────────────
btnExportJson.addEventListener('click', async () => {
  const asin=currentAsin||'UNKNOWN',date=new Date().toISOString().split('T')[0];
  const cache=currentAsin?await new Promise(r=>chrome.storage.local.get(cacheKey(currentAsin),d=>r(d[cacheKey(currentAsin)]||{}))):{};
  downloadBlob(new Blob([JSON.stringify({generatedAt:new Date().toISOString(),listingData:currentListing||cache.listingData,reviews:cache.reviews||[],manualPastedReviews:cache.manualPastedReviews||[],dataQuality:{listing:!!(cache.listingData),visibleReviews:cache.reviews?.length||0,pastedReviews:cache.manualPastedReviews?.length||0,limitedReviews:!!cache.limitedReviews},aiReport:currentReport||cache.aiReport},null,2)],{type:'application/json'}),`listinglens-${asin}-${date}.json`);
});

// ── Export CSV (includes source_url) ──────────────────────────────────────
btnExportCsv.addEventListener('click', async () => {
  const asin=currentAsin||'UNKNOWN',title=currentListing?.title||'',date=new Date().toISOString().split('T')[0];
  const cache=currentAsin?await new Promise(r=>chrome.storage.local.get(cacheKey(currentAsin),d=>r(d[cacheKey(currentAsin)]||{}))):{};
  const reviews=[...(cache.reviews||[]),...(cache.manualPastedReviews||[])];
  if(!reviews.length){showError('No reviews to export.');return;}
  const header='asin,product_title,source,source_url,review_rating,review_title,review_body,verified,date,helpful_votes,variant,review_url,collected_at';
  const rows=reviews.map(r=>[csvEsc(asin),csvEsc(title),csvEsc(r.collectMode||'visible_dom'),csvEsc(r.sourceUrl||''),r.rating??'',csvEsc(r.title),csvEsc(r.body),r.verified?'yes':'no',csvEsc(r.date),r.helpfulVotes??0,csvEsc(r.variant),csvEsc(r.reviewUrl),csvEsc(r.collectedAt)].join(','));
  downloadBlob(new Blob([[header,...rows].join('\n')],{type:'text/csv'}),`listinglens-reviews-${asin}-${date}.csv`);
});

// ── Export Markdown ────────────────────────────────────────────────────────
btnExportMd.addEventListener('click', () => {
  if (!currentReport) return;
  const asin=currentAsin||'UNKNOWN',date=new Date().toISOString().split('T')[0];
  downloadBlob(new Blob([`# ListingLens Report — ${asin}\nGenerated: ${new Date().toLocaleString()}\n\n---\n\n${currentReport}`],{type:'text/markdown'}),`listinglens-report-${asin}-${date}.md`);
});

function csvEsc(s){return'"'+String(s||'').replace(/"/g,'""')+'"';}
function downloadBlob(b,n){const u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download=n;a.click();URL.revokeObjectURL(u);}

// ── Copy Report ────────────────────────────────────────────────────────────
btnCopyReport.addEventListener('click', async () => {
  if (!currentReport) return;
  try{await navigator.clipboard.writeText(currentReport);const o=btnCopyReport.textContent;btnCopyReport.textContent='Copied!';btnCopyReport.style.color='var(--success)';setTimeout(()=>{btnCopyReport.textContent=o;btnCopyReport.style.color='';},1800);}
  catch{showError('Clipboard unavailable.');}
});

// ── Advanced Auto Collect ──────────────────────────────────────────────────
btnStartCollect.addEventListener('click', async () => {
  if (!advUnderstand.checked) return;
  const tab=await getActiveTab();
  if (getPageTypeFromUrl(tab.url)!=='reviews'){showError('Open the Amazon review page first.');return;}
  const asinFromUrl=tab.url.match(/\/product-reviews\/([A-Z0-9]{10})/i)?.[1]?.toUpperCase();
  const asin=currentAsin||asinFromUrl;
  if (!asin){showError('Could not detect ASIN.');return;}
  currentAsin=asin;
  // Clamp limits for safety
  const maxClicks  = Math.min(Math.max(parseInt($('adv-max-clicks')?.value||'5',10),1),10);
  const maxReviews = 50; // fixed at 50 for safety
  const delaySec   = Math.max(parseInt($('adv-delay')?.value||'7',10),5);
  chrome.runtime.sendMessage({action:'START_AUTO_COLLECT',asin,tabId:tab.id,currentUrl:tab.url,startPage:1,maxClicks,maxReviews,delaySeconds:delaySec,domain:new URL(tab.url).hostname},res=>{if(!res?.success)showError('Could not start collector.');});
});
btnStopCollect.addEventListener('click',()=>chrome.runtime.sendMessage({action:'STOP_AUTO_COLLECT'}));
btnSettings.addEventListener('click',()=>chrome.runtime.openOptionsPage());

function openFullApp() {
  const query = currentAsin ? `?asin=${encodeURIComponent(currentAsin)}` : '';
  chrome.tabs.create({ url: chrome.runtime.getURL(`app.html${query}`), active: true });
}
if (btnOpenFullApp) btnOpenFullApp.addEventListener('click', openFullApp);
if (btnOpenFullAppFooter) btnOpenFullAppFooter.addEventListener('click', openFullApp);

init();
