/* Zuno One marketing site — static generator.
   Run:  node build.js
   Emits every page from the content below, and re-syncs the shared
   header/footer into the hand-built pages (index, features, pricing, ...). */
const fs = require('fs');
const path = require('path');
const OUT = __dirname;

const APP = 'https://app.zunoone.com';

/* ---------------- navigation ---------------- */
const NAV = [
  { label: 'Our Products', cols: 3, groups: [
    { h5: 'Customer', items: [
      { t: 'Shared Inbox & CRM', h: 'features.html' },
      { t: 'Website Chat Widget', h: 'capture-website.html' },
      { t: 'AI Agents', h: 'ai-agents.html' },
    ]},
    { h5: 'People & HR · soon', items: [
      { t: 'HR Management', h: 'platform.html' },
      { t: 'Recruitment', h: 'platform.html' },
      { t: 'Payroll (WPS)', h: 'platform.html' },
      { t: 'Shifts & Time Tracking', h: 'platform.html' },
      { t: 'Learning & Intranet', h: 'platform.html' },
    ]},
    { h5: 'Operations', items: [
      { t: 'Project Management', h: 'project-management.html' },
      { t: 'Accounting · soon', h: 'accounting.html' },
    ]},
    { feat: { tag: 'The platform', t: 'One suite for customer, people and finance — on shared data', h: 'platform.html' } },
  ]},
  { label: 'Solutions', cols: 4, groups: [
    { h5: 'Capture leads', items: [
      { t: 'Capture from Ads', h: 'capture-ads.html' },
      { t: 'Capture from Social', h: 'capture-social.html' },
      { t: 'Capture from Website', h: 'capture-website.html' },
      { t: 'Capture from Offline', h: 'capture-offline.html' },
    ]},
    { h5: 'Convert leads', items: [
      { t: 'AI Agents', h: 'ai-agents.html', b: 'AI' },
      { t: 'Team Inbox', h: 'team-inbox.html' },
      { t: 'Qualify Leads', h: 'qualify-leads.html' },
      { t: 'Route Leads', h: 'route-leads.html' },
      { t: 'Book Appointments', h: 'book-appointments.html' },
    ]},
    { h5: 'Retain customers', items: [
      { t: 'Conversational Support', h: 'conversational-support.html' },
      { t: 'Promotions & Newsletters', h: 'promotions.html' },
      { t: 'Renewal Reminders', h: 'renewal-reminders.html' },
      { t: 'CSAT & NPS Surveys', h: 'surveys.html' },
    ]},
    { h5: 'Scale with Zuno One', items: [
      { t: 'What is Zuno One?', h: 'what-is-zunoone.html' },
      { t: 'Success Stories', h: 'customers.html' },
      { t: 'Mobile App', h: 'mobile-app.html' },
      { t: 'WhatsApp Calling API', h: 'whatsapp-calling.html' },
      { t: 'Channels & Integrations', h: 'integrations.html' },
    ]},
    { feat: { tag: 'Customer story', t: 'How Northwind cut first-response time to under 4 minutes', h: 'customers.html' } },
  ]},
  { label: 'Industries', cols: 3, groups: [
    { h5: 'Commerce', items: [
      { t: 'Retail & E-commerce', h: 'industry-retail.html' },
      { t: 'Travel & Hospitality', h: 'industry-travel.html' },
      { t: 'Automotive', h: 'industry-automotive.html' },
    ]},
    { h5: 'Services', items: [
      { t: 'Education', h: 'industry-education.html' },
      { t: 'Healthcare', h: 'industry-healthcare.html' },
      { t: 'Professional Services', h: 'industry-services.html' },
    ]},
    { h5: 'More', items: [
      { t: 'All industries', h: 'industries.html' },
      { t: 'Agencies', h: 'features.html' },
    ]},
    { feat: { tag: 'Customer story', t: 'Sport Center Los Naranjos gained 20% more conversions from sales inquiries', h: 'customers.html' } },
  ]},
  { label: 'Resources', cols: 3, groups: [
    { h5: 'Learn', items: [
      { t: 'Blog', h: '#' },
      { t: 'Guides', h: '#' },
      { t: 'Help Center', h: '#' },
      { t: 'API Docs', h: '#' },
    ]},
    { h5: 'Product', items: [
      { t: 'Features', h: 'features.html' },
      { t: 'Integrations', h: 'integrations.html' },
      { t: 'Changelog', h: '#' },
      { t: 'Status', h: '#' },
    ]},
    { h5: 'Company', items: [
      { t: 'About', h: 'about.html' },
      { t: 'Careers', h: 'careers.html' },
      { t: 'Contact', h: 'contact.html' },
    ]},
  ]},
  { label: 'Pricing', h: 'pricing.html' },
  { label: 'Why Us', h: 'why-zunoone.html' },
  { label: 'Contact', h: 'contact.html' },
];

const CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="m6 9 6 6 6-6"/></svg>';
const ARR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

/* line icons (lucide-style) */
const I = {
  chat: '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  users: '<svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  userPlus: '<svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>',
  bank: '<svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>',
  repeat: '<svg viewBox="0 0 24 24"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>',
  cap: '<svg viewBox="0 0 24 24"><path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5"/></svg>',
  megaphone: '<svg viewBox="0 0 24 24"><path d="m3 11 18-5v12L3 14v-3Z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>',
  kanban: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 8v8M15 8v5"/></svg>',
  chart: '<svg viewBox="0 0 24 24"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>',
  layers: '<svg viewBox="0 0 24 24"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
};

function header() {
  const links = NAV.map(n => {
    if (n.h) return `<a href="${n.h}">${n.label}</a>`;
    const groups = n.groups.map(g => {
      if (g.feat) return `<div class="megafeat"><span class="mf-tag">${g.feat.tag}</span><span class="mf-t">${g.feat.t}</span><a href="${g.feat.h}">Read →</a></div>`;
      return `<div><h5>${g.h5}</h5>${g.items.map(i => `<a href="${i.h}">${i.t}${i.b ? `<span class="b">${i.b}</span>` : ''}</a>`).join('')}</div>`;
    }).join('');
    return `<div class="mega" data-mega><button type="button">${n.label} ${CHEV}</button><div class="megapanel" style="--cols:${n.cols}">${groups}</div></div>`;
  }).join('\n      ');

  const mobile = NAV.map(n => {
    if (n.h) return `<a href="${n.h}">${n.label}</a>`;
    const sub = n.groups.map(g => {
      if (g.feat) return '';
      return `<h5>${g.h5}</h5>${g.items.map(i => `<a href="${i.h}">${i.t}</a>`).join('')}`;
    }).join('');
    return `<div class="m-group"><button type="button">${n.label}</button><div class="m-sub">${sub}</div></div>`;
  }).join('\n    ');

  return `<div class="promo-bar" id="promoBar">⏳ Limited time · Project Management is <b>free on select plans</b> — <a href="pricing.html">Check plans →</a><button class="x" aria-label="Dismiss" onclick="this.parentElement.classList.add('hide')">×</button></div>
<header class="nav">
  <div class="wrap">
    <a class="brand" href="index.html"><span class="mk"></span>Zuno One</a>
    <nav class="links">
      ${links}
    </nav>
    <div class="right">
      <button class="themebtn" id="themeBtn" type="button" aria-label="Toggle light theme" title="Toggle light theme">
        <svg class="i-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
        <svg class="i-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
      </button>
      <a class="signin" href="${APP}">Login</a>
      <a class="btn btn-primary btn-sm" href="${APP}">Start free</a>
      <button class="burger" id="burger" aria-label="Menu"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M3 12h18M3 18h18"/></svg></button>
    </div>
  </div>
  <div id="mnav">
    ${mobile}
    <a class="btn btn-primary" href="${APP}">Start free</a>
  </div>
</header>`;
}

function footer() {
  return `<footer>
  <div class="wrap">
    <div class="fgrid">
      <div><a class="brand" href="index.html"><span class="mk"></span>Zuno One</a><p class="tag">Every customer conversation, one shared inbox.</p>
        <div class="fsocial">
          <a href="https://instagram.com/zuno_one" target="_blank" rel="noopener" aria-label="Zuno One on Instagram"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg></a>
          <a href="https://facebook.com/zuno_one" target="_blank" rel="noopener" aria-label="Zuno One on Facebook"><svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M14 9h3l.5-3H14V4.5c0-.8.3-1.5 1.5-1.5H17V.2C16.6.1 15.5 0 14.3 0 11.7 0 10 1.6 10 4.3V6H7v3h3v9h4V9z"/></svg></a>
        </div>
      </div>
      <div class="fcol"><h4>Solutions</h4><a href="team-inbox.html">Team Inbox</a><a href="ai-agents.html">AI Agents</a><a href="route-leads.html">Route Leads</a><a href="promotions.html">Broadcasts</a><a href="conversational-support.html">Support</a></div>
      <div class="fcol"><h4>Product</h4><a href="features.html">Features</a><a href="pricing.html">Pricing</a><a href="integrations.html">Integrations</a><a href="${APP}">Login</a></div>
      <div class="fcol"><h4>Company</h4><a href="about.html">About</a><a href="why-zunoone.html">Why Us</a><a href="customers.html">Customers</a><a href="careers.html">Careers</a><a href="contact.html">Contact</a></div>
      <div class="fcol"><h4>Legal</h4><a href="security.html">Security</a><a href="privacy.html">Privacy Policy</a><a href="terms.html">Terms of Service</a><a href="refunds.html">Refund &amp; Cancellation</a><a href="dpa.html">DPA</a></div>
    </div>
    <div class="fbot"><span>© <span id="yr">2025</span> Zuno One</span><span>Built for teams in 40 countries</span></div>
  </div>
</footer>`;
}

/* ---------------- section renderers ---------------- */
const check = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6 9 17l-5-5"/></svg>';

function bullets(arr) { return `<ul>${arr.map(b => `<li>${check}${b}</li>`).join('')}</ul>`; }

function altRows(rows) {
  return rows.map((r, i) => `
    <div class="frow ${i % 2 ? 'rev' : ''} reveal">
      <div>
        ${r.eyebrow ? `<span class="eyebrow">${r.eyebrow}</span>` : ''}
        <h3>${r.h3}</h3>
        <p>${r.p}</p>
        ${r.bullets ? bullets(r.bullets) : ''}
      </div>
      <div class="art">${r.art || ''}</div>
    </div>`).join('');
}

function cardsSec(s) {
  return `<section class="band-tight"><div class="wrap reveal">
    ${s.eyebrow ? `<span class="eyebrow">${s.eyebrow}</span>` : ''}
    <h2 class="sec">${s.title}</h2>
    ${s.lead ? `<p class="sec-lead">${s.lead}</p>` : ''}
    <div class="cardgrid ${s.cols === 2 ? 'c2' : s.cols === 4 ? 'c4' : ''}">
      ${s.items.map(c => `<div class="cd">${c.ic ? `<div class="ic">${c.ic}</div>` : ''}<h3>${c.h}</h3><p>${c.p}</p></div>`).join('')}
    </div>
  </div></section>`;
}

