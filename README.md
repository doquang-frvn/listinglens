# ListingLens

Chrome extension (Manifest V3) for Amazon sellers. Turns visible listing content and customer reviews into evidence-based copy fixes — title rewrites, bullet points, image text, ad angles — to reduce expectation gaps and return risk.

## Features

- Extract Amazon listing data (title, bullets, description, price, rating)
- Capture visible customer reviews + manual paste fallback
- AI analysis (OpenAI or Google Gemini — BYO API key) with evidence-tagged insights
- Category-aware checklists (POD/custom, beauty, supplements, electronics, home/kitchen, pet, baby, apparel, tools)
- Free plan: 10 products/day · Pro ($39/mo): unlimited products + 150 AI reports/month

## Install (development)

1. `chrome://extensions` → enable Developer mode
2. Load unpacked → select this folder
3. Open any Amazon product page (`/dp/...`)

## Privacy

See [privacy.html](privacy.html) or the hosted version for the full policy. Summary: all data stays local in your browser; AI analysis is sent directly to the provider you choose (OpenAI/Gemini) using your own API key — never through a ListingLens server.

## Stack

Plain HTML/CSS/JS, Manifest V3, no build step required.
