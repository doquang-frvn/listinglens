// background.js — ListingLens v1.4.0
// Auto Collect: Click Append Mode (primary) + URL Token Mode (fallback)
// State lives in chrome.storage.local — survives popup open/close.

const JOB_KEY    = 'listinglens_active_job';
const ALARM_NAME = 'listinglens_next_step';

// ── Storage helpers ───────────────────────────────────────────────────────
const getJob    = ()         => new Promise(r => chrome.storage.local.get(JOB_KEY,          d => r(d[JOB_KEY]||null)));
const saveJob   = job        => new Promise(r => chrome.storage.local.set({[JOB_KEY]:job},  r));
const clearJob  = ()         => new Promise(r => chrome.storage.local.remove(JOB_KEY,       r));
const cacheKey  = asin       => `listinglens_cache_${asin}`;
const getCache  = asin       => new Promise(r => chrome.storage.local.get(cacheKey(asin),   d => r(d[cacheKey(asin)]||null)));
const saveCache = (asin,data)=> new Promise(r => chrome.storage.local.set({[cacheKey(asin)]:data}, r));

// ── Deduplicate + merge reviews ───────────────────────────────────────────
function mergeReviews(existing, incoming, collectMode) {
  if (!Array.isArray(existing))  existing  = [];
  if (!Array.isArray(incoming))  incoming  = [];
  const urlSeen  = new Set(existing.filter(r=>r.reviewUrl).map(r=>r.reviewUrl));
  const hashSeen = new Set(existing.map(r=>`${r.rating}|${(r.title||'').substring(0,30)}|${(r.body||'').substring(0,60)}|${r.date}|${r.variant}`));
  let added = 0;
  const merged = [...existing];
  for (const r of incoming) {
    if (r.reviewUrl && urlSeen.has(r.reviewUrl)) continue;
    const h = `${r.rating}|${(r.title||'').substring(0,30)}|${(r.body||'').substring(0,60)}|${r.date}|${r.variant}`;
    if (hashSeen.has(h)) continue;
    r.collectMode   = collectMode || 'click';
    r.collectedAt   = r.collectedAt || new Date().toISOString();
    merged.push(r);
    added++;
    if (r.reviewUrl) urlSeen.add(r.reviewUrl);
    hashSeen.add(h);
  }
  return { merged, added };
}

// ── Ensure content.js is injected ────────────────────────────────────────
async function ensureContentScript(tabId) {
  const alive = await new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, {action:'ping'}, r => resolve(!chrome.runtime.lastError && r?.alive));
  });
  if (alive) return true;
  try {
    await chrome.scripting.executeScript({target:{tabId},files:['content.js']});
    await new Promise(r=>setTimeout(r,400));
    return true;
  } catch(e) { console.error('inject failed:',e); return false; }
}

// ── Send message to tab ───────────────────────────────────────────────────
function msgTab(tabId, message, timeout=25000) {
  return new Promise(resolve => {
    const t = setTimeout(() => resolve({success:false, error:'Tab message timeout'}), timeout);
    chrome.tabs.sendMessage(tabId, message, r => {
      clearTimeout(t);
      if (chrome.runtime.lastError) resolve({success:false,error:chrome.runtime.lastError.message});
      else resolve(r||{success:false,error:'No response'});
    });
  });
}