function stepsSec(s) {
  return `<section class="band-tight"><div class="wrap reveal">
    <span class="eyebrow">${s.eyebrow || 'How it works'}</span>
    <h2 class="sec">${s.title}</h2>
    <div class="process" style="grid-template-columns:repeat(${s.items.length},1fr)">
      ${s.items.map(x => `<div class="st"><h3>${x.h}</h3><p>${x.p}</p></div>`).join('')}
    </div>
  </div></section>`;
}

function quoteSec(q) {
  return `<section class="band-tight"><div class="wrap quote reveal">
    <p>&ldquo;${q.text}&rdquo;</p>
    <div class="who"><span class="av">${q.initials}</span> ${q.who}</div>
  </div></section>`;
}

function ctaSec(c) {
  return `<section class="band"><div class="wrap reveal"><div class="ctaband">
    <span class="eyebrow center">${c.eyebrow || 'Get started'}</span>
    <h2>${c.title}</h2>
    <div class="cta">
      <a class="btn btn-primary" href="${c.primary.h}">${c.primary.t} ${ARR}</a>
      ${c.ghost ? `<a class="btn btn-ghost" href="${c.ghost.h}">${c.ghost.t}</a>` : ''}
    </div>
  </div></div></section>`;
}

/* visuals */
const V = {
  panel: (rows, reply) => `<div class="panel"><div class="bar"><span></span><span></span><span></span><span class="t">Team inbox</span></div><div class="rows">${rows.map((r, i) => `<div class="row ${i === 0 ? 'sel' : ''}" style="animation-delay:.0${i}s"><div class="av" style="background:${r.c || '#8fd5f2'}">${r.i}</div><div class="mid"><div class="nm"><span class="ch" style="background:${r.dot}"></span>${r.n}</div><div class="pv">${r.p}</div></div><div class="tm">${r.t}</div></div>`).join('')}</div>${reply ? `<div class="reply"><div class="box">${reply}<span class="cur"></span></div><div class="send">${ARR.replace('width="24" height="24"', '')}</div></div>` : ''}</div>`,
  flow: (steps) => `<div class="flow">${steps.map(s => `<div class="step"><span class="k">${s.k || ''}</span>${(Array.isArray(s.v) ? s.v : [s.v]).map(v => `<span class="pill ${s.a ? 'a' : ''}">${v}</span>`).join('')}</div>`).join('')}</div>`,
  chart: (bars) => `<div class="chart">${bars.map(b => `<div class="bar" style="--h:${b}%"></div>`).join('')}</div>`,
  tiles: (t) => `<div class="tiles">${t.map(x => `<div class="tl"><div class="n">${x.n}</div><div class="l">${x.l}</div></div>`).join('')}</div>`,
  code: (s) => `<div class="code">${s}</div>`,
};

/* ---------------- page template ---------------- */
// Zuno One help-center chat widget — lives on every marketing page and drops
// visitor conversations straight into the Zuno One dashboard (the "help"
// workspace inbox). Swap the host for your deployed CRM workspace.
const HELP_WIDGET = '<script src="https://help.zunoone.com/widget.js" async></script>';

function head(title, desc) {
  return `<title>${title}</title>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${desc || ''}">
<link rel="icon" href="logo.jpg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&family=Inter:wght@400;450;500;600&family=JetBrains+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="styles.css">
<script>try{if(localStorage.zunoTheme==='light')document.documentElement.setAttribute('data-theme','light');}catch(e){}</script>
${HELP_WIDGET}`;
}

function solutionPage(p) {
  const primary = p.roadmap
    ? { t: 'Get notified', h: `mailto:hello@zunoone.com?subject=${encodeURIComponent(p.h1 + ' — notify me')}` }
    : { t: 'Start free', h: APP };
  return `${head('Zuno One — ' + p.title, p.lead)}

${header()}

<section class="phero hsplit">
  <div class="aurora"><i></i><i></i><i></i></div>
  <div class="grid-lines"></div>
  <div class="wrap">
    <div>
      ${p.roadmap ? '<span class="ribbon">On the roadmap</span>' : `<span class="eyebrow">${p.eyebrow}</span>`}
      <h1>${p.h1}</h1>
      <p class="lead">${p.lead}</p>
      <div class="cta">
        <a class="btn btn-primary" href="${primary.h}">${primary.t} ${ARR}</a>
        <a class="btn btn-ghost" href="contact.html">Book a demo</a>
      </div>
      ${p.roadmap ? '<p class="micro">In active development — leave your email and we’ll tell you when it ships.</p>' : `<p class="micro">${p.planNote || 'Free plan · no card required'}</p>`}
    </div>
    <div>${p.hart || V.panel([
      { i: 'MC', n: 'Maya Chen', dot: 'var(--wa)', p: 'Perfect, thanks!', t: '2m' },
      { i: 'LF', n: '@lucasfit', dot: 'var(--ig)', p: 'do you ship to Portugal?', t: '5m', c: '#f0a6c2' },
      { i: 'AB', n: 'Aria Blake', dot: 'var(--ms)', p: 'thanks for the quick help!', t: '12m', c: '#9ec6ff' },
    ])}</div>
  </div>
</section>

<section class="band-tight"><div class="wrap">${altRows(p.rows)}</div></section>

${p.cards ? cardsSec(p.cards) : ''}
${p.steps ? stepsSec(p.steps) : ''}
${p.quote ? quoteSec(p.quote) : ''}

${ctaSec({ title: p.ctaTitle || 'See it with your own channels', primary, ghost: { t: 'Talk to sales', h: 'contact.html' } })}

${footer()}

<script src="app.js" defer></script>
`;
}

function industryPage(p) {
  return `${head('Zuno One for ' + p.name, p.lead)}

${header()}

<section class="phero">
  <div class="aurora"><i></i><i></i><i></i></div>
  <div class="grid-lines"></div>
  <div class="wrap">
    <span class="eyebrow">${p.icon} ${p.name}</span>
    <h1>${p.h1}</h1>
    <p class="lead">${p.lead}</p>
    <div class="cta"><a class="btn btn-primary" href="${APP}">Start free ${ARR}</a><a class="btn btn-ghost" href="contact.html">Book a demo</a></div>
  </div>
</section>

${cardsSec({ eyebrow: 'Use cases', title: p.useTitle, lead: p.useLead, items: p.uses })}

<section class="band-tight"><div class="wrap">${altRows(p.rows)}</div></section>

${p.quote ? quoteSec(p.quote) : ''}

${ctaSec({ title: `Bring every ${p.short} conversation into one inbox`, primary: { t: 'Start free', h: APP }, ghost: { t: 'Talk to sales', h: 'contact.html' } })}

${footer()}

<script src="app.js" defer></script>
`;
}

