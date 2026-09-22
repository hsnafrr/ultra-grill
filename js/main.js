/* Ultra Grill — scroll-driven hero film + section motion (GSAP ScrollTrigger) */
(function () {
  'use strict';

  var root = document.documentElement;
  var nav = document.getElementById('nav');

  // Safari < 14 only has addListener on MediaQueryList
  function onMQ(mq, fn) {
    if (mq.addEventListener) mq.addEventListener('change', fn);
    else if (mq.addListener) mq.addListener(fn);
  }

  // ------------------------------------------------------------------
  // Works with or without GSAP: mobile menu, lazy images, lazy map
  // ------------------------------------------------------------------
  function initMenu() {
    var btn = document.querySelector('.nav-toggle');
    var panel = document.getElementById('mobile-menu');
    if (!btn || !panel) return;

    function setOpen(open) {
      btn.setAttribute('aria-expanded', String(open));
      btn.setAttribute('aria-label', open ? 'Tutup menu' : 'Buka menu');
      panel.hidden = !open;
      nav.classList.toggle('is-open', open);
      document.body.classList.toggle('menu-open', open);
    }
    btn.addEventListener('click', function () {
      setOpen(btn.getAttribute('aria-expanded') !== 'true');
    });
    panel.addEventListener('click', function (e) {
      if (e.target.closest('a')) setOpen(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !panel.hidden) { setOpen(false); btn.focus(); }
    });
    onMQ(window.matchMedia('(min-width: 900px)'), function (mq) { if (mq.matches) setOpen(false); });
  }

  function initImages() {
    // Fade real photos in over their blurred placeholders
    document.querySelectorAll('.media img, .final-bg img').forEach(function (img) {
      var done = function () { img.classList.add('is-loaded'); };
      if (img.complete && img.naturalWidth) done();
      else { img.addEventListener('load', done); img.addEventListener('error', done); }
    });

    // Google Maps is heavy: only attach it when the section is close
    var frame = document.querySelector('.map iframe[data-src]');
    if (!frame) return;
    var load = function () {
      if (frame.src) return;
      frame.addEventListener('load', function () { frame.classList.add('is-loaded'); });
      frame.src = frame.getAttribute('data-src');
    };
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting) { load(); io.disconnect(); }
      }, { rootMargin: '600px 0px' });
      io.observe(frame);
    } else {
      load();
    }
  }

  initMenu();
  initImages();

  // ------------------------------------------------------------------
  // Fallback: no GSAP (CDN blocked) → static hero, simple nav state
  // ------------------------------------------------------------------
  if (!window.gsap || !window.ScrollTrigger) {
    root.classList.remove('js-seq');
    var onScroll = function () {
      nav.classList.toggle('is-solid', window.scrollY > window.innerHeight * 0.6);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return;
  }

  gsap.registerPlugin(ScrollTrigger);
  // Mobile toolbars showing/hiding must not re-layout the pinned hero
  ScrollTrigger.config({ ignoreMobileResize: true });

  var motionOK = root.classList.contains('js-seq');
  var conn = navigator.connection || {};
  var saveData = conn.saveData === true;
  var slowNet = /(^|-)2g$/.test(conn.effectiveType || '');
  var small = window.matchMedia('(max-width: 767px)').matches;
  var lean = small || saveData || slowNet;

  // ------------------------------------------------------------------
  // HERO — canvas image sequence scrubbed by scroll
  // ------------------------------------------------------------------
  // Timeline units are frames of the source film (0–191 = 0–7.96s, before the burned-in title).
  // Chapter windows follow the film's cuts: 2.0s / 4.0s / 5.5s / 7.0s @24fps.
  var LAST = 191;
  var CUTS = [[0, 48], [48, 96], [96, 132], [132, 168]];
  var LOCKUP_AT = 170;
  var HOLD_END = 212;

  function initSequence() {
    var stage = document.querySelector('.hero-stage');
    var canvas = document.querySelector('.hero-canvas');
    var poster = document.querySelector('.hero-poster');
    var ctx = canvas.getContext('2d', { alpha: false });
    var railSegs = gsap.utils.toArray('.rail-seg');
    var railFills = railSegs.map(function (s) { return s.querySelector('b'); });
    var vertical = window.matchMedia('(min-width: 1024px)');

    // Portrait screens get a 540×720 center-cropped set (96 frames, ~2 MB);
    // landscape gets 1280×720 (192 frames, the odd half only on good connections).
    var portrait = window.matchMedia('(orientation: portrait)').matches;
    var SET = portrait
      ? { dir: 'frames/m/', count: 96, step: 2 }
      : { dir: 'frames/d/', count: 192, step: 1 };

    function srcFor(i) {
      return SET.dir + 'f' + String(i + 1).padStart(3, '0') + '.webp';
    }

    // Coarse-to-fine load order: the whole film is scrubbable after a handful of frames
    var order = [];
    var seen = {};
    var passes = SET.step === 1 ? (lean ? [16, 8, 4, 2] : [16, 8, 4, 2, 1]) : [8, 4, 2, 1];
    passes.forEach(function (s) {
      for (var i = 0; i < SET.count; i += s) {
        if (!seen[i]) { seen[i] = true; order.push(i); }
      }
    });
    if (!seen[SET.count - 1]) order.push(SET.count - 1);

    var images = new Array(SET.count);
    var seq = { frame: 0 };
    var drawnImg = null;
    var rafId = 0;
    var cw = 0, ch = 0;

    function setIndex() {
      return Math.min(SET.count - 1, Math.round(seq.frame / SET.step));
    }

    function nearestImage(i) {
      if (images[i]) return images[i];
      for (var d = 1; d < SET.count; d++) {
        if (i - d >= 0 && images[i - d]) return images[i - d];
        if (i + d < SET.count && images[i + d]) return images[i + d];
      }
      return null;
    }

    function draw() {
      rafId = 0;
      var img = nearestImage(setIndex());
      if (!img || img === drawnImg || !cw) return;
      var iw = img.naturalWidth, ih = img.naturalHeight;
      var s = Math.max(cw / iw, ch / ih);   // object-fit: cover
      var w = iw * s, h = ih * s;
      ctx.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h);
      drawnImg = img;
    }

    function requestDraw() {
      if (!rafId) rafId = requestAnimationFrame(draw);
    }

    // Backing store never exceeds what the source frames can fill: a DPR-3 phone canvas
    // would be ~9× the pixels for zero extra detail, and that is what makes scrubbing stutter.
    function resize() {
      var r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      var srcW = portrait ? 540 : 1280, srcH = 720;
      var cover = Math.max(r.width / srcW, r.height / srcH);
      var dpr = Math.min(window.devicePixelRatio || 1, Math.max(1, 1 / cover));
      var w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
      if (w === cw && h === ch) return;
      cw = canvas.width = w;
      ch = canvas.height = h;
      drawnImg = null;
      requestDraw();
    }

    function loadFrame(i) {
      return new Promise(function (resolve) {
        var img = new Image();
        img.decoding = 'async';
        img.onload = function () {
          images[i] = img;
          if (Math.abs(i - setIndex()) <= 8) { drawnImg = null; requestDraw(); }
          resolve();
        };
        img.onerror = function () { resolve(); };
        img.src = srcFor(i);
      });
    }

    var cursor = 1;
    function worker() {
      if (cursor >= order.length) return Promise.resolve();
      return loadFrame(order[cursor++]).then(worker);
    }

    if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);
    else window.addEventListener('resize', resize);
    resize();

    loadFrame(order[0]).then(function () {
      draw();
      poster.classList.add('is-hidden');
      var lanes = lean ? 4 : 6;
      for (var k = 0; k < lanes; k++) worker();
    });

    // --- Wordmark: split into characters for the title reveal ---
    var mark = document.querySelector('.lockup-mark');
    var text = mark.textContent;
    mark.textContent = '';
    text.split('').forEach(function (c) {
      var span = document.createElement('span');
      span.className = 'ch';
      span.setAttribute('aria-hidden', 'true');
      span.textContent = c === ' ' ? ' ' : c;
      mark.appendChild(span);
    });

    // <use> can't be stroke-animated from outside, so inline copies of the sprite's flame paths
    var crown = document.querySelector('.lockup-crown');
    var crownSrc = document.getElementById('i-flame');
    while (crown.firstChild) crown.removeChild(crown.firstChild);
    Array.prototype.forEach.call(crownSrc.children, function (n) { crown.appendChild(n.cloneNode(true)); });
    var crownStrokes = crown.querySelectorAll('path');
    Array.prototype.forEach.call(crownStrokes, function (p) {
      var len = p.getTotalLength ? p.getTotalLength() : 60;
      p.style.strokeDasharray = len;
      p.style.strokeDashoffset = len;
    });

    // --- Rail + active chapter ---
    function updateRail(t) {
      var active = -1;
      CUTS.forEach(function (c, i) {
        var p = gsap.utils.clamp(0, 1, (t - c[0]) / (c[1] - c[0]));
        railFills[i].style.transform = (vertical.matches ? 'scaleY(' : 'scaleX(') + p + ')';
        if (t >= c[0] && t < c[1]) active = i;
      });
      railSegs.forEach(function (s, i) { s.classList.toggle('is-active', i === active); });
    }

    // --- Master timeline, scrubbed by the pinned stage ---
    var chapters = gsap.utils.toArray('.chapter');
    var chars = gsap.utils.toArray('.lockup-mark .ch');
    // Animated blur is expensive on phones; keep it for larger screens only
    var blurIn = lean ? {} : { filter: 'blur(10px)' };
    var blurOut = lean ? {} : { filter: 'blur(0px)' };

    var tl = gsap.timeline({
      defaults: { ease: 'none' },
      onUpdate: function () { updateRail(this.time()); },
      scrollTrigger: {
        id: 'hero',
        trigger: stage,
        start: 'top top',
        end: function () { return '+=' + Math.round(window.innerHeight * (lean ? 3 : 3.6)); },
        pin: true,
        scrub: lean ? 0.3 : 0.5,
        anticipatePin: 1,
        invalidateOnRefresh: true
      }
    });

    // Film playhead
    tl.to(seq, { frame: LAST, duration: LAST, onUpdate: requestDraw }, 0);

    // Intro dissolves as the film starts
    tl.to('.hero-intro', { autoAlpha: 0, y: -48, duration: 12, ease: 'power1.in' }, 1);

    // Chapter captions, timed to the film's cuts (no dead air between them)
    var windows = [[10, 42], [50, 90], [98, 126], [134, 162]];
    chapters.forEach(function (el, i) {
      var w = windows[i];
      tl.fromTo(el,
        Object.assign({ autoAlpha: 0, y: 36 }, blurIn),
        Object.assign({ autoAlpha: 1, y: 0, duration: 7, ease: 'power2.out' }, blurOut), w[0]);
      tl.to(el, { autoAlpha: 0, y: -24, duration: 5, ease: 'power1.in' }, w[1]);
    });

    // Final macro shot dims → live-type "Ultra Grill" lockup (replaces the film's burned-in title)
    tl.to('.scrim-end', { opacity: 1, duration: 18, ease: 'power1.inOut' }, 162);
    tl.set('.hero-lockup', { autoAlpha: 1 }, LOCKUP_AT);
    tl.to(crownStrokes, { strokeDashoffset: 0, duration: 12, ease: 'power2.out' }, LOCKUP_AT);
    tl.fromTo(chars,
      Object.assign({ autoAlpha: 0, yPercent: 60 }, lean ? {} : { filter: 'blur(12px)' }),
      Object.assign({ autoAlpha: 1, yPercent: 0, duration: 9, stagger: 0.9, ease: 'power3.out' }, blurOut), LOCKUP_AT + 3);
    tl.fromTo(['.lockup-tag', '.lockup-meta', '.lockup-cta'],
      { autoAlpha: 0, y: 20 },
      { autoAlpha: 1, y: 0, duration: 8, stagger: 2.5, ease: 'power3.out' }, LOCKUP_AT + 14);
    tl.to('.hero-rail', { autoAlpha: 0, duration: 6 }, LOCKUP_AT);
    tl.to('.hero-skip', { autoAlpha: 0, duration: 6 }, LOCKUP_AT);
    // Short hold on the lockup before the page releases
    var rest = HOLD_END - tl.duration();
    if (rest > 0) tl.to({}, { duration: rest });

    onMQ(vertical, function () { updateRail(tl.time()); });
    updateRail(0);
  }

  // ------------------------------------------------------------------
  // Sections — quick, early reveals (content is never left blank) + parallax
  // ------------------------------------------------------------------
  function initSections() {
    var reveals = gsap.utils.toArray('[data-reveal]');
    gsap.set(reveals, { autoAlpha: 0, y: 20 });
    ScrollTrigger.batch(reveals, {
      start: 'top bottom-=40',
      once: true,
      onEnter: function (batch) {
        gsap.to(batch, { autoAlpha: 1, y: 0, duration: 0.6, stagger: 0.06, ease: 'power3.out', overwrite: true });
      }
    });

    if (!lean) {
      gsap.utils.toArray('[data-parallax]').forEach(function (img) {
        gsap.fromTo(img, { yPercent: -5 }, {
          yPercent: 5,
          ease: 'none',
          scrollTrigger: { trigger: img.parentElement, start: 'top bottom', end: 'bottom top', scrub: true }
        });
      });
    }
  }

  // ------------------------------------------------------------------
  // Nav — solid once the hero film is over
  // ------------------------------------------------------------------
  function initNav() {
    ScrollTrigger.create({
      trigger: '#konsep',
      start: 'top ' + (motionOK ? 80 : 400) + 'px',
      onEnter: function () { nav.classList.add('is-solid'); },
      onLeaveBack: function () { nav.classList.remove('is-solid'); }
    });
  }

  // ------------------------------------------------------------------
  // In-page anchors — smooth scroll + focus handoff
  // ------------------------------------------------------------------
  function initAnchors() {
    document.addEventListener('click', function (e) {
      var a = e.target.closest('a[href^="#"]');
      if (!a) return;
      var id = a.getAttribute('href').slice(1);
      var target = id ? document.getElementById(id) : null;
      if (!target) return;
      e.preventDefault();
      // Reveal everything on the way so a long jump never lands on hidden content
      if (motionOK) gsap.set('[data-reveal]', { autoAlpha: 1, y: 0 });
      var y = id === 'top' ? 0 : target.getBoundingClientRect().top + window.pageYOffset;
      window.scrollTo({ top: y, behavior: motionOK ? 'smooth' : 'auto' });
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      try { target.focus({ preventScroll: true }); } catch (err) { /* old Safari */ }
      if (history.replaceState) history.replaceState(null, '', '#' + id);
    });
  }

  if (motionOK) {
    initSequence();
    initSections();
  }
  initNav();
  initAnchors();

  // Fonts change line lengths → trigger positions
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { ScrollTrigger.refresh(); });
  }

  // If the user flips reduced-motion while the page is open, reload into the right mode.
  onMQ(window.matchMedia('(prefers-reduced-motion: reduce)'), function () { window.location.reload(); });
})();
