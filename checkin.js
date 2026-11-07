// checkin.js — Tab chấm công GPS (đơn giản cho nhân viên lớn tuổi)
import { supabase } from './supabase.js';
import { state, $, toast, openModal, closeModal, toDateStr } from './core.js';

const LOCATION_ID = 1;
const DEFAULT_RADIUS = 150;
const MAX_ACCURACY_WARN = 200;

let _watchId = null;
let _renderTimer = null;
let _todayCheckins = [];
let _recentLogs = [];
let _anyCheckinInFlight = false;
let _autoCheckinCooldown = 0;

let _adminTodayCheckins = [];
let _realtimeChannel = null;
let _adminPollTimer = null;
let _audioCtx = null;
let _checkingAdmin = false;
let _unseenCheckinCount = 0;
let _audioUnlockBound = false;

function ensureState() {
  if (!state.checkinLocation) state.checkinLocation = null;
  if (!state.checkinUserPos) state.checkinUserPos = null;
  if (!state.checkinGpsError) state.checkinGpsError = null;
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ═══════════════════════════════════════════════════════════════
   GPS WATCH
   ═══════════════════════════════════════════════════════════════ */
function startGPSWatch() {
  if (_watchId != null) return;
  if (!navigator.geolocation) {
    state.checkinGpsError = 'Điện thoại không hỗ trợ định vị';
    return;
  }
  state.checkinGpsError = null;

  _watchId = navigator.geolocation.watchPosition(
    (pos) => {
      state.checkinUserPos = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy || 0,
        timestamp: pos.timestamp,
      };
      state.checkinGpsError = null;
      scheduleRender();
      tryAutoCheckin();
    },
    (err) => {
      let msg = 'Không lấy được vị trí';
      if (err.code === 1) msg = 'Chưa bật quyền vị trí — vào Cài đặt → Safari → Vị trí để bật';
      else if (err.code === 2) msg = 'Chưa bật định vị trên điện thoại';
      else if (err.code === 3) msg = 'Đang tìm vị trí, vui lòng đợi thêm...';
      state.checkinGpsError = msg;
      scheduleRender(true);
    },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 3000 }
  );
}

export function stopCheckinWatch() {
  if (_watchId != null) {
    try { navigator.geolocation.clearWatch(_watchId); } catch {}
    _watchId = null;
  }
  clearTimeout(_renderTimer);
  stopAdminRealtime();
  stopAdminPolling();
}

function scheduleRender(immediate = false) {
  clearTimeout(_renderTimer);
  if (immediate) {
    if ($('#tab-checkin')?.classList.contains('active')) renderCheckin();
    return;
  }
  _renderTimer = setTimeout(() => {
    if (!$('#tab-checkin')?.classList.contains('active')) return;
    const $card = $('#checkinStatusCard');
    if (!$card) renderCheckin();
    else updateLiveStatus();
  }, 500);
}

/* ═══════════════════════════════════════════════════════════════
   DATA
   ═══════════════════════════════════════════════════════════════ */
async function loadLocation() {
  const { data, error } = await supabase
    .from('cslx_checkin_location')
    .select('*')
    .eq('id', LOCATION_ID)
    .maybeSingle();
  if (error) { console.error('[checkin] location:', error); return; }
  state.checkinLocation = data || null;
}

async function loadTodayCheckins() {
  if (!state.user?.id) return;
  const today = toDateStr(new Date());
  const { data, error } = await supabase
    .from('cslx_checkins')
    .select('*')
    .eq('employee_id', state.user.id)
    .eq('checkin_date', today)
    .order('checkin_at', { ascending: true });
  if (error) { console.error(error); _todayCheckins = []; return; }
  _todayCheckins = data || [];
}

async function loadRecentLogs() {
  if (!state.user?.id) return;
  const { data, error } = await supabase
    .from('cslx_checkins')
    .select('*')
    .eq('employee_id', state.user.id)
    .order('checkin_at', { ascending: false })
    .limit(20);
  if (error) { console.error(error); _recentLogs = []; return; }
  _recentLogs = data || [];
}

async function loadAdminTodayCheckins() {
  if (!state.isAdmin) { _adminTodayCheckins = []; return; }
  const today = toDateStr(new Date());
  const { data, error } = await supabase
    .from('cslx_checkins')
    .select('*')
    .eq('checkin_date', today)
    .order('checkin_at', { ascending: true });
  if (error) { console.error('[admin checkins]', error); _adminTodayCheckins = []; return; }
  _adminTodayCheckins = data || [];
}

/* ═══════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════ */
function formatTime(iso) {
  try {
    const d = new Date(iso);
    const h = d.getHours();
    const m = d.getMinutes();
    const period = h < 12 ? 'sáng' : (h < 18 ? 'chiều' : 'tối');
    const displayH = h === 0 ? 12 : (h > 12 ? h - 12 : h);
    return `${displayH} giờ ${String(m).padStart(2, '0')} phút ${period}`;
  } catch { return '—'; }
}