/* ---------------- content ---------------- */
const SOLUTIONS = [
  {
    h: 'capture-social.html', title: 'Capture from Social', eyebrow: 'Capture leads',
    h1: 'Turn Instagram and Messenger DMs into leads',
    lead: 'Every Instagram and Facebook Messenger conversation lands in the same queue as WhatsApp and email — so a "how much?" in the DMs never slips through.',
    rows: [
      { eyebrow: 'One queue', h3: 'DMs, story replies and mentions in one place', p: 'Connect your Instagram Professional account and Facebook Page. New conversations appear in real time, tagged by channel, with the person’s handle and history attached.', bullets: ['Instagram DMs via your linked Facebook Page', 'Messenger through the Meta Graph API', 'Replies send straight from the inbox'] },
      { eyebrow: 'Never miss one', h3: 'Auto-acknowledge, then route', p: 'A workflow can reply instantly, tag the conversation by keyword, and assign it to the right person before anyone has opened the app.', art: V.flow([{ k: 'When', v: 'Instagram DM received' }, { k: 'Do', a: 1, v: ['reply · "Thanks! One sec 👋"', 'assign · Sales', 'add label · new-lead'] }]) },
    ],
    cards: { eyebrow: 'Why it matters', title: 'Social is where buying questions start', cols: 3, items: [
      { ic: 'IG', h: 'Instagram', p: 'Product questions, sizing, "is this in stock" — answered in the thread, not lost in a request folder.' },
      { ic: 'M', h: 'Messenger', p: 'Page messages routed to a real person with the same rules as every other channel.' },
      { ic: '⚡', h: 'Instant reply', p: 'An automation acknowledges within seconds so the lead knows they’re heard.' },
    ]},
  },
  {
    h: 'capture-website.html', title: 'Capture from Website', eyebrow: 'Capture leads', roadmap: true,
    h1: 'A chat widget that drops visitors into your inbox',
    lead: 'A lightweight website widget that starts a conversation on your site and continues it on WhatsApp — so a lead you catch at 2am is still reachable tomorrow.',
    rows: [
      { eyebrow: 'Web to WhatsApp', h3: 'Start on the site, continue on WhatsApp', p: 'The visitor picks a channel, the conversation opens in Zuno One, and follow-ups reach them where they already read messages.', bullets: ['One line of script to install', 'Pre-fills the page and referrer', 'Handoff to WhatsApp, Messenger or email'] },
      { eyebrow: 'Forms too', h3: 'Contact forms become conversations', p: 'Point an existing form at the Zuno One API and each submission opens a conversation with the fields attached.', art: V.code('<span class="k">POST</span> /v1/conversations\nX-API-Key: <span class="s">sk_live_…</span>\n\n{\n  <span class="k">"channel"</span>: <span class="s">"web"</span>,\n  <span class="k">"name"</span>: <span class="s">"Priya"</span>,\n  <span class="k">"message"</span>: <span class="s">"Demo request from /pricing"</span>\n}') },
    ],
  },
  {
    h: 'capture-ads.html', title: 'Capture from Ads', eyebrow: 'Capture leads', roadmap: true,
    h1: 'Click-to-chat ads that land in your inbox',
    lead: 'Run Click-to-WhatsApp and lead-form ads on Meta, and have every reply open as a qualified conversation in Zuno One — with the ad and campaign attached.',
    rows: [
      { eyebrow: 'Attribution', h3: 'Know which ad started the conversation', p: 'Each conversation carries the campaign, ad set and creative, so you can see cost-per-conversation and cost-per-close, not just cost-per-click.', bullets: ['Click-to-WhatsApp ads', 'Meta lead-form ingestion', 'Campaign and creative on every lead'] },
      { eyebrow: 'Then convert', h3: 'Straight into qualify and route', p: 'Ad leads flow through the same qualification and routing rules as everything else — no separate tool, no CSV export.', art: V.flow([{ k: 'Source', v: 'Click-to-WhatsApp ad' }, { k: 'Then', a: 1, v: ['qualify · budget + timeline', 'route · by region'] }]) },
    ],
  },
  {
    h: 'capture-offline.html', title: 'Capture from Offline', eyebrow: 'Capture leads',
    h1: 'QR codes and short links that open a chat',
    lead: 'Put a QR code on a shelf, a receipt, a business card or a packaging insert. A scan opens WhatsApp with your number and a pre-filled message — and a conversation in Zuno One.',
    rows: [
      { eyebrow: 'Scan to chat', h3: 'From the real world into the inbox', p: 'Generate a wa.me link or QR for any workspace number, with a pre-filled first message so you know where the scan came from.', bullets: ['Per-location QR codes', 'Pre-filled context message', 'Works with WhatsApp, Messenger and Instagram'] },
      { eyebrow: 'Track it', h3: 'See which touchpoints actually work', p: 'Because each link carries its own tag, reports show which shelf, flyer or event drove conversations.', art: V.tiles([{ n: '312', l: 'Shelf QR' }, { n: '188', l: 'Receipt' }, { n: '54', l: 'Event' }]) },
    ],
  },
  {
    h: 'ai-agents.html', title: 'AI Agents', eyebrow: 'Convert leads',
    h1: 'AI agents that answer first, hand off fast',
    lead: 'An AI agent drafts replies from your knowledge base and tone, handles the repetitive questions on autopilot, and passes the conversation to a person the moment it matters.',
    rows: [
      { eyebrow: 'Draft mode', h3: 'One-click suggested replies', p: 'Your team sees a ready answer, edits if needed, and sends. Grounded in the knowledge base you paste in, in the voice you set.', art: V.panel([{ i: 'AI', n: 'Suggested reply', dot: 'var(--sky)', p: '"Yes — we ship to Portugal, 3–5 days, tracking included."', t: '' }], 'Use draft') },
      { eyebrow: 'Autopilot', h3: 'Handle the FAQs without a human', p: 'Turn autopilot on for common questions. Set the keywords — "refund", "cancel", "human" — that instantly hand the conversation to your team.', bullets: ['Knowledge base and persona', 'Keyword hand-off rules', 'Every AI reply is logged and reviewable'] },
    ],
    cards: { eyebrow: 'Control', title: 'You decide how far it goes', cols: 3, items: [
      { ic: '✎', h: 'Suggest only', p: 'AI drafts, a human always sends. Zero risk, still fast.' },
      { ic: '⚙', h: 'Autopilot with guardrails', p: 'AI answers known questions; anything uncertain goes to a person.' },
      { ic: '↩', h: 'Instant hand-off', p: 'Named keywords or a low-confidence answer pull a human in immediately.' },
    ]},
  },
  {
    h: 'team-inbox.html', title: 'Team Inbox', eyebrow: 'Convert leads',
    h1: 'One inbox your whole team works from',
    lead: 'WhatsApp, Instagram, Messenger and Gmail in a single real-time queue. Full history, media, internal notes and @mentions — so nobody answers the same message twice.',
    rows: [
      { eyebrow: 'Real time', h3: 'Every channel, one thread list', p: 'New messages appear instantly, ordered by most recent, with a coloured channel dot and the contact’s real name or number.', art: V.panel([
        { i: 'MC', n: 'Maya Chen', dot: 'var(--wa)', p: 'Perfect, thanks!', t: '2m' },
        { i: 'LF', n: '@lucasfit', dot: 'var(--ig)', p: 'do you ship to Portugal?', t: '5m', c: '#f0a6c2' },
        { i: 'AB', n: 'Aria Blake', dot: 'var(--ms)', p: 'thanks for the quick help!', t: '12m', c: '#9ec6ff' },
        { i: 'NW', n: 'procurement@northwind', dot: 'var(--gm)', p: 'Re: Renewal quote', t: '41m', c: '#f2b3a9' },
      ], 'Invoice sent, due in 14 days') },
      { eyebrow: 'Stay in sync', h3: 'Notes, mentions and assignment', p: 'Leave a private note, @mention a teammate, assign a conversation, set a status. Agents can be given a restricted view of just their own queue.', bullets: ['Internal notes and @mentions', 'Assignment and status', 'Agent-restricted dashboard', 'Who sent what — agent name on every reply'] },
    ],
    quote: { text: 'We replaced three tools and a spreadsheet with the Zuno One inbox. It just works.', who: 'Priya Nair · Head of Support, Northwind', initials: 'PN' },
  },
  {
    h: 'qualify-leads.html', title: 'Qualify Leads', eyebrow: 'Convert leads',
    h1: 'Qualify leads in the conversation',
    lead: 'Ask the questions that matter — budget, timeline, team size — with an AI agent or a simple rule, tag the answers, and only put a person on the ones worth their time.',
    rows: [
      { eyebrow: 'Ask automatically', h3: 'A few questions before a human joins', p: 'An automation or AI agent collects the basics, writes them onto the contact as tags, and sets a qualification status.', art: V.flow([{ k: 'Ask', v: ['Budget?', 'Timeline?', 'Team size?'] }, { k: 'Then', a: 1, v: ['tag · budget-high', 'status · qualified'] }]) },
      { eyebrow: 'Focus the team', h3: 'Route only qualified leads to sales', p: 'Unqualified conversations stay in a nurture queue or get an automated reply. Qualified ones go straight to the right rep.', bullets: ['Custom qualification fields', 'Tags written back to the contact', 'Feeds directly into routing'] },
    ],
  },
  {
    h: 'route-leads.html', title: 'Route Leads', eyebrow: 'Convert leads',
    h1: 'Send the right chat to the right person',
    lead: 'Round-robin across a pool, or draw a grid of exactly which channels each agent handles. Availability-aware, and agents only ever see their own queue.',
    rows: [
      { eyebrow: 'Assignment matrix', h3: 'Tick who gets what', p: 'A simple channel × agent grid. Admins choose the routing; agents get a restricted view of just their channels and their conversations.', art: `<table class="mx"><thead><tr><th>Agent</th><th>WA</th><th>IG</th><th>MSG</th><th>Mail</th></tr></thead><tbody>
      <tr><td>Priya</td><td><span class="tk on">${check}</span></td><td><span class="tk on">${check}</span></td><td><span class="tk"></span></td><td><span class="tk"></span></td></tr>
      <tr><td>Sam</td><td><span class="tk"></span></td><td><span class="tk on">${check}</span></td><td><span class="tk on">${check}</span></td><td><span class="tk"></span></td></tr>
      <tr><td>Dana</td><td><span class="tk"></span></td><td><span class="tk"></span></td><td><span class="tk"></span></td><td><span class="tk on">${check}</span></td></tr></tbody></table>` },
      { eyebrow: 'Fair and fast', h3: 'Round-robin with availability', p: 'New conversations spread evenly across the on-duty pool. Someone offline is skipped, not stuck with a growing backlog.', bullets: ['Round-robin by team or skill', 'Availability-aware', 'Re-assign or escalate with a rule'] },
    ],
  },
  {
    h: 'book-appointments.html', title: 'Book Appointments', eyebrow: 'Convert leads', roadmap: true,
    h1: 'Book meetings without leaving the chat',
    lead: 'Share real availability in the conversation, let the customer pick a slot, and drop the event on your calendar — all inside the thread.',
    rows: [
      { eyebrow: 'In-thread booking', h3: 'Offer slots, confirm, done', p: 'Connect a calendar, send a booking link or inline slots, and the confirmed meeting writes back to both sides with a reminder.', bullets: ['Calendar connect (Google, Microsoft)', 'Inline slot picker in the chat', 'Automatic reminders before the call'] },
      { eyebrow: 'No-show fewer', h3: 'Reminders that actually get read', p: 'A WhatsApp reminder the day before and an hour before beats an email nobody opens.', art: V.flow([{ k: 'Booked', v: 'Thu 14:00 — Demo' }, { k: 'Remind', a: 1, v: ['1 day before', '1 hour before'] }]) },
    ],
  },
  {
    h: 'conversational-support.html', title: 'Conversational Support', eyebrow: 'Retain customers',
    h1: 'Support that lives where your customers already are',
    lead: 'Handle every support question on WhatsApp, Instagram, Messenger and email from one queue — with AI drafts, canned replies, labels and full history.',
    rows: [
      { eyebrow: 'Faster answers', h3: 'AI drafts and saved replies', p: 'One click for a grounded AI draft, or a saved reply for the questions you get twenty times a day. Edit and send.', art: V.panel([{ i: 'ES', n: 'Esther', dot: 'var(--wa)', p: 'my order hasn’t arrived', t: '3m' }], 'Sorry about that — checking your tracking now') },
      { eyebrow: 'Stay organised', h3: 'Labels, statuses and reminders', p: 'Colour-code conversations, set open / pending / closed, and add a follow-up reminder that pings when it’s due.', bullets: ['Managed labels with colours', 'Open / pending / closed status', 'Follow-up reminders', 'CSAT survey on close (roadmap)'] },
    ],
    quote: { text: 'First-response time went from a few hours to under four minutes.', who: 'Priya Nair · Head of Support, Northwind', initials: 'PN' },
  },
  {
    h: 'promotions.html', title: 'Promotions & Newsletters', eyebrow: 'Retain customers',
    h1: 'Send a message to a segment, in one place',
    lead: 'Pick a filtered set of contacts, write one message, send. Watch delivered and failed counts climb on a live progress bar, and pick up replies in the same inbox.',
    rows: [
      { eyebrow: 'Broadcasts', h3: 'Segment, send, track', p: 'Filter by label, tag or channel. Every reply comes back to the team inbox as a normal conversation — not a dead no-reply address.', art: V.tiles([{ n: '842', l: 'Sent' }, { n: '830', l: 'Delivered' }, { n: '12', l: 'Failed' }]) },
      { eyebrow: 'Keep it clean', h3: 'Opt-outs handled for you', p: 'Contacts who opt out are excluded automatically, so you stay compliant without keeping a separate list.', bullets: ['Filter by label, tag or channel', 'Live delivered / failed tracking', 'Replies flow to the inbox', 'Automatic opt-out handling'] },
    ],
  },
  {
    h: 'renewal-reminders.html', title: 'Renewal Reminders', eyebrow: 'Retain customers',
    h1: 'Nudge customers before they lapse',
    lead: 'Schedule a WhatsApp reminder 30, 7 and 1 days before a renewal or appointment. A message people actually read beats an email they don’t.',
    rows: [
      { eyebrow: 'Scheduled', h3: 'Set the cadence once', p: 'Trigger from a date on the contact or an event from your system via the API. Zuno One sends the sequence and stops if they reply or renew.', art: V.flow([{ k: 'Renewal', v: 'in 30 days' }, { k: 'Send', a: 1, v: ['T-30 · "Your plan renews soon"', 'T-7 · reminder', 'T-1 · final nudge'] }]) },
      { eyebrow: 'Two-way', h3: 'Replies land with a person', p: '"Actually I want to cancel" opens a real conversation with your retention team — not a bounce.', bullets: ['Date- or event-triggered', 'Stops on reply or renewal', 'Replies route to the right team'] },
    ],
  },
  {
    h: 'surveys.html', title: 'CSAT & NPS Surveys', eyebrow: 'Retain customers', roadmap: true,
    h1: 'Measure how the conversation went',
    lead: 'Send a one-tap CSAT or NPS survey when a conversation closes, collect the score against the agent and channel, and see it in reports.',
    rows: [
      { eyebrow: 'On close', h3: 'One question, one tap', p: 'A short rating prompt goes out automatically when a conversation is marked closed. Low scores can reopen the conversation and alert a lead.', bullets: ['CSAT (1–5) or NPS (0–10)', 'Auto-send on conversation close', 'Low-score alerts and reopen'] },
      { eyebrow: 'In reports', h3: 'Score by agent, channel and label', p: 'See CSAT trend over time and which topics or agents drag it down.', art: V.chart([70, 78, 74, 82, 88, 84, 90]) },
    ],
  },
  {
    h: 'what-is-zunoone.html', title: 'What is Zuno One?', eyebrow: 'Scale with Zuno One',
    h1: 'The omnichannel inbox for customer conversations',
    lead: 'Zuno One is a shared inbox that brings WhatsApp, Instagram, Messenger and Gmail into one place your whole team works from — with routing, automation, broadcasts, AI and analytics built in. Multi-tenant, so agencies run every client from one login.',
    rows: [
      { eyebrow: 'The idea', h3: 'One queue instead of five apps', p: 'Stop switching between a phone, a laptop and a shared mailbox. Every customer conversation, whatever channel it started on, in a single list.', bullets: ['4 channels today, more on the way', 'Real-time, with full history and media', 'Nothing to instrument for analytics'] },
      { eyebrow: 'Who it’s for', h3: 'Support teams, sales teams and agencies', p: 'Small teams use it as their whole front desk. Agencies add client businesses, each on its own subdomain workspace with its own number and branding.', art: V.flow([{ k: 'Workspace', a: 1, v: 'northwind.zunoone.com' }, { k: '', v: 'fjord.zunoone.com' }, { k: '', v: 'katal.zunoone.com' }]) },
    ],
    cards: { eyebrow: 'What’s inside', title: 'Everything in one product', cols: 4, items: [
      { ic: '📥', h: 'Team Inbox', p: 'All channels, one real-time queue.' },
      { ic: '🔀', h: 'Routing', p: 'Round-robin and a channel × agent matrix.' },
      { ic: '⚙', h: 'Automations', p: 'Triggers, conditions and actions.' },
      { ic: '📣', h: 'Broadcasts', p: 'Message a segment, track delivery.' },
      { ic: '✨', h: 'AI Agents', p: 'Draft, autopilot, keyword hand-off.' },
      { ic: '📊', h: 'Analytics', p: 'Volume, response time, per agent.' },
      { ic: '🔌', h: 'API & webhooks', p: 'Build anything on top.' },
      { ic: '🏢', h: 'Agency mode', p: 'Every client from one login.' },
    ]},
  },
  {
    h: 'mobile-app.html', title: 'Mobile App', eyebrow: 'Scale with Zuno One', roadmap: true,
    h1: 'Zuno One in your pocket',
    lead: 'Native iOS and Android apps so your team can pick up conversations, get push notifications for new messages and mentions, and reply on the move.',
    rows: [
      { eyebrow: 'On the go', h3: 'The same inbox, on your phone', p: 'Assigned conversations, push notifications, quick replies and voice notes — without opening a laptop.', bullets: ['Push for new messages and @mentions', 'Quick replies and media', 'Available for iOS and Android'] },
      { eyebrow: 'Coming', h3: 'In beta soon', p: 'We’re testing internally now. Leave your email to join the TestFlight and Play beta.', art: V.tiles([{ n: 'iOS', l: 'beta soon' }, { n: 'Android', l: 'beta soon' }, { n: 'Push', l: 'included' }]) },
    ],
  },
  {
    h: 'whatsapp-calling.html', title: 'WhatsApp Calling API', eyebrow: 'Scale with Zuno One', roadmap: true,
    h1: 'Voice calls, inside the conversation',
    lead: 'Support the WhatsApp Business Calling API so customers can call you from the chat and your team answers from Zuno One — with the full text history on screen.',
    rows: [
      { eyebrow: 'Chat to call', h3: 'Escalate to voice without a number swap', p: 'When text isn’t enough, take the call in the same window, with the conversation context right there.', bullets: ['Inbound calls from WhatsApp', 'Context and history on screen', 'Call outcome logged to the conversation'] },
      { eyebrow: 'Status', h3: 'On the roadmap', p: 'Dependent on Meta’s Calling API rollout. Register interest and we’ll keep you posted.', art: V.flow([{ k: 'Chat', v: '"can we talk?"' }, { k: 'Then', a: 1, v: 'answer call in Zuno One' }]) },
    ],
  },
  {
    h: 'project-management.html', title: 'Project Management', eyebrow: 'Operations',
    planNote: 'On the Advanced plan · free on Growth with annual billing',
    h1: 'Project management, built into the inbox',
    lead: 'A full task and delivery tool inside Zuno One — six ways to see the work, task depth from subtasks to dependencies, time tracking and sprints, plus a portfolio dashboard across every project. Turn a conversation into a task without leaving the thread.',
    rows: [
      { eyebrow: 'Six views, one dataset', h3: 'See the work the way you need to', p: 'Every project opens in the layout that fits the moment — drag cards on a Board, scan a grouped List, edit a spreadsheet-style Table, plan on a Calendar, sequence on a Timeline (Gantt with a today marker and dependency-aware bars), or check a per-project Dashboard with completion, time logged and milestones.', bullets: ['Board · List · Table · Calendar · Timeline · Dashboard', 'Group by status, assignee or priority; filter by anyone, priority, sprint or search', 'Drag-and-drop with live sync across every open board', 'Task ids like WEB-42 on every card and row'] },
      { eyebrow: 'Real task depth', h3: 'Subtasks, dependencies, custom fields and more', p: 'Tasks carry everything a delivery team needs — nested subtasks with progress, "blocked by" dependencies that stop a task closing early, per-project custom fields (text, select, date, money…), tags, estimates, checklists, comments with @mentions, and a full activity log per task.', bullets: ['Subtasks with roll-up progress', 'Dependencies — a blocked task can’t be marked done', 'Custom fields shown as Table columns', 'Recurring tasks that spawn the next occurrence on completion', 'Milestones flagged on the board, calendar and timeline'] },
      { eyebrow: 'Track effort and cadence', h3: 'Time tracking and sprints', p: 'Start a timer or log minutes against any task; totals roll up to the card and the dashboard. Turn on sprints to date-box work, mark one active, and filter every view to it.', art: V.flow([{ k: 'Task', v: 'QA the signup flow' }, { k: 'Then', a: 1, v: ['start timer → 45m logged', 'move to Done', 'burn updates on the dashboard'] }]) },
      { eyebrow: 'From chat to task', h3: 'One button in the conversation', p: 'A "Create a task" action in the inbox details panel spins a task out of the open conversation — pre-filled with the customer’s name, the last message and a link back to the thread, dropped into your first project.', art: V.flow([{ k: 'Message', v: '"can you also add onboarding?"' }, { k: 'Do', a: 1, v: ['create task · Follow up: onboarding', 'linked to the conversation', 'assign + due date'] }]) },
      { eyebrow: 'Across every project', h3: 'Portfolio Overview and access control', p: 'Switch the module to Overview for a dashboard across all projects — KPI tiles (active, completed, overdue, at-risk, velocity, team load), a status donut, a progress-by-project chart, upcoming deadlines, team workload and a live activity feed. Give each teammate a tick-box list of exactly which projects and areas they can open.', bullets: ['Board / Overview layout toggle, remembered per person', 'Per-member project access — everything else stays hidden', 'Save any project as a reusable template', 'Editable per-project statuses, custom fields and sprints'] },
    ],
    cards: { eyebrow: 'The six views', title: 'One project, six ways to look at it', cols: 3, items: [
      { ic: '🗂️', h: 'Board', p: 'Kanban columns by status, assignee or priority. Drag to move, add straight into a column.' },
      { ic: '📋', h: 'List', p: 'Grouped rows with status badges, mini progress chips and a totals footer.' },
      { ic: '🔢', h: 'Table', p: 'Spreadsheet layout with your custom-field columns, estimates and logged time.' },
      { ic: '📅', h: 'Calendar', p: 'Month grid by due date, overdue in red, today highlighted.' },
      { ic: '📈', h: 'Timeline', p: 'Gantt bars from start to due, a today marker, milestone diamonds and a status rail.' },
      { ic: '📊', h: 'Dashboard', p: 'Completion ring, tasks by status/assignee/priority, milestones and resource burn.' },
    ]},
  },
  {
    h: 'accounting.html', title: 'Accounting', eyebrow: 'Operations', roadmap: true,
    h1: 'Invoicing and books on the same customer data',
    lead: 'Quotes, invoices, expenses and VAT — linked to the same contacts, conversations and projects, so billing follows the work instead of living in a separate app.',
    rows: [
      { eyebrow: 'Quote to cash', h3: 'Send a quote from the conversation, bill from the project', p: 'Build a quote in the thread, convert it to an invoice when it’s accepted, and chase payment with the same reminders engine your team already uses.', bullets: ['Quotes and invoices with your branding', 'Payment reminders as scheduled messages', 'Expenses and receipts against a project', 'Bank reconciliation and P&L / balance sheet'] },
      { eyebrow: 'Compliance', h3: 'VAT return preparation', p: 'Tag transactions, run the period, and export a filing-ready summary. Built with UAE and GCC VAT rules in mind, adaptable to your jurisdiction.', art: V.flow([{ k: 'Invoice paid', v: 'AED 5,250 incl. VAT' }, { k: 'Then', a: 1, v: ['post to ledger', 'VAT return · Q ready', 'receipt sent to customer'] }]) },
    ],
    cards: { eyebrow: 'One suite', title: 'Why on the same platform', cols: 3, items: [
      { ic: '🔗', h: 'No re-keying', p: 'The customer, the project and the conversation are already there — the invoice just references them.' },
      { ic: '⏰', h: 'Reminders reused', p: 'Overdue-invoice nudges use the same scheduler as renewal and appointment reminders.' },
      { ic: '📁', h: 'Audit trail', p: 'Every quote, approval and payment message is attached to the thread it came from.' },
    ]},
  },
];

