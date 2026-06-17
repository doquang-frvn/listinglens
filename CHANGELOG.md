# Changelog

## v1.4.5
- Add Free/Pro subscription module (`subscription.js`): 10 products/day free, $39/mo Pro with 150 AI reports/month
- Move `tabs` permission to `optional_permissions` — only requested at runtime when Advanced Auto Collect is enabled
- Add plan badge + upgrade banner in popup/Full App

## v1.4.4
- Add Full App mode (`app.html`) for long-running AI analysis without the popup closing

## v1.4.2
- Add Google Gemini as a second AI provider (free tier, no credit card)
- Refactor `callOpenAI` into shared prompt builder + per-provider call functions

## v1.4.1
- Fix manual-paste-without-ASIN cache bug
- Fix `buildReviewUrl` hardcoded to amazon.com (now respects marketplace domain)
- Rename "Competitor Complaint Counter" → "Complaint Counter & Positioning Opportunities"
- Add 10 category-specific checklists (POD, beauty, supplement, electronics, etc.)
- Add Compliance & Claim Risk report section
- Clamp Advanced Auto Collect limits (max 10 clicks, 50 reviews)
- Add retry/backoff + clearer error messages for OpenAI rate limits

## v1.4.0
- Major repositioning: from "review collector" to "Review-to-Copy Intelligence"
- New 7-section evidence-based AI report (Listing Gap Finder, Negative Review Shield, etc.)
- Add Manual Paste Reviews
- Add Data Quality indicator
- Move Auto Collect to collapsed "Advanced/Experimental" section

## v1.3.0
- Implement Click Append Mode for review pagination (primary) with URL-token fallback
- Add login-required and CAPTCHA detection

## v1.2.x
- Pagination fixes (Amazon's `nextPageToken` mechanics)
- Cache defensive initialization fixes

## v1.1.x
- Review extraction improvements (full text, more fields, pagination UI)

## v1.0.0
- Initial release: listing + review extraction, OpenAI-based AI report
