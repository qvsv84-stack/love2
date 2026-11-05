// app.js
import { supabase } from './supabase.js';
import { initExportModule } from './export.js';
import { initSalaryModule } from './salary.js';

const DEFAULT_DOMAIN = 'skyone.vn';
const LS_KEY = 'cc_saved_login';
const SUPERVISOR_HOURS = 8;
const DAILY_MAIN_CAP = 8;

const ROLE_LABELS = {
  admin: 'Giám sát',
  temporary: 'Thời vụ',
  employee: 'Nhân viên',
  external: 'Ngoại cảnh',
};

const ROLE_ORDER = { admin: 1, employee: 2, temporary: 3, external: 4 };

const state = {
  user: null,
  profile: null,
  isAdmin: false,
  isSupervisorMode: false,
  employees: [],
  selectedEmployeeId: null,
  buildings: [],
  floors: [],
  currentMonth: new Date(),
  attendance: [],
  editingDate: null,
  batchDates: null,
  modalAreas: [],
  modalOtAreas: [],
  floorSetupBuildingId: null,
  selectionMode: false,
  selectedDates: new Set(),
  phoneActionNumber: '',
  editingEmployeeId: null,
  floorAssignments: {},
  areasSearch: '',
  areasRoleFilter: 'all',
  salaryMonth: new Date(),
  salaryRoleFilter: 'nv_tv',
  salarySearch: '',
  salarySort: 'hours_desc',
  salaryData: [],
  salaryMeta: null,
  // Excel tab
  excelMonth: new Date(),
  excelProfiles: [],
  excelAttendance: [],
  excelActionEmpId: null,
};

let exportModule = null;
let salaryModule = null;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

/* ============ HELPERS ============ */
function toast(msg, duration = 2200) {
  const el = $('#toast');
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.style.display = 'none'), duration);
}

function pad(n) { return String(n).padStart(2, '0'); }
function toDateStr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

function formatDateVN(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function formatHours(h) {
  if (h == null || isNaN(h)) return '0h';
  const n = Number(h);
  if (Number.isInteger(n)) return n + 'h';
  return n.toFixed(2).replace(/\.?0+$/, '') + 'h';
}

function formatVND(n) {
  if (!n || isNaN(n)) return '0 đ';
  return new Intl.NumberFormat('vi-VN').format(Math.round(n)) + ' đ';
}

function floorLabel(n) { return n === 0 ? 'Trệt' : `Tầng ${n}`; }

function roleLabelOf(p) {
  if (!p) return 'Nhân viên';
  if (p.role === 'admin') return ROLE_LABELS.admin;
  if (p.role === 'temporary') return ROLE_LABELS.temporary;
  if (p.role === 'external') return ROLE_LABELS.external;
  return p.position || ROLE_LABELS.employee;
}

function sortEmployees(arr) {
  return [...arr].sort((a, b) => {
    const oa = ROLE_ORDER[a.role] || 99;
    const ob = ROLE_ORDER[b.role] || 99;
    if (oa !== ob) return oa - ob;
    const na = a.full_name || a.username || '';
    const nb = b.full_name || b.username || '';
    return na.localeCompare(nb, 'vi');
  });
}

function getShortName(fullName) {
  if (!fullName) return '';
  const parts = fullName.trim().split(/\s+/);
  return parts[parts.length - 1];
}

function openModal(id) { $('#' + id).style.display = 'flex'; }
function closeModal(id) { $('#' + id).style.display = 'none'; }

/* ⭐ Lazy load html2canvas — chỉ tải khi cần */
let _html2canvasPromise = null;
function loadHtml2Canvas() {
  if (window.html2canvas) return Promise.resolve(window.html2canvas);
  if (_html2canvasPromise) return _html2canvasPromise;
  _html2canvasPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    s.async = true;
    s.onload = () => resolve(window.html2canvas);
    s.onerror = () => { _html2canvasPromise = null; reject(new Error('html2canvas load failed')); };
    document.head.appendChild(s);
  });
  return _html2canvasPromise;
}

/* ⭐ Cache attendance theo employee_id + year-month */
const attendanceCache = {};
function attendanceCacheKey(empId, y, m) {
  return `${empId}_${y}_${m}`;
}
function invalidateAttendanceCache(empId) {
  if (empId) {
    Object.keys(attendanceCache).forEach(k => {
      if (k.startsWith(empId + '_')) delete attendanceCache[k];
    });
  } else {
    Object.keys(attendanceCache).forEach(k => delete attendanceCache[k]);
  }
}

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

  // ⭐ Timeout 8s — nếu Supabase treo, không để trang trắng
  let session = null;
  try {
    const sessionPromise = supabase.auth.getSession();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('AUTH_TIMEOUT')), 8000)
    );
    const { data } = await Promise.race([sessionPromise, timeoutPromise]);
    session = data?.session;
  } catch (err) {
    console.warn('[Auth]', err.message);
    session = null;
  }

  if (session?.user) {
    try { await onLoggedIn(session.user); }
    catch (err) { console.error(err); await showGuestView(); }
  } else {
    await showGuestView();
  }
}

function showLoginScreen() {
  $('#loginScreen').style.display = 'block';
  $('#mainScreen').style.display = 'none';
}

async function showGuestView() {
  state.user = null;
  state.profile = null;
  state.isAdmin = false;
  state.isSupervisorMode = false;
  state.employees = [];
  state.selectedEmployeeId = null;
  state.attendance = [];
  state.selectionMode = false;
  state.selectedDates.clear();
  state.batchDates = null;
  state.floorAssignments = {};

  $('#loading').style.display = 'none';
  $('#loginScreen').style.display = 'none';
  $('#mainScreen').style.display = 'block';

  $('#loginBtn').style.display = 'block';
  $('#logoutBtn').style.display = 'none';

  $$('.tab-btn[data-tab="areas"]').forEach(el => el.style.display = 'none');
  $$('.tab-btn[data-tab="employees"]').forEach(el => el.style.display = 'none');
  $$('.tab-btn[data-tab="salary"]').forEach(el => el.style.display = 'none');
  $$('.tab-btn[data-tab="excel"]').forEach(el => el.style.display = 'none');

  $('#empSelectorRow').style.display = 'flex';
  $('#summaryCard').style.display = 'block';
  $('#guestBanner').style.display = 'block';
  $('#quickAttendanceRow').style.display = 'none';
  $('#calendarActions').style.display = 'none';
  $('#exportActionRow').style.display = 'block';
  $('#calendarHint').style.display = 'none';
  $('#addEmployeeBtn').style.display = 'none';
  $('#selectionBar').style.display = 'none';

  switchTab('calendar');

  // ⭐ Cần employee trước, sau đó song song
  await loadPublicEmployees();
  await Promise.all([loadBuildings(), loadAttendanceForMonth()]);
  renderCalendar();
}

async function onLoggedIn(user) {
  state.user = user;

  const { data: profile } = await supabase
    .from('profiles').select('*').eq('id', user.id).single();
  state.profile = profile || { full_name: user.email, role: 'employee', status: 'active' };

  if (state.profile?.status === 'inactive') {
    await supabase.auth.signOut();
    await showGuestView();
    setTimeout(() => {
      showLoginScreen();
      $('#loginError').textContent = 'Tài khoản đã bị vô hiệu hoá. Liên hệ admin.';
    }, 50);
    return;
  }

  state.isAdmin = state.profile?.role === 'admin';

  $('#loading').style.display = 'none';
  $('#loginScreen').style.display = 'none';
  $('#mainScreen').style.display = 'block';

  $('#loginBtn').style.display = 'none';
  $('#logoutBtn').style.display = 'block';

  $('#addEmployeeBtn').style.display = state.isAdmin ? 'block' : 'none';
  $$('.tab-btn[data-tab="areas"]').forEach(el => el.style.display = state.isAdmin ? '' : 'none');
  $$('.tab-btn[data-tab="employees"]').forEach(el => el.style.display = state.isAdmin ? '' : 'none');
  $$('.tab-btn[data-tab="salary"]').forEach(el => el.style.display = state.isAdmin ? '' : 'none');
  $$('.tab-btn[data-tab="excel"]').forEach(el => el.style.display = state.isAdmin ? '' : 'none');
  $('#empSelectorRow').style.display = state.isAdmin ? 'flex' : 'none';
  $('#summaryCard').style.display = 'block';
  $('#guestBanner').style.display = 'none';
  $('#quickAttendanceRow').style.display = state.isAdmin ? 'block' : 'none';
  $('#calendarActions').style.display = state.isAdmin ? 'flex' : 'none';
  $('#exportActionRow').style.display = 'block';
  $('#calendarHint').style.display = state.isAdmin ? '' : 'none';

  state.selectedEmployeeId = user.id;
  switchTab('calendar');

  // ⭐⭐⭐ LOAD SONG SONG — nhanh gấp 2-3 lần
  await Promise.all([
    loadEmployees(),
    loadBuildings(),
    loadAttendanceForMonth(),
  ]);

  renderCalendar();
  renderBuildings();
}

async function handleLogout() {
  await supabase.auth.signOut();
  // ⭐ Clear cache khi logout
  invalidateAttendanceCache();
  if (salaryModule) salaryModule.invalidateCache();
  await showGuestView();
}

/* ============ EMPLOYEES ============ */
async function loadPublicEmployees() {
  const { data, error } = await supabase
    .from('profiles_public').select('*').order('full_name');
  if (error) { console.error(error); return; }
  state.employees = sortEmployees(data || []);

  if (state.employees.length && !state.selectedEmployeeId) {
    state.selectedEmployeeId = state.employees[0].id;
  }
  if (state.selectedEmployeeId && !state.employees.find(e => e.id === state.selectedEmployeeId)) {
    state.selectedEmployeeId = state.employees[0]?.id ?? null;
  }

  renderEmployeeSelect();
  updateSummary();
}

