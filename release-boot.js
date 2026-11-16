/* Release initializer: runs before the app reads user data. */
(() => {
  'use strict';
  const RELEASE_ID = '2026-11-16-v9';
  const KEY_PREFIX = 'vexyro.';
  const MARKER = 'vexyro.release-id';

  function clearAppStorage(storage) {
    const keys = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (typeof key === 'string' && key.startsWith(KEY_PREFIX)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  }

  function resetLocalData() {
    let success = false;
    try { clearAppStorage(window.localStorage); success = true; } catch (_) { /* Storage might be unavailable. */ }
    try { clearAppStorage(window.sessionStorage); } catch (_) { /* Storage might be unavailable. */ }
    return success;
  }

  // A new release means a fresh onboarding only ONCE. Subsequent reloads preserve that release's data.
  // No remote/cloud data is deleted or overwritten.
  try {
    if (window.localStorage.getItem(MARKER) !== RELEASE_ID) {
      resetLocalData();
      window.localStorage.setItem(MARKER, RELEASE_ID);
    }
  } catch (_) { /* Private browsing or disabled storage: the app already handles that case. */ }

  window.VEXYRO_RELEASE = Object.freeze({ id: RELEASE_ID, resetLocalData });
})();
