import { supabase } from './supabase.js';
import { state, $, toast, openModal, closeModal, toDateStr } from './core.js';

const LOCATION_ID = 1;
let _todayCheckins = [];
let _anyCheckinInFlight = false;
let _adminTodayCheckins = [];
let _historyMode = 'day';

// Camera State
let _mediaStream = null;
let _captureType = 'in';

function ensureState() {
  if (!state.checkinLocation) state.checkinLocation = null;
}

// ─────────────────────── HELPERS ───────────────────────
function formatTime(iso) { 
  try { 
    const d = new Date(iso), h = d.getHours(), m = d.getMinutes();
    const p = h < 12 ? 'sáng' : h < 18 ? 'chiều' : 'tối';
    return `${h === 0 ? 12 : h > 12 ? h - 12 : h} giờ ${String(m).padStart(2, '0')} phút ${p}`; 
  } catch { return '—'; } 
}

function formatHHMM(iso) { 
  try { 
    const d = new Date(iso); 
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; 
  } catch { return '—'; } 
}

function formatHHMMPeriod(iso) { 
  try { 
    const d = new Date(iso), h = d.getHours(), m = d.getMinutes(); 
    const p = h < 12 ? 'sáng' : h < 18 ? 'chiều' : 'tối'; 
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} ${p}`; 
  } catch { return '—'; } 
}

function formatDateVN(iso) { 
  try { 
    const d = new Date(iso);
    const days = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7']; 
    return `${days[d.getDay()]}, ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`; 
  } catch { return '—'; } 
}

function formatDateCompact(iso) { 
  try { 
    const d = new Date(iso); 
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`; 
  } catch { return '—'; } 
}

function formatDateShort(dateStr) { 
  try { 
    const p = dateStr.split('-'); 
    return `${p[2]}/${p[1]}/${p[0]}`; 
  } catch { return dateStr; } 
}

function formatDuration(ms) { 
  const t = Math.round(ms / 6e4), h = Math.floor(t / 60), m = t % 60; 
  return h === 0 ? `${m} phút` : m === 0 ? `${h} giờ` : `${h} giờ ${m} phút`; 
}

function formatDurationShort(ms) {
  const t = Math.round(ms / 6e4), h = Math.floor(t / 60), m = t % 60;
  return h === 0 ? `${m}p` : m === 0 ? `${h}h` : `${h}h${m}p`;
}

function getUserName() {
  const emp = (state.employees || []).find(e => e.id === state.user?.id);
  return emp?.full_name || emp?.username || state.user?.email || '';
}

function getCurrentState() {
  if (_todayCheckins.length === 0) return 'need_in';
  if (_todayCheckins.length === 1) return 'need_out';
  return 'done';
}

// ─────────────────────── LOAD DATA ───────────────────────
async function loadLocation() {
  const { data, error } = await supabase.from('cslx_checkin_location').select('*').eq('id', LOCATION_ID).maybeSingle();
  if (error) { console.error('[checkin] location:', error); return; }
  state.checkinLocation = data || null;
}

async function loadTodayCheckins() {
  if (!state.user?.id) return;
  const today = toDateStr(new Date());
  const { data, error } = await supabase.from('cslx_checkins').select('*')
    .eq('employee_id', state.user.id).eq('checkin_date', today)
    .order('checkin_at', { ascending: true });
  if (error) { console.error(error); _todayCheckins = []; return; }
  _todayCheckins = data || [];
}

async function loadAdminTodayCheckins() {
  if (!state.isAdmin) { _adminTodayCheckins = []; return; }
  const today = toDateStr(new Date());
  const { data, error } = await supabase.from('cslx_checkins').select('*')
    .eq('checkin_date', today).order('checkin_at', { ascending: true });
  if (error) { console.error('[admin checkins]', error); _adminTodayCheckins = []; return; }
  _adminTodayCheckins = data || [];
}