function formatHHMM(iso) {
  try {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch { return '—'; }
}

function formatDateVN(iso) {
  try {
    const d = new Date(iso);
    const days = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
    return `${days[d.getDay()]}, ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  } catch { return '—'; }
}

function formatDateShort(dateStr) {
  try {
    const parts = dateStr.split('-');
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  } catch { return dateStr; }
}

function formatDuration(ms) {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} phút`;
  if (m === 0) return `${h} giờ`;
  return `${h} giờ ${m} phút`;
}

function getUserName() {
  const emp = (state.employees || []).find(e => e.id === state.user?.id);
  return emp?.full_name || emp?.username || state.user?.email || '';
}

function getDistanceInfo() {
  if (!state.checkinLocation || !state.checkinUserPos) return null;
  const loc = state.checkinLocation;
  const pos = state.checkinUserPos;
  const dist = haversine(pos.lat, pos.lng, loc.lat, loc.lng);
  return {
    distance: dist,
    radius: loc.radius_m,
    inRange: dist <= loc.radius_m,
    accuracy: pos.accuracy,
  };
}

function getCurrentState() {
  if (_todayCheckins.length === 0) return 'need_in';
  if (_todayCheckins.length === 1) return 'need_out';
  return 'done';
}

/* ═══════════════════════════════════════════════════════════════
   AUTO CHECK-IN
   ═══════════════════════════════════════════════════════════════ */
async function tryAutoCheckin() {
  if (_anyCheckinInFlight) return;
  if (Date.now() < _autoCheckinCooldown) return;
  if (!state.user?.id) return;
  if (getCurrentState() !== 'need_in') return;

  const distInfo = getDistanceInfo();
  if (!distInfo || !distInfo.inRange) return;

  await doAutoCheckin();
}

async function doAutoCheckin() {
  const loc = state.checkinLocation;
  const pos = state.checkinUserPos;
  if (!loc || !pos) return;

  const dist = haversine(pos.lat, pos.lng, loc.lat, loc.lng);

  _anyCheckinInFlight = true;
  try {
    const { error } = await supabase.from('cslx_checkins').insert({
      employee_id:   state.user.id,
      employee_name: getUserName(),
      checkin_date:  toDateStr(new Date()),
      type:          'in',
      lat:           pos.lat,
      lng:           pos.lng,
      accuracy_m:    pos.accuracy,
      distance_m:    dist,
      device_info:   'AUTO · ' + (navigator.userAgent || '').slice(0, 180),
    });
    if (error) throw error;

    try { navigator.vibrate([100, 50, 200]); } catch {}

    await loadTodayCheckins();
    await loadRecentLogs();
    renderCheckin();
    showSuccessModal('in', true);
  } catch (err) {
    console.error('[auto-checkin]', err);
    _autoCheckinCooldown = Date.now() + 30_000;
  } finally {
    _anyCheckinInFlight = false;
  }
}

/* ═══════════════════════════════════════════════════════════════
   ADMIN MONITOR
   ═══════════════════════════════════════════════════════════════ */
function getAudioCtx() {
  if (_audioCtx) return _audioCtx;
  try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
  return _audioCtx;
}

function playCheckinSound() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') { ctx.resume().catch(() => {}); }
  try {
    const now = ctx.currentTime;
    const o1 = ctx.createOscillator(), g1 = ctx.createGain();
    o1.frequency.value = 880; o1.type = 'sine';
    g1.gain.setValueAtTime(0.0001, now);
    g1.gain.exponentialRampToValueAtTime(0.28, now + 0.02);
    g1.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    o1.connect(g1).connect(ctx.destination);
    o1.start(now); o1.stop(now + 0.2);

    const o2 = ctx.createOscillator(), g2 = ctx.createGain();
    o2.frequency.value = 1320; o2.type = 'sine';
    g2.gain.setValueAtTime(0.0001, now + 0.14);
    g2.gain.exponentialRampToValueAtTime(0.28, now + 0.16);
    g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
    o2.connect(g2).connect(ctx.destination);
    o2.start(now + 0.14); o2.stop(now + 0.34);
  } catch {}
}

function bindAudioUnlock() {
  if (_audioUnlockBound) return;
  _audioUnlockBound = true;
  const unlock = () => {
    const ctx = getAudioCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  };
  document.addEventListener('touchstart', unlock, { once: true, passive: true });
  document.addEventListener('click', unlock, { once: true });
}

function groupAdminCheckins() {
  const map = {};
  for (const c of _adminTodayCheckins) {
    if (!map[c.employee_id]) {
      map[c.employee_id] = {
        employee_id: c.employee_id,
        employee_name: c.employee_name || '—',
        in: null,
        out: null,
      };
    }
    const t = c.type || 'in';
    if (t === 'out') {
      if (!map[c.employee_id].out) map[c.employee_id].out = c;
    } else {
      if (!map[c.employee_id].in) map[c.employee_id].in = c;
    }
  }
  return Object.values(map).sort((a, b) => {
    const ta = a.in ? new Date(a.in.checkin_at).getTime() : (a.out ? new Date(a.out.checkin_at).getTime() : 0);
    const tb = b.in ? new Date(b.in.checkin_at).getTime() : (b.out ? new Date(b.out.checkin_at).getTime() : 0);
    return tb - ta;
  });
}

function renderAdminTodaySection() {
  if (!state.isAdmin) return '';
  const groups = groupAdminCheckins();

  const rows = groups.length > 0
    ? groups.map(g => {
        const inTime = g.in ? formatHHMM(g.in.checkin_at) : null;
        const outTime = g.out ? formatHHMM(g.out.checkin_at) : null;
        const isComplete = !!(g.in && g.out);
        const name = g.employee_name || '—';
        const initial = name.charAt(0).toUpperCase();
        return `
          <div style="display:flex;align-items:center;gap:10px;padding:11px 12px;border-bottom:1px solid var(--border);">
            <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#0ea5b7,#0a6b7a);color:white;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex-shrink:0;">${initial}</div>
            <div style="flex:1;min-width:0;">
              <div style="font-weight:600;color:var(--text);font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:3px;line-height:1.4;">
                ${inTime ? `Đến <strong style="color:#16a34a;">${inTime}</strong>` : '<span style="color:#94a3b8;">Chưa đến</span>'}
                ${outTime ? ` · Về <strong style="color:#0891b2;">${outTime}</strong>` : ''}
              </div>
            </div>
            ${isComplete
              ? '<span style="font-size:11px;padding:3px 8px;background:#dcfce7;color:#15803d;border-radius:20px;font-weight:600;white-space:nowrap;">✓ Xong</span>'
              : '<span style="font-size:11px;padding:3px 8px;background:#fef3c7;color:#b45309;border-radius:20px;font-weight:600;white-space:nowrap;">Đang làm</span>'}
          </div>
        `;
      }).join('')
    : `<div style="padding:22px 16px;text-align:center;color:var(--text-muted);font-size:14px;">Chưa có nhân viên nào chấm công hôm nay</div>`;

  return `
    <div style="margin-top:24px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <div style="font-size:16px;font-weight:700;color:var(--text);">👥 Nhân viên hôm nay <span style="color:var(--ocean-600);">(${groups.length})</span></div>
        <button id="adminRefreshBtn" type="button" style="padding:6px 12px;font-size:12px;background:var(--ocean-50);color:var(--ocean-700);border:1px solid var(--ocean-200);border-radius:8px;cursor:pointer;font-family:inherit;font-weight:600;">🔄</button>
      </div>
      <div style="background:#fff;border:1px solid var(--border);border-radius:12px;overflow:hidden;">
        ${rows}
      </div>
    </div>
  `;
}

function updateCheckinTabBadge() {
  const $tab = document.querySelector('[data-tab="checkin"]');
  if (!$tab) return;
  let $badge = $tab.querySelector('.checkin-badge');
  if (_unseenCheckinCount > 0) {
    if (!$badge) {
      $badge = document.createElement('span');
      $badge.className = 'checkin-badge';
      $badge.style.cssText = 'position:absolute;top:-2px;right:-4px;min-width:18px;height:18px;line-height:18px;background:#dc2626;color:white;border-radius:9px;padding:0 5px;font-size:11px;font-weight:700;text-align:center;box-sizing:border-box;box-shadow:0 2px 4px rgba(0,0,0,0.2);pointer-events:none;';
      $tab.style.position = 'relative';
      $tab.appendChild($badge);
    }
    $badge.textContent = _unseenCheckinCount > 99 ? '99+' : String(_unseenCheckinCount);
  } else if ($badge) {
    $badge.remove();
  }
}

async function checkAdminForNewCheckins() {
  if (!state.isAdmin) return;
  if (_checkingAdmin) return;
  _checkingAdmin = true;
  try {
    const beforeIds = new Set(_adminTodayCheckins.map(c => c.id));
    await loadAdminTodayCheckins();
    const newOnes = _adminTodayCheckins.filter(c => !beforeIds.has(c.id) && c.employee_id !== state.user?.id);
    if (newOnes.length === 0) return;

    try { playCheckinSound(); } catch {}

    if (newOnes.length === 1) {
      const c = newOnes[0];
      const label = (c.type === 'out') ? 'về' : 'đến';
      toast(`🔔 ${c.employee_name || 'NV'} vừa chấm công ${label}`);
    } else {
      toast(`🔔 ${newOnes.length} nhân viên vừa chấm công`);
    }

    const onCheckinTab = $('#tab-checkin')?.classList.contains('active');
    if (onCheckinTab) {
      _unseenCheckinCount = 0;
      updateCheckinTabBadge();
      renderCheckin();
    } else {
      _unseenCheckinCount += newOnes.length;
      updateCheckinTabBadge();
    }
  } finally {
    _checkingAdmin = false;
  }
}

function startAdminRealtime() {
  if (!state.isAdmin) return;
  if (_realtimeChannel) return;
  try {
    _realtimeChannel = supabase
      .channel('cslx_checkins_admin_watch')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'cslx_checkins',
      }, () => {
        checkAdminForNewCheckins().catch(err => console.warn('[rt]', err));
      })
      .subscribe();
  } catch (err) {
    console.warn('[rt subscribe]', err);
  }
}

