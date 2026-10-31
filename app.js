// app.js
import { supabase } from './supabase.js';

const DEFAULT_DOMAIN = 'skyone.vn';
const LS_KEY = 'cc_saved_login';

const state = {
  user: null,
  profile: null,
  isAdmin: false,
  employees: [],
  selectedEmployeeId: null,
  buildings: [],
  floors: [],
  currentMonth: new Date(),
  attendance: [],
  editingDate: null,
  modalAreas: [],
  floorSetupBuildingId: null,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function toast(msg, duration = 2200) {
  const el = $('#toast');
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.style.display = 'none'), duration);
}

function pad(n) { return String(n).padStart(2, '0'); }
function toDateStr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

function formatHours(h) {
  if (h == null || isNaN(h)) return '0h';
  const n = Number(h);
  if (Number.isInteger(n)) return n + 'h';
  return n.toFixed(2).replace(/\.?0+$/, '') + 'h';
}

function floorLabel(n) { return n === 0 ? 'Trệt' : `Tầng ${n}`; }

// ⭐ Label chức danh: admin → "Giám sát"
function roleLabelOf(p) {
  if (!p) return 'Nhân viên';
  if (p.role === 'admin') return 'Giám sát';
  return p.position || 'Nhân viên';
}

function openModal(id) { $('#' + id).style.display = 'flex'; }
function closeModal(id) { $('#' + id).style.display = 'none'; }

/* ============ AUTH ============ */
async function initAuth() {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (saved) {
      $('#loginEmail').value = saved.username || '';
      $('#loginPassword').value = saved.password || '';
      $('#rememberPass').checked = true;
    }
  } catch {}

  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) await onLoggedIn(session.user);
  else showLogin();
}

function showLogin() {
  $('#loading').style.display = 'none';
  $('#loginScreen').style.display = 'block';
  $('#mainScreen').style.display = 'none';
  $('#logoutBtn').style.display = 'none';
  $('#addEmployeeBtn').style.display = 'none';
}

async function onLoggedIn(user) {
  state.user = user;

  const { data: profile } = await supabase
    .from('profiles').select('*').eq('id', user.id).single();
  state.profile = profile || { full_name: user.email, role: 'employee', status: 'active' };

  // Bị vô hiệu hoá → kick ra
  if (state.profile?.status === 'inactive') {
    await supabase.auth.signOut();
    showLogin();
    $('#loginError').textContent = 'Tài khoản đã bị vô hiệu hoá. Liên hệ admin.';
    return;
  }

  // ⭐ Chỉ có 1 role quản lý: admin (hiển thị "Giám sát")
  state.isAdmin = state.profile?.role === 'admin';

  $('#loading').style.display = 'none';
  $('#loginScreen').style.display = 'none';
  $('#mainScreen').style.display = 'block';
  $('#logoutBtn').style.display = 'block';

  // Phân quyền UI
  $('#addEmployeeBtn').style.display = state.isAdmin ? 'block' : 'none';
  $$('.tab-btn[data-tab="areas"]').forEach(el => el.style.display = state.isAdmin ? '' : 'none');
  $$('.tab-btn[data-tab="employees"]').forEach(el => el.style.display = state.isAdmin ? '' : 'none');
  $('#empSelectorRow').style.display = state.isAdmin ? '' : 'none';
  $('#calendarHint').style.display = state.isAdmin ? '' : 'none';

  // ⭐ Mọi role mặc định xem lịch của CHÍNH MÌNH
  state.selectedEmployeeId = user.id;
  switchTab('calendar');

  await loadEmployees();
  await loadBuildings();
  await loadAttendanceForMonth();
  renderCalendar();
}

async function handleLogout() {
  await supabase.auth.signOut();
  Object.assign(state, {
    user: null, profile: null, isAdmin: false, employees: [],
    selectedEmployeeId: null, buildings: [], floors: [],
    attendance: [],
  });
  showLogin();
}