// ─────────────────────── CAMERA LOGIC ───────────────────────
async function openCamera(type) {
  if (_anyCheckinInFlight) { toast('Đang xử lý, vui lòng đợi...'); return; }
  _captureType = type;
  
  let $modal = document.getElementById('cameraModal');
  if (!$modal) {
    let html = '<div id="cameraModal" style="display:none; position:fixed; inset:0; background:#000; z-index:99999; flex-direction:column;">';
    html += '<div style="padding:16px; text-align:center; color:white; font-size:16px; font-weight:600; background:rgba(0,0,0,0.5);">Chụp ảnh xác nhận</div>';
    html += '<div style="flex:1; position:relative; overflow:hidden; display:flex; align-items:center; justify-content:center;">';
    html += '<video id="cameraVideo" autoplay playsinline style="width:100%; height:100%; object-fit:cover;"></video>';
    html += '</div>';
    html += '<div style="padding:30px; display:flex; justify-content:center; align-items:center; background:#111; gap:40px;">';
    html += '<button id="cameraCloseBtn" style="background:transparent; border:none; color:white; font-size:16px; font-weight:600; cursor:pointer;">Huỷ</button>';
    html += '<button id="cameraCaptureBtn" style="width:80px; height:80px; border-radius:50%; background:#fff; border:6px solid #ccc; cursor:pointer; box-shadow:0 4px 12px rgba(0,0,0,0.5);"></button>';
    html += '<div style="width:48px;"></div>'; // Spacer
    html += '</div>';
    html += '</div>';
    document.body.insertAdjacentHTML('beforeend', html);
    $modal = document.getElementById('cameraModal');
    
    document.getElementById('cameraCloseBtn').onclick = stopCamera;
    document.getElementById('cameraCaptureBtn').onclick = capturePhoto;
  }
  
  $modal.style.display = 'flex';
  
  try {
    _mediaStream = await navigator.mediaDevices.getUserMedia({ 
      video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } },
      audio: false 
    });
    const video = document.getElementById('cameraVideo');
    video.srcObject = _mediaStream;
  } catch (err) {
    console.error('[camera]', err);
    stopCamera();
    toast('Không mở được Camera. Vui lòng kiểm tra quyền truy cập Camera trong Cài đặt!', 4000);
  }
}

function stopCamera() {
  if (_mediaStream) {
    _mediaStream.getTracks().forEach(track => track.stop());
    _mediaStream = null;
  }
  const $modal = document.getElementById('cameraModal');
  if ($modal) $modal.style.display = 'none';
  const video = document.getElementById('cameraVideo');
  if (video) video.srcObject = null;
}

async function capturePhoto() {
  const video = document.getElementById('cameraVideo');
  if (!video || !_mediaStream) return;
  
  const btn = document.getElementById('cameraCaptureBtn');
  btn.disabled = true;
  btn.style.background = '#ccc';
  
  // Tạo canvas để cắt frame từ video
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 720;
  canvas.height = video.videoHeight || 720;
  const ctx = canvas.getContext('2d');
  
  // Vẽ hình ảnh từ camera
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  
  // ==========================================
  // BẮT ĐẦU VẼ WATERMARK (TÊN, NGÀY GIỜ, LOẠI)
  // ==========================================
  const userName = getUserName();
  const now = new Date();
  const dateStr = formatDateVN(now.toISOString());
  const timeStr = formatHHMMPeriod(now.toISOString());
  const typeStr = _captureType === 'in' ? 'CHẤM CÔNG ĐẾN' : 'CHẤM CÔNG VỀ';

  // Tính toán kích thước dựa trên độ phân giải ảnh để chữ luôn cân đối
  const fontSize = Math.round(canvas.width * 0.045); 
  const padding = Math.round(canvas.width * 0.04);
  const lineHeight = fontSize * 1.4;
  const boxHeight = lineHeight * 3 + padding * 2;
  
  // Vẽ dải nền đen mờ ở dưới cùng
  ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
  ctx.fillRect(0, canvas.height - boxHeight, canvas.width, boxHeight);

  // Cấu hình font chữ
  ctx.textBaseline = 'top';
  let startY = canvas.height - boxHeight + padding;

  // Dòng 1: Tên nhân viên (Màu vàng)
  ctx.fillStyle = '#facc15'; 
  ctx.font = `bold ${fontSize}px Arial, sans-serif`;
  ctx.fillText(userName, padding, startY);
  
  // Dòng 2: Thời gian (Màu trắng)
  startY += lineHeight;
  ctx.fillStyle = '#ffffff';
  ctx.font = `${fontSize}px Arial, sans-serif`;
  ctx.fillText(`${timeStr} - ${dateStr}`, padding, startY);

  // Dòng 3: Trạng thái (Màu xanh lá)
  startY += lineHeight;
  ctx.fillStyle = '#4ade80'; 
  ctx.font = `bold ${fontSize}px Arial, sans-serif`;
  ctx.fillText(typeStr, padding, startY);
  // ==========================================
  // KẾT THÚC VẼ WATERMARK
  // ==========================================
  
  // Chuyển sang ảnh JPEG (tăng chất lượng lên 0.8 để chữ không bị mờ)
  const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
  
  stopCamera();
  await uploadAndCheckin(dataUrl, _captureType);
}

