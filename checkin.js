// checkin.js — Tab check-in GPS (chỉ admin)
import { supabase } from './supabase.js';
import { state, $, toast, openModal, closeModal, toDateStr } from './core.js';

const LOCATION_ID = 1;
const DEFAULT_RADIUS = 100;
const MAX_ACCURACY_WARN = 100;

function ensureState() {
  if (!state.checkinLocation) state.checkinLocation = null;
  if (!state.checkinLogs) state.checkinLogs = [];
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

function getGPS() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject({ code: 0, message: 'Trình duyệt không hỗ trợ GPS' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy || 0,
        timestamp: pos.timestamp,
      }),
      err => reject(err),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

async function refreshGPS() {
  state.checkinGpsError = null;
  try {
    state.checkinUserPos = await getGPS();
  } catch (err) {
    state.checkinUserPos = null;
    let msg = 'Không lấy được GPS';
    if (err.code === 1) msg = 'Bạn chưa cho phép truy cập vị trí. Vào Cài đặt → Safari → Vị trí để bật.';
    else if (err.code === 2) msg = 'GPS không khả dụng. Kiểm tra đã bật định vị chưa.';
    else if (err.code === 3) msg = 'Hết thời gian lấy GPS. Thử lại ở nơi thoáng hơn.';
    else if (err.message) msg = err.message;
    state.checkinGpsError = msg;
    console.warn('[checkin] GPS error:', err);
  }
}

async function loadLocation() {
  const { data, error } = await supabase
    .from('cslx_checkin_location')
    .select('*')
    .eq('id', LOCATION_ID)
    .maybeSingle();
  if (error) {
    console.error('[checkin] load location:', error);
    return;
  }
  state.checkinLocation = data || null;
}

async function loadLogs() {
  if (!state.user?.id) return;
  const { data, error } = await supabase
    .from('cslx_checkins')
    .select('*')
    .eq('employee_id', state.user.id)
    .order('checkin_at', { ascending: false })
    .limit(30);
  if (error) {
    console.error('[checkin] load logs:', error);
    return;
  }
  state.checkinLogs = data || [];
}

function getUserName() {
  const emp = (state.employees || []).find(e => e.id === state.user?.id);
  return emp?.full_name || emp?.username || state.user?.email || 'Admin';
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

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  } catch { return '—'; }
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch { return '—'; }
}

export async function loadCheckinTab() {
  ensureState();
  renderLoading();

  await Promise.all([loadLocation(), loadLogs()]);
  await refreshGPS();

  renderCheckin();
  bindModal();
}

function renderLoading() {
  const $root = $('#checkinRoot');
  if (!$root) return;
  $root.innerHTML = `
    <div style="text-align:center;padding:48px 20px;color:var(--text-muted);">
      <div style="font-size:28px;margin-bottom:10px;">📡</div>
      <div style="font-size:13px;">Đang lấy vị trí GPS...</div>
    </div>`;
}