const INDUSTRIES = [
  { h: 'industry-retail.html', name: 'Retail & E-commerce', short: 'retail', icon: '🛍️',
    h1: 'Turn "how much?" into a sale',
    lead: 'Answer product and stock questions on WhatsApp and Instagram in seconds, recover carts with a nudge, and keep post-purchase support in one thread.',
    useTitle: 'What retail teams do with Zuno One', useLead: 'From first question to repeat customer.',
    uses: [
      { ic: '🛒', h: 'Pre-sale questions', p: 'Sizing, stock, delivery — answered in the DMs before the buyer cools off.' },
      { ic: '📦', h: 'Order updates', p: '"Where’s my order" handled with tracking pulled into the reply.' },
      { ic: '🔁', h: 'Win-back', p: 'Broadcast an offer to a segment; replies come back to the inbox.' },
    ],
    rows: [
      { eyebrow: 'Speed', h3: 'AI drafts for the FAQ pile', p: 'Sizing charts, return policy, delivery windows — the AI agent answers the twentieth "do you ship to X?" so your team handles the rest.', art: V.panel([{ i: 'LF', n: '@lucasfit', dot: 'var(--ig)', p: 'do you ship to Portugal?', t: '5m', c: '#f0a6c2' }], 'Yes — 3–5 days, tracking included') },
      { eyebrow: 'Peak season', h3: 'Routing that holds up on Black Friday', p: 'Round-robin spreads the surge across the team; overflow gets an automated acknowledgement so nobody is ignored.', bullets: ['Round-robin across the on-duty pool', 'After-hours auto-reply', 'Labels for returns, VIPs, wholesale'] },
    ],
    quote: { text: 'Instagram DMs used to be a black hole. Now they convert.', who: 'Retail customer, apparel', initials: 'R' },
  },
  { h: 'industry-education.html', name: 'Education', short: 'education', icon: '🎓',
    h1: 'Answer parents and students on the channel they use',
    lead: 'Admissions questions, class schedules, fee reminders and re-enrolment — handled on WhatsApp by a small team, with reminders that actually get read.',
    useTitle: 'What schools and tutors do with Zuno One', useLead: 'Academic tutoring, afterschool programmes, sport and fitness centres.',
    uses: [
      { ic: '📝', h: 'Admissions', p: 'Capture enquiries from ads and the website, qualify, and book a tour.' },
      { ic: '📅', h: 'Schedules & changes', p: 'Class times, cancellations and make-up sessions in one thread per family.' },
      { ic: '💳', h: 'Fee & renewal reminders', p: 'A WhatsApp nudge before the deadline beats an email nobody opens.' },
    ],
    rows: [
      { eyebrow: 'Enrolment', h3: 'From enquiry to booked tour', p: 'A workflow qualifies the enquiry — year group, start date — and routes it to the right coordinator.', art: V.flow([{ k: 'Ask', v: ['Year group?', 'Start term?'] }, { k: 'Then', a: 1, v: ['route · coordinator', 'book · school tour'] }]) },
      { eyebrow: 'Term time', h3: 'Broadcasts for the whole cohort', p: 'Send a schedule change or event reminder to a class or programme; questions come straight back to staff.', bullets: ['Segment by class, programme or year', 'Two-way — replies reach staff', 'Re-enrolment campaigns'] },
    ],
    quote: { text: 'Sport Center Los Naranjos gained 20% more conversions from sales inquiries.', who: 'Sport & fitness customer', initials: 'S' },
  },
  { h: 'industry-healthcare.html', name: 'Healthcare', short: 'clinic', icon: '🩺',
    h1: 'Fewer no-shows, calmer front desk',
    lead: 'Appointment reminders, results-ready notifications and general questions on WhatsApp — so the phone lines are free for the calls that need them.',
    useTitle: 'What clinics do with Zuno One', useLead: 'Keep it human, keep it private.',
    uses: [
      { ic: '📲', h: 'Appointment reminders', p: 'A day-before and hour-before nudge cuts no-shows without extra staff time.' },
      { ic: '❓', h: 'General enquiries', p: 'Opening hours, directions, what to bring — answered without a call.' },
      { ic: '🔔', h: 'Ready-for-pickup', p: 'Notify when results or prescriptions are ready; replies reach reception.' },
    ],
    rows: [
      { eyebrow: 'Reminders', h3: 'A cadence that reduces no-shows', p: 'Trigger from your booking system via the API. The sequence stops as soon as the patient confirms or reschedules.', art: V.flow([{ k: 'Appt', v: 'tomorrow 10:00' }, { k: 'Send', a: 1, v: ['T-1 day · confirm?', 'T-1 hour · reminder'] }]) },
      { eyebrow: 'Care', h3: 'Sensitive by default', p: 'Zuno One pulls and displays conversations without warehousing them, and access is scoped to the team that needs it.', bullets: ['Minimal data retention', 'Role-scoped access', 'Audit of who replied'] },
    ],
  },
  { h: 'industry-services.html', name: 'Professional Services', short: 'client', icon: '💼',
    h1: 'Look responsive without hiring for it',
    lead: 'Agencies, consultancies, law and accounting firms use Zuno One to catch enquiries fast, qualify them, and keep every client thread in one place.',
    useTitle: 'What service firms do with Zuno One', useLead: 'Billable time is precious — spend less of it on inbox triage.',
    uses: [
      { ic: '📥', h: 'Enquiry capture', p: 'Website and ad enquiries open as conversations, not form emails.' },
      { ic: '✅', h: 'Qualification', p: 'A few questions before a partner’s time is committed.' },
      { ic: '🗂️', h: 'Per-client threads', p: 'One conversation history per client, across WhatsApp and email.' },
    ],
    rows: [
      { eyebrow: 'Triage', h3: 'AI answers the basics, routes the rest', p: 'Scope, timeline and budget captured up front; qualified enquiries go to the right practice area.', art: V.flow([{ k: 'Ask', v: ['Scope?', 'Budget band?'] }, { k: 'Then', a: 1, v: ['route · practice area', 'status · qualified'] }]) },
      { eyebrow: 'Agencies', h3: 'Run every client from one login', p: 'Each client gets an isolated workspace with its own number and branding; you switch between them from one dashboard.', bullets: ['Isolated workspace per client', 'Per-workspace team and channels', 'Seat limits by plan'] },
    ],
  },
  { h: 'industry-automotive.html', name: 'Automotive', short: 'dealership', icon: '🚗',
    h1: 'From "is it available?" to a booked test drive',
    lead: 'Dealerships and workshops use Zuno One to answer stock and service questions on WhatsApp, book test drives and service slots, and send MOT and service reminders.',
    useTitle: 'What automotive teams do with Zuno One', useLead: 'Sales floor and service bay, one inbox.',
    uses: [
      { ic: '🔑', h: 'Stock enquiries', p: '"Still available?" answered fast, with photos and a test-drive slot.' },
      { ic: '🔧', h: 'Service booking', p: 'Book and confirm service appointments in the thread.' },
      { ic: '📅', h: 'MOT / service reminders', p: 'Scheduled nudges before the due date, replies to the service desk.' },
    ],
    rows: [
      { eyebrow: 'Sales', h3: 'Catch the enquiry while it’s hot', p: 'Listing enquiries from the website and marketplaces land in the inbox; an automation replies instantly and assigns a salesperson.', art: V.panel([{ i: 'RP', n: 'Rehan P.', dot: 'var(--wa)', p: 'Is the 2021 model still available?', t: '1m' }], 'Yes! Free tomorrow at 3pm for a test drive?') },
      { eyebrow: 'Service', h3: 'Reminders that fill the bay', p: 'MOT and service reminders go out on a schedule and stop when the customer books.', bullets: ['Date-triggered reminder sequences', 'In-thread slot confirmation', 'Replies routed to the service desk'] },
    ],
  },
  { h: 'industry-travel.html', name: 'Travel & Hospitality', short: 'guest', icon: '✈️',
    h1: 'Answer guests before they book elsewhere',
    lead: 'Hotels, tour operators and travel agencies use Zuno One to answer availability and pricing on WhatsApp, confirm bookings, and handle in-stay requests in one thread.',
    useTitle: 'What travel teams do with Zuno One', useLead: 'Pre-booking, in-stay and follow-up.',
    uses: [
      { ic: '🏨', h: 'Availability & quotes', p: 'Room, tour and package questions answered in minutes, not next business day.' },
      { ic: '🧾', h: 'Booking confirmation', p: 'Confirm details and send what they need in the same conversation.' },
      { ic: '🛎️', h: 'In-stay requests', p: 'Late checkout, extra towels, restaurant booking — routed to the right team.' },
    ],
    rows: [
      { eyebrow: 'Conversion', h3: 'Speed wins the booking', p: 'Enquiries from listing sites and ads land in the inbox; an instant reply keeps the guest engaged while a human quotes.', art: V.panel([{ i: 'SO', n: 'Sohana', dot: 'var(--wa)', p: 'Is a sea-view room available 10–14 Jul?', t: '4m' }], 'Yes — sending options now') },
      { eyebrow: 'Peak', h3: 'Multilingual, round the clock', p: 'AI drafts handle common questions in the guest’s language; routing spreads the load across shifts.', bullets: ['After-hours auto-acknowledge', 'Round-robin across shifts', 'Labels for VIP, groups, complaints'] },
    ],
  },
];