// ─────────────────────── UPLOAD & CHECK-IN ───────────────────────
async function uploadAndCheckin(base64Image, type) {
  if (_anyCheckinInFlight) return;
  _anyCheckinInFlight = true;
  toast('Đang gửi ảnh chấm công...');
  
  try {
    // 1. Chuyển Base64 sang Blob
    const res = await fetch(base64Image);
    const blob = await res.blob();
    
    // 2. Tạo tên file duy nhất
    const fileName = `${state.user.id}_${Date.now()}.jpg`;
    
    // 3. Upload lên Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('checkin_photos')
      .upload(fileName, blob, { contentType: 'image/jpeg' });
      
    if (uploadError) throw new Error('Lỗi upload ảnh: ' + uploadError.message);
    
    // 4. Lấy link ảnh public
    const { data: publicUrlData } = supabase.storage
      .from('checkin_photos')
      .getPublicUrl(fileName);
    const photoUrl = publicUrlData.publicUrl;
    
    // 5. Lưu record vào Database
    const { error: dbError } = await supabase.from('cslx_checkins').insert({
      employee_id: state.user.id,
      employee_name: getUserName(),
      checkin_date: toDateStr(new Date()),
      type: type,
      photo_url: photoUrl,
      device_info: (navigator.userAgent || '').slice(0, 150),
    });
    
    if (dbError) throw dbError;
    
    try { navigator.vibrate([100, 50, 200]); } catch {}
    
    showSuccessModal(type);
    await loadTodayCheckins();
    if (state.isAdmin) await loadAdminTodayCheckins();
    renderCheckin();
    
  } catch (err) {
    console.error('[checkin]', err);
    toast('Lỗi chấm công: ' + (err.message || 'Vui lòng thử lại'));
  } finally {
    _anyCheckinInFlight = false;
  }
}

// ─────────────────────── RENDER CHÍNH ───────────────────────
function renderCheckin() {
  const $root = $('#checkinRoot');
  if (!$root) return;

  const userName = getUserName();
  const now = new Date();
  const currentState = getCurrentState();

  let headerHtml = '<div style="text-align:center;margin-bottom:20px;">';
  headerHtml += '<div style="font-size:24px;font-weight:700;color:var(--text);line-height:1.3;">' + userName + '</div>';
  headerHtml += '<div style="font-size:15px;color:var(--text-muted);margin-top:6px;">' + formatDateCompact(now.toISOString()) + ' · ' + formatHHMMPeriod(now.toISOString()) + '</div>';
  headerHtml += '</div>';

  let statusHtml = '';
  let actionHtml = '';

  if (currentState === 'need_in') {
    actionHtml = '<button id="btnCameraIn" style="width:100%; margin-top:20px; padding:30px 20px; font-size:26px; font-weight:700; font-family:inherit; background:linear-gradient(135deg,#16a34a,#15803d); color:white; border:none; border-radius:16px; cursor:pointer; box-shadow:0 4px 12px rgba(22,163,74,0.4); text-transform:uppercase; letter-spacing:0.5px;">📸 CHẤM CÔNG ĐẾN</button>';
  } else if (currentState === 'need_out') {
    const inTime = _todayCheckins[0] ? formatHHMMPeriod(_todayCheckins[0].checkin_at) : '—';
    actionHtml = '<div style="margin-top:16px; padding:16px; background:#f0f9ff; border:1px solid #bae6fd; border-radius:12px; text-align:center; font-size:15px; color:var(--text);">Hôm nay đã chấm công lúc<br><strong style="font-size:17px; color:#0369a1;">' + inTime + '</strong></div>';
    actionHtml += '<button id="btnCameraOut" style="width:100%; margin-top:12px; padding:30px 20px; font-size:26px; font-weight:700; font-family:inherit; background:linear-gradient(135deg,#0891b2,#0e7490); color:white; border:none; border-radius:16px; cursor:pointer; box-shadow:0 4px 12px rgba(8,145,178,0.4); text-transform:uppercase; letter-spacing:0.5px;">📸 CHẤM CÔNG VỀ</button>';
  } else {
    const inTime = _todayCheckins[0] ? formatHHMMPeriod(_todayCheckins[0].checkin_at) : '—';
    const outTime = _todayCheckins[1] ? formatHHMMPeriod(_todayCheckins[1].checkin_at) : '—';
    const totalMs = _todayCheckins.length >= 2 ? new Date(_todayCheckins[1].checkin_at) - new Date(_todayCheckins[0].checkin_at) : 0;
    
    actionHtml = '<div style="margin-top:20px; padding:28px 20px; background:#dcfce7; border:2px solid #86efac; border-radius:14px; text-align:center;">';
    actionHtml += '<div style="font-size:44px; margin-bottom:10px; line-height:1;">🎉</div>';
    actionHtml += '<div style="font-size:20px; font-weight:700; color:#15803d; margin-bottom:14px;">HOÀN THÀNH HÔM NAY</div>';
    actionHtml += '<div style="font-size:16px; color:#166534; line-height:1.9;">';
    actionHtml += '<div>Đến: <strong>' + inTime + '</strong></div>';
    actionHtml += '<div>Về: <strong>' + outTime + '</strong></div>';
    if (totalMs > 0) {
      actionHtml += '<div style="margin-top:10px; padding-top:10px; border-top:1px dashed #86efac; font-size:17px;">Tổng: <strong>' + formatDuration(totalMs) + '</strong></div>';
    }
    actionHtml += '</div></div>';
  }

  const adminTodayHtml = state.isAdmin ? renderAdminTodaySection() : '';

  $root.innerHTML = '<div style="position:relative; padding:0 0 24px;">' + headerHtml + statusHtml + actionHtml + adminTodayHtml +
    '<div style="margin-top:24px;"><button id="openHistoryBtn" type="button" style="width:100%; padding:16px 20px; font-size:15px; font-weight:700; background:#fff; color:var(--ocean-700); border:1.5px solid var(--ocean-200); border-radius:14px; cursor:pointer; font-family:inherit; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:0 1px 3px rgba(0,0,0,0.04);">📜 Xem lịch sử chấm công</button></div>' +
  '</div>';

  const $btnIn = $('#btnCameraIn');
  if ($btnIn) $btnIn.onclick = () => openCamera('in');

  const $btnOut = $('#btnCameraOut');
  if ($btnOut) $btnOut.onclick = () => openCamera('out');

  const $history = $('#openHistoryBtn');
  if ($history) $history.onclick = () => openHistoryModal('');

  bindAdminDeleteButtons();
}

