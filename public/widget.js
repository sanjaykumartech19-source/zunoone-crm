/* Zuno One website chat widget — embed with:
     <script src="https://<workspace>.zunoone.com/widget.js" async></script>
   The script derives the API base from its own src. */
(function () {
  if (window.__zunoWidget) return;
  window.__zunoWidget = true;

  var self = document.currentScript || (function () { var s = document.getElementsByTagName('script'); return s[s.length - 1]; })();
  var BASE = '';
  try { var u = new URL(self.src); BASE = u.origin; } catch (e) { BASE = location.origin; }
  var slug = (function () {
    try { return new URL(self.src).hostname.split('.')[0]; } catch (e) { return ''; }
  })();
  var API = BASE + '/widget/' + slug;
  var LS = 'zuno_wsid_' + slug;

  var cfg = { title: 'Chat with us', greeting: 'Hi! How can we help?', color: '#006591', enabled: false };
  var sessionId = null, lastTs = 0, pollTimer = null, opened = false, askedContact = false;

  var css =
    '.od-btn{position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:50%;background:var(--od);color:#fff;border:0;cursor:pointer;box-shadow:0 8px 30px rgba(0,0,0,.25);z-index:2147483000;display:flex;align-items:center;justify-content:center;transition:transform .15s}' +
    '.od-btn:hover{transform:scale(1.06)}' +
    '.od-btn svg{width:26px;height:26px}' +
    '.od-panel{position:fixed;right:20px;bottom:88px;width:360px;max-width:calc(100vw - 32px);height:520px;max-height:calc(100vh - 120px);background:#fff;border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.28);z-index:2147483000;display:none;flex-direction:column;overflow:hidden;font-family:-apple-system,Segoe UI,Roboto,sans-serif}' +
    '.od-panel.open{display:flex}' +
    '.od-hd{background:var(--od);color:#fff;padding:16px 18px;font-weight:700;font-size:15px;display:flex;justify-content:space-between;align-items:center}' +
    '.od-hd button{background:none;border:0;color:#fff;font-size:20px;cursor:pointer;line-height:1;opacity:.85}' +
    '.od-body{flex:1;overflow-y:auto;padding:16px;background:#f6f8fb;display:flex;flex-direction:column;gap:8px}' +
    '.od-m{max-width:80%;padding:9px 12px;border-radius:14px;font-size:13.5px;line-height:1.45;word-wrap:break-word}' +
    '.od-m.them{background:#fff;border:1px solid #e6ebf2;align-self:flex-start;border-bottom-left-radius:4px}' +
    '.od-m.me{background:var(--od);color:#fff;align-self:flex-end;border-bottom-right-radius:4px}' +
    '.od-form{border-top:1px solid #e6ebf2;padding:10px;display:flex;gap:8px;background:#fff}' +
    '.od-form input{flex:1;border:1px solid #d7e0ec;border-radius:10px;padding:10px 12px;font:inherit;font-size:14px;outline:none}' +
    '.od-form input:focus{border-color:var(--od)}' +
    '.od-form button{background:var(--od);color:#fff;border:0;border-radius:10px;padding:0 14px;cursor:pointer;font-weight:600}' +
    '.od-contact{background:#fff;border:1px solid #e6ebf2;border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:8px}' +
    '.od-contact input{border:1px solid #d7e0ec;border-radius:9px;padding:9px 11px;font:inherit;font-size:13px;outline:none}' +
    '.od-contact button{background:var(--od);color:#fff;border:0;border-radius:9px;padding:9px;cursor:pointer;font-weight:600;font-size:13px}' +
    '.od-foot{text-align:center;font-size:10px;color:#9aa7b4;padding:6px}';

  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function scrollDown(body) { body.scrollTop = body.scrollHeight; }

  function build() {
    var style = el('style'); style.textContent = ':root{--od:' + cfg.color + '}' + css; document.head.appendChild(style);

    var btn = el('button', 'od-btn');
    btn.setAttribute('aria-label', 'Open chat');
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

    var panel = el('div', 'od-panel');
    var hd = el('div', 'od-hd'); hd.appendChild(el('span', null, cfg.title));
    var x = el('button', null, '×'); hd.appendChild(x);
    var body = el('div', 'od-body');
    var form = el('form', 'od-form');
    var input = el('input'); input.placeholder = 'Type a message…'; input.autocomplete = 'off';
    var send = el('button', null, 'Send'); send.type = 'submit';
    form.appendChild(input); form.appendChild(send);
    var foot = el('div', 'od-foot', 'Powered by Zuno One');

    panel.appendChild(hd); panel.appendChild(body); panel.appendChild(form); panel.appendChild(foot);
    document.body.appendChild(btn); document.body.appendChild(panel);

    body.appendChild(bubble('them', cfg.greeting));

    btn.onclick = function () { opened = !opened; panel.classList.toggle('open', opened); if (opened) { input.focus(); startPoll(); } };
    x.onclick = function () { opened = false; panel.classList.remove('open'); };

    form.onsubmit = function (ev) {
      ev.preventDefault();
      var t = input.value.trim(); if (!t) return;
      input.value = '';
      body.appendChild(bubble('me', t)); scrollDown(body);
      ensureSession().then(function () {
        return fetch(API + '/message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: sessionId, text: t }) });
      }).then(function () {
        if (!askedContact && !getStored('name')) { askContact(body); }
      }).catch(function () {});
    };

    function bubble(who, text) { var b = el('div', 'od-m ' + who); b.textContent = text; return b; }

    function askContact(body) {
      askedContact = true;
      var box = el('div', 'od-contact');
      box.appendChild(el('div', null, 'Leave your details so we can follow up:'));
      var n = el('input'); n.placeholder = 'Your name';
      var e = el('input'); e.placeholder = 'Email'; e.type = 'email';
      var ok = el('button', null, 'Save');
      box.appendChild(n); box.appendChild(e); box.appendChild(ok);
      body.appendChild(box); scrollDown(body);
      ok.onclick = function () {
        setStored('name', n.value); setStored('email', e.value);
        fetch(API + '/message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: sessionId, text: '(contact details shared)', name: n.value, email: e.value }) }).catch(function () {});
        box.remove();
      };
    }

    window.__odBody = body;
  }

  function getStored(k) { try { return localStorage.getItem(LS + '_' + k) || ''; } catch (e) { return ''; } }
  function setStored(k, v) { try { localStorage.setItem(LS + '_' + k, v || ''); } catch (e) {} }

  function ensureSession() {
    if (sessionId) return Promise.resolve();
    var saved = getStored('id');
    if (saved) { sessionId = saved; return Promise.resolve(); }
    return fetch(API + '/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page: location.href, referrer: document.referrer, src: new URLSearchParams(location.search).get('src') || '' }) })
      .then(function (r) { return r.json(); })
      .then(function (j) { sessionId = j.sessionId; setStored('id', sessionId); });
  }

  function startPoll() {
    if (pollTimer) return;
    var tick = function () {
      if (!sessionId) return;
      fetch(API + '/poll?sessionId=' + encodeURIComponent(sessionId) + '&after=' + lastTs)
        .then(function (r) { return r.json(); })
        .then(function (j) {
          (j.messages || []).forEach(function (m) {
            if (m.ts <= lastTs) return;
            lastTs = m.ts;
            var b = document.createElement('div'); b.className = 'od-m them'; b.textContent = m.text;
            window.__odBody.appendChild(b); scrollDown(window.__odBody);
          });
        }).catch(function () {});
    };
    pollTimer = setInterval(tick, 3500);
    tick();
  }

  fetch(API + '/config').then(function (r) { return r.json(); }).then(function (j) {
    if (!j.enabled) return;
    cfg = Object.assign(cfg, j);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
    else build();
  }).catch(function () {});
})();