function stopAdminRealtime() {
  if (_realtimeChannel) {
    try { supabase.removeChannel(_realtimeChannel); } catch {}
    _realtimeChannel = null;
  }
}

function startAdminPolling() {
  if (!state.isAdmin) return;
  if (_adminPollTimer) return;
  _adminPollTimer = setInterval(() => {
    if (!state.isAdmin) return;
    if (document.visibilityState !== 'visible') return;
    checkAdminForNewCheckins().catch(err => console.warn('[poll]', err));
  }, 15000);
}

function stopAdminPolling() {
  if (_adminPollTimer) {
    clearInterval(_adminPollTimer);
    _adminPollTimer = null;
  }
}

/* ═══════════════════════════════════════════════════════════════
   ENTRYPOINT
   ═══════════════════════════════════════════════════════════════ */
export async function loadCheckinTab() {
  ensureState();
  const $root = $('#checkinRoot');
  if (!state.user) {
    if ($root) $root.innerHTML = '<p class="hint" style="padding:24px;text-align:center;">Vui lòng đăng nhập</p>';
    return;
  }

  _unseenCheckinCount = 0;
  updateCheckinTabBadge();

  if (!state.isAdmin) {
    stopAdminRealtime();
    stopAdminPolling();
  }

  renderLoading();

  const tasks = [loadLocation(), loadTodayCheckins(), loadRecentLogs()];
  if (state.isAdmin) tasks.push(loadAdminTodayCheckins());
  await Promise.all(tasks);

  startGPSWatch();
  if (state.isAdmin) {
    bindAudioUnlock();
    startAdminRealtime();
    startAdminPolling();
  }

  const start = Date.now();
  while (!state.checkinUserPos && !state.checkinGpsError && Date.now() - start < 8000) {
    await new Promise(r => setTimeout(r, 200));
  }

  renderCheckin();
  bindModal();
  tryAutoCheckin();
}