/* ---------------- special pages ---------------- */
function industriesIndex() {
  return `${head('Zuno One — Industries', 'Zuno One for retail, education, healthcare, professional services, automotive and travel.')}

${header()}

<section class="phero">
  <div class="aurora"><i></i><i></i><i></i></div>
  <div class="grid-lines"></div>
  <div class="wrap">
    <span class="eyebrow">Industries</span>
    <h1>Built for the way your industry talks to customers</h1>
    <p class="lead">The shared inbox is the same everywhere. What changes is which questions come in, how fast they need answering, and which reminders keep people coming back. Pick your sector.</p>
  </div>
</section>

<section class="band-tight"><div class="wrap reveal">
  <div class="ind-grid">
    ${INDUSTRIES.map(i => `<a href="${i.h}"><div class="ic">${i.icon}</div><h3>${i.name}</h3><p>${i.lead.slice(0, 96)}…</p><div class="go">Explore →</div></a>`).join('')}
  </div>
</div></section>

${quoteSec({ text: 'Sport Center Los Naranjos gained 20% more conversions from sales inquiries after moving to a single inbox.', who: 'Sport & fitness · Education', initials: 'S' })}

${ctaSec({ title: 'See Zuno One for your team', primary: { t: 'Start free', h: APP }, ghost: { t: 'Book a demo', h: 'contact.html' } })}

${footer()}

<script src="app.js" defer></script>
`;
}

function customersPage() {
  const stories = [
    { c: 'Northwind', i: 'NW', t: 'First-response time from hours to under 4 minutes', q: 'We replaced three tools and a spreadsheet with Zuno One.', who: 'Priya Nair · Head of Support' },
    { c: 'Sport Center Los Naranjos', i: 'SN', t: '20% more conversions from sales inquiries', q: 'Every enquiry gets answered now — nothing sits overnight.', who: 'Front-desk lead' },
    { c: 'Fjord', i: 'FJ', t: 'One inbox across 6 client workspaces', q: 'Our agency runs every client from one login.', who: 'Operations' },
    { c: 'Katal', i: 'KT', t: 'Cut WhatsApp response time by 70%', q: 'Routing means the right person sees it first time.', who: 'Support manager' },
  ];
  return `${head('Zuno One — Customer Stories', 'How teams use Zuno One to answer customers faster.')}

${header()}

<section class="phero">
  <div class="aurora"><i></i><i></i><i></i></div>
  <div class="grid-lines"></div>
  <div class="wrap">
    <span class="eyebrow">Success stories</span>
    <h1>Teams answering faster with Zuno One</h1>
    <p class="lead">1,400+ teams in 40 countries run their customer conversations on Zuno One. Here are a few of them.</p>
  </div>
</section>

<section class="band-tight"><div class="wrap reveal">
  <div class="cardgrid c2">
    ${stories.map(s => `<div class="cd"><div class="ic">${s.i}</div><h3>${s.c}</h3><p style="color:var(--ink-2);font-weight:600;margin-top:2px">${s.t}</p><p style="margin-top:10px">&ldquo;${s.q}&rdquo;</p><p style="margin-top:8px;color:var(--ink-3)">${s.who}</p></div>`).join('')}
  </div>
  <p class="sec-lead" style="margin-top:24px">Names and figures on this page are illustrative placeholders — swap in real customer stories before launch.</p>
</div></section>

${ctaSec({ title: 'Be the next story', primary: { t: 'Start free', h: APP }, ghost: { t: 'Book a demo', h: 'contact.html' } })}

${footer()}

<script src="app.js" defer></script>
`;
}

