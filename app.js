// app.js
import { supabase } from './supabase.js';

/* ============ STATE ============ */
const state = {
  user: null,
  profile: null,
  employees: [],
  selectedEmployeeId: null,
  buildings: [],
  floors: [],
  currentMonth: new Date(), // tháng đang xem
  attendance: [], // data của employee + month hiện tại
  editingDate: null, // ngày đang chấm công (YYYY-MM-DD)
  modalAreas: [], // [{building_id, floor_id, hours}]
  floorSetupBuildingId: null,
};

const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

/* ============ HELPERS ============ */
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

function toDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatHours(h) {
  if (h == null || isNaN(h)) return '0h';
  return Number(h).toFixed(1).replace(/\.0$/, '') + 'h';
}

function openModal(id) { $('#' + id).style.display = 'flex'; }
function closeModal(id) { $('#' + id).style.display = 'none'; }

/* ============ AUTH ============ */
async function initAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) {
    await onLoggedIn(session.user);
  } else {
    showLogin();
  }
}

function showLogin() {
  $('#loading').style.display = 'none';
  $('#loginScreen').style.display = 'block';
  $('#mainScreen').style.display = 'none';
  $('#logoutBtn').style.display = 'none';
}

async function onLoggedIn(user) {
  state.user = user;
  // load profile
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();
  if (error && error.code !== 'PGRST116') console.warn('profile err', error);
  state.profile = profile || { full_name: user.email, role: 'employee', status: 'active' };

  $('#loading').style.display = 'none';
  $('#loginScreen').style.display = 'none';
  $('#mainScreen').style.display = 'block';
  $('#logoutBtn').style.display = 'block';

  await loadEmployees();
  await loadBuildings();
  setupDefaultEmployeeSelect();
  await loadAttendanceForMonth();
  renderCalendar();
}

async function handleLogout() {
  await supabase.auth.signOut();
  state.user = null;
  state.profile = null;
  state.employees = [];
  state.attendance = [];
  state.buildings = [];
  state.floors = [];
  showLogin();
}

/* ============ LOAD DATA ============ */
async function loadEmployees() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('full_name');
  if (error) { console.error(error); toast('Không tải được nhân viên'); return; }
  state.employees = data || [];
  renderEmployeeSelect();
  renderEmployeeList();
}

function setupDefaultEmployeeSelect() {
  if (state.employees.length && !state.selectedEmployeeId) {
    state.selectedEmployeeId = state.employees[0].id;
    $('#employeeSelect').value = state.selectedEmployeeId;
    updateSummary();
  }
}

function renderEmployeeSelect() {
  const sel = $('#employeeSelect');
  sel.innerHTML = state.employees.map(e =>
    `<option value="${e.id}">${e.full_name || e.email || 'N/A'}</option>`
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
    const name = e.full_name || e.email || 'N/A';
    const initial = name.trim().charAt(0).toUpperCase();
    const status = e.status === 'inactive' ? 'inactive' : 'active';
    const statusText = status === 'active' ? 'Đang làm' : 'Nghỉ';
    return `
      <div class="employee-card">
        <div class="avatar">${initial}</div>
        <div class="emp-info">
          <div class="emp-fullname">${name}</div>
          <div class="emp-pos">${e.position || e.role || 'Nhân viên'}</div>
          <span class="emp-status status-${status}">${statusText}</span>
        </div>
      </div>`;
  }).join('');
}

async function loadBuildings() {
  const { data: buildings, error: e1 } = await supabase.from('buildings').select('*').order('name');
  if (e1) { console.error(e1); toast('Không tải được toà nhà'); return; }
  state.buildings = buildings || [];

  if (state.buildings.length) {
    const ids = state.buildings.map(b => b.id);
    const { data: floors, error: e2 } = await supabase
      .from('floors').select('*').in('building_id', ids).order('floor_number');
    if (e2) console.error(e2);
    state.floors = floors || [];
  } else {
    state.floors = [];
  }
  renderBuildings();
}

async function loadAttendanceForMonth() {
  if (!state.selectedEmployeeId) { state.attendance = []; return; }
  const y = state.currentMonth.getFullYear();
  const m = state.currentMonth.getMonth();
  const start = `${y}-${pad(m + 1)}-01`;
  const end = `${y}-${pad(m + 1)}-${pad(new Date(y, m + 1, 0).getDate())}`;

  const { data, error } = await supabase
    .from('attendance')
    .select('*')
    .eq('employee_id', state.selectedEmployeeId)
    .gte('date', start)
    .lte('date', end);
  if (error) { console.error(error); state.attendance = []; }
  else state.attendance = data || [];
  updateSummary();
}

