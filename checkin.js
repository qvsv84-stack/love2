import { supabase } from './supabase.js';
import { state, $, toast, openModal, closeModal, toDateStr } from './core.js';

const LOCATION_ID = 1;
let _todayCheckins = [];
let _anyCheckinInFlight = false;
let _adminTodayCheckins = [];
let _realtimeChannel = null;
let _checkingAdmin = false;
let _unseenCheckinCount = 0;
let _historyMode = 'day';
let _currentIP = null;
let _isCheckingNetwork = false;

function ensureState(){
  if (!state.checkinLocation) state.checkinLocation = null;
}

// ─────────────────────── LẤY IP PUBLIC ───────────────────────
async function getPublicIP() {
  try {
    // Dùng 2 API dự phòng để đảm bảo không bao giờ lỗi
    const res = await fetch('https://api.ipify.org?format=json');
    if (res.ok) {
      const data = await res.json();
      return data.ip;
    }
    const res2 = await fetch('https://ipapi.co/json/');
    if (res2.ok) {
      const data2 = await res2.json();
      return data2.ip;
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function checkNetworkStatus() {
  _isCheckingNetwork = true;
  _currentIP = await getPublicIP();
  _isCheckingNetwork = false;
}

// ─────────────────────── HELPERS ───────────────────────
function formatTime(iso){ try{ const d=new Date(iso),h=d.getHours(),m=d.getMinutes();const p=h<12?'sáng':h<18?'chiều':'tối';return `${h===0?12:h>12?h-12:h} giờ ${String(m).padStart(2,'0')} phút ${p}`; }catch{return '—'} }
function formatHHMM(iso){ try{ const d=new Date(iso); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }catch{return '—'} }
function formatHHMMPeriod(iso){ try{ const d=new Date(iso),h=d.getHours(),m=d.getMinutes(); const p=h<12?'sáng':h<18?'chiều':'tối'; return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')} ${p}`; }catch{return '—'} }
function formatDateVN(iso){ try{ const d=new Date(iso),days=['Chủ nhật','Thứ 2','Thứ 3','Thứ 4','Thứ 5','Thứ 6','Thứ 7']; return `${days[d.getDay()]}, ${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`; }catch{return '—'} }
function formatDateCompact(iso){ try{ const d=new Date(iso); return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`; }catch{return '—'} }
function formatDateShort(dateStr){ try{ const p=dateStr.split('-'); return `${p[2]}/${p[1]}/${p[0]}`; }catch{return dateStr} }
function formatDuration(ms){ const t=Math.round(ms/6e4),h=Math.floor(t/60),m=t%60; return h===0?`${m} phút`:m===0?`${h} giờ`:`${h} giờ ${m} phút`; }

function getUserName(){
  const emp = (state.employees || []).find(e => e.id === state.user?.id);
  return emp?.full_name || emp?.username || state.user?.email || '';
}
function getCurrentState(){
  if (_todayCheckins.length === 0) return 'need_in';
  if (_todayCheckins.length === 1) return 'need_out';
  return 'done';
}

// ─────────────────────── LOAD DATA ───────────────────────
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

// ─────────────────────── RENDER GIAO DIỆN ───────────────────────
function renderCheckin(){
  const $root = $('#checkinRoot');
  if (!$root) return;

  const userName = getUserName();
  const now = new Date();
  const currentState = getCurrentState();
  const loc = state.checkinLocation;

  const headerHtml = `<div style="text-align:center;margin-bottom:20px;">
    <div style="font-size:24px;font-weight:700;color:var(--text);line-height:1.3;">${userName}</div>
    <div style="font-size:15px;color:var(--text-muted);margin-top:6px;">${formatDateCompact(now.toISOString())} · ${formatHHMMPeriod(now.toISOString())}</div>
  </div>`;

  // 1. Kiểm tra xem đã cấu hình IP trường chưa
  let statusHtml = '';
  let actionHtml = '';
  
  if (!loc) {
    statusHtml = `<div style="padding:24px; background:#fef3c7; border:2px solid #fbbf24; border-radius:14px; text-align:center; color:#92400e; font-size:16px;">
      ⚠ Chưa cấu hình điểm chấm công.<br>Vui lòng báo Quản lý.
    </div>`;
  } 
  else if (_isCheckingNetwork) {
    statusHtml = `<div style="padding:24px; background:#e0e7ff; border:2px solid #a5b4fc; border-radius:14px; text-align:center; color:#3730a3; font-size:18px; font-weight:600;">
      📡 Đang kiểm tra kết nối mạng...
    </div>`;
  }
  else {
    const allowedIPs = loc.allowed_ips || [];
    const isConnectedToSchool = _currentIP && allowedIPs.includes(_currentIP);

    if (isConnectedToSchool) {
      statusHtml = `<div style="padding:26px 20px; background:#dcfce7; border:2px solid #86efac; border-radius:14px; text-align:center;">
        <div style="font-size:48px; margin-bottom:10px; color:#16a34a; line-height:1;">✓</div>
        <div style="font-size:22px; font-weight:700; color:#15803d; line-height:1.3;">ĐÃ KẾT NỐI WIFI TRƯỜNG</div>
        <div style="font-size:14px; color:#166534; margin-top:8px;">Sẵn sàng chấm công</div>
      </div>`;
    } else {
      statusHtml = `<div style="padding:26px 20px; background:#fee2e2; border:2px solid #fca5a5; border-radius:14px; text-align:center;">
        <div style="font-size:48px; margin-bottom:10px; line-height:1;">📵</div>
        <div style="font-size:20px; font-weight:700; color:#991b1b; line-height:1.3; margin-bottom:8px;">CHƯA KẾT NỐI WIFI TRƯỜNG</div>
        <div style="font-size:15px; color:#7f1d1d; line-height:1.6;">
          Vui lòng bật WiFi và kết nối vào mạng của trường.<br>
          <span style="font-size:12px; color:#b91c1c; margin-top:10px; display:block;">(Mã mạng của bạn: ${_currentIP || 'Đang ẩn'})</span>
        </div>
        <button id="btnRetryWifi" style="margin-top:16px; padding:12px 24px; font-size:15px; font-weight:700; background:#fff; color:#dc2626; border:2px solid #dc2626; border-radius:10px; cursor:pointer;">🔄 Kiểm tra lại</button>
      </div>`;
    }

    // 2. Nút Chấm Công
    const canCheckin = isConnectedToSchool;
    if (currentState === 'need_in') {
      actionHtml = `<button id="checkinActionBtn" ${canCheckin ? '' : 'disabled'} style="width:100%; margin-top:20px; padding:30px 20px; font-size:26px; font-weight:700; font-family:inherit; background:${canCheckin ? 'linear-gradient(135deg,#16a34a,#15803d)' : '#cbd5e1'}; color:white; border:none; border-radius:16px; cursor:${canCheckin ? 'pointer' : 'not-allowed'}; box-shadow:${canCheckin ? '0 4px 12px rgba(22,163,74,0.4)' : 'none'}; text-transform:uppercase; letter-spacing:0.5px;">CHẤM CÔNG ĐẾN</button>`;
    } else if (currentState === 'need_out') {
      const inTime = _todayCheckins[0] ? formatHHMMPeriod(_todayCheckins[0].checkin_at) : '—';
      actionHtml = `<div style="margin-top:16px; padding:16px; background:#f0f9ff; border:1px solid #bae6fd; border-radius:12px; text-align:center; font-size:15px; color:var(--text);">
        Hôm nay đã chấm công lúc<br><strong style="font-size:17px; color:#0369a1;">${inTime}</strong>
      </div>
      <button id="checkinActionBtn" ${canCheckin ? '' : 'disabled'} style="width:100%; margin-top:12px; padding:30px 20px; font-size:26px; font-weight:700; font-family:inherit; background:${canCheckin ? 'linear-gradient(135deg,#0891b2,#0e7490)' : '#cbd5e1'}; color:white; border:none; border-radius:16px; cursor:${canCheckin ? 'pointer' : 'not-allowed'}; box-shadow:${canCheckin ? '0 4px 12px rgba(8,145,178,0.4)' : 'none'}; text-transform:uppercase; letter-spacing:0.5px;">CHẤM CÔNG VỀ</button>`;
    } else {
      const inTime = _todayCheckins[0] ? formatHHMMPeriod(_todayCheckins[0].checkin_at) : '—';
      const outTime = _todayCheckins[1] ? formatHHMMPeriod(_todayCheckins[1].checkin_at) : '—';
      const totalMs = _todayCheckins.length >= 2 ? new Date(_todayCheckins[1].checkin_at) - new Date(_todayCheckins[0].checkin_at) : 0;
      actionHtml = `<div style="margin-top:20px; padding:28px 20px; background:#dcfce7; border:2px solid #86efac; border-radius:14px; text-align:center;">
        <div style="font-size:44px; margin-bottom:10px; line-height:1;">🎉</div>
        <div style="font-size:20px; font-weight:700; color:#15803d; margin-bottom:14px;">HOÀN THÀNH HÔM NAY</div>
        <div style="font-size:16px; color:#166534; line-height:1.9;">
          <div>Đến: <strong>${inTime}</strong></div>
          <div>Về: <strong>${outTime}</strong></div>
          ${totalMs > 0 ? `<div style="margin-top:10px; padding-top:10px; border-top:1px dashed #86efac; font-size:17px;">Tổng: <strong>${formatDuration(totalMs)}</strong></div>` : ''}
        </div>
      </div>`;
    }
  }

  const adminTodayHtml = state.isAdmin ? renderAdminTodaySection() : '';
  const adminBtn = state.isAdmin ? '<button id="checkinSettingsBtn" style="position:absolute; top:12px; right:12px; padding:8px 14px; font-size:13px; background:#fff; border:1px solid var(--border); border-radius:8px; cursor:pointer; font-family:inherit; color:var(--text-muted); box-shadow:0 1px 3px rgba(0,0,0,0.05);">⚙️ Cài đặt IP</button>' : '';

  $root.innerHTML = `<div style="position:relative; padding:0 0 24px;">
    ${adminBtn}${headerHtml}${statusHtml}${actionHtml}${adminTodayHtml}
    <div style="margin-top:24px;">
      <button id="openHistoryBtn" type="button" style="width:100%; padding:16px 20px; font-size:15px; font-weight:700; background:#fff; color:var(--ocean-700); border:1.5px solid var(--ocean-200); border-radius:14px; cursor:pointer; font-family:inherit; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:0 1px 3px rgba(0,0,0,0.04);">📜 Xem lịch sử chấm công</button>
    </div>
  </div>`;

  // Bind nút
  const $btnRetry = $('#btnRetryWifi');
  if ($btnRetry) $btnRetry.onclick = async () => {
    $btnRetry.textContent = '⏳ Đang kiểm tra...';
    await checkNetworkStatus();
    renderCheckin();
  };

  const $action = $('#checkinActionBtn');
  if ($action && !$action.disabled) $action.onclick = handleActionClick;

  const $settings = $('#checkinSettingsBtn');
  if ($settings) $settings.onclick = openSettingsModal;

  const $history = $('#openHistoryBtn');
  if ($history) $history.onclick = () => openHistoryModal('');

  bindAdminDeleteButtons();
}

// ─────────────────────── CHẤM CÔNG ───────────────────────
function handleActionClick(){
  const currentState = getCurrentState();
  const now = new Date();
  const nowStr = formatTime(now.toISOString());
  const dateStr = formatDateVN(now.toISOString());
  if (currentState === 'need_in') showConfirmModal('CHẤM CÔNG ĐẾN', nowStr, dateStr, () => doCheckin('in'));
  else if (currentState === 'need_out') showConfirmModal('CHẤM CÔNG VỀ', nowStr, dateStr, () => doCheckin('out'));
}

async function doCheckin(type){
  if (_anyCheckinInFlight) return;
  _anyCheckinInFlight = true;
  try {
    const { error } = await supabase.from('cslx_checkins').insert({
      employee_id: state.user.id,
      employee_name: getUserName(),
      checkin_date: toDateStr(new Date()),
      type,
      device_info: `IP: ${_currentIP || 'unknown'} | ` + (navigator.userAgent || '').slice(0, 150),
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

// ─────────────────────── CÀI ĐẶT IP CHO ADMIN ───────────────────────
async function openSettingsModal(){
  if (!state.isAdmin) return;
  
  // Lấy IP hiện tại của Admin
  const currentIp = await getPublicIP();
  const loc = state.checkinLocation;
  const currentAllowed = loc?.allowed_ips || [];
  
  const $coords = $('#checkinUpdateCoords');
  if ($coords) {
    $coords.innerHTML = `
      <div style="font-size:18px; font-weight:bold; color:var(--ocean-700);">${currentIp || 'Không lấy được IP'}</div>
      <div style="font-size:12px; color:var(--text-muted); margin-top:4px;">Địa chỉ IP mạng đang kết nối</div>
    `;
  }

  // Hiển thị danh sách IP đã có
  const $list = $('#checkinIpList');
  if ($list) {
    if (currentAllowed.length === 0) {
      $list.innerHTML = `<div style="color:#b45309; font-size:13px;">Chưa có IP nào được cấu hình.</div>`;
    } else {
      $list.innerHTML = currentAllowed.map(ip => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:#f1f5f9; border-radius:8px; margin-bottom:6px; border:1px solid #e2e8f0;">
          <span style="font-weight:600; font-size:14px;">${ip}</span>
          <button class="btn-remove-ip" data-ip="${ip}" style="background:#fee2e2; color:#dc2626; border:none; padding:4px 10px; border-radius:6px; font-size:12px; font-weight:bold; cursor:pointer;">Xoá</button>
        </div>
      `).join('');
      
      // Gắn sự kiện xoá
      $list.querySelectorAll('.btn-remove-ip').forEach(btn => {
        btn.onclick = async () => {
          const ipToRemove = btn.dataset.ip;
          const newIps = currentAllowed.filter(i => i !== ipToRemove);
          await supabase.from('cslx_checkin_location').update({ allowed_ips: newIps }).eq('id', LOCATION_ID);
          toast('Đã xoá IP');
          await loadLocation();
          openSettingsModal(); // Mở lại để refresh
        };
      });
    }
  }

  // Nút thêm IP hiện tại
  const $btnAdd = $('#btnAddCurrentIp');
  if ($btnAdd) {
    if (currentIp && !currentAllowed.includes(currentIp)) {
      $btnAdd.style.display = 'block';
      $btnAdd.onclick = async () => {
        const newIps = [...currentAllowed, currentIp];
        await supabase.from('cslx_checkin_location').upsert({ id: LOCATION_ID, allowed_ips: newIps }, { onConflict: 'id' });
        toast(`Đã thêm IP ${currentIp}`);
        await loadLocation();
        openSettingsModal(); // Mở lại để refresh
      };
    } else {
      $btnAdd.style.display = 'none';
    }
  }

  openModal('checkinUpdateModal');
}

// ─────────────────────── KHỞI TẠO TAB ───────────────────────
export async function loadCheckinTab(){
  ensureState();
  const $root = $('#checkinRoot');
  if (!state.user) {
    if ($root) $root.innerHTML = '<p class="hint" style="padding:24px;text-align:center;">Vui lòng đăng nhập</p>';
    return;
  }

  if ($root) $root.innerHTML = `<div style="text-align:center;padding:60px 20px;color:var(--text-muted);">
    <div style="font-size:48px;margin-bottom:16px;">📡</div>
    <div style="font-size:18px;font-weight:600;">Đang kiểm tra kết nối...</div>
  </div>`;

  await Promise.all([loadLocation(), loadTodayCheckins()]);
  await checkNetworkStatus(); // Lấy IP hiện tại

  renderCheckin();
}

// (Các hàm Admin (renderAdminTodaySection), Lịch sử (openHistoryModal), v.v... 
// tôi giữ nguyên y hệt bản trước để bạn không phải sửa nhiều. 
// Bạn chỉ cần đảm bảo file có các hàm đó là được.)