function whyPage() {
  return `${head('Zuno One — Why Us', 'Why teams choose Zuno One over a pile of separate apps.')}

${header()}

<section class="phero">
  <div class="aurora"><i></i><i></i><i></i></div>
  <div class="grid-lines"></div>
  <div class="wrap">
    <span class="eyebrow">Why Zuno One</span>
    <h1>One product, not a toolchain</h1>
    <p class="lead">Most teams end up with a phone for WhatsApp, a browser tab for Instagram, a shared mailbox, a broadcast tool and a spreadsheet for routing. Zuno One is all of that in one place — and priced so a small team can actually afford it.</p>
  </div>
</section>

${cardsSec({ eyebrow: 'Reasons', title: 'What makes it different', cols: 3, items: [
  { ic: '📥', h: 'Genuinely omnichannel', p: 'WhatsApp, Instagram, Messenger and Gmail in one queue — not a WhatsApp tool with add-ons.' },
  { ic: '⚡', h: 'Live in minutes', p: 'WhatsApp connects by QR. No Business API application, no weeks of waiting.' },
  { ic: '⚙', h: 'Automation included', p: 'A real rule engine and AI agent in every paid plan — not a premium upsell.' },
  { ic: '🏢', h: 'Multi-tenant', p: 'Agencies run every client from one login, each workspace isolated.' },
  { ic: '📊', h: 'Analytics with zero setup', p: 'Numbers straight from the conversations. No tagging discipline required.' },
  { ic: '💸', h: 'Fair pricing', p: 'Flat monthly by plan. No per-conversation fees, ever.' },
]})}

<section class="band-tight"><div class="wrap reveal">
  <span class="eyebrow">Honest about scope</span>
  <h2 class="sec">What we don’t do yet</h2>
  <p class="sec-lead">We’d rather tell you now. On the roadmap: a website chat widget, click-to-chat ad capture, in-thread appointment booking, CSAT/NPS surveys, native mobile apps, and the WhatsApp Calling API. If one of those is a dealbreaker, <a href="contact.html" style="color:var(--sky);font-weight:600">tell us</a> — it helps us prioritise.</p>
</div></section>

${quoteSec({ text: 'The pitch was "one inbox". Six months in, that’s still exactly what it is — and that’s the point.', who: 'Priya Nair · Head of Support, Northwind', initials: 'PN' })}

${ctaSec({ title: 'Try it with your own channels', primary: { t: 'Start free', h: APP }, ghost: { t: 'Book a demo', h: 'contact.html' } })}

${footer()}

<script src="app.js" defer></script>
`;
}

function contactPage() {
  return `${head('Zuno One — Contact', 'Talk to sales or get support.')}

${header()}

<section class="phero">
  <div class="aurora"><i></i><i></i><i></i></div>
  <div class="grid-lines"></div>
  <div class="wrap">
    <span class="eyebrow">Contact</span>
    <h1>Talk to us</h1>
    <p class="lead">A demo tailored to your channels, pricing for a bigger team, or a hand getting connected — we’re quick to reply.</p>
  </div>
</section>

<section class="band-tight"><div class="wrap reveal">
  <div class="contact-grid">
    <div class="cc">
      <h3>Talk to sales</h3>
      <p>Book a 30-minute demo with your own channels in view, or ask about volume pricing and agency plans.</p>
      <p style="margin-top:12px"><a href="mailto:sales@zunoone.com">sales@zunoone.com</a></p>
      <form class="applyform" id="applyForm" style="margin-top:16px">
        <div class="field"><label for="c-name">Name</label><input id="c-name" name="name" required></div>
        <div class="field"><label for="c-email">Work email</label><input id="c-email" type="email" name="email" required></div>
        <div class="field"><label for="c-co">Company &amp; team size</label><input id="c-co" name="company"></div>
        <div class="field"><label for="c-msg">What do you want to solve?</label><textarea id="c-msg" name="message" required></textarea></div>
        <button class="btn btn-primary" type="submit">Request a demo</button>
        <p id="applyNote" hidden style="color:var(--good);font-size:13px;font-family:'JetBrains Mono',monospace">Thanks — we’ll be in touch within one business day. (Demo form — wire it to your CRM before launch.)</p>
      </form>
    </div>
    <div class="cc">
      <h3>Get support</h3>
      <p>Already using Zuno One? The team answers in the help centre and by email, usually within a few hours on business days.</p>
      <p style="margin-top:12px"><a href="mailto:support@zunoone.com">support@zunoone.com</a> · <a href="#">Help centre</a></p>
      <h3 style="margin-top:22px">Partnerships &amp; press</h3>
      <p style="margin-top:8px"><a href="mailto:hello@zunoone.com">hello@zunoone.com</a></p>
      <p class="sec-lead" style="margin-top:22px">Zuno One · [registered address] · [company number]</p>
    </div>
  </div>
</div></section>

${footer()}

<script src="app.js" defer></script>
`;
}

/* ---------------- the Zuno One platform (product suite) ---------------- */
const MODULE_GROUPS = [
  { group: 'Customer', modules: [
    { ic: I.chat, name: 'Shared Inbox &amp; CRM', status: 'available',
      p: 'WhatsApp, Instagram, Messenger and Gmail in one team inbox — routing, automations, broadcasts, AI assist, a website chat widget, surveys, reminders, appointments and analytics.' },
  ]},
  { group: 'People &amp; HR', modules: [
    { ic: I.users, name: 'HR Management', status: 'soon', p: 'Employee records, contracts and documents, leave requests and approvals, onboarding and offboarding, and an org directory.' },
    { ic: I.userPlus, name: 'Recruitment', status: 'soon', p: 'Job postings, an applicant pipeline, interview scheduling and offer management — candidates flow in from the same channels.' },
    { ic: I.bank, name: 'Payroll (WPS)', status: 'soon', p: 'UAE Wage Protection System–compliant pay runs: allowances and deductions, automatic SIF file generation for the bank, and payslips.' },
    { ic: I.clock, name: 'Shifts &amp; Time Tracking', status: 'soon', p: 'Rosters, shift swaps, clock in/out, timesheets and attendance — feeding straight into payroll.' },
    { ic: I.repeat, name: 'Temp Workforce', status: 'soon', p: 'Manage a pool of temporary and contract staff: availability, placements, rates and per-assignment pay.' },
    { ic: I.cap, name: 'Learning', status: 'soon', p: 'Courses, onboarding paths and compliance training, with completion tracking per employee.' },
    { ic: I.megaphone, name: 'Team Intranet', status: 'soon', p: 'Company announcements, a knowledge base, groups and internal chat — one place for staff communication.' },
  ]},
  { group: 'Operations', modules: [
    { ic: I.kanban, name: 'Project Management', status: 'available', h: 'project-management.html', p: 'Board, List, Table, Calendar, Timeline and Dashboard views, plus a portfolio Overview. Subtasks, dependencies, custom fields, sprints, time tracking, recurring tasks and milestones. Turn a conversation into a task.' },
    { ic: I.chart, name: 'Accounting', status: 'soon', h: 'accounting.html', p: 'Invoicing and quotes, expenses, VAT return preparation, bank reconciliation and financial reports — linked to the same customers and projects.' },
  ]},
];

function platformPage() {
  const badge = s => s === 'available'
    ? '<span class="pill tag-live">Available now</span>'
    : '<span class="pill tag-soon">Coming soon</span>';
  const groupSec = g => `<div class="reveal" style="margin-top:44px">
    <div class="eyebrow">${g.group}</div>
    <div class="cardgrid c2" style="margin-top:12px">
      ${g.modules.map(m => `<div class="cd ${m.status === 'soon' ? 'soon' : ''}">
        <div class="ic"><span class="micon">${m.ic}</span></div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><h3 style="margin:0">${m.name}</h3>${badge(m.status)}</div>
        <p>${m.p}</p>
        <a class="more" href="${m.status === 'available' ? 'features.html' : (m.h || 'contact.html')}" style="color:var(--sky);font-weight:600;font-size:12px;display:inline-block;margin-top:10px">${m.status === 'available' ? 'See features →' : (m.h ? 'Learn more →' : 'Notify me when it launches →')}</a>
      </div>`).join('')}
    </div>
  </div>`;
  return `${head('Zuno One — Platform', 'One connected platform for running a business: shared inbox & CRM today, with HR, recruitment, WPS payroll, shifts, learning, an intranet, project management and accounting on the way.')}

${header()}

<section class="phero">
  <div class="aurora"><i></i><i></i><i></i></div>
  <div class="grid-lines"></div>
  <div class="wrap">
    <span class="eyebrow">Platform</span>
    <h1>One platform for running the whole business</h1>
    <p class="lead">Zuno One starts with the shared inbox and CRM. Next come a full people &amp; HR suite — HR management, recruitment, WPS-compliant payroll, shifts and time tracking, temp workforce, learning and a team intranet — plus project management and accounting. Every module is built on the same contacts, team and data, so nothing lives in a silo.</p>
    <div class="cta"><a class="btn btn-primary" href="${APP}">Start with the inbox ${ARR}</a><a class="btn btn-ghost" href="contact.html">Register interest</a></div>
  </div>
</section>

<section class="band-tight"><div class="wrap">
  <div class="reveal">
    <span class="eyebrow">Modules</span>
    <h2 class="sec">What's here and what's next</h2>
    <p class="sec-lead">The Customer module is live today. Everything below is in planning — tell us which you need first and we'll keep you posted.</p>
  </div>
  ${MODULE_GROUPS.map(groupSec).join('')}
</div></section>

<section class="band-tight"><div class="wrap reveal">
  <span class="eyebrow">Why one platform</span>
  <h2 class="sec">The same data, everywhere</h2>
  <div class="cardgrid" style="margin-top:28px">
    <div class="cd"><h3>Shared records</h3><p>A lead in the inbox, a client on a project, an employee in HR, a payee in payroll — one record, one history.</p></div>
    <div class="cd"><h3>One login &amp; team</h3><p>Add a person once. Roles and permissions carry across every module.</p></div>
    <div class="cd"><h3>Priced together</h3><p>Modules will be add-ons to your existing plan — no separate vendors, no separate invoices.</p></div>
  </div>
</div></section>

${ctaSec({ title: 'Get on the list for the next modules', primary: { t: 'Start free', h: APP }, ghost: { t: 'Register interest', h: 'contact.html' } })}

${footer()}

<script src="app.js" defer></script>
`;
}

/* ---------------- legal / policy pages ---------------- */
const COMPANY = 'Zuno One';
const LEGAL_EMAIL = 'legal@zunoone.com';
const SUPPORT_EMAIL = 'support@zunoone.com';
const UPDATED = '[Effective date — set before publishing]';