function renderLoading() {
  const $root = $('#checkinRoot');
  if (!$root) return;
  $root.innerHTML = `
    <div style="text-align:center;padding:60px 20px;color:var(--text-muted);">
      <div style="font-size:48px;margin-bottom:16px;">📡</div>
      <div style="font-size:18px;font-weight:600;">Đang tìm vị trí...</div>
      <div style="font-size:14px;margin-top:8px;">Vui lòng đợi trong giây lát</div>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════════
   RENDER
   ═══════════════════════════════════════════════════════════════ */
function renderCheckin() {
  const $root = $('#checkinRoot');
  if (!$root) return;

  const userName = getUserName();
  const now = new Date();
  const nowStr = formatTime(now.toISOString());
  const dateStr = formatDateVN(now.toISOString());
  const currentState = getCurrentState();
  const loc = state.checkinLocation;
  const pos = state.checkinUserPos;
  const err = state.checkinGpsError;
  const distInfo = getDistanceInfo();

  const headerHtml = `
    <div style="text-align:center;margin-bottom:20px;">
      <div style="font-size:15px;color:var(--text-muted);">Xin chào</div>
      <div style="font-size:22px;font-weight:700;color:var(--text);margin-top:2px;line-height:1.3;">${userName}</div>
      <div style="font-size:14px;color:var(--text-muted);margin-top:8px;">${dateStr}</div>
      <div style="font-size:16px;font-weight:600;color:var(--ocean-700);margin-top:2px;">${nowStr}</div>
    </div>`;

  let statusHtml = '';
  if (!loc) {
    statusHtml = `
      <div style="padding:24px 20px;background:#fef3c7;border:2px solid #fbbf24;border-radius:14px;text-align:center;font-size:16px;color:#92400e;line-height:1.6;">
        <div style="font-size:20px;font-weight:700;margin-bottom:10px;">⚠ Chưa có điểm chấm công</div>
        <div>Vui lòng liên hệ quản lý để cài đặt.</div>
      </div>`;
  } else if (err) {
    statusHtml = `
      <div style="padding:24px 20px;background:#fee2e2;border:2px solid #fca5a5;border-radius:14px;text-align:center;font-size:16px;color:#991b1b;line-height:1.6;">
        <div style="font-size:20px;font-weight:700;margin-bottom:10px;">⚠ ${err}</div>
        <div style="font-size:13px;margin-top:8px;color:#7f1d1d;">Nếu vẫn không được, hãy gọi quản lý</div>
        <div style="margin-top:16px;">
          <button id="checkinRetryBtn" style="padding:14px 28px;font-size:16px;font-weight:700;background:#dc2626;color:#fff;border:none;border-radius:12px;cursor:pointer;font-family:inherit;">Thử lại</button>
        </div>
      </div>`;
  } else if (distInfo) {
    if (distInfo.inRange) {
      statusHtml = `
        <div id="checkinStatusCard" style="padding:26px 20px;background:#dcfce7;border:2px solid #86efac;border-radius:14px;text-align:center;">
          <div style="font-size:44px;margin-bottom:10px;color:#16a34a;line-height:1;">✓</div>
          <div style="font-size:22px;font-weight:700;color:#15803d;line-height:1.3;">BẠN ĐÃ ĐẾN TRƯỜNG</div>
          <div style="font-size:14px;color:#166534;margin-top:8px;">Cách điểm chấm ${Math.round(distInfo.distance)} mét</div>
        </div>`;
    } else {
      const remaining = Math.round(distInfo.distance - loc.radius_m);
      statusHtml = `
        <div id="checkinStatusCard" style="padding:26px 20px;background:#fef3c7;border:2px solid #fbbf24;border-radius:14px;text-align:center;">
          <div style="font-size:44px;margin-bottom:10px;line-height:1;">⚠</div>
          <div style="font-size:22px;font-weight:700;color:#92400e;line-height:1.3;">CHƯA ĐẾN TRƯỜNG</div>
          <div style="font-size:16px;color:#78350f;margin-top:12px;line-height:1.6;">
            Hãy đi bộ thêm<br>
            <strong style="font-size:22px;color:#b45309;">${remaining} mét</strong><br>
            đến cổng trường
          </div>
        </div>`;
    }
  } else {
    statusHtml = `
      <div style="padding:24px 20px;background:#e0e7ff;border:2px solid #a5b4fc;border-radius:14px;text-align:center;font-size:16px;color:#3730a3;">
        📡 Đang tìm vị trí... vui lòng đợi
      </div>`;
  }

  let actionHtml = '';
  if (currentState === 'need_in') {
    const can = !!(loc && pos && distInfo && distInfo.inRange);
    actionHtml = `
      <button id="checkinActionBtn" ${can ? '' : 'disabled'}
        style="width:100%;margin-top:20px;padding:30px 20px;font-size:24px;font-weight:700;font-family:inherit;
               background:${can ? 'linear-gradient(135deg,#16a34a,#15803d)' : '#cbd5e1'};
               color:white;border:none;border-radius:16px;cursor:${can ? 'pointer' : 'not-allowed'};
               box-shadow:${can ? '0 4px 12px rgba(22,163,74,0.4)' : 'none'};
               text-transform:uppercase;letter-spacing:0.5px;line-height:1.2;">
        CHẤM CÔNG ĐẾN
      </button>`;
  } else if (currentState === 'need_out') {
    const can = !!(loc && pos && distInfo && distInfo.inRange);
    const inTime = _todayCheckins[0] ? formatTime(_todayCheckins[0].checkin_at) : '—';
    actionHtml = `
      <div style="margin-top:16px;padding:16px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:12px;text-align:center;font-size:15px;color:var(--text);line-height:1.6;">
        Hôm nay đã chấm công lúc<br>
        <strong style="font-size:17px;color:#0369a1;">${inTime}</strong>
      </div>
      <button id="checkinActionBtn" ${can ? '' : 'disabled'}
        style="width:100%;margin-top:12px;padding:30px 20px;font-size:24px;font-weight:700;font-family:inherit;
               background:${can ? 'linear-gradient(135deg,#0891b2,#0e7490)' : '#cbd5e1'};
               color:white;border:none;border-radius:16px;cursor:${can ? 'pointer' : 'not-allowed'};
               box-shadow:${can ? '0 4px 12px rgba(8,145,178,0.4)' : 'none'};
               text-transform:uppercase;letter-spacing:0.5px;line-height:1.2;">
        CHẤM CÔNG VỀ
      </button>`;
  } else {
    const inTime = _todayCheckins[0] ? formatTime(_todayCheckins[0].checkin_at) : '—';
    const outTime = _todayCheckins[1] ? formatTime(_todayCheckins[1].checkin_at) : '—';
    const totalMs = _todayCheckins.length >= 2
      ? new Date(_todayCheckins[1].checkin_at) - new Date(_todayCheckins[0].checkin_at)
      : 0;
    actionHtml = `
      <div style="margin-top:20px;padding:28px 20px;background:#dcfce7;border:2px solid #86efac;border-radius:14px;text-align:center;">
        <div style="font-size:44px;margin-bottom:10px;line-height:1;">🎉</div>
        <div style="font-size:20px;font-weight:700;color:#15803d;margin-bottom:14px;">HOÀN THÀNH HÔM NAY</div>
        <div style="font-size:16px;color:#166534;line-height:1.9;">
          <div>Đến: <strong>${inTime}</strong></div>
          <div>Về: <strong>${outTime}</strong></div>
          ${totalMs > 0 ? `<div style="margin-top:10px;padding-top:10px;border-top:1px dashed #86efac;font-size:17px;">Tổng: <strong>${formatDuration(totalMs)}</strong></div>` : ''}
        </div>
      </div>`;
  }

  const adminTodayHtml = state.isAdmin ? renderAdminTodaySection() : '';
  const logsHtml = renderRecentLogs(_recentLogs);

  const adminBtn = state.isAdmin
    ? `<button id="checkinSettingsBtn" style="position:absolute;top:12px;right:12px;padding:8px 14px;font-size:13px;background:#fff;border:1px solid var(--border);border-radius:8px;cursor:pointer;font-family:inherit;color:var(--text-muted);box-shadow:0 1px 3px rgba(0,0,0,0.05);">⚙️ Cài đặt</button>`
    : '';

  $root.innerHTML = `
    <div style="position:relative;padding:0 0 24px;">
      ${adminBtn}
      ${headerHtml}
      ${statusHtml}
      ${actionHtml}
      ${adminTodayHtml}
      <div style="margin-top:32px;">
        <div style="font-size:16px;font-weight:700;color:var(--text);margin-bottom:12px;">📅 Gần đây</div>
        ${logsHtml}
      </div>
    </div>
  `;

  const $retry = $('#checkinRetryBtn');
  if ($retry) $retry.onclick = () => {
    stopCheckinWatch();
    state.checkinUserPos = null;
    state.checkinGpsError = null;
    renderLoading();
    setTimeout(() => {
      startGPSWatch();
      if (state.isAdmin) { startAdminRealtime(); startAdminPolling(); }
      setTimeout(() => renderCheckin(), 800);
    }, 200);
  };

  const $action = $('#checkinActionBtn');
  if ($action && !$action.disabled) $action.onclick = handleActionClick;

  const $settings = $('#checkinSettingsBtn');
  if ($settings) $settings.onclick = openSettingsModal;

  const $adminRefresh = $('#adminRefreshBtn');
  if ($adminRefresh) {
    $adminRefresh.onclick = async () => {
      $adminRefresh.disabled = true;
      $adminRefresh.textContent = '⏳';
      try {
        await loadAdminTodayCheckins();
        renderCheckin();
      } catch (err) {
        console.warn('[admin refresh]', err);
      }
    };
  }
}

function updateLiveStatus() {
  const $card = $('#checkinStatusCard');
  if (!$card) return;
  const loc = state.checkinLocation;
  if (!loc) return;
  const distInfo = getDistanceInfo();
  if (!distInfo) return;

  const wasInRange = $card.textContent.includes('ĐÃ ĐẾN TRƯỜNG');
  if (wasInRange !== distInfo.inRange) {
    renderCheckin();
    return;
  }
  if (!distInfo.inRange) {
    const $strong = $card.querySelector('strong');
    if ($strong) {
      const remaining = Math.round(distInfo.distance - loc.radius_m);
      $strong.textContent = `${remaining} mét`;
    }
  }
}

function renderRecentLogs(logs) {
  if (!logs.length) {
    return `<div style="padding:24px 16px;background:#fff;border:1px solid var(--border);border-radius:12px;text-align:center;font-size:15px;color:var(--text-muted);">
      Chưa có lần chấm công nào
    </div>`;
  }

  const byDate = {};
  logs.forEach(l => {
    if (!byDate[l.checkin_date]) byDate[l.checkin_date] = [];
    byDate[l.checkin_date].push(l);
  });

  const dates = Object.keys(byDate).sort().reverse().slice(0, 5);
  const todayStr = toDateStr(new Date());

  return `<div style="background:#fff;border:1px solid var(--border);border-radius:12px;overflow:hidden;">
    ${dates.map(d => {
      const dayLogs = byDate[d].slice().sort((a, b) => new Date(a.checkin_at) - new Date(b.checkin_at));
      const ins = dayLogs.filter(l => l.type === 'in' || l.type === undefined || l.type === null);
      const outs = dayLogs.filter(l => l.type === 'out');
      const inTime = ins[0] ? formatTime(ins[0].checkin_at) : null;
      const outTime = outs[0] ? formatTime(outs[0].checkin_at) : null;

      let summary = '';
      if (inTime && outTime) {
        const totalMs = new Date(outs[0].checkin_at) - new Date(ins[0].checkin_at);
        summary = `<div style="font-size:14px;color:#15803d;margin-top:4px;line-height:1.6;">Đến ${inTime} · Về ${outTime}<br>Tổng ${formatDuration(totalMs)}</div>`;
      } else if (inTime) {
        summary = `<div style="font-size:14px;color:#d97706;margin-top:4px;">Đến ${inTime} · Chưa chấm về</div>`;
      }

      const dateLabel = d === todayStr ? 'Hôm nay' : formatDateShort(d);

      return `<div style="padding:14px 16px;border-bottom:1px solid var(--border);">
        <div style="font-size:15px;font-weight:700;color:var(--text);">${dateLabel}</div>
        ${summary}
      </div>`;
    }).join('')}
  </div>`;
}

/* ═══════════════════════════════════════════════════════════════
   ACTIONS
   ═══════════════════════════════════════════════════════════════ */
function handleActionClick() {
  const currentState = getCurrentState();
  const now = new Date();
  const nowStr = formatTime(now.toISOString());
  const dateStr = formatDateVN(now.toISOString());

  if (currentState === 'need_in') {
    showConfirmModal('CHẤM CÔNG ĐẾN', nowStr, dateStr, () => doCheckin('in'));
  } else if (currentState === 'need_out') {
    showConfirmModal('CHẤM CÔNG VỀ', nowStr, dateStr, () => doCheckin('out'));
  }
}

function showConfirmModal(title, timeStr, dateStr, onConfirm) {
  let $m = document.getElementById('checkinConfirmModal');
  if (!$m) {
    const html = `
      <div id="checkinConfirmModal" class="modal-overlay" style="display:none;z-index:10001;align-items:center;justify-content:center;">
        <div style="background:#fff;border-radius:18px;max-width:380px;width:calc(100% - 32px);margin:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
          <div style="padding:32px 24px;text-align:center;">
            <div id="checkinConfirmTitle" style="font-size:22px;font-weight:700;margin-bottom:20px;color:var(--text);"></div>
            <div style="font-size:15px;color:var(--text-muted);margin-bottom:8px;">Cô muốn chấm công lúc:</div>
            <div id="checkinConfirmTime" style="font-size:24px;font-weight:700;color:var(--ocean-700);margin:12px 0;line-height:1.3;"></div>
            <div id="checkinConfirmDate" style="font-size:15px;color:var(--text-muted);margin-bottom:28px;"></div>
            <div style="display:flex;gap:10px;">
              <button id="checkinConfirmCancel" style="flex:1;padding:18px;font-size:18px;font-weight:600;font-family:inherit;background:#f1f5f9;color:var(--text);border:1px solid var(--border);border-radius:12px;cursor:pointer;">
                HUỶ
              </button>
              <button id="checkinConfirmOk" style="flex:1;padding:18px;font-size:18px;font-weight:700;font-family:inherit;background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;border:none;border-radius:12px;cursor:pointer;">
                ĐỒNG Ý ✓
              </button>
            </div>
          </div>
        </div>
      </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
    $m = document.getElementById('checkinConfirmModal');
  }

  document.getElementById('checkinConfirmTitle').textContent = title;
  document.getElementById('checkinConfirmTime').textContent = timeStr;
  document.getElementById('checkinConfirmDate').textContent = dateStr;
  $m.style.display = 'flex';

  document.getElementById('checkinConfirmCancel').onclick = () => { $m.style.display = 'none'; };
  document.getElementById('checkinConfirmOk').onclick = () => { $m.style.display = 'none'; onConfirm(); };
}

