/* ═══════════════════════════════════════════════════════════
   VELOURA — Shop Pages Animation Engine
   Lenis smooth scroll + GSAP for all non-home pages.
   ═══════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  gsap.registerPlugin(ScrollTrigger);

  const EASE = {
    smooth:   'power2.out',
    elegant:  'power3.out',
    dramatic: 'power4.out',
    silky:    'expo.out',
    inOut:    'power3.inOut',
  };

  /* ═══════════════════════════════
     1. LENIS — Butter-smooth scroll
  ═══════════════════════════════ */
  const lenis = new Lenis({
    duration: 1.2,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    touchMultiplier: 1.5,
  });

  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);

  /* ═══════════════════════════════
     2. SCROLL PROGRESS BAR
  ═══════════════════════════════ */
  const progressBar = document.getElementById('scroll-progress');
  if (progressBar) {
    gsap.to(progressBar, {
      width: '100%',
      ease: 'none',
      scrollTrigger: {
        trigger: document.body,
        start: 'top top',
        end: 'bottom bottom',
        scrub: 0.3,
      },
    });
  }

  /* ═══════════════════════════════
     3. BACK TO TOP
  ═══════════════════════════════ */
  const backToTop = document.getElementById('back-to-top');
  if (backToTop) {
    ScrollTrigger.create({
      start: 'top -400',
      onUpdate: (self) => {
        if (self.direction === 1 && window.scrollY > 400) {
          backToTop.classList.add('visible');
        } else if (window.scrollY < 400) {
          backToTop.classList.remove('visible');
        }
      },
    });
    backToTop.addEventListener('click', () => lenis.scrollTo(0, { duration: 1.8 }));
  }

  /* ═══════════════════════════════
     4. CUSTOM CURSOR
  ═══════════════════════════════ */
  const cursor    = document.getElementById('cursor');
  const cursorDot = cursor?.querySelector('.cursor-dot');
  const cursorRing = cursor?.querySelector('.cursor-ring');

  if (cursor && window.matchMedia('(pointer: fine)').matches) {
    const dotX  = gsap.quickTo(cursorDot, 'x', { duration: 0.15, ease: 'power2.out' });
    const dotY  = gsap.quickTo(cursorDot, 'y', { duration: 0.15, ease: 'power2.out' });
    const ringX = gsap.quickTo(cursorRing, 'x', { duration: 0.45, ease: 'power3.out' });
    const ringY = gsap.quickTo(cursorRing, 'y', { duration: 0.45, ease: 'power3.out' });

    document.addEventListener('mousemove', (e) => {
      if (!cursor.style.opacity || cursor.style.opacity === '0') {
        cursor.style.opacity = '1';
      }
      dotX(e.clientX); dotY(e.clientY);
      ringX(e.clientX); ringY(e.clientY);
    });

    // Hide cursor when mouse leaves the window to prevent it getting stuck
    document.addEventListener('mouseleave', () => {
      cursor.style.opacity = '0';
      document.body.classList.remove('cursor-hover', 'cursor-click');
    });

    document.addEventListener('mouseenter', () => {
      cursor.style.opacity = '1';
    });

    // Use event delegation for hover state to handle dynamic elements
    const hoverSelector = 'a, button, .shop-card, .cart-item, input, select, textarea, .filter-chip, .payment-option, .qty-btn';
    document.addEventListener('mouseover', (e) => {
      if (e.target.closest(hoverSelector)) {
        document.body.classList.add('cursor-hover');
      }
    });

    document.addEventListener('mouseout', (e) => {
      if (e.target.closest(hoverSelector)) {
        document.body.classList.remove('cursor-hover');
      }
    });

    document.addEventListener('mousedown', () => document.body.classList.add('cursor-click'));
    document.addEventListener('mouseup', () => document.body.classList.remove('cursor-click'));
  }

  /* ═══════════════════════════════
     5. NAVIGATION
  ═══════════════════════════════ */
  const header = document.getElementById('site-header');
  if (header) {
    // On shop pages nav should always be scrolled style
    header.classList.add('scrolled');
    window.addEventListener('scroll', () => {
      header.classList.toggle('scrolled', true);
    }, { passive: true });
  }

  // Hamburger menu
  const hamburger     = document.getElementById('nav-hamburger');
  const mobileMenu    = document.getElementById('mobile-menu');
  const mobileClose   = document.getElementById('mobile-close');
  const mobileOverlay = document.getElementById('mobile-overlay');
  const mobileLinks   = document.querySelectorAll('.mobile-link');

  if (hamburger && mobileMenu) {
    const hbSpans = hamburger.querySelectorAll('span');
    let menuOpen = false;

    function openMenu() {
      menuOpen = true;
      mobileMenu.classList.add('open');
      mobileOverlay.classList.add('open');
      document.body.style.overflow = 'hidden';
      lenis.stop();
      gsap.to(hbSpans[0], { rotation: 45, y: 7, duration: 0.3, ease: EASE.smooth });
      gsap.to(hbSpans[1], { opacity: 0, duration: 0.15 });
      gsap.to(hbSpans[2], { rotation: -45, y: -7, duration: 0.3, ease: EASE.smooth });
      gsap.from(mobileLinks, { x: 40, opacity: 0, stagger: 0.06, duration: 0.5, ease: EASE.elegant, delay: 0.2, clearProps: 'all' });
    }

    function closeMenu() {
      menuOpen = false;
      mobileMenu.classList.remove('open');
      mobileOverlay.classList.remove('open');
      document.body.style.overflow = '';
      lenis.start();
      gsap.to(hbSpans[0], { rotation: 0, y: 0, duration: 0.3, ease: EASE.smooth });
      gsap.to(hbSpans[1], { opacity: 1, duration: 0.15, delay: 0.1 });
      gsap.to(hbSpans[2], { rotation: 0, y: 0, duration: 0.3, ease: EASE.smooth });
    }

    hamburger.addEventListener('click', () => menuOpen ? closeMenu() : openMenu());
    mobileClose.addEventListener('click', closeMenu);
    mobileOverlay.addEventListener('click', closeMenu);
    mobileLinks.forEach(link => link.addEventListener('click', closeMenu));
  }

  /* ═══════════════════════════════
     6. MAGNETIC BUTTONS
  ═══════════════════════════════ */
  if (window.matchMedia('(pointer: fine)').matches) {
    document.querySelectorAll('.btn, .back-to-top, .filter-chip').forEach(el => {
      const setX = gsap.quickTo(el, 'x', { duration: 0.4, ease: EASE.smooth });
      const setY = gsap.quickTo(el, 'y', { duration: 0.4, ease: EASE.smooth });
      el.addEventListener('mousemove', (e) => {
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        setX((e.clientX - cx) * 0.15);
        setY((e.clientY - cy) * 0.15);
      });
      el.addEventListener('mouseleave', () => { setX(0); setY(0); });
    });
  }

  /* ═══════════════════════════════
     7. PAGE HERO ENTRANCE
  ═══════════════════════════════ */
  const shopHeader = document.querySelector('.shop-hero-header');
  if (shopHeader) {
    const tl = gsap.timeline({ defaults: { ease: EASE.elegant } });
    tl.from(shopHeader.querySelector('.section-eyebrow'), { opacity: 0, y: 30, duration: 0.8 }, 0.1)
      .from(shopHeader.querySelector('h1'), { opacity: 0, y: 40, duration: 1 }, 0.2)
      .from(shopHeader.querySelector('.shop-hero-subtitle'), { opacity: 0, y: 20, duration: 0.8 }, 0.4);
  }

  // Generic page header animation
  const pageHeaders = document.querySelectorAll('.shop-header, .cart-header, .checkout-header, .success-inner, .pdp-grid');
  pageHeaders.forEach(h => {
    gsap.from(h.children, {
      opacity: 0, y: 30, stagger: 0.1, duration: 0.9, ease: EASE.elegant,
      scrollTrigger: { trigger: h, start: 'top 90%' },
    });
  });

  /* ═══════════════════════════════
     8. SHOP CARDS — Stagger entrance
  ═══════════════════════════════ */
  const shopCards = document.querySelectorAll('.shop-card');
  if (shopCards.length) {
    gsap.from(shopCards, {
      opacity: 0, y: 60,
      stagger: { each: 0.06 },
      duration: 0.9,
      ease: EASE.dramatic,
      scrollTrigger: { trigger: '.shop-grid', start: 'top 88%' },
    });
  }

  /* ═══════════════════════════════
     9. CART ITEMS ENTRANCE
  ═══════════════════════════════ */
  const cartItems = document.querySelectorAll('.cart-item');
  if (cartItems.length) {
    gsap.from(cartItems, {
      opacity: 0, x: -40,
      stagger: 0.08,
      duration: 0.8,
      ease: EASE.elegant,
    });
  }

  const cartSummary = document.querySelector('.cart-summary');
  if (cartSummary) {
    gsap.from(cartSummary, { opacity: 0, x: 40, duration: 0.9, ease: EASE.elegant, delay: 0.3 });
  }

  /* ════════════════════════════════
     10. CHECKOUT SECTIONS ENTRANCE
  ════════════════════════════════ */
  const checkoutSections = document.querySelectorAll('.checkout-section');
  if (checkoutSections.length) {
    gsap.from(checkoutSections, {
      opacity: 0, y: 40,
      stagger: 0.12,
      duration: 0.9,
      ease: EASE.elegant,
    });
  }

  const checkoutSummary = document.querySelector('.checkout-summary');
  if (checkoutSummary) {
    gsap.from(checkoutSummary, { opacity: 0, y: 40, duration: 0.9, ease: EASE.elegant, delay: 0.4 });
  }

  /* ════════════════════════════════
     11. ORDER SUCCESS ANIMATION
  ════════════════════════════════ */
  const successIcon = document.querySelector('.success-icon');
  if (successIcon) {
    const tl = gsap.timeline({ defaults: { ease: EASE.elegant } });
    tl.from('.success-icon', { scale: 0, opacity: 0, duration: 0.8, ease: 'elastic.out(1, 0.6)' })
      .from('.success-inner .section-eyebrow', { opacity: 0, y: 20, duration: 0.6 }, 0.3)
      .from('.success-title', { opacity: 0, y: 30, duration: 0.8 }, 0.4)
      .from('.success-subtitle', { opacity: 0, y: 20, duration: 0.6 }, 0.55)
      .from('.success-order-box', { opacity: 0, y: 30, duration: 0.8 }, 0.65)
      .from('.success-items', { opacity: 0, y: 30, duration: 0.8 }, 0.8)
      .from('.success-actions', { opacity: 0, y: 20, duration: 0.6 }, 0.95);

    // Confetti-like particles
    gsap.to('.success-icon', {
      boxShadow: '0 0 0 40px rgba(26,58,47,0)', duration: 1.5, ease: 'power2.out', delay: 0.3,
    });
  }

  /* ════════════════════════════════
     12. PDP — Product Detail Page
  ════════════════════════════════ */
  const pdpImage = document.querySelector('.pdp-image-wrap');
  if (pdpImage) {
    // Entrance: image fades & slides in
    gsap.fromTo('.pdp-image-wrap',
      { opacity: 0, y: 40, scale: 0.98 },
      { opacity: 1, y: 0, scale: 1, duration: 1, ease: EASE.dramatic, clearProps: 'all' }
    );
    // Info elements stagger in
    gsap.fromTo('.pdp-info-inner > *',
      { opacity: 0, y: 28 },
      { opacity: 1, y: 0, stagger: 0.07, duration: 0.8, ease: EASE.elegant, delay: 0.2, clearProps: 'all' }
    );
    // Breadcrumb fade
    const pdpBreadcrumb = document.querySelector('.pdp-breadcrumb');
    if (pdpBreadcrumb) {
      gsap.fromTo(pdpBreadcrumb, { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.5, ease: EASE.elegant, delay: 0.1, clearProps: 'all' });
    }
  }

  // PDP image zoom on hover (desktop only)
  const pdpImg = document.querySelector('.pdp-image');
  if (pdpImg && window.matchMedia('(pointer: fine)').matches) {
    const wrap = pdpImg.closest('.pdp-image-inner');
    if (wrap) {
      wrap.addEventListener('mousemove', (e) => {
        const rect = wrap.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        pdpImg.style.transformOrigin = `${x}% ${y}%`;
        pdpImg.style.transform = 'scale(1.18)';
      });
      wrap.addEventListener('mouseleave', () => {
        pdpImg.style.transform = 'scale(1)';
        pdpImg.style.transformOrigin = 'center center';
      });
    }
  }

  // PDP Add-to-cart button ripple
  const pdpAddBtn = document.querySelector('.pdp-add-btn');
  if (pdpAddBtn) {
    pdpAddBtn.addEventListener('click', function (e) {
      if (this.disabled) return;
      const ripple = document.createElement('span');
      ripple.style.cssText = `position:absolute;border-radius:50%;background:rgba(255,255,255,0.3);pointer-events:none;transform:scale(0);animation:pdp-ripple 0.6s ease-out forwards;`;
      const rect = this.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 2;
      ripple.style.width = ripple.style.height = size + 'px';
      ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
      ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
      this.appendChild(ripple);
      setTimeout(() => ripple.remove(), 600);
    });
  }

  /* ════════════════════════════════
     13. RELATED PRODUCTS
  ════════════════════════════════ */
  const relatedCards = document.querySelectorAll('.related-grid .shop-card');
  if (relatedCards.length) {
    gsap.from(relatedCards, {
      opacity: 0, y: 50, stagger: 0.1, duration: 0.9, ease: EASE.elegant,
      scrollTrigger: { trigger: '.related-section', start: 'top 85%' },
    });
  }

  /* ════════════════════════════════
     14. FILTER BAR ENTRANCE
  ════════════════════════════════ */
  const filterBar = document.querySelector('.shop-filters-bar');
  if (filterBar) {
    gsap.from(filterBar, { opacity: 0, y: -20, duration: 0.6, ease: EASE.elegant, delay: 0.2 });
  }

  /* ════════════════════════════════
     15. BREADCRUMB ENTRANCE
  ════════════════════════════════ */
  const breadcrumb = document.querySelector('.breadcrumb');
  if (breadcrumb) {
    gsap.from(breadcrumb, { opacity: 0, x: -20, duration: 0.6, ease: EASE.elegant, delay: 0.1 });
  }

  /* ════════════════════════════════
     16. SHOP CARD TILT (fine pointer)
  ════════════════════════════════ */
  if (window.matchMedia('(pointer: fine)').matches) {
    document.querySelectorAll('.shop-card').forEach(card => {
      const setRotX = gsap.quickTo(card, 'rotateX', { duration: 0.4, ease: 'power2.out' });
      const setRotY = gsap.quickTo(card, 'rotateY', { duration: 0.4, ease: 'power2.out' });

      card.addEventListener('mousemove', (e) => {
        const rect = card.getBoundingClientRect();
        const px = (e.clientX - rect.left) / rect.width  - 0.5;
        const py = (e.clientY - rect.top)  / rect.height - 0.5;
        setRotX(-py * 4);
        setRotY(px * 4);
      });
      card.addEventListener('mouseleave', () => { setRotX(0); setRotY(0); });
    });
  }

  /* ════════════════════════════════
     16b. SHOP CARD — Full card click
  ════════════════════════════════ */
  document.addEventListener('click', (e) => {
    // Don't hijack clicks on buttons, forms, or existing links
    if (e.target.closest('button, form, a, input, select, textarea')) return;
    const card = e.target.closest('.shop-card');
    if (!card) return;
    const link = card.querySelector('.shop-card-img-link, .shop-card-title a');
    if (link) window.location.href = link.href;
  });

  /* ════════════════════════════════
     17. FOOTER REVEAL
  ════════════════════════════════ */
  const footerTop = document.querySelector('.footer-top');
  if (footerTop) {
    gsap.from(footerTop.children, {
      opacity: 0, y: 24, stagger: 0.08, duration: 0.8, ease: EASE.elegant,
      scrollTrigger: { trigger: footerTop, start: 'top 90%' },
    });
  }

  /* ════════════════════════════════
     18. QTY BUTTONS
  ════════════════════════════════ */
  // Product detail qty
  const qtyInput = document.getElementById('qty');
  const qtyMinus = document.getElementById('qty-minus');
  const qtyPlus = document.getElementById('qty-plus');
  if (qtyInput && qtyMinus && qtyPlus) {
    qtyMinus.addEventListener('click', () => { if (qtyInput.value > 1) qtyInput.value = parseInt(qtyInput.value) - 1; });
    qtyPlus.addEventListener('click', () => { if (qtyInput.value < 10) qtyInput.value = parseInt(qtyInput.value) + 1; });
  }

  // Cart qty buttons
  document.querySelectorAll('.cart-item').forEach(item => {
    const input = item.querySelector('.cart-qty-input');
    const minus = item.querySelector('.qty-minus-btn');
    const plus = item.querySelector('.qty-plus-btn');
    if (input && minus && plus) {
      minus.addEventListener('click', () => { if (input.value > 1) input.value = parseInt(input.value) - 1; });
      plus.addEventListener('click', () => { if (input.value < 10) input.value = parseInt(input.value) + 1; });
    }
  });

  /* ════════════════════════════════
     19. ADD TO CART AJAX
  ════════════════════════════════ */
  document.querySelectorAll('form[action="/cart/add"]').forEach(form => {
    form.addEventListener('submit', async function(e) {
      e.preventDefault();
      const btn = form.querySelector('button[type="submit"], .btn-add-cart, .pdp-add-btn');
      if (!btn) { form.submit(); return; }
      const original = btn.innerHTML;

      try {
        const res = await fetch('/cart/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          body: JSON.stringify({
            id: form.querySelector('[name="id"]').value,
            qty: form.querySelector('[name="qty"]')?.value || 1,
          }),
        });
        const data = await res.json();

        // Update cart badge
        const badges = document.querySelectorAll('.cart-badge');
        badges.forEach(b => { b.textContent = data.cartCount; b.style.display = 'flex'; });

        // Animate button
        btn.innerHTML = '✓ Added';
        btn.style.pointerEvents = 'none';
        gsap.fromTo(btn, { scale: 0.95 }, { scale: 1, duration: 0.4, ease: 'elastic.out(1, 0.7)' });

        setTimeout(() => {
          btn.innerHTML = original;
          btn.style.pointerEvents = '';
        }, 2000);
      } catch (_) {
        form.submit();
      }
    });
  });

  /* ════════════════════════════════
     20. SMOOTH ANCHOR LINKS
  ════════════════════════════════ */
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      const href = this.getAttribute('href');
      if (href === '#') return;
      const target = document.querySelector(href);
      if (!target) return;
      e.preventDefault();
      lenis.scrollTo(target, { offset: -80, duration: 1.2 });
    });
  });

  /* ════════════════════════════════
     21. MOBILE FILTER DRAWER
  ════════════════════════════════ */
  const filterToggle  = document.getElementById('mobile-filter-toggle');
  const filterBar     = document.getElementById('shop-filters-bar');
  const filterClose   = document.getElementById('filter-drawer-close');
  const filterApply   = document.getElementById('filter-drawer-apply');
  const filterOverlay = document.getElementById('filter-drawer-overlay');

  function openFilterDrawer() {
    if (!filterBar) return;
    filterBar.classList.add('drawer-open');
    if (filterOverlay) filterOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    if (typeof lenis !== 'undefined') lenis.stop();
  }

  function closeFilterDrawer() {
    if (!filterBar) return;
    filterBar.classList.remove('drawer-open');
    if (filterOverlay) filterOverlay.classList.remove('open');
    document.body.style.overflow = '';
    if (typeof lenis !== 'undefined') lenis.start();
  }

  if (filterToggle)  filterToggle.addEventListener('click', openFilterDrawer);
  if (filterClose)   filterClose.addEventListener('click', closeFilterDrawer);
  if (filterApply)   filterApply.addEventListener('click', closeFilterDrawer);
  if (filterOverlay) filterOverlay.addEventListener('click', closeFilterDrawer);

  /* ════════════════════════════════
     22. HIDE MOBILE FILTER FAB ON SCROLL UP NEAR FILTERS
  ════════════════════════════════ */
  if (filterToggle && filterBar) {
    let lastY = 0;
    window.addEventListener('scroll', () => {
      const y = window.scrollY;
      // Show FAB only after scrolling past 200px
      if (y > 200) {
        filterToggle.style.opacity = '1';
        filterToggle.style.pointerEvents = 'auto';
      } else {
        filterToggle.style.opacity = '0';
        filterToggle.style.pointerEvents = 'none';
      }
      lastY = y;
    }, { passive: true });
    // Initial state
    filterToggle.style.opacity = '0';
    filterToggle.style.pointerEvents = 'none';
    filterToggle.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
  }

})();
