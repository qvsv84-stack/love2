import { supabase } from './supabase.js';
import { state, $, toast, openModal, closeModal, toDateStr } from './core.js';
import {
  checkEnvironment, getPermissionState, watchPermission,
  getCurrentOnce, startWatch, GeoError
} from './geo.js';

const LOCATION_ID = 1;
const DEFAULT_RADIUS = 150;

// ─────────────────────── State cục bộ ───────────────────────
let _watchHandle = null;
let _renderTimer = null;
let _todayCheckins = [];
let _anyCheckinInFlight = false;
let _autoCheckinCooldown = 0;
let _adminTodayCheckins = [];
let _realtimeChannel = null;
let _adminPollTimer = null;
let _audioCtx = null;
let _checkingAdmin = false;
let _unseenCheckinCount = 0;
let _audioUnlockBound = false;
let _historyDefaultEmpId = '';
let _historyMode = 'day';

// GPS UI state machine
let _gpsState = 'idle'; 
// idle | checking_env | insecure | unsupported | in_app | need_gesture | 
// requesting | denied | unavailable | timeout | searching | ready | unknown
let _gpsMeta = { platform: null, inApp: false, standalone: false, rawError: null };

function ensureState(){
  if (!state.checkinLocation) state.checkinLocation = null;
  if (!state.checkinUserPos) state.checkinUserPos = null;
  if (!state.checkinGpsError) state.checkinGpsError = null;
}

// ─────────────────────── Haversine ───────────────────────
function haversine(lat1, lng1, lat2, lng2){
  const R = 6371000, toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─────────────────────── GPS flow ───────────────────────
/**
 * Bước 1: check môi trường (HTTPS, support, in-app)
 * Bước 2: nếu permission = granted → watch luôn
 * Bước 3: nếu permission = prompt → KHÔNG gọi watch, mà chuyển UI sang "cần bấm nút"
 * Bước 4: nếu permission = denied → hiện hướng dẫn, watch thay đổi khi user fix
 */
async function initGPSFlow(){
  _gpsState = 'checking_env';
  scheduleRender(true);

  const env = await checkEnvironment();
  _gpsMeta = { platform: env.platform, inApp: env.inApp, standalone: env.standalone, rawError: null };

  if (!env.ok) {
    _gpsState = env.code === GeoError.INSECURE ? 'insecure'
              : env.code === GeoError.UNSUPPORTED ? 'unsupported'
              : env.code === GeoError.IN_APP ? 'in_app'
              : 'unknown';
    state.checkinGpsError = _gpsState;
    scheduleRender(true);
    return;
  }

  const perm = await getPermissionState();

  if (perm === 'granted') {
    _gpsState = 'searching';
    state.checkinGpsError = null;
    scheduleRender(true);
    _startWatchSilent();
    return;
  }

  if (perm === 'denied') {
    _gpsState = 'denied';
    state.checkinGpsError = 'denied';
    scheduleRender(true);
    // Theo dõi khi user vào Settings bật lại
    watchPermission(newPerm => {
      if (newPerm === 'granted') {
        _gpsState = 'searching';
        state.checkinGpsError = null;
        scheduleRender(true);
        _startWatchSilent();
      }
    });
    return;
  }

  // perm === 'prompt' hoặc 'unknown'
  // → KHÔNG gọi watch. Đợi user bấm nút "Bật định vị".
  _gpsState = 'need_gesture';
  state.checkinGpsError = null;
  scheduleRender(true);
}

/**
 * Bắt buộc gọi trong user gesture (sau cú tap).
 * Trigger permission popup bằng getCurrentOnce, sau đó mới watch.
 */
async function requestAndStartGPS(){
  if (_gpsState === 'requesting') return;
  _gpsState = 'requesting';
  state.checkinGpsError = null;
  scheduleRender(true);

  const result = await getCurrentOnce({ timeout: 25000, highAccuracy: true });

  if (!result.ok) {
    _gpsState = result.code === GeoError.DENIED ? 'denied'
              : result.code === GeoError.UNAVAILABLE ? 'unavailable'
              : result.code === GeoError.TIMEOUT ? 'timeout'
              : 'unknown';
    _gpsMeta.rawError = result.rawError;
    state.checkinGpsError = _gpsState;
    scheduleRender(true);
    return;
  }

  // Có vị trí → lưu + bắt đầu watch
  state.checkinUserPos = {
    lat: result.pos.coords.latitude,
    lng: result.pos.coords.longitude,
    accuracy: result.pos.coords.accuracy || 0,
    timestamp: result.pos.timestamp,
  };
  _gpsState = 'ready';
  state.checkinGpsError = null;
  scheduleRender(true);
  tryAutoCheckin();

  _startWatchSilent();
}

function _startWatchSilent(){
  if (_watchHandle) _watchHandle.cancel();
  _watchHandle = startWatch({
    highAccuracy: true,
    maximumAge: 5000,
    onPos: pos => {
      state.checkinUserPos = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy || 0,
        timestamp: pos.timestamp,
      };
      if (_gpsState !== 'ready') _gpsState = 'ready';
      state.checkinGpsError = null;
      scheduleRender();
      tryAutoCheckin();
    },
    onErr: (code, err) => {
      // Không override vị trí cũ nếu chỉ là timeout
      if (state.checkinUserPos && code === GeoError.TIMEOUT) return;
      _gpsState = code === GeoError.DENIED ? 'denied'
                : code === GeoError.UNAVAILABLE ? 'unavailable'
                : code === GeoError.TIMEOUT ? 'timeout'
                : 'unknown';
      _gpsMeta.rawError = err;
      state.checkinGpsError = _gpsState;
      scheduleRender(true);
    },
  });
}

