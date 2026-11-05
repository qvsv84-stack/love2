// core.js — State, constants, helpers, cache, auth
import { supabase } from './supabase.js';

export const DEFAULT_DOMAIN = 'skyone.vn';
export const LS_KEY = 'cc_saved_login';
export const SUPERVISOR_HOURS = 8;
export const DAILY_MAIN_CAP = 8;

export const ROLE_LABELS = {
  admin: 'Giám sát',
  temporary: 'Thời vụ',
  employee: 'Nhân viên',
  external: 'Ngoại cảnh',
};

export const ROLE_ORDER = { admin: 1, employee: 2, temporary: 3, external: 4 };

export const state = {
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
  editingTemplate: null,
  modalAreas: [],
  modalOtAreas: [],
  floorSetupBuildingId: null,
  selectionMode: false,
  selectedDates: new Set(),
  selectedViewDate: null,
  editingEmployeeId: null,
  floorAssignments: {},
  externalAssignments: [],
  nightAssignments: [],
  sundayOtAssignments: [],
  specialAreas: { external: null, night: null },
  dayAssignments: [],
  expandedBuildings: new Set(),
  areasSearch: '',
  areasRoleFilter: 'all',
  areasViewDate: null,
  salaryMonth: new Date(),
  salaryRoleFilter: 'nv_tv',
  salarySearch: '',
  salarySort: 'hours_desc',
  salaryData: [],
  salaryMeta: null,
  excelMonth: new Date(),
  excelProfiles: [],
  excelAttendance: [],
  excelActionEmpId: null,
  salaryModule: null,
  exportModule: null,
  phoneModule: null,
};

export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => document.querySelectorAll(sel);

export function toast(msg, duration = 2200) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.style.display = 'none'), duration);
}

export function pad(n) { return String(n).padStart(2, '0'); }
export function toDateStr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

export function formatDateVN(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

export function formatHours(h) {
  if (h == null || isNaN(h)) return '0h';
  const n = Number(h);
  if (Number.isInteger(n)) return n + 'h';
  return n.toFixed(2).replace(/\.?0+$/, '') + 'h';
}

export function formatVND(n) {
  if (!n || isNaN(n)) return '0 đ';
  return new Intl.NumberFormat('vi-VN').format(Math.round(n)) + ' đ';
}

export function floorLabel(n) { return n === 0 ? 'Trệt' : `Tầng ${n}`; }

export function roleLabelOf(p) {
  if (!p) return 'Nhân viên';
  if (p.role === 'admin') return ROLE_LABELS.admin;
  if (p.role === 'temporary') return ROLE_LABELS.temporary;
  if (p.role === 'external') return ROLE_LABELS.external;
  return p.position || ROLE_LABELS.employee;
}

export function sortEmployees(arr) {
  return [...arr].sort((a, b) => {
    const oa = ROLE_ORDER[a.role] || 99;
    const ob = ROLE_ORDER[b.role] || 99;
    if (oa !== ob) return oa - ob;
    const na = a.full_name || a.username || '';
    const nb = b.full_name || b.username || '';
    return na.localeCompare(nb, 'vi');
  });
}

export function getShortName(fullName) {
  if (!fullName) return '';
  const parts = fullName.trim().split(/\s+/);
  return parts[parts.length - 1];
}

export function openModal(id) { const el = $('#' + id); if (el) el.style.display = 'flex'; }
export function closeModal(id) { const el = $('#' + id); if (el) el.style.display = 'none'; }

let _html2canvasPromise = null;
export function loadHtml2Canvas() {
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

export const attendanceCache = {};
export function attendanceCacheKey(empId, y, m) { return `${empId}_${y}_${m}`; }
export function invalidateAttendanceCache(empId) {
  if (empId) {
    Object.keys(attendanceCache).forEach(k => {
      if (k.startsWith(empId + '_')) delete attendanceCache[k];
    });
  } else {
    Object.keys(attendanceCache).forEach(k => delete attendanceCache[k]);
  }
}

let _showGuestInProgress = false;
let _onLoggedInInProgress = false;

export async function initAuth() {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (saved) {
      $('#loginEmail').value = saved.username || '';
      $('#loginPassword').value = saved.password || '';
      $('#rememberPass').checked = true;
    }
  } catch {}

  let session = null, timeoutId = null;
  try {
    const sessionPromise = supabase.auth.getSession();
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('AUTH_TIMEOUT')), 8000);
    });
    const { data } = await Promise.race([sessionPromise, timeoutPromise]);
    clearTimeout(timeoutId);
    session = data?.session;
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId);
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

export function showLoginScreen() {
  $('#loginScreen').style.display = 'block';
  $('#mainScreen').style.display = 'none';
}

export async function showGuestView() {
  if (_showGuestInProgress) return;
  _showGuestInProgress = true;
  try {
    state.user = null;
    state.profile = null;
    state.isAdmin = false;
    state.isSupervisorMode = false;
    state.employees = [];
    state.selectedEmployeeId = null;
    state.attendance = [];
    state.selectionMode = false;
    state.selectedDates.clear();
    state.selectedViewDate = null;
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
    const $vrow = $('#viewDateRow'); if ($vrow) $vrow.style.display = 'none';

    const [employees, buildings, attendance] = await Promise.all([
      import('./employees.js'),
      import('./buildings.js'),
      import('./attendance.js'),
    ]);

    attendance.switchTab('calendar');

    await employees.loadPublicEmployees();
    await Promise.all([
      buildings.loadBuildings(),
      attendance.loadAttendanceForMonth(),
    ]);

    attendance.renderCalendar();
  } finally {
    _showGuestInProgress = false;
  }
}

export async function onLoggedIn(user) {
  if (_onLoggedInInProgress) return;
  _onLoggedInInProgress = true;
  try {
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

    const [employees, buildings, attendance] = await Promise.all([
      import('./employees.js'),
      import('./buildings.js'),
      import('./attendance.js'),
    ]);

    attendance.switchTab('calendar');

    await Promise.all([
      employees.loadEmployees(),
      buildings.loadBuildings(),
      attendance.loadAttendanceForMonth(),
    ]);

    attendance.renderCalendar();
    buildings.renderBuildings();
  } finally {
    _onLoggedInInProgress = false;
  }
}

export async function handleLogout() {
  await supabase.auth.signOut();
  invalidateAttendanceCache();
  if (state.salaryModule) state.salaryModule.invalidateCache();
  await showGuestView();
}