async function doCheckin(type) {
  if (_anyCheckinInFlight) { toast('Đang xử lý, vui lòng đợi'); return; }
  if (!state.checkinUserPos || !state.checkinLocation) {
    toast('Đang tìm vị trí... vui lòng đợi thêm');
    return;
  }
  const loc = state.checkinLocation;
  const pos = state.checkinUserPos;
  const dist = haversine(pos.lat, pos.lng, loc.lat, loc.lng);

  if (dist > loc.radius_m) {
    toast(`Bạn đang cách ${Math.round(dist)} mét — chưa đến trường`);
    return;
  }

  _anyCheckinInFlight = true;
  try {
    const { error } = await supabase.from('cslx_checkins').insert({
      employee_id: state.user.id,
      employee_name: getUserName(),
      checkin_date: toDateStr(new Date()),
      type,
      lat: pos.lat,
      lng: pos.lng,
      accuracy_m: pos.accuracy,
      distance_m: dist,
      device_info: (navigator.userAgent || '').slice(0, 200),
    });
    if (error) throw error;

    try { navigator.vibrate([100, 50, 200]); } catch {}

    showSuccessModal(type);

    await loadTodayCheckins();
    await loadRecentLogs();
    renderCheckin();
  } catch (err) {
    console.error('[checkin]', err);
    toast('Lỗi: ' + (err.message || 'không xác định'));
  } finally {
    _anyCheckinInFlight = false;
  }
}