export function stopCheckinWatch(){
  if (_watchHandle) { _watchHandle.cancel(); _watchHandle = null; }
  clearTimeout(_renderTimer);
  stopAdminRealtime();
  stopAdminPolling();
}

// ─────────────────────── Render ───────────────────────
function scheduleRender(immediate = false){
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

// ─── Helpers định dạng ───
function formatTime(iso){ try{ const d=new Date(iso),h=d.getHours(),m=d.getMinutes();const period=h<12?'sáng':h<18?'chiều':'tối';const dh=h===0?12:h>12?h-12:h;return `${dh} giờ ${String(m).padStart(2,'0')} phút ${period}`; }catch{return '—'} }
function formatHHMM(iso){ try{ const d=new Date(iso); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }catch{return '—'} }
function formatHHMMPeriod(iso){ try{ const d=new Date(iso),h=d.getHours(),m=d.getMinutes(); const p=h<12?'sáng':h<18?'chiều':'tối'; return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')} ${p}`; }catch{return '—'} }
function formatDateVN(iso){ try{ const d=new Date(iso),days=['Chủ nhật','Thứ 2','Thứ 3','Thứ 4','Thứ 5','Thứ 6','Thứ 7']; return `${days[d.getDay()]}, ${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`; }catch{return '—'} }
function formatDateCompact(iso){ try{ const d=new Date(iso); return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`; }catch{return '—'} }
function formatDateShort(dateStr){ try{ const p=dateStr.split('-'); return `${p[2]}/${p[1]}/${p[0]}`; }catch{return dateStr} }
function formatDuration(ms){ const t=Math.round(ms/6e4),h=Math.floor(t/60),m=t%60; return h===0?`${m} phút`:m===0?`${h} giờ`:`${h} giờ ${m} phút`; }
function formatDurationShort(ms){ const t=Math.round(ms/6e4),h=Math.floor(t/60),m=t%60; return h===0?`${m}p`:m===0?`${h}h`:`${h}h${m}p`; }

function getUserName(){
  const emp = (state.employees || []).find(e => e.id === state.user?.id);
  return emp?.full_name || emp?.username || state.user?.email || '';
}
function getDistanceInfo(){
  if (!state.checkinLocation || !state.checkinUserPos) return null;
  const loc = state.checkinLocation, pos = state.checkinUserPos;
  const dist = haversine(pos.lat, pos.lng, loc.lat, loc.lng);
  return { distance: dist, radius: loc.radius_m, inRange: dist <= loc.radius_m, accuracy: pos.accuracy };
}
function getCurrentState(){
  if (_todayCheckins.length === 0) return 'need_in';
  if (_todayCheckins.length === 1) return 'need_out';
  return 'done';
}

// ─── Load data ───
async function loadLocation(){
  const { data, error } = await supabase.from('cslx_checkin_location').select('*').eq('id', LOCATION_ID).maybeSingle();
  if (error) { console.error('[checkin] location:', error); return; }
  state.checkinLocation = data || null;
}
async function loadTodayCheckins(){
  if (!state.user?.id) return;
  const today = toDateStr(new Date());
  const { data, error } = await supabase.from('cslx_checkins').select('*')
    .eq('employee_id', state.user.id).eq('checkin_date', today)
    .order('checkin_at', { ascending: true });
  if (error) { console.error(error); _todayCheckins = []; return; }
  _todayCheckins = data || [];
}
async function loadAdminTodayCheckins(){
  if (!state.isAdmin) { _adminTodayCheckins = []; return; }
  const today = toDateStr(new Date());
  const { data, error } = await supabase.from('cslx_checkins').select('*')
    .eq('checkin_date', today).order('checkin_at', { ascending: true });
  if (error) { console.error('[admin checkins]', error); _adminTodayCheckins = []; return; }
  _adminTodayCheckins = data || [];
}

// ─────────────────────── Render UI theo state ───────────────────────
function renderStatusCard(){
  const loc = state.checkinLocation;
  const pos = state.checkinUserPos;
  const distInfo = getDistanceInfo();

  // Chưa có config location
  if (!loc) {
    return `<div style="padding:24px 20px;background:#fef3c7;border:2px solid #fbbf24;border-radius:14px;text-align:center;font-size:16px;color:#92400e;line-height:1.6;">
      <div style="font-size:20px;font-weight:700;margin-bottom:10px;">⚠ Chưa có điểm chấm công</div>
      <div>Vui lòng liên hệ quản lý để cài đặt.</div>
    </div>`;
  }

  // Render theo _gpsState
  switch (_gpsState) {
    case 'checking_env':
      return _cardNeutral('📡', 'Đang kiểm tra môi trường...', '');

    case 'insecure': {
      const proto = (location.protocol || '').replace(':', '').toUpperCase();
      return _cardError('🔒 Trang không dùng HTTPS',
        `Trang đang chạy qua <b>${proto}</b> — trình duyệt <b>chặn cứng GPS</b>.<br>Vui lòng mở bằng <b>https://</b>.`,
        null);
    }

    case 'unsupported':
      return _cardError('⚠ Trình duyệt không hỗ trợ GPS', 'Vui lòng dùng Chrome hoặc Safari mới nhất.', null);

    case 'in_app':
      return _cardError('⚠ Trình duyệt trong ứng dụng',
        `Bạn đang mở trang bằng <b>trình duyệt trong ứng dụng</b> (Zalo / Facebook / Messenger...). Các trình duyệt này <b>không cho phép lấy GPS</b>.<br><br>
        <b>Cách khắc phục:</b><br>
        1. Bấm nút <b>⋮</b> hoặc <b>...</b> ở góc trên bên phải<br>
        2. Chọn <b>"Mở bằng trình duyệt"</b> / <b>"Mở bằng Chrome"</b><br><br>
        Nếu không có tuỳ chọn đó:<br>
        • Giữ thanh địa chỉ → <b>Copy link</b><br>
        • Mở app <b>Chrome</b> → dán link → Enter`,
        null);

    case 'need_gesture':
      // Không phải lỗi — chỉ là chưa xin quyền. Hiển thị nút to.
      return _cardNeutral('📍', 'Cần cấp quyền vị trí',
        `<div style="text-align:center;margin-top:14px;">
          <button id="gpsRequestBtn" style="padding:16px 32px;font-size:17px;font-weight:700;background:linear-gradient(135deg,#0ea5b7,#0891b2);color:#fff;border:none;border-radius:14px;cursor:pointer;font-family:inherit;box-shadow:0 4px 14px rgba(14,165,183,0.4);">
            🔓 Bật định vị ngay
          </button>
          <div style="font-size:12px;color:#3730a3;margin-top:12px;line-height:1.5;">
            Bấm nút trên → Chrome sẽ hỏi quyền → chọn <b>Cho phép</b>
          </div>
        </div>`);

    case 'requesting':
      return _cardNeutral('📡', 'Đang chờ bạn cấp quyền...',
        '<div style="font-size:13px;margin-top:8px;color:#3730a3;">Nếu Chrome hiện popup, hãy bấm <b>Cho phép</b></div>');

    case 'denied': {
      const isAndroid = _gpsMeta.platform === 'android';
      const isIOS = _gpsMeta.platform === 'ios';
      let hint = '';
      if (isAndroid) {
        hint = `
          <b>1️⃣ Cấp quyền cho trang web:</b><br>
          • Bấm vào biểu tượng <b>🔒 / ⚙️</b> trên thanh địa chỉ<br>
          • Chọn <b>Quyền (Permissions)</b> → <b>Vị trí (Location)</b> → <b>Cho phép (Allow)</b><br><br>
          <b>2️⃣ Nếu không thấy 🔒:</b><br>
          • Chrome → <b>⋮</b> → Cài đặt → <b>Cài đặt trang web</b> → <b>Vị trí</b><br>
          • Xoá domain này khỏi danh sách <b>"Không được phép"</b><br><br>
          <b>3️⃣ Cấp quyền hệ thống:</b><br>
          • Cài đặt Android → Ứng dụng → <b>Chrome</b> → Quyền → <b>Vị trí</b> → Cho phép<br>
          • Bật thêm <b>Vị trí chính xác (Precise Location)</b>`;
      } else if (isIOS) {
        hint = `
          <b>1️⃣ Bấm aA bên trái thanh địa chỉ</b> → <b>Cài đặt trang web</b> → <b>Vị trí</b> → Cho phép<br><br>
          <b>2️⃣ Cài đặt iOS</b> → Safari → Vị trí → Cho phép<br><br>
          <b>3️⃣ Cài đặt iOS</b> → Quyền riêng tư → Dịch vụ định vị → Bật + chọn <b>"Vị trí chính xác"</b>`;
      } else {
        hint = 'Vào Cài đặt trình duyệt → Quyền → Vị trí → Cho phép.';
      }
      return _cardError('🔒 Chưa có quyền vị trí', hint,
        `<button id="gpsRetryBtn" style="padding:14px 28px;font-size:16px;font-weight:700;background:#dc2626;color:#fff;border:none;border-radius:12px;cursor:pointer;font-family:inherit;">Đã cấp quyền — Thử lại</button>`);
    }

    case 'unavailable':
      return _cardError('📍 GPS chưa bật',
        `Vị trí (Location) trên điện thoại đang <b>TẮT</b>.<br><br>
        <b>Cách bật:</b><br>
        • Vuốt từ trên cùng xuống → bấm giữ biểu tượng <b>Vị trí</b><br>
        • Hoặc: Cài đặt → Vị trí → Bật<br>
        • Bật thêm <b>Vị trí chính xác (Precise Location)</b>`,
        `<button id="gpsRetryBtn" style="padding:14px 28px;font-size:16px;font-weight:700;background:#dc2626;color:#fff;border:none;border-radius:12px;cursor:pointer;font-family:inherit;">Thử lại</button>`);

    case 'timeout':
      return _cardError('⏱ Không lấy được GPS',
        `Có thể do: đang trong nhà, GPS chưa fix, hoặc mạng yếu.<br><br>
        <b>Thử:</b> ra ngoài trời, bật WiFi (giúp định vị nhanh hơn), rồi bấm Thử lại.`,
        `<button id="gpsRetryBtn" style="padding:14px 28px;font-size:16px;font-weight:700;background:#dc2626;color:#fff;border:none;border-radius:12px;cursor:pointer;font-family:inherit;">Thử lại</button>`);

    case 'unknown':
      return _cardError('⚠ Không lấy được vị trí',
        `Lỗi không xác định. Thử tải lại trang hoặc dùng trình duyệt khác.`,
        `<button id="gpsRetryBtn" style="padding:14px 28px;font-size:16px;font-weight:700;background:#dc2626;color:#fff;border:none;border-radius:12px;cursor:pointer;font-family:inherit;">Thử lại</button>`);

    case 'searching':
      return _cardNeutral('📡', 'Đang tìm vị trí...',
        '<div style="font-size:13px;margin-top:8px;color:#3730a3;">Vui lòng đợi vài giây</div>');

    case 'ready': {
      if (!distInfo) return _cardNeutral('📡', 'Đang tải...', '');
      const poorAccuracy = pos && pos.accuracy > Math.max(80, loc.radius_m * 1.5);
      const accuracyNote = poorAccuracy
        ? `<div style="font-size:12px;color:#78350f;margin-top:10px;line-height:1.4;">⚠ GPS yếu (±${Math.round(pos.accuracy)}m) — nếu sai vị trí, hãy ra ngoài trời</div>`
        : '';

      if (distInfo.inRange) {
        return `<div id="checkinStatusCard" style="padding:26px 20px;background:#dcfce7;border:2px solid #86efac;border-radius:14px;text-align:center;">
          <div style="font-size:44px;margin-bottom:10px;color:#16a34a;line-height:1;">✓</div>
          <div style="font-size:22px;font-weight:700;color:#15803d;line-height:1.3;">BẠN ĐÃ ĐẾN TRƯỜNG</div>
          <div style="font-size:14px;color:#166534;margin-top:8px;">Cách điểm chấm ${Math.round(distInfo.distance)} mét</div>
          ${accuracyNote}
        </div>`;
      }
      const remaining = Math.round(distInfo.distance - loc.radius_m);
      return `<div id="checkinStatusCard" style="padding:26px 20px;background:#fef3c7;border:2px solid #fbbf24;border-radius:14px;text-align:center;">
        <div style="font-size:44px;margin-bottom:10px;line-height:1;">⚠</div>
        <div style="font-size:22px;font-weight:700;color:#92400e;line-height:1.3;">CHƯA ĐẾN TRƯỜNG</div>
        <div style="font-size:16px;color:#78350f;margin-top:12px;line-height:1.6;">Hãy đi bộ thêm<br><strong style="font-size:22px;color:#b45309;">${remaining} mét</strong><br>đến cổng trường</div>
        ${accuracyNote}
      </div>`;
    }

    default:
      return _cardNeutral('📡', 'Đang khởi động GPS...', '');
  }
}

function _cardNeutral(icon, title, extra){
  return `<div style="padding:24px 20px;background:#e0e7ff;border:2px solid #a5b4fc;border-radius:14px;text-align:center;color:#3730a3;">
    <div style="font-size:40px;margin-bottom:10px;line-height:1;">${icon}</div>
    <div style="font-size:18px;font-weight:700;">${title}</div>
    ${extra}
  </div>`;
}
function _cardError(title, hintHtml, extraBtnHtml){
  return `<div style="padding:22px 20px;background:#fee2e2;border:2px solid #fca5a5;border-radius:14px;color:#991b1b;line-height:1.7;">
    <div style="font-size:19px;font-weight:700;margin-bottom:12px;text-align:center;">⚠ ${title}</div>
    <div style="font-size:13.5px;">${hintHtml}</div>
    ${extraBtnHtml ? `<div style="margin-top:18px;text-align:center;">${extraBtnHtml}</div>` : ''}
  </div>`;
}

// ─────────────────────── renderCheckin tổng ───────────────────────
function renderCheckin(){
  const $root = $('#checkinRoot');
  if (!$root) return;

  const userName = getUserName();
  const now = new Date();
  const currentState = getCurrentState();
  const loc = state.checkinLocation;
  const pos = state.checkinUserPos;
  const distInfo = getDistanceInfo();

  const headerHtml = `<div style="text-align:center;margin-bottom:20px;">
    <div style="font-size:22px;font-weight:700;color:var(--text);line-height:1.3;">${userName}</div>
    <div style="font-size:14px;color:var(--text-muted);margin-top:6px;">${formatDateCompact(now.toISOString())} · ${formatHHMMPeriod(now.toISOString())}</div>
  </div>`;

  const statusHtml = renderStatusCard();

  let actionHtml = '';
  const canCheckin = _gpsState === 'ready' && pos && distInfo && distInfo.inRange && loc;

  if (currentState === 'need_in') {
    actionHtml = `<button id="checkinActionBtn" ${canCheckin ? '' : 'disabled'} style="width:100%;margin-top:20px;padding:30px 20px;font-size:24px;font-weight:700;font-family:inherit;background:${canCheckin ? 'linear-gradient(135deg,#16a34a,#15803d)' : '#cbd5e1'};color:white;border:none;border-radius:16px;cursor:${canCheckin ? 'pointer' : 'not-allowed'};box-shadow:${canCheckin ? '0 4px 12px rgba(22,163,74,0.4)' : 'none'};text-transform:uppercase;letter-spacing:0.5px;line-height:1.2;">CHẤM CÔNG ĐẾN</button>`;
  } else if (currentState === 'need_out') {
    const inTime = _todayCheckins[0] ? formatHHMMPeriod(_todayCheckins[0].checkin_at) : '—';
    actionHtml = `<div style="margin-top:16px;padding:16px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:12px;text-align:center;font-size:15px;color:var(--text);line-height:1.6;">Hôm nay đã chấm công lúc<br><strong style="font-size:17px;color:#0369a1;">${inTime}</strong></div>
    <button id="checkinActionBtn" ${canCheckin ? '' : 'disabled'} style="width:100%;margin-top:12px;padding:30px 20px;font-size:24px;font-weight:700;font-family:inherit;background:${canCheckin ? 'linear-gradient(135deg,#0891b2,#0e7490)' : '#cbd5e1'};color:white;border:none;border-radius:16px;cursor:${canCheckin ? 'pointer' : 'not-allowed'};box-shadow:${canCheckin ? '0 4px 12px rgba(8,145,178,0.4)' : 'none'};text-transform:uppercase;letter-spacing:0.5px;line-height:1.2;">CHẤM CÔNG VỀ</button>`;
  } else {
    const inTime = _todayCheckins[0] ? formatHHMMPeriod(_todayCheckins[0].checkin_at) : '—';
    const outTime = _todayCheckins[1] ? formatHHMMPeriod(_todayCheckins[1].checkin_at) : '—';
    const totalMs = _todayCheckins.length >= 2 ? new Date(_todayCheckins[1].checkin_at) - new Date(_todayCheckins[0].checkin_at) : 0;
    actionHtml = `<div style="margin-top:20px;padding:28px 20px;background:#dcfce7;border:2px solid #86efac;border-radius:14px;text-align:center;">
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
  const adminBtn = state.isAdmin ? '<button id="checkinSettingsBtn" style="position:absolute;top:12px;right:12px;padding:8px 14px;font-size:13px;background:#fff;border:1px solid var(--border);border-radius:8px;cursor:pointer;font-family:inherit;color:var(--text-muted);box-shadow:0 1px 3px rgba(0,0,0,0.05);">⚙️ Cài đặt</button>' : '';

  $root.innerHTML = `<div style="position:relative;padding:0 0 24px;">
    ${adminBtn}${headerHtml}${statusHtml}${actionHtml}${adminTodayHtml}
    <div style="margin-top:24px;">
      <button id="openHistoryBtn" type="button" style="width:100%;padding:16px 20px;font-size:15px;font-weight:700;background:#fff;color:var(--ocean-700);border:1.5px solid var(--ocean-200);border-radius:14px;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 1px 3px rgba(0,0,0,0.04);">📜 Xem lịch sử chấm công</button>
    </div>
  </div>`;

  // Bind các nút theo state
  const $gpsReq = $('#gpsRequestBtn');
  if ($gpsReq) $gpsReq.onclick = () => { requestAndStartGPS().catch(e => console.warn('[gps request]', e)); };

  const $gpsRetry = $('#gpsRetryBtn');
  if ($gpsRetry) $gpsRetry.onclick = () => {
    // Reset state và thử lại (vẫn phải qua gesture → requestAndStartGPS)
    _gpsState = 'need_gesture';
    state.checkinGpsError = null;
    requestAndStartGPS().catch(e => console.warn('[gps retry]', e));
  };

  const $action = $('#checkinActionBtn');
  if ($action && !$action.disabled) $action.onclick = handleActionClick;

  const $settings = $('#checkinSettingsBtn');
  if ($settings) $settings.onclick = openSettingsModal;

  const $history = $('#openHistoryBtn');
  if ($history) $history.onclick = () => openHistoryModal('');

  bindAdminDeleteButtons();
}

function updateLiveStatus(){
  const $card = $('#checkinStatusCard');
  if (!$card) return;
  if (!state.checkinLocation) return;
  const distInfo = getDistanceInfo();
  if (!distInfo) return;
  const wasInRange = $card.textContent.includes('ĐÃ ĐẾN TRƯỜNG');
  if (wasInRange !== distInfo.inRange) { renderCheckin(); return; }
  if (!distInfo.inRange) {
    const $strong = $card.querySelector('strong');
    if ($strong) {
      const remaining = Math.round(distInfo.distance - state.checkinLocation.radius_m);
      $strong.textContent = `${remaining} mét`;
    }
  }
}

// ─────────────────────── Action ───────────────────────
function handleActionClick(){
  const currentState = getCurrentState();
  const now = new Date();
  const nowStr = formatTime(now.toISOString());
  const dateStr = formatDateVN(now.toISOString());
  if (currentState === 'need_in') showConfirmModal('CHẤM CÔNG ĐẾN', nowStr, dateStr, () => doCheckin('in'));
  else if (currentState === 'need_out') showConfirmModal('CHẤM CÔNG VỀ', nowStr, dateStr, () => doCheckin('out'));
}

function showConfirmModal(title, timeStr, dateStr, onConfirm){
  let $m = document.getElementById('checkinConfirmModal');
  if (!$m) {
    const html = `<div id="checkinConfirmModal" class="modal-overlay" style="display:none;z-index:10001;align-items:center;justify-content:center;">
      <div style="background:#fff;border-radius:18px;max-width:380px;width:calc(100% - 32px);margin:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
        <div style="padding:32px 24px;text-align:center;">
          <div id="checkinConfirmTitle" style="font-size:22px;font-weight:700;margin-bottom:20px;color:var(--text);"></div>
          <div style="font-size:15px;color:var(--text-muted);margin-bottom:8px;">Bạn muốn chấm công lúc:</div>
          <div id="checkinConfirmTime" style="font-size:24px;font-weight:700;color:var(--ocean-700);margin:12px 0;line-height:1.3;"></div>
          <div id="checkinConfirmDate" style="font-size:15px;color:var(--text-muted);margin-bottom:28px;"></div>
          <div style="display:flex;gap:10px;">
            <button id="checkinConfirmCancel" style="flex:1;padding:18px;font-size:18px;font-weight:600;font-family:inherit;background:#f1f5f9;color:var(--text);border:1px solid var(--border);border-radius:12px;cursor:pointer;">HUỶ</button>
            <button id="checkinConfirmOk" style="flex:1;padding:18px;font-size:18px;font-weight:700;font-family:inherit;background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;border:none;border-radius:12px;cursor:pointer;">ĐỒNG Ý ✓</button>
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

async function doCheckin(type){
  if (_anyCheckinInFlight) { toast('Đang xử lý, vui lòng đợi'); return; }
  if (!state.checkinUserPos || !state.checkinLocation) { toast('Đang tìm vị trí... vui lòng đợi thêm'); return; }
  const loc = state.checkinLocation, pos = state.checkinUserPos;
  const dist = haversine(pos.lat, pos.lng, loc.lat, loc.lng);
  if (dist > loc.radius_m) { toast(`Bạn đang cách ${Math.round(dist)} mét — chưa đến trường`); return; }
  _anyCheckinInFlight = true;
  try {
    const { error } = await supabase.from('cslx_checkins').insert({
      employee_id: state.user.id,
      employee_name: getUserName(),
      checkin_date: toDateStr(new Date()),
      type, lat: pos.lat, lng: pos.lng,
      accuracy_m: pos.accuracy, distance_m: dist,
      device_info: (navigator.userAgent || '').slice(0, 200),
    });
    if (error) throw error;
    try { navigator.vibrate([100, 50, 200]); } catch {}
    showSuccessModal(type);
    await loadTodayCheckins();
    renderCheckin();
  } catch (err) {
    console.error('[checkin]', err);
    toast('Lỗi: ' + (err.message || 'không xác định'));
  } finally {
    _anyCheckinInFlight = false;
  }
}

function showSuccessModal(type, isAuto = false){
  const title = type === 'in'
    ? isAuto ? 'ĐÃ TỰ ĐỘNG CHẤM CÔNG ĐẾN' : 'CHẤM CÔNG ĐẾN THÀNH CÔNG'
    : 'CHẤM CÔNG VỀ THÀNH CÔNG';
  const now = new Date();
  let $m = document.getElementById('checkinSuccessModal');
  if (!$m) {
    const html = `<div id="checkinSuccessModal" class="modal-overlay" style="display:none;z-index:10002;background:rgba(0,0,0,0.75);align-items:center;justify-content:center;">
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
    if (isAuto) { $note.style.display = 'block'; $note.textContent = 'Hệ thống tự chấm công khi bạn vào trường.'; }
    else { $note.style.display = 'none'; }
  }
  $m.style.display = 'flex';
  setTimeout(() => { if ($m) $m.style.display = 'none'; }, isAuto ? 4500 : 3500);
}

// ─────────────────────── Auto checkin ───────────────────────
async function tryAutoCheckin(){
  if (_anyCheckinInFlight) return;
  if (Date.now() < _autoCheckinCooldown) return;
  if (!state.user?.id) return;
  if (getCurrentState() !== 'need_in') return;
  const distInfo = getDistanceInfo();
  if (!distInfo || !distInfo.inRange) return;
  await doAutoCheckin();
}
async function doAutoCheckin(){
  const loc = state.checkinLocation, pos = state.checkinUserPos;
  if (!loc || !pos) return;
  const dist = haversine(pos.lat, pos.lng, loc.lat, loc.lng);
  _anyCheckinInFlight = true;
  try {
    const { error } = await supabase.from('cslx_checkins').insert({
      employee_id: state.user.id,
      employee_name: getUserName(),
      checkin_date: toDateStr(new Date()),
      type: 'in', lat: pos.lat, lng: pos.lng,
      accuracy_m: pos.accuracy, distance_m: dist,
      device_info: 'AUTO · ' + (navigator.userAgent || '').slice(0, 180),
    });
    if (error) throw error;
    try { navigator.vibrate([100, 50, 200]); } catch {}
    await loadTodayCheckins();
    renderCheckin();
    showSuccessModal('in', true);
  } catch (err) {
    console.error('[auto-checkin]', err);
    _autoCheckinCooldown = Date.now() + 30000;
  } finally {
    _anyCheckinInFlight = false;
  }
}

// ─────────────────────── Admin section (giữ nguyên) ───────────────────────
// ... (phần admin + history + realtime + audio + settings giữ như file cũ,
// không thay đổi vì không liên quan GPS)
// Để giữ response gọn, tôi đã lược phần này — copy từ checkin.js cũ nguyên văn.

// ─────────────────────── Entry point ───────────────────────
export async function loadCheckinTab(){
  ensureState();
  const $root = $('#checkinRoot');
  if (!state.user) {
    if ($root) $root.innerHTML = '<p class="hint" style="padding:24px;text-align:center;">Vui lòng đăng nhập</p>';
    return;
  }
  _unseenCheckinCount = 0;
  updateCheckinTabBadge();
  if (!state.isAdmin) { stopAdminRealtime(); stopAdminPolling(); }

  // Loading
  if ($root) $root.innerHTML = `<div style="text-align:center;padding:60px 20px;color:var(--text-muted);">
    <div style="font-size:48px;margin-bottom:16px;">📡</div>
    <div style="font-size:18px;font-weight:600;">Đang tải...</div>
  </div>`;

  const tasks = [loadLocation(), loadTodayCheckins()];
  if (state.isAdmin) tasks.push(loadAdminTodayCheckins());
  await Promise.all(tasks);

  if (state.isAdmin) { bindAudioUnlock(); startAdminRealtime(); startAdminPolling(); }

  // GPS flow (KHÔNG tự gọi getCurrentPosition ngầm nữa)
  await initGPSFlow();

  renderCheckin();
  bindModal();
}

// ... (phần admin/history/audio/settings — copy nguyên từ file cũ,
//     chỉ cần đảm bảo bindModal vẫn có)
function bindModal(){
  const $confirm = $('#checkinUpdateConfirmBtn');
  if ($confirm && !$confirm.dataset.bound) {
    $confirm.dataset.bound = '1';
    $confirm.addEventListener('click', handleConfirmUpdateLocation);
  }
}

// ... các hàm admin/history/audio/settings khác (không đổi)