function renderCheckin() {
  const $root = $('#checkinRoot');
  if (!$root) return;

  const loc = state.checkinLocation;
  const pos = state.checkinUserPos;
  const err = state.checkinGpsError;
  const distInfo = getDistanceInfo();

  let statusCard = '';
  if (!loc) {
    statusCard = `
      <div style="padding:16px;background:#fef3c7;border:1px solid #fbbf24;border-radius:10px;font-size:13px;color:#92400e;line-height:1.6;">
        <strong>⚠️ Chưa cấu hình vị trí</strong><br>
        Đứng tại vị trí muốn đặt điểm check-in, bấm <strong>"Cập nhật định vị"</strong>.
      </div>`;
  } else if (err) {
    statusCard = `
      <div style="padding:16px;background:#fee2e2;border:1px solid #fca5a5;border-radius:10px;font-size:13px;color:#991b1b;line-height:1.6;">
        <strong>⚠️ Lỗi GPS</strong><br>
        ${err}
        <div style="margin-top:10px;">
          <button id="checkinRetryGpsBtn" style="padding:8px 14px;font-size:12px;font-weight:600;background:#dc2626;color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:inherit;">🔄 Thử lấy GPS lại</button>
        </div>
      </div>`;
  } else if (distInfo) {
    const ok = distInfo.inRange;
    const color = ok ? '#16a34a' : '#dc2626';
    const bg = ok ? '#dcfce7' : '#fee2e2';
    const border = ok ? '#86efac' : '#fca5a5';
    const icon = ok ? '✅' : '❌';
    const txt = ok ? 'TRONG PHẠM VI' : 'NGOÀI PHẠM VI';

    const accuracyWarn = distInfo.accuracy > MAX_ACCURACY_WARN
      ? `<div style="margin-top:8px;padding:6px 8px;background:#fef3c7;border-radius:6px;font-size:12px;color:#92400e;">⚠️ GPS chính xác thấp (±${Math.round(distInfo.accuracy)}m) — nên ra chỗ thoáng hơn</div>`
      : '';

    statusCard = `
      <div style="padding:14px;background:${bg};border:1px solid ${border};border-radius:10px;font-size:13px;color:${color};line-height:1.6;">
        <div style="font-weight:700;font-size:15px;margin-bottom:8px;">${icon} ${txt}</div>
        <div style="display:flex;gap:14px;flex-wrap:wrap;color:var(--text);font-size:12.5px;">
          <span>📏 Cách điểm: <strong>${Math.round(distInfo.distance)}m</strong></span>
          <span>⭕ Bán kính: <strong>${distInfo.radius}m</strong></span>
          <span>📡 GPS: <strong>±${Math.round(distInfo.accuracy)}m</strong></span>
        </div>
        ${accuracyWarn}
      </div>`;
  }

  let locationCard = '';
  if (loc) {
    locationCard = `
      <div style="padding:12px 14px;background:#fff;border:1px solid var(--border);border-radius:10px;margin-top:10px;font-size:12px;color:var(--text-muted);line-height:1.7;">
        <div style="font-weight:700;color:var(--text);font-size:13px;margin-bottom:4px;">📍 Điểm định vị</div>
        <div>Toạ độ: <strong style="color:var(--text);">${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)}</strong></div>
        <div>Bán kính: <strong style="color:var(--text);">${loc.radius_m}m</strong></div>
        <div>Cập nhật: ${formatTime(loc.updated_at)} ${formatDate(loc.updated_at)}${loc.updated_by_name ? ' · ' + loc.updated_by_name : ''}</div>
      </div>`;
  }

  const canCheckin = !!(loc && pos && distInfo && distInfo.inRange);
  const logsHtml = renderLogs(state.checkinLogs);

  $root.innerHTML = `
    <div style="padding:0 0 20px;">
      ${statusCard}
      ${locationCard}

      <div style="display:flex;gap:8px;margin-top:14px;">
        <button id="checkinUpdateLocBtn" class="btn-secondary" style="flex:1;padding:12px;font-size:14px;">🔄 Cập nhật định vị</button>
        <button id="checkinDoBtn" class="btn-primary" style="flex:1;padding:12px;font-size:14px;${!canCheckin ? 'opacity:0.5;cursor:not-allowed;' : ''}" ${!canCheckin ? 'disabled' : ''}>📍 Check in</button>
      </div>

      <div style="margin-top:22px;">
        <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:8px;">📜 Lịch sử check-in</div>
        ${logsHtml}
      </div>
    </div>
  `;

  const $retry = $('#checkinRetryGpsBtn');
  if ($retry) $retry.onclick = handleRetryGPS;

  const $update = $('#checkinUpdateLocBtn');
  if ($update) $update.onclick = handleOpenUpdateModal;

  const $do = $('#checkinDoBtn');
  if ($do && canCheckin) $do.onclick = handleCheckin;
}