/* ============ EMPLOYEES ============ */
async function loadEmployees() {
  const { data, error } = await supabase.from('profiles').select('*').order('full_name');
  if (error) { console.error(error); toast('Không tải được nhân viên'); return; }
  state.employees = data || [];

  // User đang chọn bị xoá → quay về chính mình
  if (state.selectedEmployeeId && !state.employees.find(e => e.id === state.selectedEmployeeId)) {
    state.selectedEmployeeId = state.user?.id || (state.employees[0]?.id ?? null);
  }

  renderEmployeeSelect();
  renderEmployeeList();
}

function renderEmployeeSelect() {
  const sel = $('#employeeSelect');
  sel.innerHTML = state.employees.map(e =>
    `<option value="${e.id}">${e.full_name || e.username || e.email || 'N/A'}</option>`
  ).join('');
  if (state.selectedEmployeeId) sel.value = state.selectedEmployeeId;
}

function renderEmployeeList() {
  const wrap = $('#employeesList');
  if (!state.employees.length) {
    wrap.innerHTML = '<p class="hint">Chưa có nhân viên.</p>';
    return;
  }
  wrap.innerHTML = state.employees.map(e => {
    const name = e.full_name || e.username || e.email || 'N/A';
    const initial = name.trim().charAt(0).toUpperCase();
    const isActive = e.status !== 'inactive';
    const statusText = isActive ? 'Đang làm' : 'Đã vô hiệu';
    const roleLabel = roleLabelOf(e); // ⭐ "Giám sát" nếu admin
    const isSelf = e.id === state.user?.id;
    const canManage = state.isAdmin && !isSelf;

    const actions = canManage ? `
      <div style="display:flex;flex-direction:column;gap:6px;margin-left:8px;flex-shrink:0">
        <button class="btn-small" data-emp-toggle="${e.id}" data-current="${isActive ? 'active' : 'inactive'}"
          style="background:${isActive ? '#fef3c7;color:#b45309' : '#dcfce7;color:#16a34a'};padding:6px 10px;margin:0"
          title="${isActive ? 'Vô hiệu hoá' : 'Kích hoạt lại'}">
          ${isActive ? '⏸' : '▶'}
        </button>
        <button class="btn-small" data-emp-delete="${e.id}" data-name="${name.replace(/"/g, '&quot;')}"
          style="background:#fee2e2;color:#e74c3c;padding:6px 10px;margin:0" title="Xoá vĩnh viễn">
          🗑
        </button>
      </div>` : '';

    return `
      <div class="employee-card" style="${!isActive ? 'opacity:0.75' : ''}">
        <div class="avatar" style="${!isActive ? 'filter:grayscale(1)' : ''}">${initial}</div>
        <div class="emp-info">
          <div class="emp-fullname">${name}${isSelf ? ' <span style="font-size:11px;color:var(--text-muted)">(bạn)</span>' : ''}</div>
          <div class="emp-pos">${roleLabel}${e.username ? ' · @' + e.username : ''}</div>
          <span class="emp-status status-${isActive ? 'active' : 'inactive'}">${statusText}</span>
        </div>
        ${actions}
      </div>`;
  }).join('');

  wrap.querySelectorAll('[data-emp-toggle]').forEach(btn => {
    btn.addEventListener('click', () =>
      toggleEmployeeStatus(btn.dataset.empToggle, btn.dataset.current));
  });
  wrap.querySelectorAll('[data-emp-delete]').forEach(btn => {
    btn.addEventListener('click', () =>
      deleteEmployee(btn.dataset.empDelete, btn.dataset.name));
  });
}

async function toggleEmployeeStatus(userId, currentStatus) {
  if (!state.isAdmin) return;
  const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
  const msg = newStatus === 'inactive'
    ? 'Vô hiệu hoá nhân viên này?\n\nHọ sẽ không đăng nhập được nữa.'
    : 'Kích hoạt lại nhân viên này?';
  if (!confirm(msg)) return;

  const { error } = await supabase.rpc('admin_set_user_status', {
    p_user_id: userId,
    p_status: newStatus,
  });
  if (error) {
    toast('Lỗi: ' + error.message.replace(/^ERROR:\s*/i, ''));
    return;
  }
  toast(newStatus === 'inactive' ? '⏸ Đã vô hiệu hoá' : '▶ Đã kích hoạt');
  await loadEmployees();
}