function legalPage(slug, title, intro, sections) {
  const toc = `<div class="toc"><h4>Contents</h4><ol>${sections.map((s, i) => `<li><a href="#s${i + 1}">${s.h}</a></li>`).join('')}</ol></div>`;
  const body = sections.map((s, i) => `<h2 id="s${i + 1}">${i + 1}. ${s.h}</h2>${s.b}`).join('\n');
  return `${head(COMPANY + ' — ' + title, title + ' for ' + COMPANY + ' / the Zuno One platform.')}

${header()}

<section class="phero">
  <div class="aurora"><i></i><i></i><i></i></div>
  <div class="grid-lines"></div>
  <div class="wrap">
    <span class="eyebrow">Legal</span>
    <h1>${title}</h1>
    <p class="lead">${intro}</p>
  </div>
</section>

<section class="band-tight"><div class="wrap"><div class="legal">
  <div class="tmpl"><b>Template — review with a lawyer.</b> This document is a starting point for ${COMPANY}. Fill in every <b>[bracketed]</b> field (registered entity, address, governing law, dates) and have it reviewed for your jurisdiction and how you actually operate before you publish or rely on it.</div>
  <div class="updated">Last updated: ${UPDATED}</div>
  ${toc}
  ${body}
  <h2>Contact</h2>
  <p>Questions about this ${title.toLowerCase()}: <a href="mailto:${LEGAL_EMAIL}">${LEGAL_EMAIL}</a>. ${COMPANY}, [registered company number], [registered address].</p>
</div></div></section>

${footer()}

<script src="app.js" defer></script>
`;
}

const TERMS = [
  { h: 'Agreement to terms', b: `<p>These Terms of Service ("Terms") are a binding agreement between ${COMPANY} ("we", "us") and the person or entity that creates an account or uses the ${COMPANY} platform, including the shared inbox, website chat widget, automations, broadcasts, analytics and API (the "Service"). By creating an account or using the Service you accept these Terms. If you accept on behalf of an organisation, you confirm you are authorised to bind it.</p>` },
  { h: 'The Service', b: `<p>The Service lets you receive and reply to customer conversations from messaging channels (such as WhatsApp, Instagram, Facebook Messenger and email) in one place, and to route, automate, broadcast and report on them. We may add, change or remove features. We do not warehouse full conversation history from third-party channels; we pull and display messages, and store limited operational data (contacts, labels, notes, reminders, appointments, survey results, call logs and widget threads).</p>` },
  { h: 'Accounts and eligibility', b: `<p>You must provide accurate information, keep your credentials secure, and are responsible for all activity under your account. You must be at least 18 and capable of forming a contract. One workspace = one customer organisation; sharing a workspace across unrelated businesses is not permitted.</p>` },
  { h: 'Third-party channels', b: `<p>WhatsApp, Meta (Instagram, Messenger) and Google (Gmail) are independent services with their own terms. You are responsible for complying with those terms and for having the right to connect the accounts and numbers you connect. Certain connection methods may not be officially sanctioned by the channel provider and could result in that provider limiting or disabling your account; you accept that risk. We are not responsible for a channel provider suspending, rate-limiting or banning your account, number or page.</p>` },
  { h: 'Acceptable use', b: `<p>You agree not to use the Service to: send unsolicited bulk or spam messages; violate messaging, marketing, privacy or consumer-protection laws (including opt-in / opt-out requirements); send unlawful, deceptive, harassing, or infringing content; impersonate others; probe, scan or breach security; overload or interfere with the Service; or resell the Service without our written permission. You are responsible for obtaining any consents required to message the people you message.</p>` },
  { h: 'Your data and content', b: `<p>As between the parties, you own the data and content you and your customers submit ("Customer Data"). You grant us a licence to host, process and transmit Customer Data solely to provide and support the Service. For personal data within Customer Data, we act as your processor; our handling is described in the <a href="privacy.html">Privacy Policy</a> and, where applicable, a Data Processing Addendum. You are responsible for the lawfulness of the Customer Data and for having the rights and consents to provide it.</p>` },
  { h: 'Plans, billing and renewals', b: `<p>Paid plans are billed in advance on a recurring monthly basis through our payment processor (Stripe). Subscriptions renew automatically until cancelled. Fees are exclusive of taxes, which you are responsible for. Plan limits (seats, contacts, AI credits) apply as shown on the <a href="pricing.html">Pricing</a> page; exceeding them may require an upgrade. We may change prices with at least 30 days' notice effective at your next renewal. Non-payment may lead to suspension or downgrade — see the <a href="refunds.html">Refund &amp; Cancellation Policy</a>.</p>` },
  { h: 'Free plan and trials', b: `<p>Any free plan or trial is provided "as is" with no commitments, and we may change or discontinue it at any time. Usage limits on the free plan are enforced; work already created stays accessible.</p>` },
  { h: 'AI features', b: `<p>Optional AI features generate suggested or automated replies from the knowledge and settings you provide. Output may be inaccurate or inappropriate; you are responsible for reviewing and for any messages sent from your workspace, whether by a person or an automation. AI processing may use a third-party model provider.</p>` },
  { h: 'Intellectual property', b: `<p>We and our licensors own the Service, its software, and all related IP. We grant you a limited, non-exclusive, non-transferable right to use the Service during your subscription. You may not copy, modify, reverse-engineer, or create derivative works of the Service except as permitted by law.</p>` },
  { h: 'Confidentiality', b: `<p>Each party will protect the other's non-public information disclosed in connection with the Service with reasonable care and use it only to perform under these Terms.</p>` },
  { h: 'Warranties and disclaimers', b: `<p>The Service is provided "as is" and "as available". To the fullest extent permitted by law we disclaim all warranties, express or implied, including merchantability, fitness for a particular purpose, non-infringement, and any warranty that the Service will be uninterrupted, error-free, or that messages will always be delivered by third-party channels.</p>` },
  { h: 'Limitation of liability', b: `<p>To the fullest extent permitted by law, neither party is liable for indirect, incidental, special, consequential or punitive damages, or for lost profits, revenue, data or goodwill. Our total aggregate liability arising out of or related to the Service is limited to the amounts you paid us for the Service in the 12 months before the event giving rise to the claim (or, if you are on a free plan, to USD 100).</p>` },
  { h: 'Indemnification', b: `<p>You will defend and indemnify us against third-party claims arising from your Customer Data, your use of the Service in breach of these Terms or law, or your messaging of individuals without required consent.</p>` },
  { h: 'Suspension', b: `<p>We may suspend your access immediately if we reasonably believe there is a security risk, unlawful activity, a violation of Section 5, non-payment, or a demand from a channel provider or authority. We will try to give notice where practical.</p>` },
  { h: 'Term and termination', b: `<p>These Terms apply while you have an account. You may cancel at any time from the billing settings; cancellation stops future renewals and access continues until the end of the paid period. We may terminate for material breach not cured within 15 days of notice. On termination your right to use the Service ends; we may delete Customer Data after a reasonable period unless law requires otherwise. You can export your data before termination.</p>` },
  { h: 'Changes to the Service and Terms', b: `<p>We may update these Terms; if a change is material we will give reasonable notice (e.g. by email or in-app). Continued use after the effective date means you accept the updated Terms.</p>` },
  { h: 'Governing law and disputes', b: `<p>These Terms are governed by the laws of [jurisdiction], without regard to conflict-of-laws rules. The courts of [venue] have exclusive jurisdiction, except that either party may seek injunctive relief in any competent court. [If you offer arbitration, state it here.]</p>` },
  { h: 'General', b: `<p>These Terms, the Privacy Policy and any order form are the entire agreement. If a provision is unenforceable, the rest remains in effect. Neither party may assign without the other's consent, except to a successor in a merger or asset sale. Failure to enforce a provision is not a waiver. Notices to us: <a href="mailto:${LEGAL_EMAIL}">${LEGAL_EMAIL}</a>.</p>` }
];

const PRIVACY = [
  { h: 'Who we are', b: `<p>${COMPANY} ("we", "us") operates the ${COMPANY} platform. For personal data about our own account holders and website visitors, we are the controller. For personal data contained in the conversations and contacts our customers manage in the Service ("Customer Data"), our customer is the controller and we act as a processor on their instructions. Controller contact: <a href="mailto:${LEGAL_EMAIL}">${LEGAL_EMAIL}</a>, [registered address].</p>` },
  { h: 'Data we collect', b: `<ul>
    <li><b>Account data</b> — name, work email, password (hashed), workspace name, role.</li>
    <li><b>Billing data</b> — plan, and limited details from our payment processor (Stripe); we do not store full card numbers.</li>
    <li><b>Usage and device data</b> — log data, IP address, browser/device info, pages and features used, timestamps, and diagnostic data.</li>
    <li><b>Customer Data (as processor)</b> — contact names, phone numbers, emails and social handles; message content pulled from connected channels for display; labels, notes, tags, reminders, appointments, survey responses, call logs, and website-widget conversations.</li>
    <li><b>Support data</b> — information you send us when you contact support.</li>
  </ul>` },
  { h: 'How we use personal data (as controller)', b: `<ul>
    <li>To provide, secure, maintain and improve the Service.</li>
    <li>To authenticate users and prevent abuse and fraud.</li>
    <li>To bill and manage subscriptions.</li>
    <li>To communicate with you about the Service, including service and security notices.</li>
    <li>To comply with legal obligations and enforce our terms.</li>
  </ul>
  <p><b>Legal bases (GDPR)</b>: performance of a contract; our legitimate interests in running and securing the Service; consent where required (e.g. certain communications or cookies); and legal obligation.</p>` },
  { h: 'Customer Data — our role as processor', b: `<p>We process Customer Data only to provide the Service and on the customer's documented instructions, as set out in these terms and any Data Processing Addendum. We do not sell Customer Data and do not use it to train models for other customers. If you are an individual whose data appears in a customer's workspace, please contact that business (the controller) to exercise your rights; we will assist them.</p>` },
  { h: 'Sharing and sub-processors', b: `<p>We share personal data with service providers who help us run the Service, under contract and only as needed, including:</p>
  <ul>
    <li><b>Cloud hosting</b> — [hosting provider, e.g. Google Cloud], region [region].</li>
    <li><b>Payments</b> — Stripe.</li>
    <li><b>AI model provider</b> — [e.g. OpenAI], only if you enable AI features.</li>
    <li><b>Channel APIs</b> — Meta (Instagram, Messenger) and Google (Gmail) when you connect those channels.</li>
    <li><b>Email / error monitoring</b> — [providers].</li>
  </ul>
  <p>We may also disclose data to comply with law, protect rights and safety, or in a merger or asset sale (with notice). A current sub-processor list is available on request.</p>` },
  { h: 'International transfers', b: `<p>We and our providers may process data outside your country, including in [regions]. Where required we use appropriate safeguards such as the EU Standard Contractual Clauses.</p>` },
  { h: 'Retention', b: `<p>We keep account and billing data for the life of the account and as needed for legal, tax and audit purposes. Customer Data is retained per the customer's configuration and deleted within a reasonable period after account termination unless law requires otherwise. Logs are kept for a limited period for security and debugging. Locally cached message text on the server (used to display recent history) is periodically pruned.</p>` },
  { h: 'Security', b: `<p>We use technical and organisational measures including encryption in transit, hashed passwords, access controls, network isolation of the database, rate limiting and least-privilege access. No method is perfectly secure; we will notify affected customers and authorities of a personal data breach as required by law.</p>` },
  { h: 'Your rights', b: `<p>Depending on where you live you may have rights to access, correct, delete, restrict or object to processing, to data portability, and to withdraw consent. To exercise rights over data we hold as controller, email <a href="mailto:${LEGAL_EMAIL}">${LEGAL_EMAIL}</a>. You may also complain to your local data protection authority. California residents: we do not sell or "share" personal information as defined by the CPRA.</p>` },
  { h: 'Cookies', b: `<p>Our website and app use strictly necessary cookies (for login/session) and may use limited analytics. You can control cookies in your browser. [If you add non-essential analytics or marketing cookies, add a consent banner and describe them here.]</p>` },
  { h: 'Children', b: `<p>The Service is not directed to children under 16 and we do not knowingly collect their personal data.</p>` },
  { h: 'Changes', b: `<p>We may update this Privacy Policy; material changes will be notified by email or in-app. The "last updated" date shows the current version.</p>` }
];