// ── Wait for tab to finish loading ────────────────────────────────────────
function waitForTabLoad(tabId, timeoutMs=15000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Tab load timeout'));
    }, timeoutMs);
    function listener(id, info) {
      if (id !== tabId || info.status !== 'complete') return;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(t);
      resolve();
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// ── Stop job ──────────────────────────────────────────────────────────────
async function stopJob(error=null, status='stopped', note=null) {
  chrome.alarms.clear(ALARM_NAME);
  const job = await getJob();
  if (!job) return;
  job.running   = false;
  job.status    = status;
  job.lastError = error;
  job.note      = note;
  job.updatedAt = new Date().toISOString();
  await saveJob(job);
  console.log('ListingLens job', status, error||note||'');
}

// ── Persist current reviews to cache ─────────────────────────────────────
async function persistToCache(job, newReviews, collectMode) {
  const cache = await getCache(job.asin) || {};
  if (!Array.isArray(cache.reviews))        cache.reviews        = [];
  if (!Array.isArray(cache.pagesCollected)) cache.pagesCollected = [];

  const { merged, added } = mergeReviews(cache.reviews, newReviews, collectMode);
  cache.reviews           = merged;
  cache.clickAppendCount  = (cache.clickAppendCount||0) + (added>0?1:0);
  cache.totalReviewCount  = job.totalReviewCount  || cache.totalReviewCount;
  cache.estimatedReviewPages = job.estimatedPages || cache.estimatedReviewPages;
  // Persist limitedReviews flag if detected during advanced collect
  if (job.limitedReviewsDetected) cache.limitedReviews = true;
  cache.lastCollectedAt   = new Date().toISOString();
  if (job.lastShowMoreState) cache.lastShowMoreState = job.lastShowMoreState;
  if (job.nextReviewsUrl)    cache.lastNextReviewsUrl = job.nextReviewsUrl;

  await saveCache(job.asin, cache);
  return { merged, added, total: merged.length };
}

// ── Main auto-collect step ────────────────────────────────────────────────
async function runCollectStep() {
  const job = await getJob();
  if (!job || !job.running) return;

  // Verify tab still open and on Amazon review page
  let tab;
  try { tab = await new Promise((res,rej) => chrome.tabs.get(job.tabId, t => chrome.runtime.lastError?rej():res(t))); }
  catch { await stopJob('Tab was closed.'); return; }

  if (!tab.url?.includes('/product-reviews/') && !tab.url?.includes('/dp/')) {
    await stopJob('Tab navigated away from Amazon review page.');
    return;
  }

  // Ensure script injected
  const injected = await ensureContentScript(job.tabId);
  if (!injected) { await stopJob('Could not inject content script.'); return; }

  job.status    = 'extracting';
  job.updatedAt = new Date().toISOString();
  await saveJob(job);

  // ── PRIMARY: Click Append Mode ─────────────────────────────────────────
  const clickRes = await msgTab(job.tabId, {action:'CLICK_SHOW_MORE_AND_WAIT', timeoutMs:22000}, 25000);

  // Handle login required
  if (clickRes.loginRequired) {
    await stopJob(
      'Amazon requires sign-in to view more reviews. Use a separate browser profile with a regular Amazon buyer account (not Seller Central).',
      'stopped'
    );
    return;
  }

  // Handle CAPTCHA
  if (clickRes.captcha) {
    await stopJob('Amazon CAPTCHA detected. Solve it manually, then restart collection.', 'stopped');
    return;
  }

  // No more reviews — completed naturally
  if (clickRes.noMore) {
    // Do a final extract of whatever's in DOM
    const finalRes = await msgTab(job.tabId, {action:'extractReviews'}, 10000);
    if (finalRes.success && finalRes.reviews?.length > 0) {
      await persistToCache(job, finalRes.reviews, 'click');
    }
    await stopJob(null, 'completed', 'No more reviews to load — reached last available batch.');
    return;
  }

  // Click succeeded — merge reviews
  if (clickRes.success && clickRes.reviews?.length > 0) {
    if (clickRes.showMore?.state?.pageNumber)    job.currentPage = parseInt(clickRes.showMore.state.pageNumber,10);
    if (clickRes.showMore?.state?.nextPageToken) job.lastShowMoreState = clickRes.showMore.state;
    if (clickRes.debugInfo?.totalReviewCount)    job.totalReviewCount  = clickRes.debugInfo.totalReviewCount;
    if (clickRes.debugInfo?.estimatedPages)      job.estimatedPages    = clickRes.debugInfo.estimatedPages;
    if (clickRes.limitedReviews) job.limitedReviewsDetected = true;
    job.nextReviewsUrl = clickRes.fallbackNextReviewsUrl || null;

    const { total, added } = await persistToCache(job, clickRes.reviews, 'click');
    job.collectedCount    = total;
    job.lastAddedCount    = added;
    job.clicksCompleted   = (job.clicksCompleted||0) + 1;
    job.consecutiveEmpty  = added === 0 ? (job.consecutiveEmpty||0)+1 : 0;
    job.updatedAt         = new Date().toISOString();
    // Stop gracefully if Amazon shows limited selection
    if (job.limitedReviewsDetected) {
      await stopJob(null, 'completed', 'Amazon is showing a limited review selection. Reviews collected so far are saved.');
      return;
    }

    // Check stop conditions
    if (total >= job.maxReviews) {
      await stopJob(null, 'completed', `Collected ${total} reviews — reached limit of ${job.maxReviews}.`);
      return;
    }
    if (job.clicksCompleted >= job.maxClicks) {
      await stopJob(null, 'completed', `Completed ${job.maxClicks} click batches.`);
      return;
    }
    if (job.consecutiveEmpty >= 2) {
      await stopJob(null, 'completed', 'No new reviews added in last 2 attempts — likely reached end.');
      return;
    }

    job.status = 'waiting';
    await saveJob(job);
    // Random delay: ±2s around set delay to appear more human
    const jitter = Math.random() * 4 - 2; // -2 to +2
    const delay  = Math.max(4, job.delaySeconds + jitter);
    chrome.alarms.create(ALARM_NAME, { delayInMinutes: delay/60 });
    return;
  }

  // ── FALLBACK: URL Token Mode ──────────────────────────────────────────
  if (clickRes.timeout || !clickRes.success) {
    const fallbackUrl = clickRes.fallbackNextReviewsUrl || job.nextReviewsUrl;

    if (!fallbackUrl) {
      await stopJob(`Click mode failed and no fallback URL available. Last error: ${clickRes.error}`);
      return;
    }

    console.log('ListingLens: click mode failed, trying URL fallback:', fallbackUrl);
    job.status    = 'fallback_navigating';
    job.updatedAt = new Date().toISOString();
    await saveJob(job);

    try {
      await new Promise((res,rej) => chrome.tabs.update(job.tabId, {url:fallbackUrl}, t => chrome.runtime.lastError?rej():res(t)));
      await waitForTabLoad(job.tabId, 12000);
      await new Promise(r => setTimeout(r, 3500)); // let Amazon render
    } catch(e) {
      await stopJob('URL fallback navigation failed: ' + e.message);
      return;
    }

    const injectedFb = await ensureContentScript(job.tabId);
    if (!injectedFb) { await stopJob('Post-fallback script injection failed.'); return; }

    const fbRes = await msgTab(job.tabId, {action:'extractReviews'}, 10000);

    if (!fbRes.success) {
      if (fbRes.loginRequired) {
        await stopJob('Amazon requires sign-in. Use a separate buyer-only browser profile.', 'stopped');
      } else if (fbRes.captcha) {
        await stopJob('CAPTCHA detected. Solve it manually then restart.', 'stopped');
      } else {
        await stopJob('Fallback extraction failed: ' + fbRes.error);
      }
      return;
    }

    if (fbRes.reviews?.length > 0) {
      const { total, added } = await persistToCache(job, fbRes.reviews, 'url');
      job.collectedCount   = total;
      job.lastAddedCount   = added;
      job.clicksCompleted  = (job.clicksCompleted||0) + 1;
    }

    if (job.collectedCount >= job.maxReviews || job.clicksCompleted >= job.maxClicks) {
      await stopJob(null, 'completed', `Reached limit after URL fallback. Total: ${job.collectedCount}`);
      return;
    }

    job.status    = 'waiting';
    job.updatedAt = new Date().toISOString();
    await saveJob(job);
    const delay = Math.max(4, job.delaySeconds + (Math.random()*4-2));
    chrome.alarms.create(ALARM_NAME, { delayInMinutes: delay/60 });
  }
}

// ── Alarm fires: run next step ─────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== ALARM_NAME) return;
  await runCollectStep();
});

