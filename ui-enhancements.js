'use strict';

(() => {
  const searchInput = document.getElementById('searchInput');
  const networkStatus = document.getElementById('networkStatus');
  let isOnline = navigator.onLine;

  function updateNetworkStatus() {
    if (networkStatus) networkStatus.classList.toggle('hidden', isOnline);
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