function renderLogs(logs) {
  if (!logs.length) {
    return '<p class="hint" style="margin:0;padding:16px;text-align:center;font-size:12px;">Chưa có check-in nào</p>';
  }
  return `
    <div style="background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden;">
      ${logs.map(l => `
        <div style="padding:10px 14px;border-bottom:1px solid var(--border);font-size:13px;">
          <div style="font-weight:600;color:var(--text);">✅ ${formatTime(l.checkin_at)} · ${formatDate(l.checkin_at)}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:3px;">
            📏 ${Math.round(l.distance_m || 0)}m · 📡 ±${Math.round(l.accuracy_m || 0)}m
          </div>
        </div>
      `).join('')}
    </div>`;
}

async function handleRetryGPS() {
  renderLoading();
  await refreshGPS();
  renderCheckin();
}

function handleOpenUpdateModal() {
  if (!state.checkinUserPos) {
    toast('Chưa có GPS. Bấm "Thử lấy GPS lại" trước.');
    return;
  }
  const pos = state.checkinUserPos;
  const currentRadius = state.checkinLocation?.radius_m || DEFAULT_RADIUS;

  const $coords = $('#checkinUpdateCoords');
  if ($coords) {
    $coords.innerHTML = `
      <div>${pos.lat.toFixed(6)}, ${pos.lng.toFixed(6)}</div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Độ chính xác GPS: ±${Math.round(pos.accuracy)}m</div>
    `;
  }
  const $radius = $('#checkinRadiusInput');
  if ($radius) $radius.value = currentRadius;

  openModal('checkinUpdateModal');
}

async function handleConfirmUpdateLocation() {
  if (!state.checkinUserPos) {
    toast('Không có GPS');
    return;
  }
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

    toast(`✅ Đã cập nhật vị trí · Bán kính ${radius}m`);
    closeModal('checkinUpdateModal');
    await loadLocation();
    renderCheckin();
  } catch (err) {
    console.error('[checkin] update location:', err);
    toast('Lỗi: ' + (err.message || 'không xác định'));
  } finally {
    if ($btn) { $btn.disabled = false; $btn.textContent = 'Xác nhận'; }
  }
}

async function handleCheckin() {
  const $btn = $('#checkinDoBtn');
  if ($btn) { $btn.disabled = true; $btn.textContent = '⏳ Đang check-in...'; }

  try {
    await refreshGPS();

    if (!state.checkinUserPos) {
      toast('Không lấy được GPS: ' + (state.checkinGpsError || 'lỗi không rõ'));
      renderCheckin();
      return;
    }
    const loc = state.checkinLocation;
    if (!loc) {
      toast('Chưa có điểm định vị');
      renderCheckin();
      return;
    }
    const pos = state.checkinUserPos;
    const dist = haversine(pos.lat, pos.lng, loc.lat, loc.lng);

    if (dist > loc.radius_m) {
      toast(`Bạn đang cách ${Math.round(dist)}m — vượt quá bán kính ${loc.radius_m}m`);
      renderCheckin();
      return;
    }

    const { error } = await supabase.from('cslx_checkins').insert({
      employee_id: state.user.id,
      employee_name: getUserName(),
      checkin_date: toDateStr(new Date()),
      lat: pos.lat,
      lng: pos.lng,
      accuracy_m: pos.accuracy,
      distance_m: dist,
      device_info: (navigator.userAgent || '').slice(0, 200),
    });

    if (error) throw error;

    toast('✅ Check-in thành công!');
    await loadLogs();
    renderCheckin();
  } catch (err) {
    console.error('[checkin] checkin:', err);
    toast('Lỗi check-in: ' + (err.message || 'không xác định'));
    renderCheckin();
  }
}

function bindModal() {
  const $confirm = $('#checkinUpdateConfirmBtn');
  if ($confirm && !$confirm.dataset.bound) {
    $confirm.dataset.bound = '1';
    $confirm.addEventListener('click', handleConfirmUpdateLocation);
  }
  const $overlay = $('#checkinUpdateModal');
  if ($overlay && !$overlay.dataset.bound) {
    $overlay.dataset.bound = '1';
    $overlay.addEventListener('click', (e) => {
      if (e.target.id === 'checkinUpdateModal') closeModal('checkinUpdateModal');
    });
  }
}