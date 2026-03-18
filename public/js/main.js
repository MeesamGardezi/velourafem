/* ═══════════════════════════════════════════════════════════
   VELOURA FEM — Main JS
   ═══════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ─────────────────────────────
     PAGE LOADER
  ───────────────────────────── */
  const loader = document.getElementById('loader');

  window.addEventListener('load', () => {
    setTimeout(() => {
      loader.style.opacity = '0';
      loader.style.transition = 'opacity 0.7s ease';
      setTimeout(() => {
        loader.style.display = 'none';
        document.body.classList.add('loaded');
        initHeroAnimations();
      }, 700);
    }, 1600);
  });

  /* ─────────────────────────────
     CUSTOM CURSOR
  ───────────────────────────── */
  const cursor     = document.getElementById('cursor');
  const cursorDot  = cursor.querySelector('.cursor-dot');
  const cursorRing = cursor.querySelector('.cursor-ring');

  let mouseX = 0, mouseY = 0;
  let ringX  = 0, ringY  = 0;

  document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    cursorDot.style.left  = mouseX + 'px';
    cursorDot.style.top   = mouseY + 'px';
  });

  // Smooth ring follow
  function animateRing() {
    ringX += (mouseX - ringX) * 0.12;
    ringY += (mouseY - ringY) * 0.12;
    cursorRing.style.left = ringX + 'px';
    cursorRing.style.top  = ringY + 'px';
    requestAnimationFrame(animateRing);
  }
  animateRing();

  // Hover states
  const hoverTargets = 'a, button, .card, .pillar, .t-dot, .t-nav-btn, .nav-hamburger';

  document.querySelectorAll(hoverTargets).forEach(el => {
    el.addEventListener('mouseenter', () => document.body.classList.add('cursor-hover'));
    el.addEventListener('mouseleave', () => document.body.classList.remove('cursor-hover'));
  });

  /* ─────────────────────────────
     NAVIGATION — SCROLL BEHAVIOR
  ───────────────────────────── */
  const header = document.getElementById('site-header');

  const onScroll = () => {
    if (window.scrollY > 60) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ─────────────────────────────
     MOBILE MENU
  ───────────────────────────── */
  const hamburger    = document.getElementById('nav-hamburger');
  const mobileMenu   = document.getElementById('mobile-menu');
  const mobileClose  = document.getElementById('mobile-close');
  const mobileOverlay = document.getElementById('mobile-overlay');

  function openMenu() {
    mobileMenu.classList.add('open');
    mobileOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeMenu() {
    mobileMenu.classList.remove('open');
    mobileOverlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  hamburger.addEventListener('click', openMenu);
  mobileClose.addEventListener('click', closeMenu);
  mobileOverlay.addEventListener('click', closeMenu);

  // Close on mobile link click
  document.querySelectorAll('.mobile-link').forEach(link => {
    link.addEventListener('click', closeMenu);
  });

  /* ─────────────────────────────
     SCROLL REVEAL
  ───────────────────────────── */
  const revealEls = document.querySelectorAll('.reveal, .reveal-up, .reveal-left, .reveal-right');

  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          revealObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
  );

  revealEls.forEach(el => revealObserver.observe(el));

  /* ─────────────────────────────
     HERO ENTRANCE (GSAP)
  ───────────────────────────── */
  function initHeroAnimations() {
    if (typeof gsap === 'undefined') return;

    gsap.registerPlugin(ScrollTrigger);

    // Hero entrance sequence
    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

    tl.from('.hero-eyebrow',        { opacity: 0, y: 24, duration: 0.8 })
      .from('.hero-title-line',     { opacity: 0, y: 32, duration: 0.9 }, '-=0.4')
      .from('.hero-title-script',   { opacity: 0, y: 24, duration: 0.9 }, '-=0.5')
      .from('.hero-sub',            { opacity: 0, y: 20, duration: 0.8 }, '-=0.4')
      .from('.hero-actions',        { opacity: 0, y: 16, duration: 0.7 }, '-=0.4')
      .from('.hero-scroll',         { opacity: 0, duration: 0.7 },        '-=0.2');

    // Parallax on hero content
    gsap.to('.hero-content', {
      y: 80,
      ease: 'none',
      scrollTrigger: {
        trigger: '.hero',
        start: 'top top',
        end: 'bottom top',
        scrub: true,
      },
    });

    // Orbs parallax
    gsap.to('.hero-orb-1', {
      y: -60,
      ease: 'none',
      scrollTrigger: {
        trigger: '.hero',
        start: 'top top',
        end: 'bottom top',
        scrub: 1.5,
      },
    });

    gsap.to('.hero-orb-2', {
      y: -100,
      ease: 'none',
      scrollTrigger: {
        trigger: '.hero',
        start: 'top top',
        end: 'bottom top',
        scrub: 2,
      },
    });

    // Stats count-up
    document.querySelectorAll('.stat-value').forEach(el => {
      const raw = el.dataset.value || el.textContent;
      const isPercent = raw.includes('%');
      const num = parseInt(raw.replace(/[^0-9]/g, ''), 10);

      if (isNaN(num)) return;

      ScrollTrigger.create({
        trigger: el,
        start: 'top 85%',
        onEnter: () => {
          let start = 0;
          const duration = 1600;
          const step = timestamp => {
            if (!start) start = timestamp;
            const progress = Math.min((timestamp - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = Math.floor(eased * num);
            const suffix = raw.replace(/[0-9]/g, '').replace(/\s/g, '');
            el.textContent = current + suffix;
            if (progress < 1) requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        },
        once: true,
      });
    });

    // Editorial section slide
    ScrollTrigger.batch('.pillar', {
      onEnter: batch => gsap.from(batch, {
        opacity: 0,
        y: 40,
        stagger: 0.12,
        duration: 0.8,
        ease: 'power2.out',
        clearProps: 'all',
      }),
      start: 'top 85%',
    });

    // Process steps stagger
    ScrollTrigger.batch('.process-step', {
      onEnter: batch => gsap.from(batch, {
        opacity: 0,
        y: 32,
        stagger: 0.15,
        duration: 0.9,
        ease: 'power2.out',
        clearProps: 'all',
      }),
      start: 'top 85%',
    });

    // Cards stagger
    ScrollTrigger.batch('.card', {
      onEnter: batch => gsap.from(batch, {
        opacity: 0,
        y: 48,
        stagger: 0.1,
        duration: 0.9,
        ease: 'power2.out',
        clearProps: 'all',
      }),
      start: 'top 88%',
    });
  }

  /* ─────────────────────────────
     TESTIMONIALS SLIDER
  ───────────────────────────── */
  const track = document.getElementById('testimonials-track');
  const dots  = document.querySelectorAll('.t-dot');
  const btnPrev = document.getElementById('t-prev');
  const btnNext = document.getElementById('t-next');
  const total = dots.length;
  let current = 0;

  function goTo(idx) {
    current = (idx + total) % total;
    track.style.transform = `translateX(calc(-${current * 100}% - ${current * 28}px))`;
    dots.forEach((d, i) => d.classList.toggle('active', i === current));
  }

  btnPrev.addEventListener('click', () => goTo(current - 1));
  btnNext.addEventListener('click', () => goTo(current + 1));
  dots.forEach((dot, i) => dot.addEventListener('click', () => goTo(i)));

  // Auto-advance
  let autoplay = setInterval(() => goTo(current + 1), 6000);

  [btnPrev, btnNext, ...dots].forEach(el => {
    el.addEventListener('click', () => {
      clearInterval(autoplay);
      autoplay = setInterval(() => goTo(current + 1), 6000);
    });
  });

  // Touch/swipe support
  let touchStartX = 0;
  track.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
  track.addEventListener('touchend', e => {
    const diff = touchStartX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) goTo(current + (diff > 0 ? 1 : -1));
  });

  /* ─────────────────────────────
     NEWSLETTER
  ───────────────────────────── */
  window.handleSubscribe = function (e) {
    e.preventDefault();
    const input = document.getElementById('newsletter-email');
    const btn   = e.target.querySelector('button[type="submit"]');
    const original = btn.textContent;

    btn.textContent = 'Welcome ✓';
    btn.style.background = 'var(--forest-green)';
    btn.disabled = true;
    input.value = '';

    setTimeout(() => {
      btn.textContent = original;
      btn.style.background = '';
      btn.disabled = false;
    }, 3000);
  };

  /* ─────────────────────────────
     SMOOTH SCROLL
  ───────────────────────────── */
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const target = document.querySelector(this.getAttribute('href'));
      if (!target) return;
      e.preventDefault();
      const offset = 88;
      const top = target.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top, behavior: 'smooth' });
    });
  });

  /* ─────────────────────────────
     MAGNETIC HOVER (nav & btns)
  ───────────────────────────── */
  document.querySelectorAll('.btn, .t-nav-btn, .social-link').forEach(btn => {
    btn.addEventListener('mousemove', (e) => {
      const rect = btn.getBoundingClientRect();
      const cx = rect.left + rect.width  / 2;
      const cy = rect.top  + rect.height / 2;
      const dx = (e.clientX - cx) * 0.25;
      const dy = (e.clientY - cy) * 0.25;
      btn.style.transform = `translate(${dx}px, ${dy}px)`;
    });

    btn.addEventListener('mouseleave', () => {
      btn.style.transform = '';
    });
  });

  /* ─────────────────────────────
     CARD TILT
  ───────────────────────────── */
  document.querySelectorAll('.card').forEach(card => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width  - 0.5) * 8;
      const y = ((e.clientY - rect.top)  / rect.height - 0.5) * 8;
      card.style.transform = `translateY(-8px) rotateX(${-y}deg) rotateY(${x}deg)`;
      card.style.transformOrigin = 'center center';
    });

    card.addEventListener('mouseleave', () => {
      card.style.transform = '';
    });
  });

  /* ─────────────────────────────
     MARQUEE — pause on hover
  ───────────────────────────── */
  const marqueeTrack = document.querySelector('.marquee-track');
  if (marqueeTrack) {
    marqueeTrack.addEventListener('mouseenter', () => {
      marqueeTrack.style.animationPlayState = 'paused';
    });
    marqueeTrack.addEventListener('mouseleave', () => {
      marqueeTrack.style.animationPlayState = 'running';
    });
  }

  /* ─────────────────────────────
     ACTIVE NAV LINK on scroll
  ───────────────────────────── */
  const sections = document.querySelectorAll('section[id], footer[id]');
  const navLinks = document.querySelectorAll('.nav-link');

  const sectionObserver = new IntersectionObserver(
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
    { threshold: 0.4 }
  );

  sections.forEach(s => sectionObserver.observe(s));

})();