function showSuccessModal(type) {
  const title = type === 'in' ? 'CHẤM CÔNG ĐẾN THÀNH CÔNG' : 'CHẤM CÔNG VỀ THÀNH CÔNG';
  const now = new Date();
  let $m = document.getElementById('checkinSuccessModal');
  if (!$m) {
    let html = '<div id="checkinSuccessModal" class="modal-overlay" style="display:none;z-index:10002;background:rgba(0,0,0,0.75);align-items:center;justify-content:center;">';
    html += '<div style="background:#fff;border-radius:20px;max-width:360px;width:calc(100% - 40px);margin:auto;box-shadow:0 20px 60px rgba(0,0,0,0.4);">';
    html += '<div style="padding:44px 24px;text-align:center;">';
    html += '<div style="font-size:88px;color:#16a34a;line-height:1;margin-bottom:24px;">✓</div>';
    html += '<div id="checkinSuccessTitle" style="font-size:22px;font-weight:700;color:#15803d;margin-bottom:20px;line-height:1.3;"></div>';
    html += '<div id="checkinSuccessTime" style="font-size:24px;font-weight:700;color:var(--text);margin-bottom:8px;"></div>';
    html += '<div id="checkinSuccessDate" style="font-size:15px;color:var(--text-muted);"></div>';
    html += '</div></div></div>';
    document.body.insertAdjacentHTML('beforeend', html);
    $m = document.getElementById('checkinSuccessModal');
  }
  document.getElementById('checkinSuccessTitle').textContent = title;
  document.getElementById('checkinSuccessTime').textContent = formatTime(now.toISOString());
  document.getElementById('checkinSuccessDate').textContent = formatDateVN(now.toISOString());
  $m.style.display = 'flex';
  setTimeout(() => { if ($m) $m.style.display = 'none'; }, 3500);
}