/* ============ SUMMARY ============ */
function updateSummary() {
  const emp = state.employees.find(e => e.id === state.selectedEmployeeId);
  if (!emp) {
    $('#sumName').textContent = '—';
    $('#sumRole').textContent = '—';
    $('#sumStatus').textContent = '—';
    $('#sumWork').textContent = '0h';
    $('#sumOT').textContent = '0h';
    return;
  }
  $('#sumName').textContent = emp.full_name || emp.email || '—';
  $('#sumRole').textContent = emp.position || emp.role || 'Nhân viên';
  const status = emp.status === 'inactive' ? 'Nghỉ' : 'Đang làm';
  $('#sumStatus').textContent = status;

  let work = 0, ot = 0;
  for (const a of state.attendance) {
    if (a.is_off) continue;
    work += Number(a.total_hours || 0);
    ot += Number(a.ot_hours || 0);
  }
  $('#sumWork').textContent = formatHours(work);
  $('#sumOT').textContent = formatHours(ot);
}

/* ============ CALENDAR ============ */
function renderCalendar() {
  const y = state.currentMonth.getFullYear();
  const m = state.currentMonth.getMonth();
  $('#monthLabel').textContent = `Tháng ${m + 1}/${y}`;

  const grid = $('#calendarGrid');
  const first = new Date(y, m, 1);
  const daysInMonth = new Date(y, m + 1, 0).getDate();

  // T2=0 ... CN=6
  let startCol = (first.getDay() + 6) % 7;
  const attMap = {};
  for (const a of state.attendance) attMap[a.date] = a;

  const todayStr = toDateStr(new Date());

  let html = '';
  for (let i = 0; i < startCol; i++) html += `<div class="cal-day empty"></div>`;

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${y}-${pad(m + 1)}-${pad(d)}`;
    const att = attMap[dateStr];
    let cls = 'cal-day';
    let sub = '';
    if (att) {
      if (att.is_off) {
        cls += ' off-day';
        sub = 'OFF';
      } else {
        cls += ' has-data';
        sub = formatHours(att.total_hours);
      }
    }
    if (dateStr === todayStr) cls += ' today';
    html += `<div class="${cls}" data-date="${dateStr}">
      <span class="day-num">${d}</span>
      ${sub ? `<span class="day-hours">${sub}</span>` : ''}
    </div>`;
  }
  grid.innerHTML = html;

  // attach long-press
  grid.querySelectorAll('.cal-day:not(.empty)').forEach(el => {
    attachLongPress(el, () => openAttendanceModal(el.dataset.date));
  });
}

/* ============ LONG PRESS ============ */
function attachLongPress(el, cb) {
  let timer = null;
  let moved = false;
  const DURATION = 550;

  const start = (e) => {
    moved = false;
    timer = setTimeout(() => {
      if (!moved) {
        if (navigator.vibrate) navigator.vibrate(30);
        cb();
      }
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

/* ============ ATTENDANCE MODAL ============ */
async function openAttendanceModal(dateStr) {
  if (!state.selectedEmployeeId) { toast('Chọn nhân viên trước'); return; }
  state.editingDate = dateStr;

  const emp = state.employees.find(e => e.id === state.selectedEmployeeId);
  $('#attModalTitle').textContent = `Chấm công — ${emp?.full_name || ''} — ${dateStr}`;

  // Tìm data cũ
  const existing = state.attendance.find(a => a.date === dateStr);

  // Khởi tạo areas
  if (existing && Array.isArray(existing.areas) && existing.areas.length) {
    state.modalAreas = existing.areas.map(a => ({
      building_id: a.building_id || '',
      floor_id: a.floor_id || '',
      hours: Number(a.hours || 0),
    }));
  } else if (existing && existing.is_off) {
    state.modalAreas = [];
  } else {
    state.modalAreas = [{ building_id: '', floor_id: '', hours: 0 }];
  }

  renderAreaPicker();

  // set mode
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
        Tầng ${f.floor_number} (${formatHours(f.default_hours)})
      </option>`
    ).join('');
    return `
      <div class="area-entry" data-idx="${idx}">
        <select class="area-building">
          <option value="">-- Toà nhà --</option>${bOpts}
        </select>
        <select class="area-floor">
          <option value="">-- Tầng --</option>${fOpts}
        </select>
        <button class="remove-area" data-remove="${idx}">✕</button>
      </div>`;
  }).join('');

  // bind
  wrap.querySelectorAll('.area-entry').forEach(entryEl => {
    const idx = Number(entryEl.dataset.idx);
    const bSel = entryEl.querySelector('.area-building');
    const fSel = entryEl.querySelector('.area-floor');
    bSel.addEventListener('change', () => {
      state.modalAreas[idx].building_id = bSel.value;
      state.modalAreas[idx].floor_id = '';
      renderAreaPicker();
      updatePreview();
    });
    fSel.addEventListener('change', () => {
      state.modalAreas[idx].floor_id = fSel.value;
      const f = state.floors.find(x => x.id === fSel.value);
      state.modalAreas[idx].hours = f ? Number(f.default_hours || 0) : 0;
      updatePreview();
    });
    entryEl.querySelector('.remove-area').addEventListener('click', () => {
      state.modalAreas.splice(idx, 1);
      renderAreaPicker();
      updatePreview();
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
  // default: sum floor hours
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
  const label = mode === 'off' ? 'OFF' : formatHours(total + ot);
  $('#attPreview').textContent = label;
}

async function saveAttendance() {
  if (!state.selectedEmployeeId || !state.editingDate) return;
  const mode = getSelectedMode();
  const total = computeHours();
  const ot = Number($('#otHours').value || 0);

  if (mode !== 'off' && total <= 0) {
    toast('Vui lòng chọn khu vực hoặc nhập giờ'); return;
  }

  const payload = {
    employee_id: state.selectedEmployeeId,
    date: state.editingDate,
    total_hours: mode === 'off' ? 0 : total,
    ot_hours: mode === 'off' ? 0 : ot,
    is_off: mode === 'off',
    mode: mode,
    manual_hours: mode === 'manual' ? Number($('#manualHours').value || 0) : null,
    areas: mode === 'off' ? [] : state.modalAreas
      .filter(a => a.building_id && a.floor_id)
      .map(a => ({ building_id: a.building_id, floor_id: a.floor_id, hours: a.hours })),
  };

  // upsert theo (employee_id, date)
  const { error } = await supabase
    .from('attendance')
    .upsert(payload, { onConflict: 'employee_id,date' });

  if (error) {
    console.error(error);
    toast('Lưu thất bại: ' + error.message);
    return;
  }
  toast('Đã lưu chấm công ✓');
  closeModal('attendanceModal');
  await loadAttendanceForMonth();
  renderCalendar();
}

/* ============ BUILDINGS ============ */
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
        <span class="floor-name">Tầng ${f.floor_number}</span>
        <span class="floor-hours">${formatHours(f.default_hours)}</span>
      </div>`).join('') || '<p class="hint" style="margin:0">Chưa setup tầng</p>';

    return `
      <div class="building-card" data-id="${b.id}">
        <h3>${b.name} <span class="floor-count">${floors.length} tầng</span></h3>
        <div class="building-floors">${floorRows}</div>
        <div class="building-actions">
          <button class="btn-small" data-setup="${b.id}">⚙️ Setup giờ tầng</button>
          <button class="btn-small" data-delete="${b.id}" style="background:#fee2e2;color:#e74c3c">🗑 Xoá</button>
        </div>
      </div>`;
  }).join('');

  wrap.querySelectorAll('[data-setup]').forEach(btn => {
    btn.addEventListener('click', () => openFloorSetup(btn.dataset.setup));
  });
  wrap.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', () => deleteBuilding(btn.dataset.delete));
  });
}

async function deleteBuilding(id) {
  if (!confirm('Xoá toà nhà này và tất cả tầng?')) return;
  const { error } = await supabase.from('buildings').delete().eq('id', id);
  if (error) { toast('Xoá thất bại'); return; }
  toast('Đã xoá');
  await loadBuildings();
}

async function saveBuilding() {
  const name = $('#buildingName').value.trim();
  const count = parseInt($('#buildingFloors').value, 10);
  if (!name) { toast('Nhập tên toà nhà'); return; }
  if (!count || count < 1) { toast('Số tầng không hợp lệ'); return; }

  const { data: b, error } = await supabase
    .from('buildings').insert({ name }).select().single();
  if (error) { toast('Lỗi: ' + error.message); return; }

  const floors = Array.from({ length: count }, (_, i) => ({
    building_id: b.id,
    floor_number: i + 1,
    default_hours: 8,
  }));
  const { error: e2 } = await supabase.from('floors').insert(floors);
  if (e2) { toast('Lỗi tạo tầng: ' + e2.message); return; }

  toast('Đã thêm toà nhà');
  closeModal('buildingModal');
  $('#buildingName').value = '';
  $('#buildingFloors').value = '1';
  await loadBuildings();
}

function openFloorSetup(buildingId) {
  state.floorSetupBuildingId = buildingId;
  const b = state.buildings.find(x => x.id === buildingId);
  $('#floorModalTitle').textContent = `Setup giờ tầng — ${b?.name || ''}`;

  const floors = state.floors.filter(f => f.building_id === buildingId)
    .sort((a, c) => a.floor_number - c.floor_number);

  const form = $('#floorsForm');
  form.innerHTML = floors.map(f => `
    <div class="floor-form-row" data-id="${f.id}">
      <span>Tầng ${f.floor_number}</span>
      <input type="number" class="hours-input" min="0" max="24" step="0.5"
        value="${f.default_hours ?? 8}" placeholder="Giờ" />
    </div>`).join('') || '<p class="hint">Chưa có tầng.</p>';

  openModal('floorModal');
}

async function saveFloors() {
  const rows = $$('#floorsForm .floor-form-row');
  const updates = [];
  rows.forEach(row => {
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
}

/* ============ TABS ============ */
function switchTab(name) {
  $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab-content').forEach(c => c.classList.toggle('active', c.id === 'tab-' + name));
}

/* ============ MONTH NAV ============ */
async function changeMonth(delta) {
  const d = new Date(state.currentMonth);
  d.setMonth(d.getMonth() + delta);
  state.currentMonth = d;
  await loadAttendanceForMonth();
  renderCalendar();
}

/* ============ EVENTS ============ */
function bindEvents() {
  // Login
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#loginEmail').value.trim();
    const pass = $('#loginPassword').value;
    $('#loginError').textContent = '';
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: pass });
    if (error) { $('#loginError').textContent = error.message; return; }
    await onLoggedIn(data.user);
  });

  // Logout
  $('#logoutBtn').addEventListener('click', handleLogout);

  // Tabs
  $$('.tab-btn').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  // Employee select
  $('#employeeSelect').addEventListener('change', async (e) => {
    state.selectedEmployeeId = e.target.value;
    await loadAttendanceForMonth();
    renderCalendar();
  });

  // Month nav
  $('#prevMonth').addEventListener('click', () => changeMonth(-1));
  $('#nextMonth').addEventListener('click', () => changeMonth(1));

  // Attendance modal
  $('#attendanceModal').addEventListener('click', (e) => {
    if (e.target.id === 'attendanceModal') closeModal('attendanceModal');
  });
  $$('input[name="attMode"]').forEach(r => {
    r.addEventListener('change', () => {
      toggleManualHours(r.value);
      updatePreview();
    });
  });
  $('#manualHours').addEventListener('input', updatePreview);
  $('#otHours').addEventListener('input', updatePreview);
  $('#addAreaEntryBtn').addEventListener('click', () => {
    state.modalAreas.push({ building_id: '', floor_id: '', hours: 0 });
    renderAreaPicker();
  });
  $('#saveAttendanceBtn').addEventListener('click', saveAttendance);

  // Building modal
  $('#addBuildingBtn').addEventListener('click', () => openModal('buildingModal'));
  $('#buildingModal').addEventListener('click', (e) => {
    if (e.target.id === 'buildingModal') closeModal('buildingModal');
  });
  $('#saveBuildingBtn').addEventListener('click', saveBuilding);

  // Floor modal
  $('#floorModal').addEventListener('click', (e) => {
    if (e.target.id === 'floorModal') closeModal('floorModal');
  });
  $('#saveFloorsBtn').addEventListener('click', saveFloors);

  // Close buttons
  $$('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });

  // Auth listener
  supabase.auth.onAuthStateChange((_event, session) => {
    if (!session) showLogin();
  });
}

/* ============ BOOT ============ */
document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  initAuth();
});