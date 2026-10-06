# Zuno One marketing site

Standalone static site. No framework. One small Node generator, no other build step.

## Structure

```
build.js      generator — nav model + all Solutions/Industries/company pages
content in build.js:  edit SOLUTIONS, INDUSTRIES, NAV, and the special-page fns
styles.css    the whole design system (dark oceanic theme + mega-menu)
app.js        nav, mega-menus, mobile accordion, scroll reveal, count-up, pricing toggle, demo forms
serve.js      local static server (also does /pricing -> pricing.html, 404 fallback)
```

### Hand-built pages (rich, bespoke)
`index.html` · `features.html` · `pricing.html` · `integrations.html` · `about.html` · `careers.html` · `careers-sales-officer.html` · `404.html`

### Generated pages (`node build.js`)
- **Solutions** — capture-ads, capture-social, capture-website, capture-offline, ai-agents, team-inbox, qualify-leads, route-leads, book-appointments, conversational-support, promotions, renewal-reminders, surveys, what-is-zunoone, mobile-app, whatsapp-calling
- **Industries** — industry-retail, -travel, -automotive, -education, -healthcare, -services, plus `industries.html`
- **Company** — customers, why-zunoone, contact

`build.js` also re-injects the shared `<header>` / `<footer>` into the hand-built pages, so the nav stays identical everywhere. **Run `node build.js` after editing the nav model or any generated page's content.**

Pages for features that don't exist yet (Ads capture, Website widget, Appointments, Surveys, Mobile app, Calling API) are marked **"On the roadmap"** with a *Get notified* CTA instead of *Start free*.

## Run locally
```
node build.js   # regenerate
node serve.js   # http://localhost:4173
```

## Deploy
Upload the folder as-is to any static host (Netlify, Vercel, Cloudflare Pages, GitHub Pages, S3+nginx). `404.html` is picked up automatically by most; map unknown paths to it otherwise.

## Before going live
- Swap placeholder links: `https://app.zunoone.com`, `mailto:*@zunoone.com`, and the `#` links (blog, guides, help, docs, status, changelog, legal).
- Replace marketing figures (1,400+ teams, 18M+ conversations, 40 countries, 99.98% uptime, founded 2021, 32 people) with real numbers.
- Replace trust-bar wordmarks, testimonials and everything on `customers.html` with real, permissioned customer stories.
- Wire the demo forms (`#applyForm` on contact.html and careers-sales-officer.html) to your CRM / ATS.
- Build the roadmap features, then flip `roadmap: true` off in `build.js` and rerun.
