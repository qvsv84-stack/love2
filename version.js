// version.js — Version tracking + update check (semantic compare)
export const APP_VERSION = '2.0.2';
export const APP_BUILD = '2026-11-09';

if (typeof window !== 'undefined') {
  window.__APP_VERSION = APP_VERSION;
  window.__APP_BUILD = APP_BUILD;
  console.log(`[App] v${APP_VERSION} (build ${APP_BUILD})`);
}

/* So sánh semantic: trả 1 nếu a > b, -1 nếu a < b, 0 nếu bằng */
function parseVer(v) {
  return String(v || '0').split('.').map(n => parseInt(n, 10) || 0);
}
function compareVersion(a, b) {
  const pa = parseVer(a);
  const pb = parseVer(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na > nb ? 1 : -1;
  }
  return 0;
}

/* Check xem có bản mới KHÔNG — chỉ update khi server MỚI HƠN */
export async function checkForUpdate() {
  try {
    const res = await fetch('/version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.version) return null;
    // Chỉ báo update nếu server > current (không hạ cấp)
    if (compareVersion(data.version, APP_VERSION) > 0) {
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

/* Helper: xoá toàn bộ cache + SW trước khi reload để lấy code mới */
export async function forceUpdateAndReload() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) {
        try { await r.unregister(); } catch {}
      }
    }
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      for (const k of keys) {
        try { await caches.delete(k); } catch {}
      }
    }
  } catch (e) {
    console.warn('[forceUpdate]', e);
  }
  location.reload(true);
}