async function deleteEmployee(userId, name) {
  if (!state.isAdmin) return;
  const ok = confirm(
    `Xoá vĩnh viễn "${name}"?\n\n` +
    `• Tài khoản đăng nhập sẽ bị xoá\n` +
    `• Toàn bộ lịch sử chấm công sẽ bị xoá\n` +
    `• Không thể hoàn tác`
  );
  if (!ok) return;

  const { error } = await supabase.rpc('admin_delete_user', { p_user_id: userId });
  if (error) {
    toast('Lỗi: ' + error.message.replace(/^ERROR:\s*/i, ''));
    return;
  }
  toast('🗑 Đã xoá nhân viên');
  await loadEmployees();
  await loadAttendanceForMonth();
  renderCalendar();
}

async function createEmployee() {
  if (!state.isAdmin) { toast('Chỉ Giám sát được tạo nhân viên'); return; }
  const username = $('#empUsername').value.trim().toLowerCase();
  const password = $('#empPassword').value;
  const full_name = $('#empFullName').value.trim();
  const errEl = $('#empCreateError');
  errEl.textContent = '';

  if (!username) { errEl.textContent = 'Nhập tên đăng nhập'; return; }
  if (password.length < 6) { errEl.textContent = 'Mật khẩu tối thiểu 6 ký tự'; return; }
  if (full_name.length < 2) { errEl.textContent = 'Tên hiển thị quá ngắn'; return; }

  const btn = $('#saveEmployeeBtn');
  btn.disabled = true; btn.textContent = 'Đang tạo...';

  const { error } = await supabase.rpc('admin_create_employee', {
    p_username: username, p_password: password, p_full_name: full_name,
  });

  btn.disabled = false; btn.textContent = 'Tạo';
  if (error) {
    errEl.textContent = (error.message || 'Tạo thất bại').replace(/^ERROR:\s*/i, '');
    return;
  }
  toast('Đã tạo nhân viên ✓');
  closeModal('employeeModal');
  await loadEmployees();
}

/* ============ BUILDINGS ============ */
async function loadBuildings() {
  const { data: buildings, error: e1 } = await supabase.from('buildings').select('*').order('name');
  if (e1) { console.error(e1); return; }
  state.buildings = buildings || [];

  if (state.buildings.length) {
    const ids = state.buildings.map(b => b.id);
    const { data: floors } = await supabase
      .from('floors').select('*').in('building_id', ids).order('floor_number');
    state.floors = floors || [];
  } else state.floors = [];
  renderBuildings();
}

function renderBuildings() {
  const wrap = $('#buildingsList');
  if (!state.buildings.length) {
    wrap.innerHTML = '<p class="hint">Chưa có toà nhà nào. Nhấn "+ Thêm tòa nhà".</p>';
    return;
  }
  wrap.innerHTML = state.buildings.map(b => {
    const floors = state.floors.filter(f => f.building_id === b.id)
      .sort((a, c) => a.floor_number - c.floor_number);
    const floorRows = floors.map(f => `
      <div class="floor-row">
        <span class="floor-name">${floorLabel(f.floor_number)}</span>
        <span class="floor-hours">${formatHours(f.default_hours)}</span>
      </div>`).join('') || '<p class="hint" style="margin:0">Chưa setup tầng</p>';

    return `
      <div class="building-card" data-id="${b.id}">
        <h3>${b.name} <span class="floor-count">${floors.length} mặt bằng</span></h3>
        <div class="building-floors">${floorRows}</div>
        <div class="building-actions">
          <button class="btn-small" data-setup="${b.id}">⚙️ Setup giờ tầng</button>
          <button class="btn-small" data-delete="${b.id}" style="background:#fee2e2;color:#e74c3c">🗑 Xoá</button>
        </div>
      </div>`;
  }).join('');

  wrap.querySelectorAll('[data-setup]').forEach(btn =>
    btn.addEventListener('click', () => openFloorSetup(btn.dataset.setup)));
  wrap.querySelectorAll('[data-delete]').forEach(btn =>
    btn.addEventListener('click', () => deleteBuilding(btn.dataset.delete)));
}