// ── Message handler ────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.action === 'START_AUTO_COLLECT') {
    (async () => {
      chrome.alarms.clear(ALARM_NAME);
      const { asin, tabId, startPage, maxClicks, maxReviews, delaySeconds, domain } = msg;
      const job = {
        running:true, status:'starting',
        asin, domain, tabId,
        startPage: startPage||1, currentPage: startPage||1,
        maxClicks:  maxClicks||5,
        maxReviews: maxReviews||50,
        delaySeconds: delaySeconds||7,
        clicksCompleted:0, collectedCount:0, lastAddedCount:0, consecutiveEmpty:0,
        totalReviewCount:null, estimatedPages:null,
        lastShowMoreState:null, nextReviewsUrl:null,
        lastError:null, note:null,
        startedAt:new Date().toISOString(), updatedAt:new Date().toISOString(),
      };
      await saveJob(job);
      // First step: extract current DOM immediately, then start click loop
      setTimeout(runCollectStep, 1500);
      sendResponse({ success:true });
    })();
    return true;
  }

  if (msg.action === 'STOP_AUTO_COLLECT') {
    stopJob('Stopped by user.').then(() => sendResponse({success:true}));
    return true;
  }

  if (msg.action === 'GET_JOB') {
    getJob().then(job => sendResponse({job}));
    return true;
  }

  if (msg.action === 'CLEAR_JOB') {
    clearJob().then(() => sendResponse({success:true}));
    return true;
  }
});

chrome.tabs.onRemoved.addListener(async tabId => {
  const job = await getJob();
  if (job?.running && job.tabId===tabId) await stopJob('Tab was closed. Collection stopped.');
});

chrome.runtime.onInstalled.addListener(() => console.log('ListingLens v1.4.0 installed.'));