async function loadEmployees() {
  if (!state.user) return loadPublicEmployees();

  const { data, error } = await supabase.from('profiles').select('*').order('full_name');
  if (error) { console.error(error); toast('Không tải được nhân viên'); return; }
  state.employees = sortEmployees(data || []);

  if (state.selectedEmployeeId && !state.employees.find(e => e.id === state.selectedEmployeeId)) {
    state.selectedEmployeeId = state.user?.id || (state.employees[0]?.id ?? null);
  }

  renderEmployeeSelect();
  renderEmployeeList();
}

function renderEmployeeSelect() {
  const sel = $('#employeeSelect');
  sel.innerHTML = state.employees.map(e => {
    const name = e.full_name || e.username || e.email || 'N/A';
    return `<option value="${e.id}">${name}</option>`;
  }).join('');
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
    const roleLabel = roleLabelOf(e);
    const isSelf = e.id === state.user?.id;
    const canManage = state.isAdmin && !isSelf;
    const canEdit = state.isAdmin;

    let phoneHtml = '';
    if (e.phone) {
      phoneHtml = ` - <a class="phone-link" data-phone="${e.phone}" href="javascript:void(0)">${e.phone}</a>`;
    } else if (canEdit) {
      phoneHtml = ` - <a class="phone-link phone-link-add" data-emp-edit="${e.id}" href="javascript:void(0)">+ Thêm SĐT</a>`;
    }

    const roleSelect = canManage ? `
      <select class="role-select" data-emp-role="${e.id}" data-current="${e.role}">
        <option value="admin" ${e.role === 'admin' ? 'selected' : ''}>${ROLE_LABELS.admin}</option>
        <option value="temporary" ${e.role === 'temporary' ? 'selected' : ''}>${ROLE_LABELS.temporary}</option>
        <option value="employee" ${e.role === 'employee' ? 'selected' : ''}>${ROLE_LABELS.employee}</option>
        <option value="external" ${e.role === 'external' ? 'selected' : ''}>${ROLE_LABELS.external}</option>
      </select>` : '';

    let actionsHtml = '';
    if (canEdit) {
      const toggleBtn = canManage ? `
        <button class="btn-icon-sm" data-emp-toggle="${e.id}" data-current="${isActive ? 'active' : 'inactive'}"
          style="background:${isActive ? '#fef3c7;color:#b45309' : '#dcfce7;color:#16a34a'}"
          title="${isActive ? 'Vô hiệu hoá' : 'Kích hoạt lại'}">
          ${isActive ? '⏸' : '▶'}
        </button>` : '';
      const deleteBtn = canManage ? `
        <button class="btn-icon-sm" data-emp-delete="${e.id}" data-name="${name.replace(/"/g, '&quot;')}"
          style="background:#fee2e2;color:#e74c3c" title="Xoá vĩnh viễn">🗑</button>` : '';

      actionsHtml = `
        <div class="emp-actions">
          ${toggleBtn}
          <button class="btn-icon-sm" data-emp-edit="${e.id}"
            style="background:var(--ocean-100);color:var(--ocean-700)" title="Sửa thông tin">✏️</button>
          ${deleteBtn}
        </div>`;
    }

    return `
      <div class="employee-card" style="${!isActive ? 'opacity:0.75' : ''}">
        <div class="avatar" style="${!isActive ? 'filter:grayscale(1)' : ''}">${initial}</div>
        <div class="emp-info">
          <div class="emp-fullname">${name}${isSelf ? ' <span style="font-size:11px;color:var(--text-muted)">(bạn)</span>' : ''}${phoneHtml}</div>
          <div class="emp-pos">${roleLabel}${e.username ? ' · @' + e.username : ''}</div>
          <span class="emp-status status-${isActive ? 'active' : 'inactive'}">${statusText}</span>
          ${roleSelect}
        </div>
        ${actionsHtml}
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
  wrap.querySelectorAll('[data-emp-role]').forEach(sel => {
    sel.addEventListener('change', () => {
      changeEmployeeRole(sel.dataset.empRole, sel.value, sel.dataset.current);
    });
  });
  wrap.querySelectorAll('[data-phone]').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      showPhoneAction(el.dataset.phone);
    });
  });
  wrap.querySelectorAll('[data-emp-edit]').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      openEditEmployeeModal(el.dataset.empEdit);
    });
  });
}

/* ============ EDIT EMPLOYEE ============ */
function openEditEmployeeModal(userId) {
  const emp = state.employees.find(e => e.id === userId);
  if (!emp) return;
  state.editingEmployeeId = userId;

  $('#editEmpTitle').textContent = `Sửa: ${emp.full_name || emp.username || emp.email || 'N/A'}`;
  $('#editEmpUsername').value = emp.username || emp.email || '—';
  $('#editEmpFullName').value = emp.full_name || '';
  $('#editEmpPhone').value = emp.phone || '';
  $('#editEmpPassword').value = '';
  $('#editEmpError').textContent = '';
  openModal('editEmployeeModal');
}

async function saveEditEmployee() {
  if (!state.isAdmin) return;
  if (!state.editingEmployeeId) return;

  const full_name = $('#editEmpFullName').value.trim();
  const phone = $('#editEmpPhone').value.trim();
  const password = $('#editEmpPassword').value.trim();
  const errEl = $('#editEmpError');
  errEl.textContent = '';

  if (full_name.length < 2) { errEl.textContent = 'Tên hiển thị quá ngắn'; return; }
  if (phone && !/^[0-9]{1,10}$/.test(phone)) {
    errEl.textContent = 'Số điện thoại chỉ được chứa số, tối đa 10 ký tự';
    return;
  }
  if (password && password.length < 6) {
    errEl.textContent = 'Mật khẩu tối thiểu 6 ký tự (hoặc để trống)';
    return;
  }

  const btn = $('#saveEditEmpBtn');
  btn.disabled = true; btn.textContent = 'Đang lưu...';

  const { error } = await supabase.rpc('admin_update_employee', {
    p_user_id: state.editingEmployeeId,
    p_full_name: full_name,
    p_phone: phone || null,
    p_password: password || null,
  });

  btn.disabled = false; btn.textContent = 'Lưu';
  if (error) {
    errEl.textContent = (error.message || 'Lưu thất bại').replace(/^ERROR:\s*/i, '');
    return;
  }

  toast('Đã cập nhật nhân viên ✓');
  closeModal('editEmployeeModal');
  await loadEmployees();
  if (state.isAdmin) renderBuildings();
  if (state.selectedEmployeeId === state.editingEmployeeId) updateSummary();
}

/* ============ PHONE ACTIONS ============ */
function showPhoneAction(phone) {
  if (!phone) return;
  state.phoneActionNumber = phone;
  $('#phoneActionNumber').textContent = phone;
  openModal('phoneActionModal');
}

function callPhoneNumber() {
  const phone = state.phoneActionNumber;
  if (!phone) return;
  window.location.href = 'tel:' + phone;
  closeModal('phoneActionModal');
}

async function copyPhoneNumber() {
  const phone = state.phoneActionNumber;
  if (!phone) return;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(phone);
    } else {
      const ta = document.createElement('textarea');
      ta.value = phone;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    toast('📋 Đã sao chép ' + phone);
    closeModal('phoneActionModal');
  } catch (err) {
    toast('Không sao chép được');
  }
}

/* ============ ROLE / STATUS / DELETE ============ */
async function changeEmployeeRole(userId, newRole, currentRole) {
  if (!state.isAdmin) return;
  if (newRole === currentRole) return;

  const emp = state.employees.find(e => e.id === userId);
  const empName = emp?.full_name || emp?.username || 'nhân viên này';

  const msg = newRole === 'admin'
    ? `Đổi "${empName}" thành Giám sát?\n\nHọ sẽ có TOÀN QUYỀN quản lý:\n• Xem lịch của mọi người\n• Chấm công\n• Tạo/xoá nhân viên\n• Quản lý toà nhà`
    : `Đổi "${empName}" thành ${ROLE_LABELS[newRole]}?`;

  if (!confirm(msg)) {
    const sel = document.querySelector(`[data-emp-role="${userId}"]`);
    if (sel) sel.value = currentRole;
    return;
  }

  const { error } = await supabase.rpc('admin_set_user_role', {
    p_user_id: userId, p_role: newRole,
  });

  if (error) {
    toast('Lỗi: ' + error.message.replace(/^ERROR:\s*/i, ''));
    const sel = document.querySelector(`[data-emp-role="${userId}"]`);
    if (sel) sel.value = currentRole;
    return;
  }

  toast(`Đã đổi thành ${ROLE_LABELS[newRole]} ✓`);
  await loadEmployees();
  if (state.selectedEmployeeId === userId) updateSummary();
}

async function toggleEmployeeStatus(userId, currentStatus) {
  if (!state.isAdmin) return;
  const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
  const msg = newStatus === 'inactive'
    ? 'Vô hiệu hoá nhân viên này?\n\nHọ sẽ không đăng nhập được nữa.'
    : 'Kích hoạt lại nhân viên này?';
  if (!confirm(msg)) return;

  const { error } = await supabase.rpc('admin_set_user_status', {
    p_user_id: userId, p_status: newStatus,
  });
  if (error) { toast('Lỗi: ' + error.message.replace(/^ERROR:\s*/i, '')); return; }
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
  if (error) { toast('Lỗi: ' + error.message.replace(/^ERROR:\s*/i, '')); return; }
  toast('🗑 Đã xoá nhân viên');

  // ⭐ Invalidate cache
  invalidateAttendanceCache();
  if (salaryModule) salaryModule.invalidateCache();

  await loadEmployees();
  await loadAttendanceForMonth();
  await loadTodayAssignments();
  renderCalendar();
  renderBuildings();
}

/* ============ CREATE EMPLOYEE ============ */
async function createEmployee() {
  if (!state.isAdmin) { toast('Chỉ Giám sát được tạo nhân viên'); return; }
  const username = $('#empUsername').value.trim().toLowerCase();
  const password = $('#empPassword').value;
  const full_name = $('#empFullName').value.trim();
  const phone = $('#empPhone').value.trim();
  const errEl = $('#empCreateError');
  errEl.textContent = '';

  if (!username) { errEl.textContent = 'Nhập tên đăng nhập'; return; }
  if (password.length < 6) { errEl.textContent = 'Mật khẩu tối thiểu 6 ký tự'; return; }
  if (full_name.length < 2) { errEl.textContent = 'Tên hiển thị quá ngắn'; return; }
  if (phone && !/^[0-9]{1,10}$/.test(phone)) {
    errEl.textContent = 'Số điện thoại chỉ được chứa số, tối đa 10 ký tự';
    return;
  }

  const btn = $('#saveEmployeeBtn');
  btn.disabled = true; btn.textContent = 'Đang tạo...';

  const { error } = await supabase.rpc('admin_create_employee', {
    p_username: username,
    p_password: password,
    p_full_name: full_name,
    p_phone: phone || null,
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
  } else {
    state.floors = [];
  }

  // ⭐ KHÔNG gọi loadTodayAssignments ở đây — chỉ cần khi mở tab Khu vực
  renderBuildings();
}

async function loadTodayAssignments() {
  const todayStr = toDateStr(new Date());
  const { data, error } = await supabase
    .from('attendance')
    .select('employee_id, areas, ot_areas, is_off, mode, total_hours, ot_hours')
    .eq('date', todayStr)
    .neq('is_off', true);

  if (error) {
    console.error(error);
    state.floorAssignments = {};
    return;
  }

  const mainUsersByFloor = {};
  const otAutoUsersByFloor = {};

  for (const a of data) {
    if (a.mode === 'default' && Array.isArray(a.areas)) {
      for (const area of a.areas) {
        const fid = area.floor_id;
        if (!fid) continue;
        if (!mainUsersByFloor[fid]) mainUsersByFloor[fid] = new Set();
        mainUsersByFloor[fid].add(a.employee_id);
      }
    }
    if (Array.isArray(a.ot_areas)) {
      for (const area of a.ot_areas) {
        const fid = area.floor_id;
        if (!fid) continue;
        const h = area.hours;
        if (h != null && h !== '' && !isNaN(Number(h))) continue;
        if (!otAutoUsersByFloor[fid]) otAutoUsersByFloor[fid] = new Set();
        otAutoUsersByFloor[fid].add(a.employee_id);
      }
    }
  }

  const map = {};

  for (const a of data) {
    const perFloor = {};
    let mainRawTotal = 0;
    let otRawTotal = 0;

    if (a.mode === 'default' && Array.isArray(a.areas)) {
      for (const area of a.areas) {
        const fid = area.floor_id;
        if (!fid) continue;
        if (!perFloor[fid]) perFloor[fid] = { main: 0, ot: 0 };

        const floor = state.floors.find(x => x.id === fid);
        const floorDefault = floor ? Number(floor.default_hours || 0) : 0;
        const cnt = mainUsersByFloor[fid]?.size || 1;
        const raw = floorDefault / cnt;

        perFloor[fid].main += raw;
        mainRawTotal += raw;
      }
    } else if (a.mode === 'manual' && Array.isArray(a.areas)) {
      for (const area of a.areas) {
        const fid = area.floor_id;
        if (!fid) continue;
        if (!perFloor[fid]) perFloor[fid] = { main: 0, ot: 0 };
        const raw = Number(area.hours || 0);
        perFloor[fid].main += raw;
        mainRawTotal += raw;
      }
    }

    if (Array.isArray(a.ot_areas)) {
      for (const area of a.ot_areas) {
        const fid = area.floor_id;
        if (!fid) continue;
        if (!perFloor[fid]) perFloor[fid] = { main: 0, ot: 0 };

        const h = area.hours;
        const isManual = h != null && h !== '' && !isNaN(Number(h));
        let raw;
        if (isManual) {
          raw = Number(h);
        } else {
          const floor = state.floors.find(x => x.id === fid);
          const floorDefault = floor ? Number(floor.default_hours || 0) : 0;
          const cnt = otAutoUsersByFloor[fid]?.size || 1;
          raw = floorDefault / cnt;
        }
        perFloor[fid].ot += raw;
        otRawTotal += raw;
      }
    }

    const mainFromDB = Number(a.total_hours || 0);
    const otFromDB = Number(a.ot_hours || 0);

    if (mainRawTotal > 0) {
      for (const fid in perFloor) {
        perFloor[fid].main = perFloor[fid].main * (mainFromDB / mainRawTotal);
      }
    }
    if (otRawTotal > 0) {
      for (const fid in perFloor) {
        perFloor[fid].ot = perFloor[fid].ot * (otFromDB / otRawTotal);
      }
    } else if (otFromDB > 0 && mainRawTotal > 0) {
      let maxFid = null, maxMain = 0;
      for (const fid in perFloor) {
        if (perFloor[fid].main > maxMain) {
          maxMain = perFloor[fid].main;
          maxFid = fid;
        }
      }
      if (maxFid) perFloor[maxFid].ot = otFromDB;
    }

    for (const [fid, h] of Object.entries(perFloor)) {
      if (!map[fid]) map[fid] = [];
      const existing = map[fid].find(x => x.employee_id === a.employee_id);
      if (existing) {
        existing.main_hours += h.main;
        existing.ot_hours += h.ot;
      } else {
        map[fid].push({
          employee_id: a.employee_id,
          main_hours: h.main,
          ot_hours: h.ot,
        });
      }
    }
  }

  state.floorAssignments = map;

  const hint = $('#areasHint');
  if (hint) {
    hint.textContent = `📅 Đang hiển thị nhân viên được phân công hôm nay (${formatDateVN(todayStr)})`;
  }
}

function renderBuildings() {
  const wrap = $('#buildingsList');
  const $sum = $('#areasSummary');

  if (!state.buildings.length) {
    wrap.innerHTML = '<p class="hint">Chưa có toà nhà nào. Nhấn "+ Thêm tòa nhà".</p>';
    if ($sum) $sum.style.display = 'none';
    return;
  }

  const search = (state.areasSearch || '').toLowerCase().trim();
  const roleFilter = state.areasRoleFilter || 'all';

  const filteredEmpIds = new Set();
  const filteredEmployees = state.employees.filter(e => {
    if (e.status === 'inactive') return false;
    if (roleFilter !== 'all' && e.role !== roleFilter) return false;
    if (search) {
      const name = (e.full_name || '').toLowerCase();
      const phone = (e.phone || '').toLowerCase();
      const username = (e.username || '').toLowerCase();
      if (!name.includes(search) && !phone.includes(search) && !username.includes(search)) return false;
    }
    filteredEmpIds.add(e.id);
    return true;
  });

  const allActive = state.employees.filter(e => e.status !== 'inactive');
  const nvEmployees = allActive.filter(e => e.role === 'employee');
  const nvEmpIds = new Set(nvEmployees.map(e => e.id));

  const workingNVIds = new Set();
  for (const fid in state.floorAssignments) {
    const assigns = state.floorAssignments[fid] || [];
    for (const a of assigns) {
      if (nvEmpIds.has(a.employee_id)) workingNVIds.add(a.employee_id);
    }
  }
  const totalNV = nvEmployees.length;
  const workingNVCount = workingNVIds.size;

  const floorsWithPeople = new Set();
  for (const b of state.buildings) {
    const floors = state.floors.filter(f => f.building_id === b.id);
    for (const f of floors) {
      const assigns = state.floorAssignments[f.id] || [];
      const visible = assigns.filter(a => filteredEmpIds.has(a.employee_id));
      if (visible.length > 0) floorsWithPeople.add(f.id);
    }
  }

  const totalFloors = state.floors.length;
  const floorsWithPeopleCount = floorsWithPeople.size;
  const isFiltered = search !== '' || roleFilter !== 'all';

  if ($sum) {
    $sum.style.display = 'block';
    $sum.innerHTML = `
      <div class="areas-summary-row">
        <span class="areas-summary-label">👥 Nhân viên đi làm hôm nay</span>
        <span class="areas-summary-value">
          <span class="${workingNVCount === totalNV && totalNV > 0 ? 'ok' : ''}">${workingNVCount}</span>/${totalNV}
        </span>
      </div>
      <div class="areas-summary-row">
        <span class="areas-summary-label">🏢 Tầng có người</span>
        <span class="areas-summary-value">
          <span class="${floorsWithPeopleCount === totalFloors && totalFloors > 0 ? 'ok' : ''}">${floorsWithPeopleCount}</span>/${totalFloors}
        </span>
      </div>
      ${isFiltered ? `<div style="font-size:11px;color:var(--text-muted);margin-top:6px;text-align:center;padding-top:6px;border-top:1px dashed var(--border)">🔍 Đang lọc — số liệu tầng chỉ tính người khớp bộ lọc</div>` : ''}
    `;
  }

  wrap.innerHTML = state.buildings.map(b => {
    const floors = state.floors.filter(f => f.building_id === b.id)
      .sort((a, c) => a.floor_number - c.floor_number);

    const floorRows = floors.map(f => {
      const assigns = state.floorAssignments[f.id] || [];
      const visible = assigns.filter(a => filteredEmpIds.has(a.employee_id));

      let assigneesHtml = '';
      if (visible.length > 0) {
        const items = visible.map(item => {
          const emp = state.employees.find(e => e.id === item.employee_id);
          if (!emp) return '';
          const name = emp.full_name || emp.username || '';
          const initial = name.charAt(0).toUpperCase();

          return `
            <div class="floor-assignee">
              <div class="assignee-avatar">${initial}</div>
              <div class="assignee-info">
                <span class="assignee-name" data-jump-emp="${emp.id}" title="Xem lịch công">${name}</span>
                ${emp.phone ? `<span class="assignee-phone"><a class="phone-link" data-phone="${emp.phone}" href="javascript:void(0)">${emp.phone}</a></span>` : ''}
              </div>
            </div>`;
        }).filter(Boolean).join('');
        assigneesHtml = `<div class="floor-assignees-list">${items}</div>`;
      }

      const peopleBadge = visible.length > 0
        ? `<span class="floor-people-count">${visible.length} người</span>`
        : `<span class="floor-people-count is-empty">Trống</span>`;

      return `
        <div class="floor-row${visible.length > 0 ? ' has-assignees' : ''}">
          <div class="floor-row-head">
            <span class="floor-name">${floorLabel(f.floor_number)} ${peopleBadge}</span>
            <span class="floor-hours">${formatHours(f.default_hours)}</span>
          </div>
          ${assigneesHtml}
        </div>`;
    }).join('') || '<p class="hint" style="margin:0">Chưa setup tầng</p>';

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

  wrap.querySelectorAll('[data-phone]').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      showPhoneAction(el.dataset.phone);
    });
  });

  wrap.querySelectorAll('[data-jump-emp]').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      jumpToEmployeeCalendar(el.dataset.jumpEmp);
    });
  });
}

async function jumpToEmployeeCalendar(empId) {
  const emp = state.employees.find(e => e.id === empId);
  if (!emp) { toast('Không tìm thấy nhân viên'); return; }

  state.selectedEmployeeId = empId;
  const sel = $('#employeeSelect');
  if (sel) sel.value = empId;

  switchTab('calendar');
  await loadAttendanceForMonth();
  renderCalendar();

  toast(`📅 Đang xem lịch của ${emp.full_name || emp.username || ''}`);
}

async function deleteBuilding(id) {
  if (!confirm('Xoá toà nhà này và tất cả tầng?')) return;
  const { error } = await supabase.from('buildings').delete().eq('id', id);
  if (error) { toast('Xoá thất bại'); return; }
  toast('Đã xoá');
  invalidateAttendanceCache();
  if (salaryModule) salaryModule.invalidateCache();
  await loadBuildings();
  await loadAttendanceForMonth();
  renderCalendar();
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
  invalidateAttendanceCache();
  if (salaryModule) salaryModule.invalidateCache();
  await loadBuildings();
  await loadAttendanceForMonth();
  renderCalendar();
}

/* ============ ATTENDANCE ============ */
async function loadAttendanceForMonth(forceRefresh = false) {
  if (!state.selectedEmployeeId) { state.attendance = []; return; }
  const y = state.currentMonth.getFullYear();
  const m = state.currentMonth.getMonth();
  const key = attendanceCacheKey(state.selectedEmployeeId, y, m);

  // ⭐ Cache hit
  if (!forceRefresh && attendanceCache[key]) {
    state.attendance = attendanceCache[key];
    updateSummary();
    return;
  }

  const start = `${y}-${pad(m + 1)}-01`;
  const end = `${y}-${pad(m + 1)}-${pad(new Date(y, m + 1, 0).getDate())}`;

  const { data, error } = await supabase
    .from('attendance').select('*')
    .eq('employee_id', state.selectedEmployeeId)
    .gte('date', start).lte('date', end);
  if (error) {
    console.error(error);
    state.attendance = [];
  } else {
    state.attendance = data || [];
    attendanceCache[key] = state.attendance;
  }
  updateSummary();
}

function updateSummary() {
  const emp = state.employees.find(e => e.id === state.selectedEmployeeId);
  if (!emp) {
    ['sumName', 'sumRole'].forEach(id => $('#' + id).textContent = '—');
    ['sumDays', 'sumWork', 'sumOT', 'sumLeave'].forEach(id => $('#' + id).textContent = '0');
    return;
  }
  $('#sumName').textContent = emp.full_name || emp.username || emp.email || '—';
  $('#sumRole').textContent = roleLabelOf(emp);

  let work = 0, ot = 0;
  let workDays = 0;
  let leaveDays = 0;

  for (const a of state.attendance) {
    if (a.mode === 'leave') { leaveDays++; continue; }
    if (a.is_off) continue;

    const h = Number(a.total_hours || 0);
    const o = Number(a.ot_hours || 0);
    if (h > 0 || o > 0) workDays++;
    work += h;
    ot += o;
  }

  $('#sumDays').textContent = workDays;
  $('#sumWork').textContent = formatHours(work);
  $('#sumOT').textContent = formatHours(ot);
  $('#sumLeave').textContent = leaveDays;
}

/* ============ PREFILL ============ */
async function getPreviousAttendance(employeeId, beforeDate) {
  const { data, error } = await supabase
    .from('attendance')
    .select('*')
    .eq('employee_id', employeeId)
    .lt('date', beforeDate)
    .order('date', { ascending: false })
    .limit(1);
  if (error) { console.error(error); return null; }
  return data?.[0] || null;
}

/* ============ OPEN ATTENDANCE MODAL ============ */
async function openAttendanceModal(dateStr, batchDates = null) {
  if (!state.isAdmin) { toast('Chỉ Giám sát được chấm công'); return; }
  if (!state.selectedEmployeeId) { toast('Chọn nhân viên trước'); return; }

  state.editingDate = dateStr;
  state.batchDates = batchDates;

  const emp = state.employees.find(e => e.id === state.selectedEmployeeId);
  const targetIsSupervisor = emp?.role === 'admin';
  state.isSupervisorMode = targetIsSupervisor;

  $('#attModalTitle').textContent = batchDates
    ? `Chấm công ${batchDates.length} ngày — ${emp?.full_name || ''}`
    : `Chấm công — ${emp?.full_name || ''} — ${formatDateVN(dateStr)}`;

  $('#supervisorModeSection').style.display = targetIsSupervisor ? 'block' : 'none';
  $('#employeeModeSection').style.display = targetIsSupervisor ? 'none' : 'block';

  let template = null;
  let source = 'none';
  let prevDate = null;

  if (!batchDates) {
    template = state.attendance.find(a => a.date === dateStr) || null;
    if (template) {
      source = 'existing';
    } else {
      const prev = await getPreviousAttendance(state.selectedEmployeeId, dateStr);
      if (prev) {
        template = prev;
        source = 'previous';
        prevDate = prev.date;
      }
    }
  } else {
    const earliest = [...batchDates].sort()[0];
    const prev = await getPreviousAttendance(state.selectedEmployeeId, earliest);
    if (prev) {
      template = prev;
      source = 'previous';
      prevDate = prev.date;
    }
  }

  showPrefillNote(source, prevDate);
  showBatchNote(batchDates);

  if (targetIsSupervisor) openSupervisorModeContent(template);
  else openEmployeeModeContent(template);

  updatePreview();
  openModal('attendanceModal');
}

function showPrefillNote(source, prevDate) {
  const el = $('#prefillNote');
  if (source === 'previous' && prevDate) {
    el.textContent = `📋 Đã điền sẵn theo ngày ${formatDateVN(prevDate)} — sửa lại nếu cần`;
    el.style.display = 'block';
  } else {
    el.style.display = 'none';
  }
}

function showBatchNote(batchDates) {
  const el = $('#batchNote');
  if (batchDates && batchDates.length > 1) {
    const sorted = [...batchDates].sort();
    const list = sorted.slice(0, 5).map(formatDateVN).join(', ');
    const more = sorted.length > 5 ? ` ... +${sorted.length - 5} ngày` : '';
    el.textContent = `📅 Sẽ áp dụng cho ${sorted.length} ngày: ${list}${more}`;
    el.style.display = 'block';
  } else {
    el.style.display = 'none';
  }
}

function openSupervisorModeContent(template) {
  let mode = 'default';
  let otH = 0;
  if (template) {
    if (template.mode === 'leave') mode = 'leave';
    else if (template.is_off || template.mode === 'off') mode = 'off';
    else if (Number(template.ot_hours) > 0) mode = 'ot';
    otH = Number(template.ot_hours || 0);
  }

  $$('input[name="supMode"]').forEach(r => r.checked = r.value === mode);
  $('#supOtHours').value = otH > 0 ? otH : '';
  toggleSupOtGroup(mode);
}

function openEmployeeModeContent(template) {
  const validFloorIds = new Set(state.floors.map(f => f.id));
  const validBuildingIds = new Set(state.buildings.map(b => b.id));

  if (template && Array.isArray(template.areas) && template.areas.length) {
    state.modalAreas = template.areas
      .filter(a => validBuildingIds.has(a.building_id) && validFloorIds.has(a.floor_id))
      .map(a => ({ building_id: a.building_id, floor_id: a.floor_id, hours: Number(a.hours || 0) }));
    if (!state.modalAreas.length) state.modalAreas = [{ building_id: '', floor_id: '', hours: 0 }];
  } else if (template && (template.is_off || template.mode === 'off' || template.mode === 'leave')) {
    state.modalAreas = [];
  } else {
    state.modalAreas = [{ building_id: '', floor_id: '', hours: 0 }];
  }

  if (template && Array.isArray(template.ot_areas) && template.ot_areas.length) {
    state.modalOtAreas = template.ot_areas
      .filter(a => validBuildingIds.has(a.building_id) && validFloorIds.has(a.floor_id))
      .map(a => ({
        building_id: a.building_id,
        floor_id: a.floor_id,
        hours: a.hours != null ? Number(a.hours) : null,
      }));
  } else {
    state.modalOtAreas = [];
  }

  renderMainAreaPicker();
  renderOtAreaPicker();

  let mode = 'default';
  if (template) {
    if (template.mode === 'leave') mode = 'leave';
    else if (template.is_off || template.mode === 'off') mode = 'off';
    else if (template.mode === 'manual') mode = 'manual';
  }
  $$('input[name="attMode"]').forEach(r => r.checked = r.value === mode);
  toggleModeSections(mode);
  $('#manualHours').value = template?.manual_hours ?? '';
}

/* ============ AREA PICKER ============ */
function renderAreaPickerInto(wrapId, areasState, isOt) {
  const rerender = () => renderAreaPickerInto(wrapId, areasState, isOt);
  const wrap = $('#' + wrapId);

  if (!areasState.length) {
    wrap.innerHTML = '<p class="hint" style="margin:0 0 4px">Chưa có khu vực.</p>';
    return;
  }

  wrap.innerHTML = areasState.map((entry, idx) => {
    const bOpts = state.buildings.map(b =>
      `<option value="${b.id}" ${b.id === entry.building_id ? 'selected' : ''}>${b.name}</option>`
    ).join('');
    const floorsOfB = state.floors.filter(f => f.building_id === entry.building_id);
    const fOpts = floorsOfB.map(f =>
      `<option value="${f.id}" ${f.id === entry.floor_id ? 'selected' : ''}>
        ${floorLabel(f.floor_number)} (${formatHours(f.default_hours)})
      </option>`
    ).join('');

    let hoursInput = '';
    if (isOt) {
      const floor = entry.floor_id ? state.floors.find(x => x.id === entry.floor_id) : null;
      const displayVal = entry.hours != null ? entry.hours : '';
      const placeholder = floor ? formatHours(floor.default_hours) : 'Giờ';
      hoursInput = `<input type="number" class="area-hours-input" data-hours-idx="${idx}"
        step="0.5" min="0" max="24" value="${displayVal}" placeholder="${placeholder}" />`;
    }

    return `
      <div class="area-entry" data-idx="${idx}">
        <select class="area-building"><option value="">-- Toà nhà --</option>${bOpts}</select>
        <select class="area-floor"><option value="">-- Tầng --</option>${fOpts}</select>
        ${hoursInput}
        <button class="remove-area" data-remove="${idx}">✕</button>
      </div>`;
  }).join('');

  wrap.querySelectorAll('.area-entry').forEach(entryEl => {
    const idx = Number(entryEl.dataset.idx);
    const bSel = entryEl.querySelector('.area-building');
    const fSel = entryEl.querySelector('.area-floor');
    const hInput = entryEl.querySelector('.area-hours-input');
    const removeBtn = entryEl.querySelector('.remove-area');

    bSel.addEventListener('change', () => {
      areasState[idx].building_id = bSel.value;
      areasState[idx].floor_id = '';
      if (isOt) areasState[idx].hours = null;
      rerender();
      updatePreview();
    });

    fSel.addEventListener('change', () => {
      areasState[idx].floor_id = fSel.value;
      if (isOt) {
        areasState[idx].hours = null;
        if (hInput) {
          const floor = state.floors.find(x => x.id === fSel.value);
          hInput.value = '';
          hInput.placeholder = floor ? formatHours(floor.default_hours) : 'Giờ';
        }
      } else {
        const floor = state.floors.find(x => x.id === fSel.value);
        areasState[idx].hours = floor ? Number(floor.default_hours || 0) : 0;
      }
      updatePreview();
    });

    if (hInput) {
      hInput.addEventListener('input', () => {
        const raw = hInput.value.trim();
        areasState[idx].hours = raw === '' ? null : Number(raw);
        updatePreview();
      });
    }

    removeBtn.addEventListener('click', () => {
      areasState.splice(idx, 1);
      rerender();
      updatePreview();
    });
  });
}

function renderMainAreaPicker() {
  renderAreaPickerInto('mainAreaPicker', state.modalAreas, false);
}

function renderOtAreaPicker() {
  renderAreaPickerInto('otAreaPicker', state.modalOtAreas, true);
}

/* ============ MODE TOGGLES ============ */
function toggleModeSections(mode) {
  $('#manualHoursGroup').style.display = mode === 'manual' ? 'block' : 'none';
  $('#mainAreaSection').style.display = mode === 'default' ? 'block' : 'none';
  $('#otSection').style.display = (mode === 'off' || mode === 'leave') ? 'none' : 'block';
}

function toggleSupOtGroup(mode) {
  $('#supOtGroup').style.display = mode === 'ot' ? 'block' : 'none';
}

function getSelectedMode() {
  return document.querySelector('input[name="attMode"]:checked')?.value || 'default';
}

function getSelectedSupMode() {
  return document.querySelector('input[name="supMode"]:checked')?.value || 'default';
}

/* ============ HOURS CALC ============ */
function computeMainHoursRaw() {
  const mode = getSelectedMode();
  if (mode === 'off' || mode === 'leave') return 0;
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

function computeMainHours() {
  return Math.min(computeMainHoursRaw(), DAILY_MAIN_CAP);
}

function computeOverflow() {
  return Math.max(0, computeMainHoursRaw() - DAILY_MAIN_CAP);
}

function computeOtHoursRaw() {
  let h = 0;
  for (const entry of state.modalOtAreas) {
    if (!entry.floor_id) continue;
    if (entry.hours != null && !isNaN(entry.hours)) {
      h += Number(entry.hours);
    } else {
      const f = state.floors.find(x => x.id === entry.floor_id);
      if (f) h += Number(f.default_hours || 0);
    }
  }
  return h;
}

function computeOtHours() {
  return computeOtHoursRaw() + computeOverflow();
}

/* ============ PREVIEW ============ */
function updatePreview() {
  if (state.isSupervisorMode) {
    const mode = getSelectedSupMode();
    const isOff = mode === 'off';
    const isLeave = mode === 'leave';
    const mainH = (isOff || isLeave) ? 0 : SUPERVISOR_HOURS;
    const otH = mode === 'ot' ? Number($('#supOtHours').value || 0) : 0;
    $('#supMainPreview').textContent = isLeave ? 'PHÉP' : (isOff ? 'OFF' : formatHours(SUPERVISOR_HOURS));
    $('#supOtPreview').textContent = formatHours(otH);
    $('#supTotalPreview').textContent = isLeave ? 'PHÉP' : formatHours(mainH + otH);
    return;
  }

  const mode = getSelectedMode();
  const isInactive = mode === 'off' || mode === 'leave';
  const mainH = computeMainHours();
  const otH = isInactive ? 0 : computeOtHours();
  $('#mainHoursPreview').textContent = mode === 'leave' ? 'PHÉP' : (mode === 'off' ? 'OFF' : formatHours(mainH));
  $('#otHoursPreview').textContent = formatHours(otH);
  $('#totalHoursPreview').textContent = mode === 'leave' ? 'PHÉP' : formatHours(mainH + otH);
  $('#shareNote').style.display = (mode === 'default' && mainH > 0) ? 'block' : 'none';
}

/* ============ PAYLOAD BUILDERS ============ */
function buildSupervisorPayload() {
  const mode = getSelectedSupMode();
  const isOff = mode === 'off';
  const isLeave = mode === 'leave';
  const otH = mode === 'ot' ? Number($('#supOtHours').value || 0) : 0;

  if (mode === 'ot' && otH <= 0) {
    toast('Nhập số giờ tăng ca (> 0)');
    return null;
  }

  if (isLeave) {
    return {
      employee_id: state.selectedEmployeeId,
      total_hours: 0, ot_hours: 0, is_off: false,
      mode: 'leave', manual_hours: null, areas: [], ot_areas: [],
    };
  }

  return {
    employee_id: state.selectedEmployeeId,
    total_hours: isOff ? 0 : SUPERVISOR_HOURS,
    ot_hours: isOff ? 0 : otH,
    is_off: isOff,
    mode: isOff ? 'off' : 'manual',
    manual_hours: isOff ? null : SUPERVISOR_HOURS,
    areas: [], ot_areas: [],
  };
}

function buildEmployeePayload() {
  const mode = getSelectedMode();
  const isInactive = mode === 'off' || mode === 'leave';
  const mainH = computeMainHours();
  const otH = isInactive ? 0 : computeOtHours();
  const rawMain = computeMainHoursRaw();

  if (mode === 'leave') {
    return {
      employee_id: state.selectedEmployeeId,
      total_hours: 0, ot_hours: 0, is_off: false,
      mode: 'leave', manual_hours: null, areas: [], ot_areas: [],
    };
  }

  if (mode !== 'off' && mainH <= 0) {
    toast('Vui lòng chọn khu vực chính hoặc nhập giờ');
    return null;
  }

  return {
    employee_id: state.selectedEmployeeId,
    total_hours: mode === 'off' ? 0 : mainH,
    ot_hours: otH,
    is_off: mode === 'off',
    mode,
    manual_hours: mode === 'manual' ? rawMain : null,
    areas: mode === 'off' ? [] : state.modalAreas
      .filter(a => a.building_id && a.floor_id)
      .map(a => ({ building_id: a.building_id, floor_id: a.floor_id, hours: a.hours })),
    ot_areas: mode === 'off' ? [] : state.modalOtAreas
      .filter(a => a.building_id && a.floor_id)
      .map(a => ({
        building_id: a.building_id,
        floor_id: a.floor_id,
        hours: a.hours != null && !isNaN(a.hours) ? Number(a.hours) : null,
      })),
  };
}

/* ============ SAVE ============ */
async function saveAttendance() {
  if (!state.isAdmin) { toast('Chỉ Giám sát được chấm công'); return; }
  if (!state.selectedEmployeeId) return;

  const basePayload = state.isSupervisorMode
    ? buildSupervisorPayload()
    : buildEmployeePayload();
  if (!basePayload) return;

  const dates = state.batchDates && state.batchDates.length > 0
    ? [...state.batchDates]
    : [state.editingDate];

  if (dates.length > 1) {
    const { data } = await supabase
      .from('attendance')
      .select('date')
      .eq('employee_id', state.selectedEmployeeId)
      .in('date', dates);

    if (data && data.length > 0) {
      const ok = confirm(
        `${data.length}/${dates.length} ngày đã có dữ liệu sẽ bị GHI ĐÈ.\n\nTiếp tục?`
      );
      if (!ok) return;
    }
  }

  const payloads = dates.map(date => ({ ...basePayload, date }));

  const { error } = await supabase
    .from('attendance')
    .upsert(payloads, { onConflict: 'employee_id,date' });

  if (error) { toast('Lưu thất bại: ' + error.message); return; }

  toast(`Đã lưu ${dates.length} ngày ✓`);
  closeModal('attendanceModal');

  const wasSelection = state.selectionMode;
  state.batchDates = null;

  if (wasSelection) exitSelectionMode();

  // ⭐ Invalidate cache
  invalidateAttendanceCache(state.selectedEmployeeId);
  if (salaryModule) salaryModule.invalidateCache();

  await loadAttendanceForMonth(true);
  await loadTodayAssignments();
  renderCalendar();
  renderBuildings();
}

/* ============ SELECTION MODE ============ */
function toggleSelectionMode() {
  if (state.selectionMode) {
    exitSelectionMode();
  } else {
    state.selectionMode = true;
    state.selectedDates.clear();
    $('#selectionBar').style.display = 'block';
    $('#selectionToggleBtn').textContent = '✕ Thoát chọn';
    $('#selectionToggleBtn').classList.add('active');
    updateSelectionCount();
    renderCalendar();
  }
}

function exitSelectionMode() {
  state.selectionMode = false;
  state.selectedDates.clear();
  $('#selectionBar').style.display = 'none';
  $('#selectionToggleBtn').textContent = '☑️ Chọn nhiều ngày';
  $('#selectionToggleBtn').classList.remove('active');
  renderCalendar();
}

function toggleDateSelection(dateStr) {
  if (state.selectedDates.has(dateStr)) {
    state.selectedDates.delete(dateStr);
  } else {
    state.selectedDates.add(dateStr);
  }
  updateSelectionCount();
  renderCalendar();
}

function updateSelectionCount() {
  const n = state.selectedDates.size;
  $('#selectionCount').textContent = `${n} ngày đã chọn`;
  $('#applySelectionBtn').disabled = n === 0;
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
      if (att.mode === 'leave') {
        cls += ' leave-day';
        sub = 'P';
      } else if (att.is_off) {
        cls += ' off-day';
        sub = 'OFF';
      } else {
        cls += ' has-data';
        const totalH = Number(att.total_hours || 0) + Number(att.ot_hours || 0);
        sub = totalH > 0 ? formatHours(totalH) : '';
      }
    }
    if (dateStr === todayStr) cls += ' today';
    if (state.selectionMode && state.selectedDates.has(dateStr)) cls += ' selected';
    html += `<div class="${cls}" data-date="${dateStr}">
      <span class="day-num">${d}</span>
      ${sub ? `<span class="day-hours">${sub}</span>` : ''}
    </div>`;
  }
  grid.innerHTML = html;

  if (state.selectionMode) {
    grid.querySelectorAll('.cal-day:not(.empty)').forEach(el => {
      el.addEventListener('click', () => toggleDateSelection(el.dataset.date));
    });
  } else if (state.isAdmin) {
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

  if (name === 'salary' && state.isAdmin && salaryModule) {
    const y = state.salaryMonth.getFullYear();
    const m = state.salaryMonth.getMonth() + 1;
    $('#salaryMonth').value = `${y}-${String(m).padStart(2, '0')}`;
    $('#salaryRoleFilter').value = state.salaryRoleFilter;
    $('#salarySearch').value = state.salarySearch || '';
    $('#salarySort').value = state.salarySort || 'hours_desc';
    // ⭐ false = dùng cache, không force refetch mỗi lần mở tab
    salaryModule.loadSalaryForMonth(false);
  }

  if (name === 'areas' && state.isAdmin) {
    loadTodayAssignments().then(renderBuildings);
  }

  if (name === 'excel' && state.isAdmin) {
    const y = state.excelMonth.getFullYear();
    const m = state.excelMonth.getMonth() + 1;
    $('#excelMonth').value = `${y}-${String(m).padStart(2, '0')}`;
    loadExcelData();
  }
}

async function changeMonth(delta) {
  const d = new Date(state.currentMonth);
  d.setMonth(d.getMonth() + delta);
  state.currentMonth = d;
  await loadAttendanceForMonth();
  renderCalendar();
}

/* ============ EXCEL TAB — MATRIX 2 BLOCK ============ */
async function loadExcelData() {
  const y = state.excelMonth.getFullYear();
  const m = state.excelMonth.getMonth() + 1;
  const daysInMonth = new Date(y, m, 0).getDate();
  const startDate = `${y}-${pad(m)}-01`;
  const endDate = `${y}-${pad(m)}-${pad(daysInMonth)}`;

  const $loading = $('#excelLoading');
  const $content = $('#excelContent');
  if ($loading) { $loading.style.display = 'block'; $loading.textContent = 'Đang tải...'; }
  if ($content) $content.style.display = 'none';

  const [profRes, attRes] = await Promise.all([
    supabase.from('profiles').select('*').order('full_name'),
    supabase.from('attendance').select('*')
      .gte('date', startDate).lte('date', endDate),
  ]);

  if (profRes.error || attRes.error) {
    if ($loading) $loading.textContent = 'Lỗi tải dữ liệu: ' +
      (profRes.error?.message || attRes.error?.message);
    return;
  }

  state.excelProfiles = sortEmployees((profRes.data || []).filter(p => p.status !== 'inactive'));
  state.excelAttendance = attRes.data || [];

  if ($loading) $loading.style.display = 'none';
  if ($content) $content.style.display = 'block';

  renderExcelBlocks(y, m, daysInMonth);
}

/* Xây dựng map emp_id -> { day: att } */
function buildAttMap() {
  const map = {};
  for (const a of state.excelAttendance) {
    if (!map[a.employee_id]) map[a.employee_id] = {};
    const day = Number(a.date.split('-')[2]);
    map[a.employee_id][day] = a;
  }
  return map;
}

/* Tính giá trị 1 ô */
function getCellData(att) {
  if (!att) return { nc: '', ot: '', ncCls: 'val-empty', otCls: 'val-empty' };
  if (att.mode === 'leave') return { nc: 'P', ot: '', ncCls: 'val-leave', otCls: 'val-empty' };
  if (att.is_off) return { nc: 'O', ot: '', ncCls: 'val-off', otCls: 'val-empty' };

  const th = Number(att.total_hours || 0);
  const oh = Number(att.ot_hours || 0);
  let ncVal = '', otVal = '';
  if (th > 0) {
    const days = th / 8;
    ncVal = Number.isInteger(days) ? String(days) : days.toFixed(2).replace(/\.?0+$/, '');
  }
  if (oh > 0) {
    otVal = Number.isInteger(oh) ? String(oh) : oh.toFixed(2).replace(/\.?0+$/, '');
  }
  return { nc: ncVal, ot: otVal, ncCls: ncVal ? '' : 'val-empty', otCls: otVal ? '' : 'val-empty' };
}

/* Render 1 block matrix (portrait) */
function renderMatrixBlock(y, m, fromDay, toDay, attMap) {
  const todayStr = toDateStr(new Date());
  const todayPrefix = `${y}-${pad(m)}`;
  const todayDay = todayStr.startsWith(todayPrefix) ? Number(todayStr.split('-')[2]) : -1;

  let html = '<table class="excel-matrix"><thead><tr>';
  html += '<th class="th-name">Nhân viên</th>';
  for (let d = fromDay; d <= toDay; d++) {
    const dow = new Date(y, m - 1, d).getDay();
    const clsArr = [];
    if (dow === 0) clsArr.push('th-sunday');
    if (d === todayDay) clsArr.push('th-today');
    html += `<th class="${clsArr.join(' ')}">${d}</th>`;
  }
  html += '</tr></thead><tbody>';

  for (const emp of state.excelProfiles) {
    const empAtt = attMap[emp.id] || {};
    const name = emp.full_name || emp.username || '';
    const safeName = name.replace(/"/g, '&quot;');

    let rowNC = '<tr class="row-nc">';
    let rowOT = '<tr class="row-ot">';

    rowNC += `<td rowspan="2" class="td-name" data-emp="${emp.id}" title="${safeName} — Tap để lưu/chia sẻ">${name}</td>`;

    for (let d = fromDay; d <= toDay; d++) {
      const att = empAtt[d];
      const dow = new Date(y, m - 1, d).getDay();
      const cls = dow === 0 ? 'td-sunday' : '';
      const cell = getCellData(att);

      rowNC += `<td class="${cls} ${cell.ncCls}">${cell.nc}</td>`;
      rowOT += `<td class="${cls} ${cell.otCls}">${cell.ot}</td>`;
    }

    rowNC += '</tr>';
    rowOT += '</tr>';
    html += rowNC + rowOT;
  }
  html += '</tbody></table>';
  return html;
}

function renderExcelBlocks(y, m, daysInMonth) {
  const attMap = buildAttMap();

  const block1 = $('#excelBlock1');
  const block2 = $('#excelBlock2');

  const mid = 15;
  if (block1) {
    block1.innerHTML = renderMatrixBlock(y, m, 1, Math.min(mid, daysInMonth), attMap);
  }
  if (block2) {
    if (daysInMonth > mid) {
      block2.innerHTML = renderMatrixBlock(y, m, mid + 1, daysInMonth, attMap);
      block2.style.display = 'block';
      const part2Label = block2.previousElementSibling;
      if (part2Label && part2Label.classList.contains('excel-part-label')) {
        part2Label.style.display = 'inline-block';
      }
    } else {
      block2.innerHTML = '';
      block2.style.display = 'none';
      const part2Label = block2.previousElementSibling;
      if (part2Label && part2Label.classList.contains('excel-part-label')) {
        part2Label.style.display = 'none';
      }
    }
  }

  $$('[data-emp]').forEach(el => {
    el.addEventListener('click', () => {
      openExcelActionModal(el.dataset.emp);
    });
  });
}

function onExcelMonthChanged() {
  const val = $('#excelMonth').value;
  if (!val) return;
  const [y, m] = val.split('-').map(Number);
  state.excelMonth = new Date(y, m - 1, 1);
  loadExcelData();
}

/* Modal action cho từng user */
function openExcelActionModal(empId) {
  const emp = state.excelProfiles.find(e => e.id === empId);
  if (!emp) return;
  state.excelActionEmpId = empId;
  $('#excelActionName').textContent = emp.full_name || emp.username || '—';
  openModal('excelActionModal');
}

/* ⭐ Render PNG capture table (full 31 ngày) — dùng cho html2canvas */
function buildCaptureTableHTML(profiles, attMap, year, month, daysInMonth, title) {
  const todayStr = toDateStr(new Date());
  const todayPrefix = `${year}-${pad(month)}`;
  const todayDay = todayStr.startsWith(todayPrefix) ? Number(todayStr.split('-')[2]) : -1;

  let html = '';

  if (title) {
    html += `<div class="excel-capture-title">${title}</div>`;
    html += `<div class="excel-capture-subtitle">BẢNG CÔNG THÁNG ${month}/${year}</div>`;
  }

  html += '<table class="excel-capture-table"><thead><tr>';
  html += '<th class="th-name">Nhân viên</th>';
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month - 1, d).getDay();
    const cls = dow === 0 ? 'th-sunday' : '';
    html += `<th class="${cls}">${d}</th>`;
  }
  html += '</tr></thead><tbody>';

  for (const emp of profiles) {
    const empAtt = attMap[emp.id] || {};
    const name = emp.full_name || emp.username || '';

    let rowNC = '<tr class="row-nc">';
    let rowOT = '<tr class="row-ot">';

    rowNC += `<td rowspan="2" class="td-name">${name}</td>`;

    for (let d = 1; d <= daysInMonth; d++) {
      const att = empAtt[d];
      const dow = new Date(year, month - 1, d).getDay();
      const cls = dow === 0 ? 'td-sunday' : '';
      const cell = getCellData(att);

      rowNC += `<td class="${cls} ${cell.ncCls}">${cell.nc}</td>`;
      rowOT += `<td class="${cls} ${cell.otCls}">${cell.ot}</td>`;
    }

    rowNC += '</tr>';
    rowOT += '</tr>';
    html += rowNC + rowOT;
  }

  html += '</tbody></table>';
  return html;
}

/* ⭐ Chụp 1 user (hoặc nhiều user) → PNG — lazy load html2canvas */
async function captureExcelPNG(profilesToCapture, title, filename) {
  try {
    await loadHtml2Canvas();
  } catch {
    toast('Không tải được thư viện ảnh');
    return null;
  }

  const y = state.excelMonth.getFullYear();
  const m = state.excelMonth.getMonth() + 1;
  const daysInMonth = new Date(y, m, 0).getDate();

  const attMap = buildAttMap();

  const captureArea = $('#excelCaptureArea');
  if (!captureArea) return null;

  const tableHTML = buildCaptureTableHTML(profilesToCapture, attMap, y, m, daysInMonth, title);
  captureArea.innerHTML = `
    <div style="display:inline-block;background:white;padding:0;">
      ${tableHTML}
      <div style="text-align:center;padding:10px;font-size:11px;color:#5c7c82;font-family:'Be Vietnam Pro',sans-serif;border-top:1px solid #d4eef2;">
        Xuất lúc ${pad(new Date().getDate())}/${pad(new Date().getMonth() + 1)}/${new Date().getFullYear()} ${pad(new Date().getHours())}:${pad(new Date().getMinutes())}
        · NC = Ngày công (8h) · OT = Tăng ca
      </div>
    </div>
  `;

  await new Promise(r => setTimeout(r, 100));

  try {
    const target = captureArea.firstElementChild;
    const canvas = await html2canvas(target, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      logging: false,
    });

    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        if (!blob) { resolve(null); return; }
        resolve({ blob, filename });
      }, 'image/png', 0.95);
    });
  } catch (err) {
    console.error(err);
    toast('Lỗi render ảnh: ' + err.message);
    return null;
  }
}

/* ⭐ Lưu 1 user */
async function saveExcelOne() {
  const empId = state.excelActionEmpId;
  if (!empId) return;
  const emp = state.excelProfiles.find(e => e.id === empId);
  if (!emp) return;

  closeModal('excelActionModal');
  toast('⏳ Đang tạo ảnh...');

  const name = emp.full_name || emp.username || 'NhanVien';
  const safeName = name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_ÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠƯẠ-ỹ]/g, '');

  const result = await captureExcelPNG(
    [emp],
    name,
    `BangCong_${safeName}.png`
  );

  if (!result) return;

  const url = URL.createObjectURL(result.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = result.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  toast('📷 Đã lưu ảnh: ' + result.filename);
}

/* ⭐ Chia sẻ 1 user */
async function shareExcelOne() {
  const empId = state.excelActionEmpId;
  if (!empId) return;
  const emp = state.excelProfiles.find(e => e.id === empId);
  if (!emp) return;

  closeModal('excelActionModal');
  toast('⏳ Đang tạo ảnh...');

  const name = emp.full_name || emp.username || 'NhanVien';
  const safeName = name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_ÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠƯẠ-ỹ]/g, '');

  const result = await captureExcelPNG(
    [emp],
    name,
    `BangCong_${safeName}.png`
  );

  if (!result) return;

  await sharePNG(result.blob, result.filename, `Bảng công ${name}`);
}

/* ⭐ Lưu tất cả */
async function saveExcelAll() {
  if (!state.excelProfiles.length) { toast('Chưa có dữ liệu'); return; }

  toast('⏳ Đang tạo ảnh toàn bộ...');

  const y = state.excelMonth.getFullYear();
  const m = state.excelMonth.getMonth() + 1;

  const result = await captureExcelPNG(
    state.excelProfiles,
    'BẢNG CÔNG TOÀN CÔNG TY',
    `BangCong_All_${pad(m)}_${y}.png`
  );

  if (!result) return;

  const url = URL.createObjectURL(result.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = result.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  toast('📷 Đã lưu ảnh: ' + result.filename);
}

/* ⭐ Chia sẻ tất cả */
async function shareExcelAll() {
  if (!state.excelProfiles.length) { toast('Chưa có dữ liệu'); return; }

  toast('⏳ Đang tạo ảnh toàn bộ...');

  const y = state.excelMonth.getFullYear();
  const m = state.excelMonth.getMonth() + 1;

  const result = await captureExcelPNG(
    state.excelProfiles,
    'BẢNG CÔNG TOÀN CÔNG TY',
    `BangCong_All_${pad(m)}_${y}.png`
  );

  if (!result) return;

  await sharePNG(result.blob, result.filename, 'Bảng công toàn công ty');
}

/* ⭐ Share PNG — hỗ trợ iOS + desktop */
async function sharePNG(blob, filename, title) {
  const file = new File([blob], filename, { type: 'image/png' });

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  if (isIOS && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text: filename });
      toast('✅ Đã chia sẻ ảnh');
    } catch (err) {
      if (err.name === 'AbortError') return;
      downloadBlob(blob, filename);
    }
  } else if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text: filename });
      toast('✅ Đã chia sẻ ảnh');
    } catch (err) {
      if (err.name === 'AbortError') return;
      downloadBlob(blob, filename);
    }
  } else {
    downloadBlob(blob, filename);
    toast('✅ Đã tải ảnh: ' + filename);
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* ============ BULK COPY ============ */
async function bulkCopySubmit() {
  const src = $('#bulkSourceDate').value;
  const tgt = $('#bulkTargetDate').value;
  if (!src || !tgt) { toast('Chọn ngày nguồn và đích'); return; }
  if (src === tgt) { toast('Ngày nguồn và đích phải khác nhau'); return; }

  const btn = $('#bulkCopySubmit');
  btn.disabled = true; btn.textContent = 'Đang copy...';

  const { data: srcData, error: e1 } = await supabase
    .from('attendance').select('*').eq('date', src);

  if (e1) {
    toast('Lỗi: ' + e1.message);
    btn.disabled = false; btn.textContent = 'Copy';
    return;
  }
  if (!srcData || !srcData.length) {
    toast('Ngày nguồn không có dữ liệu');
    btn.disabled = false; btn.textContent = 'Copy';
    return;
  }

  const { data: tgtData } = await supabase
    .from('attendance').select('employee_id').eq('date', tgt);
  const tgtIds = new Set((tgtData || []).map(e => e.employee_id));

  const toCopy = srcData.filter(a => !tgtIds.has(a.employee_id));
  if (!toCopy.length) {
    toast('Tất cả nhân viên đã có dữ liệu ngày đích');
    btn.disabled = false; btn.textContent = 'Copy';
    return;
  }

  const ok = confirm(
    `Sẽ copy ${toCopy.length} nhân viên từ ${formatDateVN(src)} sang ${formatDateVN(tgt)}.` +
    (tgtIds.size > 0 ? `\n\n(${tgtIds.size} người đã có ngày đích sẽ bị bỏ qua)` : '') +
    `\n\nTiếp tục?`
  );
  if (!ok) { btn.disabled = false; btn.textContent = 'Copy'; return; }

  const payloads = toCopy.map(a => ({
    employee_id: a.employee_id,
    date: tgt,
    total_hours: a.total_hours,
    ot_hours: a.ot_hours,
    is_off: a.is_off,
    mode: a.mode,
    manual_hours: a.manual_hours,
    areas: a.areas,
    ot_areas: a.ot_areas,
  }));

  const { error: e2 } = await supabase
    .from('attendance').upsert(payloads, { onConflict: 'employee_id,date' });

  btn.disabled = false; btn.textContent = 'Copy';

  if (e2) { toast('Lỗi: ' + e2.message); return; }

  toast(`Đã copy ${payloads.length} bản ghi ✓`);
  closeModal('bulkCopyModal');

  // ⭐ Invalidate cache
  invalidateAttendanceCache();
  if (salaryModule) salaryModule.invalidateCache();

  await loadAttendanceForMonth(true);
  await loadTodayAssignments();
  renderCalendar();
  renderBuildings();
}

/* ============ EVENTS ============ */
function bindEvents() {
  $('#loginBtn').addEventListener('click', showLoginScreen);
  $('#guestLoginBtn').addEventListener('click', showLoginScreen);
  $('#cancelLoginBtn').addEventListener('click', showGuestView);

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

  $('#todayAttendanceBtn').addEventListener('click', () => {
    if (!state.isAdmin) return;
    if (!state.selectedEmployeeId) { toast('Chọn nhân viên trước'); return; }
    const todayStr = toDateStr(new Date());
    openAttendanceModal(todayStr);
  });

  $('#employeeSelect').addEventListener('change', async (e) => {
    state.selectedEmployeeId = e.target.value;
    if (state.selectionMode) exitSelectionMode();
    await loadAttendanceForMonth();
    renderCalendar();
  });

  $('#prevMonth').addEventListener('click', () => changeMonth(-1));
  $('#nextMonth').addEventListener('click', () => changeMonth(1));

  $('#selectionToggleBtn').addEventListener('click', toggleSelectionMode);
  $('#cancelSelectionBtn').addEventListener('click', exitSelectionMode);
  $('#applySelectionBtn').addEventListener('click', () => {
    if (state.selectedDates.size === 0) return;
    const dates = [...state.selectedDates].sort();
    openAttendanceModal(dates[0], dates);
  });

  $('#bulkCopyBtn').addEventListener('click', () => {
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    $('#bulkSourceDate').value = toDateStr(yesterday);
    $('#bulkTargetDate').value = toDateStr(today);
    $('#bulkCopyInfo').textContent = '';
    openModal('bulkCopyModal');
  });
  $('#bulkCopyModal').addEventListener('click', (e) => {
    if (e.target.id === 'bulkCopyModal') closeModal('bulkCopyModal');
  });
  $('#bulkCopySubmit').addEventListener('click', bulkCopySubmit);

  // Areas filters
  const areasSearchEl = $('#areasSearch');
  if (areasSearchEl) {
    areasSearchEl.addEventListener('input', (e) => {
      state.areasSearch = e.target.value;
      renderBuildings();
    });
  }
  const areasRoleFilterEl = $('#areasRoleFilter');
  if (areasRoleFilterEl) {
    areasRoleFilterEl.addEventListener('change', (e) => {
      state.areasRoleFilter = e.target.value;
      renderBuildings();
    });
  }

  // EXPORT
  $('#exportExcelBtn').addEventListener('click', () => {
    if (exportModule) exportModule.openExportModal();
  });
  $('#exportModal').addEventListener('click', (e) => {
    if (e.target.id === 'exportModal') closeModal('exportModal');
  });
  $('#exportSubmitBtn').addEventListener('click', () => {
    // ⭐ doExport giờ là async — không await cần thiết, nhưng bắt lỗi
    if (exportModule) exportModule.doExport().catch(err => console.error(err));
  });
  $$('input[name="exportScope"]').forEach(r => {
    r.addEventListener('change', () => {
      $('#exportOnePersonGroup').style.display = r.value === 'one' ? 'block' : 'none';
    });
  });
  $('#exportMonth').addEventListener('change', () => {
    if (exportModule) exportModule.onMonthChanged().catch(err => console.error(err));
  });

  // SALARY
  $('#salaryMonth').addEventListener('change', () => {
    if (salaryModule) salaryModule.onMonthChanged();
  });
  $('#salaryRoleFilter').addEventListener('change', () => {
    if (salaryModule) salaryModule.onRoleFilterChanged();
  });
  $('#salarySearch').addEventListener('input', () => {
    if (salaryModule) salaryModule.onSearchChanged();
  });
  $('#salarySort').addEventListener('change', () => {
    if (salaryModule) salaryModule.onSortChanged();
  });
  $('#salaryExportBtn').addEventListener('click', () => {
    // ⭐ doExportSalary giờ là async
    if (exportModule && exportModule.doExportSalary) {
      exportModule.doExportSalary().catch(err => console.error(err));
    }
  });

  // EXCEL TAB
  const excelMonthEl = $('#excelMonth');
  if (excelMonthEl) excelMonthEl.addEventListener('change', onExcelMonthChanged);

  const excelSaveAllBtn = $('#excelSaveAllBtn');
  if (excelSaveAllBtn) excelSaveAllBtn.addEventListener('click', saveExcelAll);

  const excelShareAllBtn = $('#excelShareAllBtn');
  if (excelShareAllBtn) excelShareAllBtn.addEventListener('click', shareExcelAll);

  const excelSaveOneBtn = $('#excelSaveOneBtn');
  if (excelSaveOneBtn) excelSaveOneBtn.addEventListener('click', saveExcelOne);

  const excelShareOneBtn = $('#excelShareOneBtn');
  if (excelShareOneBtn) excelShareOneBtn.addEventListener('click', shareExcelOne);

  const excelActionModal = $('#excelActionModal');
  if (excelActionModal) {
    excelActionModal.addEventListener('click', (e) => {
      if (e.target.id === 'excelActionModal') closeModal('excelActionModal');
    });
  }

  // ATTENDANCE MODAL
  $('#attendanceModal').addEventListener('click', (e) => {
    if (e.target.id === 'attendanceModal') closeModal('attendanceModal');
  });
  $$('input[name="attMode"]').forEach(r => r.addEventListener('change', () => {
    toggleModeSections(r.value); updatePreview();
  }));
  $('#manualHours').addEventListener('input', updatePreview);
  $$('input[name="supMode"]').forEach(r => r.addEventListener('change', () => {
    toggleSupOtGroup(r.value); updatePreview();
  }));
  $('#supOtHours').addEventListener('input', updatePreview);

  $('#addMainAreaBtn').addEventListener('click', () => {
    state.modalAreas.push({ building_id: '', floor_id: '', hours: 0 });
    renderMainAreaPicker();
    updatePreview();
  });
  $('#addOtAreaBtn').addEventListener('click', () => {
    state.modalOtAreas.push({ building_id: '', floor_id: '', hours: null });
    renderOtAreaPicker();
    updatePreview();
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
    $('#empUsername').value = '';
    $('#empPassword').value = '';
    $('#empFullName').value = '';
    $('#empPhone').value = '';
    $('#empCreateError').textContent = '';
    openModal('employeeModal');
  });
  $('#employeeModal').addEventListener('click', (e) => {
    if (e.target.id === 'employeeModal') closeModal('employeeModal');
  });
  $('#saveEmployeeBtn').addEventListener('click', createEmployee);

  $('#editEmployeeModal').addEventListener('click', (e) => {
    if (e.target.id === 'editEmployeeModal') closeModal('editEmployeeModal');
  });
  $('#saveEditEmpBtn').addEventListener('click', saveEditEmployee);

  $('#phoneCallBtn').addEventListener('click', callPhoneNumber);
  $('#phoneCopyBtn').addEventListener('click', copyPhoneNumber);
  $('#phoneActionModal').addEventListener('click', (e) => {
    if (e.target.id === 'phoneActionModal') closeModal('phoneActionModal');
  });

  ['#empPhone', '#editEmpPhone'].forEach(id => {
    $(id).addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/[^0-9]/g, '').slice(0, 10);
    });
  });

  $$('[data-close]').forEach(btn =>
    btn.addEventListener('click', () => closeModal(btn.dataset.close)));

  supabase.auth.onAuthStateChange((_event, session) => {
    if (!session && state.user) {
      invalidateAttendanceCache();
      if (salaryModule) salaryModule.invalidateCache();
      showGuestView();
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  exportModule = initExportModule({
    state, toast, openModal, closeModal,
  });

  salaryModule = initSalaryModule({
    state, toast, formatHours, formatVND, roleLabelOf,
  });

  bindEvents();
  initAuth();
});