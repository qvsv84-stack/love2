// version.js — Version tracking + update check
export const APP_VERSION = '2.0.1';
export const APP_BUILD = '2026-11-06';

// ⭐ Expose cho debug
if (typeof window !== 'undefined') {
  window.__APP_VERSION = APP_VERSION;
  window.__APP_BUILD = APP_BUILD;
  console.log(`[App] v${APP_VERSION} (build ${APP_BUILD})`);
}

/* ⭐ Check xem có bản mới không — so sánh version với server */
export async function checkForUpdate() {
  try {
    const res = await fetch('/version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return null;

    const data = await res.json();
    if (data.version && data.version !== APP_VERSION) {
      return {
        current: APP_VERSION,
        latest: data.version,
        buildDate: data.buildDate,
      };
    }
    return null;
  } catch {
    return null;
  }
}