async function deleteBuilding(id) {
  if (!confirm('Xoá toà nhà này và tất cả tầng?')) return;
  const { error } = await supabase.from('buildings').delete().eq('id', id);
  if (error) { toast('Xoá thất bại'); return; }
  toast('Đã xoá');
  await loadBuildings();
}

async function saveBuilding() {
  if (!state.isAdmin) { toast('Chỉ Giám sát được thêm toà nhà'); return; }
  const name = $('#buildingName').value.trim();
  const count = parseInt($('#buildingFloors').value, 10);
  const noGround = $('#noGroundFloor').checked;

  if (!name) { toast('Nhập tên toà nhà'); return; }
  if (!count || count < 1) { toast('Số tầng lầu không hợp lệ'); return; }
  if (count > 50) { toast('Tối đa 50 tầng lầu'); return; }

  const { data: b, error } = await supabase
    .from('buildings').insert({ name }).select().single();
  if (error) { toast('Lỗi: ' + error.message); return; }

  const startFloor = noGround ? 1 : 0;
  const floors = [];
  for (let i = 0; i < count; i++) {
    floors.push({
      building_id: b.id,
      floor_number: startFloor + i,
      default_hours: 8,
    });
  }
  const { error: e2 } = await supabase.from('floors').insert(floors);
  if (e2) { toast('Lỗi tạo tầng: ' + e2.message); return; }

  toast(`Đã tạo ${name} với ${floors.length} mặt bằng`);
  closeModal('buildingModal');
  $('#buildingName').value = '';
  $('#buildingFloors').value = '1';
  $('#noGroundFloor').checked = false;
  await loadBuildings();
}

function openFloorSetup(buildingId) {
  state.floorSetupBuildingId = buildingId;
  const b = state.buildings.find(x => x.id === buildingId);
  $('#floorModalTitle').textContent = `Setup giờ tầng — ${b?.name || ''}`;

  const floors = state.floors.filter(f => f.building_id === buildingId)
    .sort((a, c) => a.floor_number - c.floor_number);

  $('#floorsForm').innerHTML = floors.map(f => `
    <div class="floor-form-row" data-id="${f.id}">
      <span>${floorLabel(f.floor_number)}</span>
      <input type="number" class="hours-input" min="0" max="24" step="0.5"
        value="${f.default_hours ?? 8}" placeholder="Giờ" />
    </div>`).join('') || '<p class="hint">Chưa có tầng.</p>';

  openModal('floorModal');
}

async function saveFloors() {
  const updates = [];
  $$('#floorsForm .floor-form-row').forEach(row => {
    const id = row.dataset.id;
    const val = Number(row.querySelector('input').value || 0);
    updates.push(supabase.from('floors').update({ default_hours: val }).eq('id', id));
  });
  const results = await Promise.all(updates);
  const failed = results.find(r => r.error);
  if (failed) { toast('Lỗi lưu: ' + failed.error.message); return; }
  toast('Đã lưu giờ tầng ✓');
  closeModal('floorModal');
  await loadBuildings();
  await loadAttendanceForMonth();
  renderCalendar();
}

/* ============ ATTENDANCE ============ */
async function loadAttendanceForMonth() {
  if (!state.selectedEmployeeId) { state.attendance = []; return; }
  const y = state.currentMonth.getFullYear();
  const m = state.currentMonth.getMonth();
  const start = `${y}-${pad(m + 1)}-01`;
  const end = `${y}-${pad(m + 1)}-${pad(new Date(y, m + 1, 0).getDate())}`;

  const { data, error } = await supabase
    .from('attendance').select('*')
    .eq('employee_id', state.selectedEmployeeId)
    .gte('date', start).lte('date', end);
  if (error) { console.error(error); state.attendance = []; }
  else state.attendance = data || [];
  updateSummary();
}

