/* Zuno One marketing site — shared behaviour */
(function () {
  document.documentElement.className += ' js';

  var y = document.getElementById('yr');
  if (y) y.textContent = new Date().getFullYear();

  var b = document.getElementById('burger'), m = document.getElementById('mnav');
  if (b && m) b.addEventListener('click', function () { m.classList.toggle('open'); });

  // ---- light / dark theme toggle ----
  var tb = document.getElementById('themeBtn');
  if (tb) tb.addEventListener('click', function () {
    var toLight = document.documentElement.getAttribute('data-theme') !== 'light';
    if (toLight) document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
    try { localStorage.zunoTheme = toLight ? 'light' : 'dark'; } catch (e) {}
  });

  // ---- desktop mega-menus ----
  var megas = [].slice.call(document.querySelectorAll('.mega'));
  function closeMegas(except) { megas.forEach(function (x) { if (x !== except) x.classList.remove('open'); }); }
  megas.forEach(function (mega) {
    var btn = mega.querySelector('button');
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = mega.classList.contains('open');
      closeMegas(mega);
      mega.classList.toggle('open', !open);
    });
    mega.addEventListener('mouseenter', function () { if (window.innerWidth > 960) { closeMegas(mega); mega.classList.add('open'); } });
    mega.addEventListener('mouseleave', function () { if (window.innerWidth > 960) mega.classList.remove('open'); });
  });
  document.addEventListener('click', function () { closeMegas(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeMegas(); if (m) m.classList.remove('open'); } });

  // ---- mobile accordion groups ----
  [].slice.call(document.querySelectorAll('#mnav .m-group > button')).forEach(function (btn) {
    btn.addEventListener('click', function () { btn.parentNode.classList.toggle('open'); });
  });

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- scroll reveal (IO for the stagger, scroll/timeout fallbacks so nothing stays hidden) ----
  var reveals = [].slice.call(document.querySelectorAll('.reveal'));
  function revealInView() {
    var h = window.innerHeight || document.documentElement.clientHeight;
    for (var i = reveals.length - 1; i >= 0; i--) {
      var el = reveals[i];
      if (el.classList.contains('in')) { reveals.splice(i, 1); continue; }
      if (el.getBoundingClientRect().top < h - 40) { el.classList.add('in'); reveals.splice(i, 1); }
    }
  }
  if (reduce || !('IntersectionObserver' in window)) {
    reveals.forEach(function (el) { el.classList.add('in'); });
    reveals.length = 0;
  } else {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: .12, rootMargin: '0px 0px -6% 0px' });
    reveals.forEach(function (el) { io.observe(el); });

    var ticking = false;
    function onScroll() {
      if (ticking) return; ticking = true;
      requestAnimationFrame(function () { revealInView(); ticking = false; });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    window.addEventListener('load', function () { setTimeout(revealInView, 300); });
    setTimeout(revealInView, 800);
    // absolute catch-all: never leave content hidden
    setTimeout(function () { reveals.forEach(function (el) { el.classList.add('in'); }); }, 3500);
  }

  // ---- count-up ----
  function countUp(el) {
    var target = parseFloat(el.dataset.count), suf = el.dataset.suffix || '', dur = 1200, t0 = null;
    function fmt(n) { return target >= 1000 ? Math.round(n).toLocaleString() : (Math.round(n * 10) / 10).toString(); }
    if (reduce) { el.textContent = fmt(target) + suf; return; }
    function step(ts) {
      if (!t0) t0 = ts;
      var p = Math.min((ts - t0) / dur, 1), e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(target * e) + suf;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  if ('IntersectionObserver' in window) {
    var nio = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { countUp(e.target); nio.unobserve(e.target); } });
    }, { threshold: .6 });
    document.querySelectorAll('[data-count]').forEach(function (el) { nio.observe(el); });
  }

  // ---- pricing monthly / annual toggle ----
  var tg = document.getElementById('billToggle');
  if (tg) {
    var applyBilling = function (annual) {
      tg.setAttribute('aria-pressed', annual ? 'true' : 'false');
      document.querySelectorAll('[data-m]').forEach(function (el) {
        el.textContent = annual ? el.dataset.a : el.dataset.m;
      });
      document.querySelectorAll('[data-period]').forEach(function (el) {
        el.textContent = annual ? '/mo · billed yearly' : '/mo';
      });
      document.querySelectorAll('[data-mper]').forEach(function (el) {
        el.textContent = annual ? el.dataset.aper : el.dataset.mper;
      });
      document.querySelectorAll('[data-msub]').forEach(function (el) {
        el.textContent = annual ? el.dataset.asub : el.dataset.msub;
      });
      // per-plan "months free" line: annual text vs optional monthly text
      document.querySelectorAll('.mfree[data-mf]').forEach(function (el) {
        var txt = annual ? el.dataset.mf : (el.dataset.mfMonthly || '');
        el.textContent = txt || ' ';
        el.classList.toggle('on', !!txt);
      });
      // comparison-table cells that only apply on annual billing (e.g. Project Management on Growth)
      document.querySelectorAll('[data-mcell]').forEach(function (el) {
        el.textContent = annual ? (el.dataset.acell || '✓') : (el.dataset.mcell || '—');
        el.classList.toggle('yes', annual);
        el.classList.toggle('no', !annual);
      });
    };
    tg.addEventListener('click', function () {
      applyBilling(tg.getAttribute('aria-pressed') !== 'true');
    });
    applyBilling(false);
  }

  // ---- application form (demo only) ----
  var af = document.getElementById('applyForm');
  if (af) af.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var note = document.getElementById('applyNote');
    if (note) { note.hidden = false; note.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' }); }
    af.reset();
  });
})();