function showSuccessModal(type, isAuto = false) {
  const title = type === 'in'
    ? (isAuto ? 'ĐÃ TỰ ĐỘNG CHẤM CÔNG ĐẾN' : 'CHẤM CÔNG ĐẾN THÀNH CÔNG')
    : 'CHẤM CÔNG VỀ THÀNH CÔNG';
  const now = new Date();

  let $m = document.getElementById('checkinSuccessModal');
  if (!$m) {
    const html = `
      <div id="checkinSuccessModal" class="modal-overlay" style="display:none;z-index:10002;background:rgba(0,0,0,0.75);align-items:center;justify-content:center;">
        <div style="background:#fff;border-radius:20px;max-width:360px;width:calc(100% - 40px);margin:auto;box-shadow:0 20px 60px rgba(0,0,0,0.4);">
          <div style="padding:44px 24px;text-align:center;">
            <div style="font-size:88px;color:#16a34a;line-height:1;margin-bottom:24px;">✓</div>
            <div id="checkinSuccessTitle" style="font-size:22px;font-weight:700;color:#15803d;margin-bottom:20px;line-height:1.3;"></div>
            <div id="checkinSuccessTime" style="font-size:24px;font-weight:700;color:var(--text);margin-bottom:8px;"></div>
            <div id="checkinSuccessDate" style="font-size:15px;color:var(--text-muted);"></div>
            <div id="checkinSuccessNote" style="font-size:13px;color:#15803d;margin-top:14px;line-height:1.5;display:none;"></div>
          </div>
        </div>
      </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
    $m = document.getElementById('checkinSuccessModal');
  }

  document.getElementById('checkinSuccessTitle').textContent = title;
  document.getElementById('checkinSuccessTime').textContent = formatTime(now.toISOString());
  document.getElementById('checkinSuccessDate').textContent = formatDateVN(now.toISOString());

  const $note = document.getElementById('checkinSuccessNote');
  if ($note) {
    if (isAuto) {
      $note.style.display = 'block';
      $note.textContent = 'Hệ thống tự chấm công khi bạn vào trường.';
    } else {
      $note.style.display = 'none';
    }
  }

  $m.style.display = 'flex';

  setTimeout(() => {
    if ($m) $m.style.display = 'none';
  }, isAuto ? 4500 : 3500);
}

/* ═══════════════════════════════════════════════════════════════
   SETTINGS (chỉ admin)
   ═══════════════════════════════════════════════════════════════ */
function openSettingsModal() {
  if (!state.isAdmin) return;
  if (!state.checkinUserPos) {
    toast('Đang tìm vị trí, đợi thêm vài giây');
    return;
  }
  const pos = state.checkinUserPos;
  const currentRadius = state.checkinLocation?.radius_m || DEFAULT_RADIUS;

  const $coords = $('#checkinUpdateCoords');
  if ($coords) {
    $coords.innerHTML = `<div>${pos.lat.toFixed(6)}, ${pos.lng.toFixed(6)}</div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Độ chính xác GPS: ±${Math.round(pos.accuracy)}m</div>`;
  }
  const $radius = $('#checkinRadiusInput');
  if ($radius) $radius.value = currentRadius;

  openModal('checkinUpdateModal');
}

async function handleConfirmUpdateLocation() {
  if (!state.checkinUserPos) { toast('Đang tìm vị trí'); return; }
  const radius = parseInt($('#checkinRadiusInput')?.value || '0', 10);
  if (isNaN(radius) || radius < 20 || radius > 1000) {
    toast('Bán kính phải từ 20 đến 1000 mét');
    return;
  }

  const $btn = $('#checkinUpdateConfirmBtn');
  if ($btn) { $btn.disabled = true; $btn.textContent = '⏳ Đang lưu...'; }

  try {
    const pos = state.checkinUserPos;
    const { error } = await supabase
      .from('cslx_checkin_location')
      .upsert({
        id: LOCATION_ID,
        lat: pos.lat,
        lng: pos.lng,
        radius_m: radius,
        updated_by: state.user.id,
        updated_by_name: getUserName(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });

    if (error) throw error;

    toast(`Đã cập nhật · Bán kính ${radius} mét`);
    closeModal('checkinUpdateModal');
    await loadLocation();
    renderCheckin();
  } catch (err) {
    console.error('[checkin] update:', err);
    toast('Lỗi: ' + (err.message || 'không xác định'));
  } finally {
    if ($btn) { $btn.disabled = false; $btn.textContent = 'Xác nhận'; }
  }
}

function bindModal() {
  const $confirm = $('#checkinUpdateConfirmBtn');
  if ($confirm && !$confirm.dataset.bound) {
    $confirm.dataset.bound = '1';
    $confirm.addEventListener('click', handleConfirmUpdateLocation);
  }
}