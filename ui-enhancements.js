'use strict';

(() => {
  const searchInput = document.getElementById('searchInput');
  const networkStatus = document.getElementById('networkStatus');
  const hero = document.querySelector('.pg-hero');
  const heroImage = document.getElementById('heroSlideshowImage');
  const heroSlideStatus = document.getElementById('heroSlideStatus');
  let isOnline = navigator.onLine;
  const heroSlides = [
    'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?auto=format&fit=crop&w=1600&q=80'
  ];
  let heroSlideIndex = 0;

  function updateNetworkStatus() {
    if (networkStatus) networkStatus.classList.toggle('hidden', isOnline);
  }

  function labelIconOnlyButtons(root = document) {
    const buttons = root.matches && root.matches('button, a')
      ? [root, ...root.querySelectorAll('button, a')]
      : [...root.querySelectorAll('button, a')];
    buttons.forEach(element => {
      if ((element.textContent || '').trim() || element.getAttribute('aria-label') || element.title) return;

      const icon = element.querySelector('i');
      if (!icon) return;
      const iconNames = {
        'fa-xmark': 'إغلاق النافذة',
        'fa-eye': 'إظهار أو إخفاء توكن البوت',
        'fa-pen-to-square': 'تعديل البيانات',
        'fa-trash-can': 'حذف',
        'fa-whatsapp': 'فتح واتساب',
        'fa-calendar-check': 'تسجيل الحضور',
        'fa-id-card': 'عرض بطاقة العضوية',
        'fa-notes-medical': 'فتح ملف الكورس',
        'fa-bell': 'إرسال تذكير',
        'fa-arrows-rotate': 'تجديد الاشتراك',
        'fa-telegram': 'إرسال رسالة عبر تليكرام'
      };
      const iconName = [...icon.classList].find(name => iconNames[name]);
      if (!iconName) return;

      let label = iconNames[iconName];
      if (iconName === 'fa-xmark') {
        const modal = element.closest('.modal-backdrop');
        const heading = modal && modal.querySelector('h2, h3');
        if (heading && heading.textContent.trim()) label = `إغلاق ${heading.textContent.trim()}`;
      }

      element.setAttribute('aria-label', label);
      element.title = label;
    });
  }

  function makeClickTargetsKeyboardAccessible(root = document) {
    const targets = root.matches && root.matches('[onclick]')
      ? [root, ...root.querySelectorAll('[onclick]')]
      : [...root.querySelectorAll('[onclick]')];
    targets.forEach(element => {
      if (['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL'].includes(element.tagName) ||
          element.id === 'mobileMenuBackdrop' ||
          element.classList.contains('modal-backdrop') ||
          element.querySelector('button, a, input, select, textarea')) return;

      if (!element.hasAttribute('role')) element.setAttribute('role', 'button');
      if (!element.hasAttribute('tabindex')) element.tabIndex = 0;
      if (element.dataset.keyboardAction) return;

      element.dataset.keyboardAction = 'true';
      element.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        element.click();
      });
    });
  }

  function enhanceActions(root = document) {
    labelIconOnlyButtons(root);
    makeClickTargetsKeyboardAccessible(root);
  }

  window.addEventListener('online', () => {
    isOnline = true;
    updateNetworkStatus();
  });
  window.addEventListener('offline', () => {
    isOnline = false;
    updateNetworkStatus();
  });
  updateNetworkStatus();
  enhanceActions();
  new MutationObserver(records => {
    records.forEach(record => record.addedNodes.forEach(node => {
      if (node instanceof Element) enhanceActions(node);
    }));
  }).observe(document.body, { childList: true, subtree: true });

  function showHeroSlide(index) {
    if (!heroImage || heroSlides.length < 1) return;
    heroSlideIndex = (index + heroSlides.length) % heroSlides.length;
    heroImage.classList.remove('is-visible');
    heroImage.src = heroSlides[heroSlideIndex];
    if (heroSlideStatus) heroSlideStatus.textContent = `صورة ${heroSlideIndex + 1} من ${heroSlides.length}`;
  }

  if (heroImage) {
    heroImage.addEventListener('load', () => heroImage.classList.add('is-visible'));
    heroImage.addEventListener('error', () => heroImage.classList.remove('is-visible'));
    if (heroImage.complete && heroImage.naturalWidth) heroImage.classList.add('is-visible');
  }

  if (hero && heroSlides.length > 1 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    window.setInterval(() => {
      if (!document.hidden) showHeroSlide(heroSlideIndex + 1);
    }, 8000);
  }

  document.addEventListener('keydown', event => {
    const isSearchShortcut = event.key === '/' && !event.altKey && !event.ctrlKey && !event.metaKey;
    const target = event.target;
    const isEditing = target instanceof Element &&
      target.closest('input, textarea, select, [contenteditable="true"]');

    if (isSearchShortcut && !isEditing && searchInput) {
      event.preventDefault();
      searchInput.focus();
    }
  });
})();
