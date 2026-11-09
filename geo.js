// geo.js — Lớp xử lý GPS thuần (không UI, không side effect)
// Đảm bảo trigger đúng permission popup trên Chrome Android

export const GeoError = {
  INSECURE: 'insecure',
  UNSUPPORTED: 'unsupported',
  IN_APP: 'in_app',
  DENIED: 'denied',
  UNAVAILABLE: 'unavailable',
  TIMEOUT: 'timeout',
  UNKNOWN: 'unknown',
};

function isIOS(){return /iPad|iPhone|iPod/.test(navigator.userAgent||'')}
function isAndroid(){return /Android/.test(navigator.userAgent||'')}
function isInAppBrowser(){
  const ua = navigator.userAgent||'';
  return /Zalo|FBAN|FBAV|FB_IAB|FBIOS|Instagram|Line\/|Twitter|Telegram|MicroMessenger/i.test(ua);
}
function isStandalone(){
  if (window.matchMedia) {
    try {
      if (window.matchMedia('(display-mode: standalone)').matches) return true;
      if (window.matchMedia('(display-mode: fullscreen)').matches) return true;
      if (window.matchMedia('(display-mode: minimal-ui)').matches) return true;
    } catch {}
  }
  return navigator.standalone === true;
}

export async function checkEnvironment(){
  const platform = isIOS() ? 'ios' : isAndroid() ? 'android' : 'other';
  const inApp = isInAppBrowser();
  const standalone = isStandalone();

  if (!window.isSecureContext) return { ok: false, code: GeoError.INSECURE, platform, inApp, standalone };
  if (!navigator.geolocation) return { ok: false, code: GeoError.UNSUPPORTED, platform, inApp, standalone };
  if (inApp) return { ok: false, code: GeoError.IN_APP, platform, inApp, standalone };
  
  return { ok: true, platform, inApp, standalone };
}

export async function getPermissionState(){
  if (!navigator.permissions?.query) return 'unknown';
  try {
    const r = await navigator.permissions.query({ name: 'geolocation' });
    return r.state;
  } catch {
    return 'unknown';
  }
}

export async function watchPermission(onChange){
  if (!navigator.permissions?.query) return;
  try {
    const r = await navigator.permissions.query({ name: 'geolocation' });
    r.onchange = () => onChange(r.state);
  } catch {}
}

export function getCurrentOnce({ timeout = 20000, highAccuracy = true } = {}){
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve({ ok: false, code: GeoError.UNSUPPORTED, rawError: null });
    
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve({ ok: false, code: GeoError.TIMEOUT, rawError: { code: 3 } });
    }, timeout);

    try {
      navigator.geolocation.getCurrentPosition(
        pos => {
          if (done) return;
          done = true; clearTimeout(timer);
          resolve({ ok: true, pos });
        },
        err => {
          if (done) return;
          done = true; clearTimeout(timer);
          resolve({ ok: false, code: mapErrorCode(err?.code), rawError: err });
        },
        { enableHighAccuracy: highAccuracy, timeout, maximumAge: 0 }
      );
    } catch (e) {
      if (done) return;
      done = true; clearTimeout(timer);
      resolve({ ok: false, code: GeoError.UNKNOWN, rawError: e });
    }
  });
}

export function startWatch({ onPos, onErr, highAccuracy = true, maximumAge = 5000 }){
  let wid = null;
  try {
    wid = navigator.geolocation.watchPosition(
      onPos,
      err => onErr(mapErrorCode(err?.code), err),
      { enableHighAccuracy: highAccuracy, timeout: 30000, maximumAge }
    );
  } catch (e) {
    onErr(GeoError.UNKNOWN, e);
  }
  return { cancel: () => { try { if (wid != null) navigator.geolocation.clearWatch(wid); } catch {} } };
}

function mapErrorCode(code){
  switch (code) {
    case 1: return GeoError.DENIED;
    case 2: return GeoError.UNAVAILABLE;
    case 3: return GeoError.TIMEOUT;
    default: return GeoError.UNKNOWN;
  }
}