function updateSummary() {
  const emp = state.employees.find(e => e.id === state.selectedEmployeeId);
  if (!emp) {
    ['sumName', 'sumRole', 'sumStatus'].forEach(id => $('#' + id).textContent = '—');
    ['sumWork', 'sumOT'].forEach(id => $('#' + id).textContent = '0h');
    return;
  }
  $('#sumName').textContent = emp.full_name || emp.username || emp.email || '—';
  $('#sumRole').textContent = roleLabelOf(emp); // ⭐ "Giám sát" nếu admin
  $('#sumStatus').textContent = emp.status === 'inactive' ? 'Nghỉ' : 'Đang làm';

  let work = 0, ot = 0;
  for (const a of state.attendance) {
    if (a.is_off) continue;
    work += Number(a.total_hours || 0);
    ot += Number(a.ot_hours || 0);
  }
  $('#sumWork').textContent = formatHours(work);
  $('#sumOT').textContent = formatHours(ot);
}

async function openAttendanceModal(dateStr) {
  if (!state.isAdmin) { toast('Chỉ Giám sát được chấm công'); return; }
  if (!state.selectedEmployeeId) { toast('Chọn nhân viên trước'); return; }
  state.editingDate = dateStr;

  const emp = state.employees.find(e => e.id === state.selectedEmployeeId);
  $('#attModalTitle').textContent = `Chấm công — ${emp?.full_name || ''} — ${dateStr}`;

  const existing = state.attendance.find(a => a.date === dateStr);
  if (existing && Array.isArray(existing.areas) && existing.areas.length) {
    state.modalAreas = existing.areas.map(a => ({
      building_id: a.building_id || '', floor_id: a.floor_id || '', hours: Number(a.hours || 0),
    }));
  } else if (existing && existing.is_off) state.modalAreas = [];
  else state.modalAreas = [{ building_id: '', floor_id: '', hours: 0 }];

  renderAreaPicker();

  let mode = 'default';
  if (existing) {
    if (existing.is_off) mode = 'off';
    else if (existing.mode === 'manual') mode = 'manual';
  }
  $$('input[name="attMode"]').forEach(r => r.checked = r.value === mode);
  toggleManualHours(mode);
  $('#manualHours').value = existing?.manual_hours ?? '';
  $('#otHours').value = existing?.ot_hours ?? '';
  updatePreview();
  openModal('attendanceModal');
}

function renderAreaPicker() {
  const wrap = $('#areaPicker');
  if (!state.modalAreas.length) {
    wrap.innerHTML = '<p class="hint">Chưa có khu vực. Nhấn "+ Thêm khu vực".</p>';
    return;
  }
  wrap.innerHTML = state.modalAreas.map((entry, idx) => {
    const bOpts = state.buildings.map(b =>
      `<option value="${b.id}" ${b.id === entry.building_id ? 'selected' : ''}>${b.name}</option>`
    ).join('');
    const floorsOfB = state.floors.filter(f => f.building_id === entry.building_id);
    const fOpts = floorsOfB.map(f =>
      `<option value="${f.id}" ${f.id === entry.floor_id ? 'selected' : ''}>
        ${floorLabel(f.floor_number)} (${formatHours(f.default_hours)})
      </option>`
    ).join('');
    return `
      <div class="area-entry" data-idx="${idx}">
        <select class="area-building"><option value="">-- Toà nhà --</option>${bOpts}</select>
        <select class="area-floor"><option value="">-- Tầng --</option>${fOpts}</select>
        <button class="remove-area" data-remove="${idx}">✕</button>
      </div>`;
  }).join('');

  wrap.querySelectorAll('.area-entry').forEach(entryEl => {
    const idx = Number(entryEl.dataset.idx);
    const bSel = entryEl.querySelector('.area-building');
    const fSel = entryEl.querySelector('.area-floor');
    bSel.addEventListener('change', () => {
      state.modalAreas[idx].building_id = bSel.value;
      state.modalAreas[idx].floor_id = '';
      renderAreaPicker(); updatePreview();
    });
    fSel.addEventListener('change', () => {
      state.modalAreas[idx].floor_id = fSel.value;
      const f = state.floors.find(x => x.id === fSel.value);
      state.modalAreas[idx].hours = f ? Number(f.default_hours || 0) : 0;
      updatePreview();
    });
    entryEl.querySelector('.remove-area').addEventListener('click', () => {
      state.modalAreas.splice(idx, 1);
      renderAreaPicker(); updatePreview();
    });
  });
}

