// content.js — ListingLens v1.4.0
// Extracts listing + visible reviews. Detects limited-review state, login, CAPTCHA.

function getPageType() {
  const p = window.location.pathname;
  if (p.includes('/product-reviews/')) return 'reviews';
  if (p.includes('/dp/') || p.includes('/gp/product/')) return 'product';
  return 'unknown';
}

function extractAsin() {
  const m = window.location.pathname.match(/\/(?:dp|product-reviews|gp\/product)\/([A-Z0-9]{10})/i);
  if (m) return m[1].toUpperCase();
  const el = document.querySelector('#dp [data-asin],[data-asin]');
  if (el?.getAttribute('data-asin')) return el.getAttribute('data-asin').toUpperCase();
  return null;
}

function detectLoginRequired() {
  const url = window.location.href;
  if (url.includes('/ap/signin') || url.includes('/signin?')) return true;
  if (document.querySelector('#ap_email, input[name="email"]')) return true;
  const body = document.body?.textContent || '';
  return body.includes('Sign in') && body.includes('Email or mobile phone number');
}

function detectCaptcha() {
  if (document.querySelector('form[action*="validateCaptcha"]')) return true;
  const body = document.body?.textContent || '';
  return body.includes('Enter the characters you see below') || body.includes("make sure you're not a robot");
}

// Detect "We're showing a limited selection of reviews"
function detectLimitedReviews() {
  const body = document.body?.textContent || '';
  return body.includes('limited selection of reviews') || body.includes('To see more reviews, you can send a request');
}

function qs(selectors) {
  for (const sel of selectors) {
    try { const el = document.querySelector(sel); if (el) { const t = el.textContent.trim(); if (t) return t; } } catch {}
  }
  return null;
}

function extractTotalReviewCount() {
  for (const sel of ['[data-hook="total-review-count"]','.a-size-medium.a-color-secondary']) {
    for (const el of document.querySelectorAll(sel)) {
      const m = el.textContent.match(/([\d,]+)\s+(?:customer\s+reviews?|global\s+ratings?|ratings?)/i);
      if (m) return parseInt(m[1].replace(/,/g,''), 10);
    }
  }
  return null;
}

// ── Extract listing data ──────────────────────────────────────────────────
function extractListingData() {
  const data = { pageType: getPageType(), url: window.location.href, asin: extractAsin() };

  data.title = qs(['#productTitle','h1.a-size-large span','.product-title-word-break']);

  let brand = qs(['#bylineInfo','a#bylineInfo','#brand','.po-brand .po-break-word']);
  if (brand) brand = brand.replace(/^Brand:\s*/i,'').replace(/^Visit the\s+/i,'').replace(/\s+Store$/i,'').trim();
  data.brand = brand;

  data.price = qs(['.a-price .a-offscreen','#corePriceDisplay_desktop_feature_div .a-offscreen','.apexPriceToPay .a-offscreen','#price_inside_buybox','#priceblock_ourprice']);

  let rating = qs(['#acrPopover .a-icon-alt','#averageCustomerReviews .a-icon-alt']);
  if (rating) { const m = rating.match(/[\d.]+\s+out of\s+[\d.]+/i); if (m) rating = m[0]; }
  data.rating = rating;
  data.reviewCount = qs(['#acrCustomerReviewText','span[data-hook="total-review-count"]']);

  const bulletNodes = document.querySelectorAll('#feature-bullets ul li span.a-list-item,#featurebullets_feature_div ul li span.a-list-item');
  data.bullets = [...bulletNodes].map(n => n.textContent.trim())
    .filter(t => t.length > 2 && !t.toLowerCase().includes('make sure this fits'));

  const descParts = [...document.querySelectorAll('#productDescription p,#productDescription_feature_div p')]
    .map(n => n.textContent.trim()).filter(t => t.length > 10);
  data.description = descParts.join('\n\n').substring(0, 2000) || null;

  const aplusNode = document.querySelector('#aplus,#aplus3p_feature_div');
  data.aboutProduct = aplusNode ? aplusNode.textContent.replace(/\s+/g,' ').trim().substring(0,1500) : null;

  const details = {};
  document.querySelectorAll('#productDetails_techSpec_section_1 tr,#productDetails_db_sections tr,.prodDetTable tr,#detailBullets_feature_div li').forEach(row => {
    const k = row.querySelector('th,span.a-text-bold')?.textContent.replace(/[:\u200F\u200E\u00A0]/g,'').trim();
    const v = row.querySelector('td,span:not(.a-text-bold)')?.textContent.replace(/\s+/g,' ').trim();
    if (k && v && k.length < 80) details[k] = v;
  });
  data.productDetails = Object.keys(details).length > 0 ? details : null;

  const { reviews } = extractReviewsFromDOM();
  data.reviewsPreview = reviews;
  return data;
}