const REFUNDS = [
  { h: 'Subscriptions', b: `<p>Paid ${COMPANY} plans are billed <b>in advance</b> on a recurring <b>monthly</b> basis through Stripe. Your subscription renews automatically each month until you cancel.</p>` },
  { h: 'Cancelling', b: `<p>You can cancel at any time from <b>Settings → Billing → Manage billing</b>. When you cancel:</p>
  <ul>
    <li>Your plan stays active until the end of the current paid period.</li>
    <li>You are not billed again.</li>
    <li>At period end the workspace moves to the Free plan; data above Free-plan limits may become read-only.</li>
  </ul>` },
  { h: 'Refunds', b: `<p>Payments are <b>non-refundable</b> and we do not provide partial refunds or credits for unused time, a downgrade mid-cycle, or periods where you did not use the Service. As a goodwill exception, if you contact <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> within <b>[14]</b> days of your <b>first</b> paid charge and have not substantially used paid features, we may at our discretion refund that charge.</p>` },
  { h: 'Annual plans', b: `<p>[If you offer annual billing: state whether it is refundable. Typical policy — annual plans are paid up front and are non-refundable; you may cancel to stop the next annual renewal.]</p>` },
  { h: 'Failed payments', b: `<p>If a renewal payment fails, we retry and mark the workspace <b>past due</b>. If payment is not resolved within <b>[7]</b> days the subscription is cancelled and the workspace moves to the Free plan. Reactivating requires a successful payment.</p>` },
  { h: 'Price changes', b: `<p>We give at least 30 days' notice of a price increase; it takes effect at your next renewal. If you do not agree, cancel before that renewal.</p>` },
  { h: 'Taxes', b: `<p>Prices exclude VAT / GST / sales tax, which is added where applicable based on your billing details.</p>` },
  { h: 'Chargebacks', b: `<p>If you have a billing problem, contact us first — we resolve most issues quickly. Initiating a chargeback without contacting us may result in immediate suspension of the workspace.</p>` },
  { h: 'Free plan', b: `<p>The Free plan costs nothing and has no refund implications. We may change its limits or discontinue it with notice.</p>` }
];

const DPA_STUB = [
  { h: 'Purpose', b: `<p>This page is a placeholder for the ${COMPANY} Data Processing Addendum ("DPA"), which supplements the <a href="terms.html">Terms of Service</a> where ${COMPANY} processes personal data on a customer's behalf (as processor) under the GDPR, UK GDPR or similar laws.</p>` },
  { h: 'What a DPA needs to cover', b: `<ul>
    <li>Subject matter, duration, nature and purpose of processing; categories of data and data subjects.</li>
    <li>Processing only on documented instructions; confidentiality of personnel.</li>
    <li>Security measures (Article 32).</li>
    <li>Sub-processor terms and a current sub-processor list, with a right to object.</li>
    <li>Assistance with data-subject requests and with breach notification, DPIAs and audits.</li>
    <li>Deletion or return of data on termination.</li>
    <li>International transfer mechanism (e.g. EU Standard Contractual Clauses) as an annex.</li>
  </ul>` },
  { h: 'Getting a signed DPA', b: `<p>Until this page is finalised, request the current DPA by emailing <a href="mailto:${LEGAL_EMAIL}">${LEGAL_EMAIL}</a> with your legal entity name and address. We will counter-sign and return it.</p>` }
];

/* ---------------- security overview ---------------- */
function securityPage() {
  const card = (t, b) => `<div class="int"><h3>${t}</h3><p>${b}</p></div>`;
  return `${head(COMPANY + ' — Security & Privacy', 'How ' + COMPANY + ' protects your customer conversations: encryption at rest, no warehousing of third-party channels, tenant isolation and full action attribution.')}

${header()}

<section class="phero">
  <div class="aurora"><i></i><i></i><i></i></div>
  <div class="grid-lines"></div>
  <div class="wrap">
    <span class="eyebrow">Security &amp; privacy</span>
    <h1>Your conversations stay yours</h1>
    <p class="lead">${COMPANY} is a shared inbox — your team needs to read and reply to messages, so the platform can process them. Everything below is what we do so that no one else can.</p>
  </div>
</section>

<section class="band-tight"><div class="wrap reveal">
  <h2 class="sec">How message data is stored</h2>
  <div class="intgrid">
    ${card('Encrypted at rest', 'WhatsApp history and website-chat threads are sealed with AES‑256‑GCM before anything is written to disk, using a key derived per workspace. On the server’s disk and in every backup they are unreadable ciphertext. Set your own master key (kept off the server in a secret manager) so a stolen disk or leaked backup stays sealed.')}
    ${card('Nothing warehoused from Meta or Google', 'Instagram, Messenger and Gmail messages are fetched live from Meta and Google each time an agent opens a thread. We don’t copy that history into our database.')}
    ${card('The activity log keeps facts, not content', 'Reports and webhooks run off a lightweight event log that records that a message happened — channel, time, agent, counts — never the message body.')}
    ${card('Tenant isolation', 'Every workspace’s data is scoped by tenant at the query layer. One customer’s data is never returned to another.')}
  </div>
</div></section>

<section class="band-tight"><div class="wrap reveal">
  <h2 class="sec">Access &amp; accountability</h2>
  <div class="intgrid">
    ${card('Agents see only their queue', 'Channel-by-agent assignment means an agent’s inbox shows the conversations routed to them and nothing else.')}
    ${card('Every action is attributed', 'Outgoing messages carry the agent’s name. Deletions record who deleted what. Assignments, status changes and automation runs are all logged.')}
    ${card('Passwords hashed', 'Account passwords are stored as bcrypt hashes (cost 12), never in plain text. Sessions expire on a sliding 7‑day window.')}
    ${card('Hardened by default', 'Security headers via Helmet, rate-limiting on login, locked-down CORS in production, and graceful handling of channel outages so the service stays up.')}
  </div>
</div></section>

<section class="band-tight"><div class="wrap reveal">
  <h2 class="sec">What we don’t do</h2>
  <div class="intgrid">
    ${card('We don’t sell your data', 'Your conversations and contacts are not sold, rented or shared with advertisers or data brokers.')}
    ${card('We don’t train AI on your conversations', 'Optional AI features use the knowledge and settings you provide. Your customer conversations are not used to train shared models.')}
  </div>
  <p class="sec-lead" style="margin-top:20px">On the roadmap: independent penetration testing and a published report, SSO/SAML, configurable data-retention windows, and a signed DPA for every customer. Questions? <a href="mailto:${LEGAL_EMAIL}" style="color:var(--sky);font-weight:600">${LEGAL_EMAIL}</a>.</p>
  <p class="sec-lead" style="margin-top:6px">See also the <a href="privacy.html" style="color:var(--sky);font-weight:600">Privacy Policy</a> and <a href="dpa.html" style="color:var(--sky);font-weight:600">Data Processing Addendum</a>.</p>
</div></section>

${ctaSec({ title: 'Bring every channel into one secure inbox', primary: { t: 'Start free', h: APP }, ghost: { t: 'Talk to us', h: 'contact.html' } })}

${footer()}

<script src="app.js" defer></script>
`;
}

/* ---------------- write ---------------- */
function write(name, html) {
  fs.writeFileSync(path.join(OUT, name), html.trim() + '\n');
  console.log('  ✓', name);
}

console.log('Generated pages:');
SOLUTIONS.forEach(p => write(p.h, solutionPage(p)));
INDUSTRIES.forEach(p => write(p.h, industryPage(p)));
write('industries.html', industriesIndex());
write('customers.html', customersPage());
write('why-zunoone.html', whyPage());
write('contact.html', contactPage());
write('platform.html', platformPage());
write('security.html', securityPage());
write('terms.html', legalPage('terms', 'Terms of Service', `The rules for using ${COMPANY}. By creating an account you agree to these terms.`, TERMS));
write('privacy.html', legalPage('privacy', 'Privacy Policy', `How ${COMPANY} collects, uses and protects personal data — for our own users, and as a processor for the data our customers manage.`, PRIVACY));
write('refunds.html', legalPage('refunds', 'Refund & Cancellation Policy', `How billing, cancellations and refunds work on ${COMPANY} paid plans.`, REFUNDS));
write('dpa.html', legalPage('dpa', 'Data Processing Addendum', `The GDPR / data-protection addendum for customers where ${COMPANY} processes personal data on your behalf.`, DPA_STUB));

/* ---------------- re-sync header/footer into hand-built pages ---------------- */
const H = header(), F = footer();
const bespoke = ['index.html', 'features.html', 'pricing.html', 'integrations.html', 'about.html', 'careers.html', 'careers-sales-officer.html', '404.html'];
console.log('Re-synced shared nav/footer:');
for (const f of bespoke) {
  const fp = path.join(OUT, f);
  if (!fs.existsSync(fp)) continue;
  let s = fs.readFileSync(fp, 'utf8');
  s = s.replace(/(?:<div class="promo-bar"[\s\S]*?<\/div>\s*)?<header class="nav">[\s\S]*?<\/header>/, H);
  s = s.replace(/<footer>[\s\S]*?<\/footer>/, F);
  // help-center chat widget on every page
  s = s.replace(/\s*<script src="https:\/\/help\.zunoone\.com\/widget\.js"[^>]*><\/script>/g, '');
  if (!s.includes('help.zunoone.com/widget.js')) {
    s = s.replace('<link rel="stylesheet" href="styles.css">', '<link rel="stylesheet" href="styles.css">\n' + HELP_WIDGET);
  }
  // early theme-init (no flash of dark before a stored light preference applies)
  s = s.replace(/\s*<script>try\{if\(localStorage\.zunoTheme[\s\S]*?<\/script>/g, '');
  if (!s.includes('localStorage.zunoTheme')) {
    s = s.replace('<link rel="stylesheet" href="styles.css">', "<link rel=\"stylesheet\" href=\"styles.css\">\n<script>try{if(localStorage.zunoTheme==='light')document.documentElement.setAttribute('data-theme','light');}catch(e){}</script>");
  }
  fs.writeFileSync(fp, s);
  console.log('  ✓', f);
}
console.log('\nDone. Run:  node serve.js');