// ─────────────────────── ADMIN SECTION ───────────────────────
function groupAdminCheckins() {
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

function renderAdminTodaySection() {
  if (!state.isAdmin) return '';
  const groups = groupAdminCheckins();
  const today = toDateStr(new Date());
  
  let rows = '';
  if (groups.length > 0) {
    for (const g of groups) {
      const inTime = g.in ? formatHHMM(g.in.checkin_at) : null;
      const outTime = g.out ? formatHHMM(g.out.checkin_at) : null;
      const isComplete = !!(g.in && g.out);
      const name = g.employee_name || '—';
      const initial = name.charAt(0).toUpperCase();
      const safeName = name.replace(/"/g, '&quot;');
      
      let viewPhotoBtn = '';
      if (g.in && g.in.photo_url) {
        viewPhotoBtn += '<a href="' + g.in.photo_url + '" target="_blank" style="display:inline-block; margin-right:6px; text-decoration:none; font-size:11px; padding:3px 8px; background:#e0f2fe; color:#0369a1; border-radius:20px; font-weight:600;">📸 Ảnh đến</a>';
      }
      if (g.out && g.out.photo_url) {
        viewPhotoBtn += '<a href="' + g.out.photo_url + '" target="_blank" style="display:inline-block; margin-right:6px; text-decoration:none; font-size:11px; padding:3px 8px; background:#e0f2fe; color:#0369a1; border-radius:20px; font-weight:600;">📸 Ảnh về</a>';
      }

      rows += '<div style="display:flex;align-items:center;gap:10px;padding:11px 12px;border-bottom:1px solid var(--border);">';
      rows += '<div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#0ea5b7,#0a6b7a);color:white;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex-shrink:0;">' + initial + '</div>';
      rows += '<div style="flex:1;min-width:0;">';
      rows += '<div style="font-weight:600;color:var(--text);font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + name + '</div>';
      
      rows += '<div style="font-size:12px;color:var(--text-muted);margin-top:3px;line-height:1.4;">';
      rows += inTime ? 'Đến <strong style="color:#16a34a;">' + inTime + '</strong>' : '<span style="color:#94a3b8;">Chưa đến</span>';
      rows += outTime ? ' · Về <strong style="color:#0891b2;">' + outTime + '</strong>' : '';
      rows += '</div>';
      if (viewPhotoBtn) {
         rows += '<div style="margin-top:6px;">' + viewPhotoBtn + '</div>';
      }
      rows += '</div>';
      
      if (isComplete) {
        rows += '<span style="font-size:11px;padding:3px 8px;background:#dcfce7;color:#15803d;border-radius:20px;font-weight:600;white-space:nowrap;">✓ Xong</span>';
      } else {
        rows += '<span style="font-size:11px;padding:3px 8px;background:#fef3c7;color:#b45309;border-radius:20px;font-weight:600;white-space:nowrap;">Đang làm</span>';
      }
      
      rows += '<button class="admin-del-btn" type="button" data-del-emp="' + g.employee_id + '" data-del-name="' + safeName + '" data-del-date="' + today + '" title="Xoá chấm công hôm nay" style="width:32px;height:32px;background:#fee2e2;color:#dc2626;border:1px solid #fecaca;border-radius:8px;cursor:pointer;font-family:inherit;font-size:14px;flex-shrink:0;padding:0;display:flex;align-items:center;justify-content:center;line-height:1;">🗑</button>';
      rows += '</div>';
    }
  } else {
    rows = '<div style="padding:22px 16px;text-align:center;color:var(--text-muted);font-size:14px;">Chưa có nhân viên nào chấm công hôm nay</div>';
  }

  const bulkBtn = groups.length > 0 ? '<button id="adminBulkDeleteBtn" type="button" style="width:100%;margin-top:8px;padding:11px 14px;font-size:13px;font-weight:600;background:#fff;color:#dc2626;border:1.5px solid #fecaca;border-radius:10px;cursor:pointer;font-family:inherit;">🗑 Xoá tất cả hôm nay</button>' : '';

  return '<div style="margin-top:24px;">' +
    '<div style="font-size:16px;font-weight:700;color:var(--text);margin-bottom:10px;">👥 Nhân viên hôm nay <span style="color:var(--ocean-600);">(' + groups.length + ')</span></div>' +
    '<div style="background:#fff;border:1px solid var(--border);border-radius:12px;overflow:hidden;">' + rows + '</div>' +
    bulkBtn +
  '</div>';
}

function bindAdminDeleteButtons() {
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

async function deleteCheckinsByEmpDate(empId, empName, dateStr) {
  if (!state.isAdmin) return false;
  if (!confirm('⚠️ Xoá TẤT CẢ chấm công của\n\n👤 "' + (empName || 'NV') + '"\n📅 ngày ' + formatDateShort(dateStr) + '?')) return false;
  const { error } = await supabase.from('cslx_checkins').delete().eq('employee_id', empId).eq('checkin_date', dateStr);
  if (error) { toast('Lỗi xoá: ' + error.message); return false; }
  toast('🗑 Đã xoá');
  return true;
}

async function deleteAllTodayCheckins() {
  if (!state.isAdmin) return;
  const today = toDateStr(new Date());
  if (!confirm('⚠️ Xoá TẤT CẢ ' + _adminTodayCheckins.length + ' chấm công hôm nay?')) return;
  const { error } = await supabase.from('cslx_checkins').delete().eq('checkin_date', today);
  if (error) { toast('Lỗi xoá: ' + error.message); return; }
  toast('🗑 Đã xoá sạch hôm nay');
  await loadAdminTodayCheckins(); 
  await loadTodayCheckins(); 
  renderCheckin();
}

// ─────────────────────── LỊCH SỬ ───────────────────────
function updateHistoryModeUI() {
  const $btnDay = document.getElementById('historyModeDay');
  const $btnMonth = document.getElementById('historyModeMonth');
  const $hint = document.getElementById('historyScopeHint');
  const $dateInput = document.getElementById('historyDateInput');
  const activeStyle = 'flex:1;padding:9px 12px;font-size:13px;font-weight:700;background:var(--ocean-500);color:white;border:1.5px solid var(--ocean-500);border-radius:9px;cursor:pointer;font-family:inherit;';
  const inactiveStyle = 'flex:1;padding:9px 12px;font-size:13px;font-weight:600;background:#fff;color:var(--text-muted);border:1.5px solid var(--border);border-radius:9px;cursor:pointer;font-family:inherit;';
  if ($btnDay) $btnDay.style.cssText = _historyMode === 'day' ? activeStyle : inactiveStyle;
  if ($btnMonth) $btnMonth.style.cssText = _historyMode === 'month' ? activeStyle : inactiveStyle;
  const dateVal = $dateInput?.value || '';
  if ($hint && dateVal) {
    if (_historyMode === 'day') $hint.textContent = '🎯 Đang xem ngày ' + formatDateShort(dateVal);
    else { const parts = dateVal.split('-'); $hint.textContent = '📅 Đang xem cả tháng ' + parts[1] + '/' + parts[0]; }
  } else if ($hint) { $hint.textContent = ''; }
}

function ensureHistoryModal() {
  let $m = document.getElementById('checkinHistoryModal');
  if ($m) return $m;
  let html = '<div id="checkinHistoryModal" class="modal-overlay" style="display:none;z-index:10001;align-items:center;justify-content:center;padding:12px;">';
  html += '<div style="background:#fff;border-radius:18px;max-width:480px;width:100%;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.3);">';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:16px 18px;border-bottom:1px solid var(--border);flex-shrink:0;">';
  html += '<h3 style="margin:0;font-size:17px;font-weight:700;color:var(--ocean-700);">📜 Lịch sử chấm công</h3>';
  html += '<button id="historyCloseBtn" type="button" style="background:var(--ocean-50);border:none;width:32px;height:32px;border-radius:8px;font-size:15px;color:var(--text-muted);cursor:pointer;font-family:inherit;">✕</button>';
  html += '</div>';
  html += '<div style="padding:12px 16px;border-bottom:1px solid var(--border);flex-shrink:0;display:flex;flex-direction:column;gap:10px;">';
  html += '<select id="historyEmpSelect" class="input" style="display:none;padding:10px 12px;font-size:14px;"><option value="">👤 Tất cả NV</option></select>';
  html += '<input type="date" id="historyDateInput" class="input" style="padding:10px 12px;font-size:14px;" />';
  html += '<div style="display:flex;gap:8px;">';
  html += '<button id="historyModeDay" type="button">📍 Ngày này</button>';
  html += '<button id="historyModeMonth" type="button">📅 Cả tháng</button>';
  html += '</div>';
  html += '<div id="historyScopeHint" style="font-size:11.5px;color:var(--text-muted);line-height:1.4;text-align:center;"></div>';
  html += '</div>';
  html += '<div id="historyContent" style="flex:1;overflow-y:auto;padding:12px 16px;-webkit-overflow-scrolling:touch;min-height:0;">';
  html += '<div style="text-align:center;padding:40px;color:var(--text-muted);">⏳ Đang tải...</div>';
  html += '</div>';
  html += '<div style="padding:12px 16px;border-top:1px solid var(--border);flex-shrink:0;display:flex;justify-content:center;">';
  html += '<button id="historyCloseBtn2" type="button" style="padding:10px 24px;font-size:13px;font-weight:600;background:#fff;color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-family:inherit;">Đóng</button>';
  html += '</div></div></div>';
  
  document.body.insertAdjacentHTML('beforeend', html);
  $m = document.getElementById('checkinHistoryModal');
  const closeFn = () => { $m.style.display = 'none'; };
  document.getElementById('historyCloseBtn').onclick = closeFn;
  document.getElementById('historyCloseBtn2').onclick = closeFn;
  $m.onclick = (e) => { if (e.target === $m) closeFn(); };
  document.getElementById('historyDateInput').onchange = () => { updateHistoryModeUI(); loadHistoryData().catch(err => console.warn('[history]', err)); };
  document.getElementById('historyEmpSelect').onchange = () => { loadHistoryData().catch(err => console.warn('[history]', err)); };
  document.getElementById('historyModeDay').onclick = () => { _historyMode = 'day'; updateHistoryModeUI(); loadHistoryData().catch(err => console.warn('[history]', err)); };
  document.getElementById('historyModeMonth').onclick = () => { _historyMode = 'month'; updateHistoryModeUI(); loadHistoryData().catch(err => console.warn('[history]', err)); };
  return $m;
}

function openHistoryModal(defaultEmpId = '') {
  _historyMode = 'day';
  const $m = ensureHistoryModal();
  const $date = document.getElementById('historyDateInput');
  if ($date) $date.value = toDateStr(new Date());
  const $empSel = document.getElementById('historyEmpSelect');
  if ($empSel) {
    if (state.isAdmin) {
      $empSel.style.display = 'block';
      const emps = (state.employees || []).filter(e => e.status !== 'inactive').sort((a, b) => (a.full_name || a.username || '').localeCompare(b.full_name || b.username || '', 'vi'));
      $empSel.innerHTML = '<option value="">👤 Tất cả NV</option>' + emps.map(e => '<option value="' + e.id + '">' + (e.full_name || e.username || '') + '</option>').join('');
      $empSel.value = defaultEmpId || '';
    } else {
      $empSel.style.display = 'none'; $empSel.value = '';
    }
  }
  updateHistoryModeUI();
  $m.style.display = 'flex';
  loadHistoryData().catch(err => { console.warn('[history]', err); const $c = document.getElementById('historyContent'); if ($c) $c.innerHTML = '<div style="text-align:center;padding:40px;color:#dc2626;">⚠ Lỗi tải dữ liệu</div>'; });
}

async function loadHistoryData() {
  const $content = document.getElementById('historyContent');
  if (!$content) return;
  const $date = document.getElementById('historyDateInput');
  const $empSel = document.getElementById('historyEmpSelect');
  const dateVal = $date?.value || '';
  if (!dateVal) { $content.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">Chọn ngày để xem</div>'; return; }

  let query = supabase.from('cslx_checkins').select('*');
  if (_historyMode === 'day') { query = query.eq('checkin_date', dateVal); }
  else {
    const parts = dateVal.split('-').map(Number);
    const y = parts[0], mo = parts[1];
    const lastDay = new Date(y, mo, 0).getDate();
    const start = y + '-' + String(mo).padStart(2, '0') + '-01';
    const end = y + '-' + String(mo).padStart(2, '0') + '-' + String(lastDay).padStart(2, '0');
    query = query.gte('checkin_date', start).lte('checkin_date', end);
  }

  let selEmpId = null;
  if (!state.isAdmin) { selEmpId = state.user?.id; } else { selEmpId = $empSel?.value || null; }
  if (!state.isAdmin && !selEmpId) { $content.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">Vui lòng đăng nhập</div>'; return; }
  if (selEmpId) query = query.eq('employee_id', selEmpId);

  query = query.order('checkin_date', { ascending: false }).order('checkin_at', { ascending: true });
  $content.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">⏳ Đang tải...</div>';

  const { data, error } = await query;
  if (error) { $content.innerHTML = '<div style="text-align:center;padding:40px;color:#dc2626;">⚠ Lỗi: ' + error.message + '</div>'; return; }
  if (!data || data.length === 0) {
    const scope = _historyMode === 'day' ? 'ngày ' + formatDateShort(dateVal) : 'tháng ' + dateVal.slice(5, 7) + '/' + dateVal.slice(0, 4);
    $content.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">📭 Chưa có dữ liệu chấm công ' + scope + '</div>';
    return;
  }

  const byDate = {};
  for (const c of data) {
    if (!byDate[c.checkin_date]) byDate[c.checkin_date] = {};
    if (!byDate[c.checkin_date][c.employee_id]) { byDate[c.checkin_date][c.employee_id] = { employee_id: c.employee_id, employee_name: c.employee_name || '—', in: null, out: null }; }
    const rec = byDate[c.checkin_date][c.employee_id];
    const t = c.type || 'in';
    if (t === 'out') { if (!rec.out) rec.out = c; } else { if (!rec.in) rec.in = c; }
  }

  const todayStr = toDateStr(new Date());
  const days = Object.keys(byDate).sort().reverse();
  const dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

  let contentHtml = '';
  for (const d of days) {
    const dateObj = new Date(d + 'T00:00:00');
    const dow = dayNames[dateObj.getDay()];
    const dd = String(dateObj.getDate()).padStart(2, '0');
    const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
    const isToday = d === todayStr;
    const empRecs = Object.values(byDate[d]).sort((a, b) => {
      const ta = a.in ? new Date(a.in.checkin_at).getTime() : a.out ? new Date(a.out.checkin_at).getTime() : 0;
      const tb = b.in ? new Date(b.in.checkin_at).getTime() : b.out ? new Date(b.out.checkin_at).getTime() : 0;
      return ta - tb;
    });
    const dayHeaderStyle = isToday ? 'background:linear-gradient(135deg,#dcfce7,#bbf7d0);color:#15803d;border-color:#86efac;' : 'background:var(--ocean-50);color:var(--ocean-700);border-color:var(--ocean-200);';
    
    contentHtml += '<div style="margin-bottom:14px;">';
    contentHtml += '<div style="padding:8px 12px;border-radius:10px;font-size:13px;font-weight:700;margin-bottom:8px;border:1px solid;' + dayHeaderStyle + '">' + (isToday ? '📍 Hôm nay · ' : '') + dow + ', ' + dd + '/' + mm + '/' + dateObj.getFullYear() + '</div>';
    contentHtml += '<div style="background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden;">';
    
    for (const r of empRecs) {
      const inTime = r.in ? formatHHMM(r.in.checkin_at) : null;
      const outTime = r.out ? formatHHMM(r.out.checkin_at) : null;
      let durText = '';
      if (r.in && r.out) { const ms = new Date(r.out.checkin_at) - new Date(r.in.checkin_at); durText = ' <span style="color:#0f766e;font-weight:600;">(' + formatDurationShort(ms) + ')</span>'; }
      const safeName = (r.employee_name || '').replace(/"/g, '&quot;');
      
      contentHtml += '<div style="padding:10px 12px;border-bottom:1px solid var(--border);display:flex;align-items:flex-start;gap:8px;">';
      contentHtml += '<div style="flex:1;min-width:0;">';
      contentHtml += '<div style="font-weight:600;font-size:13px;color:var(--text);margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + r.employee_name + '</div>';
      contentHtml += '<div style="font-size:12.5px;color:var(--text-muted);line-height:1.6;">';
      contentHtml += inTime ? '🟢 Đến <strong style="color:#16a34a;">' + inTime + '</strong>' : '<span style="color:#94a3b8;">— Chưa đến</span>';
      contentHtml += outTime ? ' · 🔵 Về <strong style="color:#0891b2;">' + outTime + '</strong>' + durText : '';
      contentHtml += '</div>';
      
      let photoLinks = '';
      if (r.in && r.in.photo_url) photoLinks += '<a href="' + r.in.photo_url + '" target="_blank" style="display:inline-block; margin-top:6px; margin-right:8px; font-size:12px; color:#0369a1; text-decoration:none; font-weight:600;">📸 Ảnh đến</a>';
      if (r.out && r.out.photo_url) photoLinks += '<a href="' + r.out.photo_url + '" target="_blank" style="display:inline-block; margin-top:6px; margin-right:8px; font-size:12px; color:#0369a1; text-decoration:none; font-weight:600;">📸 Ảnh về</a>';
      contentHtml += photoLinks;

      contentHtml += '</div>';
      
      if (state.isAdmin) {
        contentHtml += '<button class="hist-del-btn" type="button" data-hist-del-emp="' + r.employee_id + '" data-hist-del-name="' + safeName + '" data-hist-del-date="' + d + '" title="Xoá chấm công NV này trong ngày" style="width:32px;height:32px;background:#fee2e2;color:#dc2626;border:1px solid #fecaca;border-radius:8px;cursor:pointer;font-family:inherit;font-size:14px;flex-shrink:0;padding:0;display:flex;align-items:center;justify-content:center;line-height:1;">🗑</button>';
      }
      contentHtml += '</div>';
    }
    contentHtml += '</div></div>';
  }
  $content.innerHTML = contentHtml;

  if (state.isAdmin) {
    document.querySelectorAll('.hist-del-btn').forEach(btn => {
      btn.onclick = async () => {
        if (btn.disabled) return;
        btn.disabled = true;
        const empId = btn.dataset.histDelEmp, empName = btn.dataset.histDelName, dateStr = btn.dataset.histDelDate;
        try {
          const ok = await deleteCheckinsByEmpDate(empId, empName, dateStr);
          if (ok) { await loadAdminTodayCheckins(); await loadTodayCheckins(); renderCheckin(); await loadHistoryData(); }
        } finally { btn.disabled = false; }
      };
    });
  }
}

export async function loadCheckinTab() {
  ensureState();
  const $root = $('#checkinRoot');
  if (!state.user) {
    if ($root) $root.innerHTML = '<p class="hint" style="padding:24px;text-align:center;">Vui lòng đăng nhập</p>';
    return;
  }

  if ($root) {
    let loadingHtml = '<div style="text-align:center;padding:60px 20px;color:var(--text-muted);">';
    loadingHtml += '<div style="font-size:48px;margin-bottom:16px;">📸</div>';
    loadingHtml += '<div style="font-size:18px;font-weight:600;">Đang tải...</div>';
    loadingHtml += '</div>';
    $root.innerHTML = loadingHtml;
  }

  const tasks = [loadLocation(), loadTodayCheckins()];
  if (state.isAdmin) tasks.push(loadAdminTodayCheckins());
  await Promise.all(tasks);
  
  renderCheckin();
}