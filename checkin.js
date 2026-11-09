import { supabase } from './supabase.js';
import { state, $, toast, openModal, closeModal, toDateStr } from './core.js';

const LOCATION_ID = 1;
let _todayCheckins = [];
let _anyCheckinInFlight = false;
let _adminTodayCheckins = [];
let _realtimeChannel = null;
let _adminPollTimer = null;
let _checkingAdmin = false;
let _unseenCheckinCount = 0;
let _audioCtx = null;
let _audioUnlockBound = false;
let _historyMode = 'day';
let _currentIP = null;
let _isCheckingNetwork = false;

function ensureState(){
  if (!state.checkinLocation) state.checkinLocation = null;
}

// ─────────────────────── LẤY IP PUBLIC ───────────────────────
async function getPublicIP() {
  try {
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
function formatDurationShort(ms){ const t=Math.round(ms/6e4),h=Math.floor(t/60),m=t%60; return h===0?`${m}p`:m===0?`${h}h`:`${h}h${m}p`; }

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
async function loadAdminTodayCheckins(){
  if (!state.isAdmin) { _adminTodayCheckins = []; return; }
  const today = toDateStr(new Date());
  const { data, error } = await supabase.from('cslx_checkins').select('*')
    .eq('checkin_date', today).order('checkin_at', { ascending: true });
  if (error) { console.error('[admin checkins]', error); _adminTodayCheckins = []; return; }
  _adminTodayCheckins = data || [];
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

  let statusHtml = '';
  let actionHtml = '';
  
  if (!loc) {
    statusHtml = `<div style="padding:24px; background:#fef3c7; border:2px solid #fbbf24; border-radius:14px; text-align:center; color:#92400e; font-size:16px;">
      ⚠ Chưa cấu hình điểm chấm công.<br>Vui lòng báo Quản lý.
    </div>`;
  } 
  else if (_isCheckingNetwork) {
    statusHtml = `<div style="padding:24px; background:#e0e7ff; border:2px solid #a5b4fc; border-radius:14px; text-align:center; color:#3730a3; font-size:18px; font-weight:600;">
      📡 Đang kiểm tra kết nối WiFi...
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

  // Lấy HTML phần admin (nếu là admin)
  const adminTodayHtml = state.isAdmin ? renderAdminTodaySection() : '';
  const adminBtn = state.isAdmin ? '<button id="checkinSettingsBtn" style="position:absolute; top:12px; right:12px; padding:8px 14px; font-size:13px; background:#fff; border:1px solid var(--border); border-radius:8px; cursor:pointer; font-family:inherit; color:var(--text-muted); box-shadow:0 1px 3px rgba(0,0,0,0.05);">⚙️ Cài đặt WiFi</button>' : '';

  $root.innerHTML = `<div style="position:relative; padding:0 0 24px;">
    ${adminBtn}${headerHtml}${statusHtml}${actionHtml}${adminTodayHtml}
    <div style="margin-top:24px;">
      <button id="openHistoryBtn" type="button" style="width:100%; padding:16px 20px; font-size:15px; font-weight:700; background:#fff; color:var(--ocean-700); border:1.5px solid var(--ocean-200); border-radius:14px; cursor:pointer; font-family:inherit; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:0 1px 3px rgba(0,0,0,0.04);">📜 Xem lịch sử chấm công</button>
    </div>
  </div>`;

  // Bind sự kiện
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

// ─────────────────────── ADMIN SECTION ───────────────────────
function groupAdminCheckins(){
  const map = {};
  for (const c of _adminTodayCheckins) {
    if (!map[c.employee_id]) map[c.employee_id] = { employee_id: c.employee_id, employee_name: c.employee_name || '—', in: null, out: null };
    const t = c.type || 'in';
    if (t === 'out') { if (!map[c.employee_id].out) map[c.employee_id].out = c; }
    else { if (!map[c.employee_id].in) map[c.employee_id].in = c; }
  }
  return Object.values(map).sort((a, b) => {
    const ta = a.in ? new Date(a.in.checkin_at).getTime() : a.out ? new Date(a.out.checkin_at).getTime() : 0;
    const tb = b.in ? new Date(b.in.checkin_at).getTime() : b.out ? new Date(b.out.checkin_at).getTime() : 0;
    return tb - ta;
  });
}

function renderAdminTodaySection(){
  if (!state.isAdmin) return '';
  const groups = groupAdminCheckins();
  const today = toDateStr(new Date());
  
  const rows = groups.length > 0 ? groups.map(g => {
    const inTime = g.in ? formatHHMM(g.in.checkin_at) : null;
    const outTime = g.out ? formatHHMM(g.out.checkin_at) : null;
    const isComplete = !!(g.in && g.out);
    const name = g.employee_name || '—';
    const initial = name.charAt(0).toUpperCase();
    const safeName = name.replace(/"/g, '&quot;');
    return `<div style="display:flex;align-items:center;gap:10px;padding:11px 12px;border-bottom:1px solid var(--border);">
      <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#0ea5b7,#0a6b7a);color:white;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex-shrink:0;">${initial}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;color:var(--text);font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:3px;line-height:1.4;">${inTime ? `Đến <strong style="color:#16a34a;">${inTime}</strong>` : '<span style="color:#94a3b8;">Chưa đến</span>'}${outTime ? ` · Về <strong style="color:#0891b2;">${outTime}</strong>` : ''}</div>
      </div>
      ${isComplete ? '<span style="font-size:11px;padding:3px 8px;background:#dcfce7;color:#15803d;border-radius:20px;font-weight:600;white-space:nowrap;">✓ Xong</span>' : '<span style="font-size:11px;padding:3px 8px;background:#fef3c7;color:#b45309;border-radius:20px;font-weight:600;white-space:nowrap;">Đang làm</span>'}
      <button class="admin-del-btn" type="button" data-del-emp="${g.employee_id}" data-del-name="${safeName}" data-del-date="${today}" title="Xoá chấm công hôm nay" style="width:32px;height:32px;background:#fee2e2;color:#dc2626;border:1px solid #fecaca;border-radius:8px;cursor:pointer;font-family:inherit;font-size:14px;flex-shrink:0;padding:0;display:flex;align-items:center;justify-content:center;line-height:1;">🗑</button>
    </div>`;
  }).join('') : '<div style="padding:22px 16px;text-align:center;color:var(--text-muted);font-size:14px;">Chưa có nhân viên nào chấm công hôm nay</div>';

  const bulkBtn = groups.length > 0 ? '<button id="adminBulkDeleteBtn" type="button" style="width:100%;margin-top:8px;padding:11px 14px;font-size:13px;font-weight:600;background:#fff;color:#dc2626;border:1.5px solid #fecaca;border-radius:10px;cursor:pointer;font-family:inherit;">🗑 Xoá tất cả hôm nay</button>' : '';

  return `<div style="margin-top:24px;">
    <div style="font-size:16px;font-weight:700;color:var(--text);margin-bottom:10px;">👥 Nhân viên hôm nay <span style="color:var(--ocean-600);">(${groups.length})</span></div>
    <div style="background:#fff;border:1px solid var(--border);border-radius:12px;overflow:hidden;">${rows}</div>
    ${bulkBtn}
  </div>`;
}

function bindAdminDeleteButtons(){
  if (!state.isAdmin) return;
  document.querySelectorAll('.admin-del-btn').forEach(btn => {
    btn.onclick = async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      const empId = btn.dataset.delEmp, empName = btn.dataset.delName, dateStr = btn.dataset.delDate;
      try {
        const ok = await deleteCheckinsByEmpDate(empId, empName, dateStr);
        if (ok) { await loadAdminTodayCheckins(); await loadTodayCheckins(); renderCheckin(); }
      } finally { btn.disabled = false; }
    };
  });
  const $bulkBtn = document.getElementById('adminBulkDeleteBtn');
  if ($bulkBtn) {
    $bulkBtn.onclick = async () => {
      if ($bulkBtn.disabled) return;
      $bulkBtn.disabled = true; $bulkBtn.textContent = '⏳ Đang xoá...';
      try { await deleteAllTodayCheckins(); }
      finally { const b = document.getElementById('adminBulkDeleteBtn'); if (b) { b.disabled = false; b.textContent = '🗑 Xoá tất cả hôm nay'; } }
    };
  }
}

// ─────────────────────── CHẤM CÔNG & MODALS ───────────────────────
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
  if (_anyCheckinInFlight) { toast('Đang xử lý...'); return; }
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
    if (state.isAdmin) await loadAdminTodayCheckins();
    renderCheckin();
  } catch (err) {
    console.error('[checkin]', err);
    toast('Lỗi: ' + (err.message || 'không xác định'));
  } finally {
    _anyCheckinInFlight = false;
  }
}

function showSuccessModal(type){
  const title = type === 'in' ? 'CHẤM CÔNG ĐẾN THÀNH CÔNG' : 'CHẤM CÔNG VỀ THÀNH CÔNG';
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
        </div>
      </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
    $m = document.getElementById('checkinSuccessModal');
  }
  document.getElementById('checkinSuccessTitle').textContent = title;
  document.getElementById('checkinSuccessTime').textContent = formatTime(now.toISOString());
  document.getElementById('checkinSuccessDate').textContent = formatDateVN(now.toISOString());
  $m.style.display = 'flex';
  setTimeout(() => { if ($m) $m.style.display = 'none'; }, 3500);
}

// ─────────────────────── XOÁ DỮ LIỆU ADMIN ───────────────────────
async function deleteCheckinsByEmpDate(empId, empName, dateStr){
  if (!state.isAdmin) return false;
  if (!confirm(`⚠️ Xoá TẤT CẢ chấm công của\n\n👤 "${empName || 'NV'}"\n📅 ngày ${formatDateShort(dateStr)}?`)) return false;
  const { error } = await supabase.from('cslx_checkins').delete().eq('employee_id', empId).eq('checkin_date', dateStr);
  if (error) { toast('Lỗi xoá: ' + error.message); return false; }
  toast('🗑 Đã xoá');
  return true;
}
async function deleteAllTodayCheckins(){
  if (!state.isAdmin) return;
  const today = toDateStr(new Date());
  if (!confirm(`⚠️ Xoá TẤT CẢ ${_adminTodayCheckins.length} chấm công hôm nay?`)) return;
  const { error } = await supabase.from('cslx_checkins').delete().eq('checkin_date', today);
  if (error) { toast('Lỗi xoá: ' + error.message); return; }
  toast(`🗑 Đã xoá sạch hôm nay`);
  await loadAdminTodayCheckins(); await loadTodayCheckins(); renderCheckin();
}

// ─────────────────────── CÀI ĐẶT IP CHO ADMIN ───────────────────────
async function openSettingsModal(){
  if (!state.isAdmin) return;
  
  openModal('checkinUpdateModal');
  
  const $coords = $('#checkinUpdateCoords');
  const $list = $('#checkinIpList');
  const $btnAdd = $('#btnAddCurrentIp');
  
  if ($coords) $coords.innerHTML = '⏳ Đang lấy IP mạng hiện tại...';
  if ($btnAdd) $btnAdd.style.display = 'none';
  
  const currentIp = await getPublicIP();
  const loc = state.checkinLocation;
  const currentAllowed = loc?.allowed_ips || [];
  
  if ($coords) {
    if (!currentIp) {
      $coords.innerHTML = `<span style="color:#dc2626;">❌ Lỗi mạng. Không lấy được IP.</span>`;
    } else {
      $coords.innerHTML = `
        <div style="font-size:18px; font-weight:bold; color:var(--ocean-700);">${currentIp}</div>
        <div style="font-size:12px; color:var(--text-muted); margin-top:4px;">IP của mạng WiFi bạn đang kết nối</div>
      `;
    }
  }

  if ($list) {
    if (currentAllowed.length === 0) {
      $list.innerHTML = `<div style="color:#b45309; font-size:13px; text-align:center; padding:10px;">Chưa có WiFi nào được lưu.</div>`;
    } else {
      $list.innerHTML = currentAllowed.map(ip => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 12px; background:#f1f5f9; border-radius:8px; margin-bottom:8px; border:1px solid #e2e8f0;">
          <span style="font-weight:600; font-size:14px;">${ip}</span>
          <button class="btn-remove-ip" data-ip="${ip}" style="background:#fee2e2; color:#dc2626; border:none; padding:6px 12px; border-radius:6px; font-size:12px; font-weight:bold; cursor:pointer;">Xoá</button>
        </div>
      `).join('');
      
      $list.querySelectorAll('.btn-remove-ip').forEach(btn => {
        btn.onclick = async () => {
          if (!confirm('Xoá IP này khỏi danh sách cho phép?')) return;
          const ipToRemove = btn.dataset.ip;
          const newIps = currentAllowed.filter(i => i !== ipToRemove);
          await supabase.from('cslx_checkin_location').update({ allowed_ips: newIps }).eq('id', LOCATION_ID);
          toast('Đã xoá IP');
          await loadLocation();
          openSettingsModal();
        };
      });
    }
  }

  if ($btnAdd) {
    if (currentIp && !currentAllowed.includes(currentIp)) {
      $btnAdd.style.display = 'block';
      $btnAdd.textContent = '+ Lưu WiFi này cho Nhân viên';
      $btnAdd.disabled = false;
      $btnAdd.onclick = async () => {
        $btnAdd.textContent = '⏳ Đang lưu...';
        $btnAdd.disabled = true;
        const newIps = [...currentAllowed, currentIp];
        const { error } = await supabase.from('cslx_checkin_location').upsert({ id: LOCATION_ID, allowed_ips: newIps }, { onConflict: 'id' });
        if (error) {
          toast('Lỗi: ' + error.message);
          $btnAdd.textContent = '+ Lưu WiFi này cho Nhân viên';
          $btnAdd.disabled = false;
        } else {
          toast(`✅ Đã lưu WiFi trường!`);
          await loadLocation();
          openSettingsModal();
        }
      };
    } else if (currentIp && currentAllowed.includes(currentIp)) {
      $coords.innerHTML += `<div style="font-size:13px; color:#16a34a; font-weight:bold; margin-top:6px;">✓ WiFi này đã được lưu</div>`;
    }
  }
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

  const tasks = [loadLocation(), loadTodayCheckins()];
  if (state.isAdmin) tasks.push(loadAdminTodayCheckins());
  await Promise.all(tasks);
  
  await checkNetworkStatus(); 
  renderCheckin();
}