function toggleManualHours(mode) {
  $('#manualHoursGroup').style.display = mode === 'manual' ? 'block' : 'none';
}

function getSelectedMode() {
  return document.querySelector('input[name="attMode"]:checked')?.value || 'default';
}

function computeHours() {
  const mode = getSelectedMode();
  if (mode === 'off') return 0;
  if (mode === 'manual') return Number($('#manualHours').value || 0);
  let h = 0;
  for (const entry of state.modalAreas) {
    if (entry.floor_id) {
      const f = state.floors.find(x => x.id === entry.floor_id);
      if (f) h += Number(f.default_hours || 0);
    }
  }
  return h;
}

function updatePreview() {
  const mode = getSelectedMode();
  const total = computeHours();
  const ot = Number($('#otHours').value || 0);
  $('#attPreview').textContent = mode === 'off' ? 'OFF' : formatHours(total + ot);
  $('#shareNote').style.display = (mode === 'default' && total > 0) ? 'block' : 'none';
}

async function saveAttendance() {
  if (!state.isAdmin) { toast('Chỉ Giám sát được chấm công'); return; }
  if (!state.selectedEmployeeId || !state.editingDate) return;

  const mode = getSelectedMode();
  const total = computeHours();
  const ot = Number($('#otHours').value || 0);
  if (mode !== 'off' && total <= 0) { toast('Vui lòng chọn khu vực hoặc nhập giờ'); return; }

  const payload = {
    employee_id: state.selectedEmployeeId,
    date: state.editingDate,
    total_hours: mode === 'off' ? 0 : total,
    ot_hours: mode === 'off' ? 0 : ot,
    is_off: mode === 'off',
    mode,
    manual_hours: mode === 'manual' ? Number($('#manualHours').value || 0) : null,
    areas: mode === 'off' ? [] : state.modalAreas
      .filter(a => a.building_id && a.floor_id)
      .map(a => ({ building_id: a.building_id, floor_id: a.floor_id, hours: a.hours })),
  };

  const { error } = await supabase.from('attendance').upsert(payload, { onConflict: 'employee_id,date' });
  if (error) { toast('Lưu thất bại: ' + error.message); return; }

  const { error: rcErr } = await supabase.rpc('recalc_day_attendance', { p_date: state.editingDate });
  if (rcErr) console.warn('recalc failed:', rcErr);

  toast('Đã lưu chấm công ✓');
  closeModal('attendanceModal');
  await loadAttendanceForMonth();
  renderCalendar();
}

/* ============ CALENDAR ============ */
function renderCalendar() {
  const y = state.currentMonth.getFullYear();
  const m = state.currentMonth.getMonth();
  $('#monthLabel').textContent = `Tháng ${m + 1}/${y}`;

  const grid = $('#calendarGrid');
  const first = new Date(y, m, 1);
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const startCol = (first.getDay() + 6) % 7;

  const attMap = {};
  for (const a of state.attendance) attMap[a.date] = a;
  const todayStr = toDateStr(new Date());

  let html = '';
  for (let i = 0; i < startCol; i++) html += `<div class="cal-day empty"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${y}-${pad(m + 1)}-${pad(d)}`;
    const att = attMap[dateStr];
    let cls = 'cal-day'; let sub = '';
    if (att) {
      if (att.is_off) { cls += ' off-day'; sub = 'OFF'; }
      else { cls += ' has-data'; sub = formatHours(att.total_hours); }
    }
    if (dateStr === todayStr) cls += ' today';
    html += `<div class="${cls}" data-date="${dateStr}">
      <span class="day-num">${d}</span>
      ${sub ? `<span class="day-hours">${sub}</span>` : ''}
    </div>`;
  }
  grid.innerHTML = html;

  if (state.isAdmin) {
    grid.querySelectorAll('.cal-day:not(.empty)').forEach(el =>
      attachLongPress(el, () => openAttendanceModal(el.dataset.date)));
  }
}

