/* ═══════════════════════════════════════════════════════════
   VELOURA FEM — Animation Engine (Refined)
   All animations use GSAP for buttery 60fps performance.
   ═══════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  gsap.registerPlugin(ScrollTrigger);

  // ── Luxury easing presets ──
  const EASE = {
    smooth:   'power2.out',
    elegant:  'power3.out',
    dramatic: 'power4.out',
    silky:    'expo.out',
    spring:   'elastic.out(1, 0.7)',
    inOut:    'power3.inOut',
  };

  /* ═══════════════════════════════
     1. PAGE LOADER — Cinematic curtain reveal
  ═══════════════════════════════ */
  function runLoader() {
    const tl = gsap.timeline({
      onComplete: () => {
        document.getElementById('loader').style.display = 'none';
        document.body.classList.add('loaded');
        runHeroEntrance();
        initScrollAnimations();
      },
    });

    tl.to('.loader-brand', {
        opacity: 1,
        duration: 0.6,
        ease: EASE.smooth,
      })
      .to('.loader-script', {
        opacity: 1,
        y: 0,
        duration: 0.5,
        ease: EASE.smooth,
      }, '-=0.3')
      .to('.loader-bar', {
        opacity: 1,
        duration: 0.3,
      }, '-=0.2')
      .to('.loader-fill', {
        width: '100%',
        duration: 1.2,
        ease: 'power1.inOut',
      }, '-=0.1')
      .to('.loader-inner', {
        opacity: 0,
        y: -20,
        duration: 0.4,
        ease: EASE.smooth,
      })
      .to('.loader-curtain-left', {
        xPercent: -100,
        duration: 0.9,
        ease: EASE.inOut,
      }, '-=0.15')
      .to('.loader-curtain-right', {
        xPercent: 100,
        duration: 0.9,
        ease: EASE.inOut,
      }, '<');
  }

  // Set initial states for loader
  gsap.set('.loader-brand', { opacity: 0 });
  gsap.set('.loader-script', { opacity: 0, y: 8 });
  gsap.set('.loader-bar', { opacity: 0 });

  window.addEventListener('load', () => {
    // Small delay so fonts render first
    setTimeout(runLoader, 200);
  });

  /* ═══════════════════════════════
     2. CUSTOM CURSOR — GSAP-driven for silk smoothness
  ═══════════════════════════════ */
  const cursor    = document.getElementById('cursor');
  const cursorDot = cursor?.querySelector('.cursor-dot');
  const cursorRing = cursor?.querySelector('.cursor-ring');

  if (cursor && window.matchMedia('(pointer: fine)').matches) {
    // Use gsap.quickTo for 60fps cursor with organic lag
    const dotX  = gsap.quickTo(cursorDot, 'x', { duration: 0.15, ease: 'power2.out' });
    const dotY  = gsap.quickTo(cursorDot, 'y', { duration: 0.15, ease: 'power2.out' });
    const ringX = gsap.quickTo(cursorRing, 'x', { duration: 0.45, ease: 'power3.out' });
    const ringY = gsap.quickTo(cursorRing, 'y', { duration: 0.45, ease: 'power3.out' });

    document.addEventListener('mousemove', (e) => {
      dotX(e.clientX);
      dotY(e.clientY);
      ringX(e.clientX);
      ringY(e.clientY);
    });

    // Hover — expand ring
    const interactiveEls = document.querySelectorAll(
      'a, button, .card, .pillar, .t-dot, .t-nav-btn, .nav-hamburger, input'
    );

    interactiveEls.forEach(el => {
      el.addEventListener('mouseenter', () => document.body.classList.add('cursor-hover'));
      el.addEventListener('mouseleave', () => document.body.classList.remove('cursor-hover'));
    });

    // Click feedback
    document.addEventListener('mousedown', () => document.body.classList.add('cursor-click'));
    document.addEventListener('mouseup', () => document.body.classList.remove('cursor-click'));
  }

  /* ═══════════════════════════════
     3. NAVIGATION — Smooth scroll state
  ═══════════════════════════════ */
  const header = document.getElementById('site-header');
  let lastScroll = 0;

  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    if (y > 60) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
    lastScroll = y;
  }, { passive: true });

  /* ═══════════════════════════════
     4. MOBILE MENU — with staggered link reveal
  ═══════════════════════════════ */
  const hamburger     = document.getElementById('nav-hamburger');
  const mobileMenu    = document.getElementById('mobile-menu');
  const mobileClose   = document.getElementById('mobile-close');
  const mobileOverlay = document.getElementById('mobile-overlay');
  const mobileLinks   = document.querySelectorAll('.mobile-link');

  function openMenu() {
    mobileMenu.classList.add('open');
    mobileOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';

    // Staggered link entrance
    gsap.from(mobileLinks, {
      x: 40,
      opacity: 0,
      stagger: 0.06,
      duration: 0.5,
      ease: EASE.elegant,
      delay: 0.2,
      clearProps: 'all',
    });
  }

  function closeMenu() {
    mobileMenu.classList.remove('open');
    mobileOverlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  hamburger.addEventListener('click', openMenu);
  mobileClose.addEventListener('click', closeMenu);
  mobileOverlay.addEventListener('click', closeMenu);
  mobileLinks.forEach(link => link.addEventListener('click', closeMenu));

  /* ═══════════════════════════════
     5. HERO — Cinematic entrance sequence
  ═══════════════════════════════ */
  function runHeroEntrance() {
    const tl = gsap.timeline({
      defaults: { ease: EASE.elegant },
    });

    // Border fade in
    tl.to('.hero-border', {
        opacity: 1,
        duration: 2,
        ease: 'none',
      }, 0)

      // Eyebrow
      .to('.hero-eyebrow', {
        opacity: 1,
        y: 0,
        duration: 0.9,
      }, 0.1)

      // Title line — split word reveal
      .to('.hero-title-line', {
        opacity: 1,
        duration: 0.1,
      }, 0.25)
      .to('.hero-title-line .word-inner', {
        y: 0,
        stagger: 0.06,
        duration: 1,
        ease: EASE.dramatic,
      }, 0.25)

      // Script title
      .to('.hero-title-script', {
        opacity: 1,
        duration: 0.1,
      }, 0.55)
      .to('.hero-title-script .word-inner', {
        y: 0,
        duration: 1.1,
        ease: EASE.dramatic,
      }, 0.55)

      // Sub-heading
      .to('.hero-sub', {
        opacity: 1,
        y: 0,
        duration: 0.9,
      }, 0.7)

      // Buttons
      .to('.hero-actions', {
        opacity: 1,
        y: 0,
        duration: 0.8,
      }, 0.85)

      // Scroll indicator
      .to('.hero-scroll', {
        opacity: 1,
        duration: 0.8,
      }, 1.1);

    // Set initial positions (GSAP .from approach)
    gsap.set('.hero-eyebrow', { y: 20 });
    gsap.set('.hero-sub', { y: 16 });
    gsap.set('.hero-actions', { y: 12 });

    // Orbs — slow organic drift
    gsap.to('.hero-orb-1', {
      y: -35,
      x: 15,
      scale: 1.04,
      duration: 8,
      ease: 'sine.inOut',
      repeat: -1,
      yoyo: true,
    });

    gsap.to('.hero-orb-2', {
      y: 30,
      x: -20,
      scale: 1.06,
      duration: 10,
      ease: 'sine.inOut',
      repeat: -1,
      yoyo: true,
      delay: -3,
    });

    gsap.to('.hero-orb-3', {
      y: -20,
      x: 10,
      scale: 1.03,
      duration: 7,
      ease: 'sine.inOut',
      repeat: -1,
      yoyo: true,
      delay: -5,
    });

    // Hero parallax on scroll
    gsap.to('.hero-content', {
      y: 100,
      opacity: 0.3,
      ease: 'none',
      scrollTrigger: {
        trigger: '.hero',
        start: 'top top',
        end: 'bottom top',
        scrub: 1.2,
      },
    });

    gsap.to('.hero-orb-1', {
      y: '-=80',
      scrollTrigger: {
        trigger: '.hero',
        start: 'top top',
        end: 'bottom top',
        scrub: 2,
      },
    });
  }

  /* ═══════════════════════════════
     6. SCROLL ANIMATIONS — Section-by-section reveals
  ═══════════════════════════════ */
  function initScrollAnimations() {

    // ── Stats counter ──
    document.querySelectorAll('.stat-value').forEach(el => {
      const raw = el.dataset.value || el.textContent;
      const num = parseInt(raw.replace(/[^0-9]/g, ''), 10);
      if (isNaN(num)) return;

      const suffix = raw.replace(/[0-9]/g, '').replace(/\s/g, '');
      const obj = { val: 0 };

      ScrollTrigger.create({
        trigger: el,
        start: 'top 88%',
        once: true,
        onEnter: () => {
          gsap.to(obj, {
            val: num,
            duration: 2,
            ease: 'power2.out',
            onUpdate: () => {
              el.textContent = Math.floor(obj.val) + suffix;
            },
          });
        },
      });
    });

    // ── Generic section headers (eyebrow, title, subtitle) ──
    document.querySelectorAll('.philosophy-header, .collection-header, .process-header').forEach(header => {
      const eyebrow  = header.querySelector('.section-eyebrow');
      const title    = header.querySelector('.section-title');
      const subtitle = header.querySelector('.section-subtitle');
      const els = [eyebrow, title, subtitle].filter(Boolean);

      gsap.from(els, {
        opacity: 0,
        y: 30,
        stagger: 0.12,
        duration: 0.9,
        ease: EASE.elegant,
        scrollTrigger: {
          trigger: header,
          start: 'top 82%',
          toggleActions: 'play none none none',
        },
      });
    });

    // ── Pillars ──
    gsap.from('.pillar', {
      opacity: 0,
      y: 40,
      stagger: 0.1,
      duration: 0.9,
      ease: EASE.elegant,
      scrollTrigger: {
        trigger: '.pillars',
        start: 'top 82%',
      },
    });

    // ── Collection cards — staggered cascade ──
    gsap.from('.card', {
      opacity: 0,
      y: 60,
      stagger: {
        each: 0.08,
        from: 'start',
      },
      duration: 1,
      ease: EASE.dramatic,
      scrollTrigger: {
        trigger: '.cards',
        start: 'top 85%',
      },
    });

    // ── Collection CTA ──
    gsap.from('.collection-cta', {
      opacity: 0,
      y: 24,
      duration: 0.8,
      ease: EASE.elegant,
      scrollTrigger: {
        trigger: '.collection-cta',
        start: 'top 90%',
      },
    });

    // ── Editorial — left/right slide ──
    gsap.from('.editorial-left', {
      opacity: 0,
      x: -60,
      duration: 1.1,
      ease: EASE.dramatic,
      scrollTrigger: {
        trigger: '.editorial-inner',
        start: 'top 78%',
      },
    });

    gsap.from('.editorial-right', {
      opacity: 0,
      x: 60,
      duration: 1.1,
      ease: EASE.dramatic,
      scrollTrigger: {
        trigger: '.editorial-inner',
        start: 'top 78%',
      },
    });

    // ── Testimonial section header ──
    const tHeader = document.querySelector('.testimonials-inner');
    if (tHeader) {
      gsap.from(tHeader.querySelectorAll('.section-eyebrow, .section-title'), {
        opacity: 0,
        y: 28,
        stagger: 0.1,
        duration: 0.9,
        ease: EASE.elegant,
        scrollTrigger: {
          trigger: tHeader,
          start: 'top 82%',
        },
      });
    }

    // ── Process steps ──
    gsap.from('.process-step', {
      opacity: 0,
      y: 40,
      stagger: 0.12,
      duration: 0.9,
      ease: EASE.elegant,
      scrollTrigger: {
        trigger: '.process-steps',
        start: 'top 82%',
      },
    });

    // ── Newsletter section ──
    const nlInner = document.querySelector('.newsletter-inner');
    if (nlInner) {
      gsap.from(nlInner.children, {
        opacity: 0,
        y: 30,
        stagger: 0.1,
        duration: 0.9,
        ease: EASE.elegant,
        scrollTrigger: {
          trigger: nlInner,
          start: 'top 82%',
        },
      });
    }

    // Newsletter orbs float
    gsap.to('.newsletter-orb-1', {
      y: -30, x: 15,
      duration: 9,
      ease: 'sine.inOut',
      repeat: -1,
      yoyo: true,
    });

    gsap.to('.newsletter-orb-2', {
      y: 25, x: -10,
      duration: 11,
      ease: 'sine.inOut',
      repeat: -1,
      yoyo: true,
    });

    // ── Footer reveal ──
    gsap.from('.footer-top > *', {
      opacity: 0,
      y: 24,
      stagger: 0.08,
      duration: 0.8,
      ease: EASE.elegant,
      scrollTrigger: {
        trigger: '.footer-top',
        start: 'top 90%',
      },
    });

    // ── Parallax on section orbs/decorative elements ──
    gsap.to('.editorial-orb', {
      y: -40,
      ease: 'none',
      scrollTrigger: {
        trigger: '.editorial',
        start: 'top bottom',
        end: 'bottom top',
        scrub: 2,
      },
    });
  }

  /* ═══════════════════════════════
     7. TESTIMONIALS SLIDER — Smooth GSAP transitions
  ═══════════════════════════════ */
  const track   = document.getElementById('testimonials-track');
  const dots    = document.querySelectorAll('.t-dot');
  const btnPrev = document.getElementById('t-prev');
  const btnNext = document.getElementById('t-next');
  const cards   = document.querySelectorAll('.testimonial-card');
  const total   = dots.length;
  let current   = 0;
  let isAnimating = false;

  function updateActiveCard() {
    cards.forEach((c, i) => c.classList.toggle('active', i === current));
  }

  function goTo(idx) {
    if (isAnimating) return;
    isAnimating = true;
    current = ((idx % total) + total) % total;

    dots.forEach((d, i) => d.classList.toggle('active', i === current));

    gsap.to(track, {
      x: -(current * (track.parentElement.offsetWidth + 28)),
      duration: 0.7,
      ease: EASE.inOut,
      onComplete: () => {
        isAnimating = false;
        updateActiveCard();
      },
    });
  }

  // Initialize
  updateActiveCard();

  btnPrev.addEventListener('click', () => goTo(current - 1));
  btnNext.addEventListener('click', () => goTo(current + 1));
  dots.forEach((dot, i) => dot.addEventListener('click', () => goTo(i)));

  // Auto-advance
  let autoplay = setInterval(() => goTo(current + 1), 6000);

  function resetAutoplay() {
    clearInterval(autoplay);
    autoplay = setInterval(() => goTo(current + 1), 6000);
  }

  [btnPrev, btnNext, ...dots].forEach(el => {
    el.addEventListener('click', resetAutoplay);
  });

  // Touch swipe
  let touchStartX = 0;
  track.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
  track.addEventListener('touchend', e => {
    const diff = touchStartX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) {
      goTo(current + (diff > 0 ? 1 : -1));
      resetAutoplay();
    }
  });

  /* ═══════════════════════════════
     8. CARD TILT — GSAP quickTo for silk-smooth 3D
  ═══════════════════════════════ */
  document.querySelectorAll('.card').forEach(card => {
    const setRotX = gsap.quickTo(card, 'rotateX', { duration: 0.4, ease: 'power2.out' });
    const setRotY = gsap.quickTo(card, 'rotateY', { duration: 0.4, ease: 'power2.out' });
    const setY    = gsap.quickTo(card, 'y',       { duration: 0.4, ease: 'power2.out' });

    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width  - 0.5;
      const py = (e.clientY - rect.top)  / rect.height - 0.5;
      setRotX(-py * 6);
      setRotY(px * 6);
      setY(-6);
    });

    card.addEventListener('mouseleave', () => {
      setRotX(0);
      setRotY(0);
      setY(0);
    });
  });

  /* ═══════════════════════════════
     9. MAGNETIC BUTTONS — Spring return
  ═══════════════════════════════ */
  document.querySelectorAll('.btn, .t-nav-btn, .social-link').forEach(el => {
    const setX = gsap.quickTo(el, 'x', { duration: 0.4, ease: EASE.smooth });
    const setY = gsap.quickTo(el, 'y', { duration: 0.4, ease: EASE.smooth });

    el.addEventListener('mousemove', (e) => {
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width  / 2;
      const cy = rect.top  + rect.height / 2;
      setX((e.clientX - cx) * 0.2);
      setY((e.clientY - cy) * 0.2);
    });

    el.addEventListener('mouseleave', () => {
      setX(0);
      setY(0);
    });
  });

  /* ═══════════════════════════════
     10. SMOOTH SCROLL
  ═══════════════════════════════ */
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const href = this.getAttribute('href');
      if (href === '#') return;
      const target = document.querySelector(href);
      if (!target) return;
      e.preventDefault();
      const offset = 80;
      const top = target.getBoundingClientRect().top + window.scrollY - offset;

      gsap.to(window, {
        scrollTo: { y: top, autoKill: true },
        duration: 1,
        ease: EASE.inOut,
      });
    });
  });

  /* ═══════════════════════════════
     11. ACTIVE NAV HIGHLIGHT
  ═══════════════════════════════ */
  const sections = document.querySelectorAll('section[id], footer[id]');
  const navLinks = document.querySelectorAll('.nav-link');

  const sectionObs = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          navLinks.forEach(link => {
            link.classList.toggle('active', link.getAttribute('href') === `#${id}`);
          });
        }
      });
    },
    { threshold: 0.35 }
  );

  sections.forEach(s => sectionObs.observe(s));

  /* ═══════════════════════════════
     12. NEWSLETTER HANDLER
  ═══════════════════════════════ */
  window.handleSubscribe = function (e) {
    e.preventDefault();
    const input = document.getElementById('newsletter-email');
    const btn   = e.target.querySelector('button[type="submit"]');
    const original = btn.textContent;

    // Animated confirmation
    gsap.to(btn, {
      scale: 0.95,
      duration: 0.1,
      ease: 'power2.in',
      onComplete: () => {
        btn.textContent = 'Welcome';
        btn.style.background = 'var(--forest-green)';
        btn.disabled = true;
        input.value = '';

        gsap.to(btn, {
          scale: 1,
          duration: 0.4,
          ease: EASE.spring,
        });

        setTimeout(() => {
          gsap.to(btn, {
            scale: 0.97,
            duration: 0.15,
            onComplete: () => {
              btn.textContent = original;
              btn.style.background = '';
              btn.disabled = false;
              gsap.to(btn, { scale: 1, duration: 0.3, ease: EASE.smooth });
            },
          });
        }, 3000);
      },
    });
  };

  /* ═══════════════════════════════
     13. SPLIT TEXT UTILITY — Wrap words for hero
  ═══════════════════════════════ */
  function splitWords(selector) {
    document.querySelectorAll(selector).forEach(el => {
      const text = el.textContent.trim();
      el.innerHTML = text.split(/\s+/).map(word =>
        `<span class="word"><span class="word-inner">${word}</span></span>`
      ).join(' ');
    });
  }

  // Run split text immediately
  splitWords('.hero-title-line');
  splitWords('.hero-title-script');

})();