// ── Extract visible reviews ───────────────────────────────────────────────
function extractReviewsFromDOM() {
  const limitedReviews = detectLimitedReviews();

  let reviewNodes = [];
  for (const sel of ['[data-hook="review"]','#cm_cr-review_list div[data-hook="review"]','div[id^="customer_review-"]','.review[id^="customer_review"]']) {
    const found = [...document.querySelectorAll(sel)];
    if (found.length > reviewNodes.length) reviewNodes = found;
  }

  const totalReviewCount = extractTotalReviewCount();

  const reviews = reviewNodes.slice(0,100).map(node => {
    const titleEl   = node.querySelector('[data-hook="review-title"] span:not(.a-icon-alt)')||node.querySelector('a[data-hook="review-title"] span')||node.querySelector('[data-hook="review-title"]');
    const bodyEl    = node.querySelector('[data-hook="review-body"] span')||node.querySelector('[data-hook="review-body"]')||node.querySelector('.review-text-content span')||node.querySelector('.review-text-content');
    const ratingEl  = node.querySelector('[data-hook="review-star-rating"] .a-icon-alt')||node.querySelector('[data-hook="cmps-review-star-rating"] .a-icon-alt')||node.querySelector('.review-rating .a-icon-alt');
    const dateEl    = node.querySelector('[data-hook="review-date"]');
    const verifiedEl= node.querySelector('[data-hook="avp-badge"]')||node.querySelector('.a-size-mini.a-color-state');
    const helpfulEl = node.querySelector('[data-hook="helpful-vote-statement"]')||node.querySelector('.cr-vote-text');
    const variantEl = node.querySelector('[data-hook="format-strip"]')||node.querySelector('.review-format-strip')||node.querySelector('a[data-hook="format-strip-linkless"]');

    let helpfulVotes = 0;
    if (helpfulEl) { const m = helpfulEl.textContent.match(/(\d[\d,]*)/); if (m) helpfulVotes = parseInt(m[1].replace(/,/g,''),10); }
    const variant   = variantEl ? variantEl.textContent.replace(/^(Color|Style|Size|Flavor|Pattern)[:\s]*/i,'').trim() : '';
    const reviewId  = node.id||'';
    const reviewUrl = reviewId ? `${window.location.origin}/gp/customer-reviews/${reviewId.replace('customer_review-','')}` : '';
    const body      = bodyEl?.textContent.trim()||'';
    if (body.length < 5) return null;
    const ratingText  = ratingEl?.textContent.trim()||'';
    const ratingMatch = ratingText.match(/^([\d.]+)/);
    return {
      title:titleEl?.textContent.trim()||'', body:body.substring(0,1000),
      rating:ratingMatch?parseFloat(ratingMatch[1]):null, ratingText,
      date:dateEl?.textContent.trim()||'', verified:!!verifiedEl,
      helpfulVotes, variant, reviewUrl, sourceUrl:window.location.href,
      collectMode:'visible_dom', collectedAt:new Date().toISOString(),
    };
  }).filter(Boolean);

  return { reviews, limitedReviews, totalReviewCount };
}

// ── Message handler ────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'ping') { sendResponse({alive:true,pageType:getPageType()}); return true; }

  if (message.action === 'extractListing') {
    try { sendResponse({success:true, data:extractListingData()}); }
    catch(e) { sendResponse({success:false, error:e.message}); }
    return true;
  }

  if (message.action === 'extractReviews') {
    if (detectLoginRequired()) { sendResponse({success:false,loginRequired:true,error:'Amazon requires sign-in to view more reviews.'}); return true; }
    if (detectCaptcha())       { sendResponse({success:false,captcha:true,error:'Amazon CAPTCHA detected. Please solve it manually.'}); return true; }
    try {
      const result = extractReviewsFromDOM();
      sendResponse({success:true, ...result, asin:extractAsin(), pageType:getPageType()});
    } catch(e) { sendResponse({success:false,error:e.message}); }
    return true;
  }

  // Click append mode (kept for advanced use)
  if (message.action === 'CLICK_SHOW_MORE_AND_WAIT') {
    if (detectLoginRequired()) { sendResponse({success:false,loginRequired:true,error:'Amazon requires sign-in.'}); return true; }
    const btn = document.querySelector('a[data-hook="show-more-button"]');
    if (!btn) { sendResponse({success:false,noMore:true,error:'No Show More button found.'}); return true; }
    const beforeCount = document.querySelectorAll('[data-hook="review"]').length;
    const timeoutMs = message.timeoutMs || 20000;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return; settled=true; obs.disconnect();
      const result = extractReviewsFromDOM();
      sendResponse({success:false,timeout:true,mode:'click',...result});
    }, timeoutMs);
    const obs = new MutationObserver(() => {
      if (settled) return;
      const now = document.querySelectorAll('[data-hook="review"]').length;
      if (now > beforeCount) {
        settled=true; obs.disconnect(); clearTimeout(timer);
        setTimeout(() => {
          const result = extractReviewsFromDOM();
          sendResponse({success:true,mode:'click',beforeCount,addedVisibleCount:now-beforeCount,...result});
        }, 1000);
      }
    });
    obs.observe(document.querySelector('#cm_cr-review_list,#cm-cr-sort-footer')||document.body, {childList:true,subtree:true});
    btn.click();
    return true;
  }

  return true;
});