function attachLongPress(el, cb) {
  let timer = null; let moved = false;
  const DURATION = 550;
  const start = () => {
    moved = false;
    timer = setTimeout(() => {
      if (!moved) { if (navigator.vibrate) navigator.vibrate(30); cb(); }
    }, DURATION);
  };
  const cancel = () => { clearTimeout(timer); timer = null; };
  const move = () => { moved = true; cancel(); };

  el.addEventListener('touchstart', start, { passive: true });
  el.addEventListener('touchend', cancel);
  el.addEventListener('touchmove', move, { passive: true });
  el.addEventListener('touchcancel', cancel);
  el.addEventListener('mousedown', start);
  el.addEventListener('mouseup', cancel);
  el.addEventListener('mouseleave', cancel);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

function switchTab(name) {
  $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab-content').forEach(c => c.classList.toggle('active', c.id === 'tab-' + name));
}

async function changeMonth(delta) {
  const d = new Date(state.currentMonth);
  d.setMonth(d.getMonth() + delta);
  state.currentMonth = d;
  await loadAttendanceForMonth();
  renderCalendar();
}

/* ============ EVENTS ============ */
function bindEvents() {
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    let raw = $('#loginEmail').value.trim();
    if (!raw) { $('#loginError').textContent = 'Nhập tên đăng nhập'; return; }
    if (!raw.includes('@')) raw = `${raw}@${DEFAULT_DOMAIN}`;
    const pass = $('#loginPassword').value;
    const remember = $('#rememberPass').checked;

    $('#loginError').textContent = '';
    const { data, error } = await supabase.auth.signInWithPassword({ email: raw, password: pass });
    if (error) { $('#loginError').textContent = 'Sai tên đăng nhập hoặc mật khẩu'; return; }

    if (remember) {
      localStorage.setItem(LS_KEY, JSON.stringify({
        username: $('#loginEmail').value.trim(), password: pass,
      }));
    } else localStorage.removeItem(LS_KEY);

    await onLoggedIn(data.user);
  });

  $('#logoutBtn').addEventListener('click', handleLogout);
  $$('.tab-btn').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  $('#employeeSelect').addEventListener('change', async (e) => {
    state.selectedEmployeeId = e.target.value;
    await loadAttendanceForMonth();
    renderCalendar();
  });

  $('#prevMonth').addEventListener('click', () => changeMonth(-1));
  $('#nextMonth').addEventListener('click', () => changeMonth(1));

  $('#attendanceModal').addEventListener('click', (e) => {
    if (e.target.id === 'attendanceModal') closeModal('attendanceModal');
  });
  $$('input[name="attMode"]').forEach(r => r.addEventListener('change', () => {
    toggleManualHours(r.value); updatePreview();
  }));
  $('#manualHours').addEventListener('input', updatePreview);
  $('#otHours').addEventListener('input', updatePreview);
  $('#addAreaEntryBtn').addEventListener('click', () => {
    state.modalAreas.push({ building_id: '', floor_id: '', hours: 0 });
    renderAreaPicker();
  });
  $('#saveAttendanceBtn').addEventListener('click', saveAttendance);

  $('#addBuildingBtn').addEventListener('click', () => openModal('buildingModal'));
  $('#buildingModal').addEventListener('click', (e) => {
    if (e.target.id === 'buildingModal') closeModal('buildingModal');
  });
  $('#saveBuildingBtn').addEventListener('click', saveBuilding);

  $('#floorModal').addEventListener('click', (e) => {
    if (e.target.id === 'floorModal') closeModal('floorModal');
  });
  $('#saveFloorsBtn').addEventListener('click', saveFloors);

  $('#addEmployeeBtn').addEventListener('click', () => {
    $('#empUsername').value = ''; $('#empPassword').value = ''; $('#empFullName').value = '';
    $('#empCreateError').textContent = '';
    openModal('employeeModal');
  });
  $('#employeeModal').addEventListener('click', (e) => {
    if (e.target.id === 'employeeModal') closeModal('employeeModal');
  });
  $('#saveEmployeeBtn').addEventListener('click', createEmployee);

  $$('[data-close]').forEach(btn =>
    btn.addEventListener('click', () => closeModal(btn.dataset.close)));

  supabase.auth.onAuthStateChange((_event, session) => {
    if (!session) showLogin();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  initAuth();
});