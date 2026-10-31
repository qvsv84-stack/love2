import { supabase } from './supabase.js';

// ============ STATE ============
const state = {
  user: null,
  profile: null,
  employees: [],
  buildings: [],
  attendance: {},        // key: `${employeeId}_${dateISO}` -> record
  selectedEmployee: null,
  currentMonth: new Date(),
  editingDate: null,     // ISO date for attendance modal
  editingAtt: null,      // existing record
  modalAreas: [],        // [{building_id, floor_index}]
  editingBuilding: null,
  floorsDraft: []
};

const $ = (id) => document.getElementById(id);

// ============ HELPERS ============
function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function toast(msg, ms = 2400) {
  const t = $('toast');
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.style.display = 'none', ms);
}
function initials(name) {
  if (!name) return '?';
  return name.trim().split(/\s+/).slice(-2).map(w => w[0]).join('').toUpperCase();
}
function openModal(id) { $(id).style.display = 'flex'; }
function closeModal(id) { $(id).style.display = 'none'; }

// ============ AUTH ============
async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    state.user = session.user;
    await afterLogin();
  } else {
    $('loading').style.display = 'none';
    $('loginScreen').style.display = 'block';
  }
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('loginEmail').value.trim();
  const password = $('loginPassword').value;
  $('loginError').textContent = '';
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    $('loginError').textContent = 'Đăng nhập thất bại: ' + error.message;
    return;
  }
  state.user = data.user;
  $('loginScreen').style.display = 'none';
  $('loading').style.display = 'block';
  await afterLogin();
});

$('logoutBtn').addEventListener('click', async () => {
  await supabase.auth.signOut();
  location.reload();
});

async function afterLogin() {
  $('loginScreen').style.display = 'none';
  $('mainScreen').style.display = 'block';
  $('logoutBtn').style.display = 'block';
  $('loading').style.display = 'none';

  await loadProfile();
  await loadEmployees();
  await loadBuildings();
  await loadAttendanceForMonth();
  renderEmployeeSelect();
  renderCalendar();
  renderBuildings();
  renderEmployees();
}

async function loadProfile() {
  try {
    const { data, error } = await supabase
      .from('profiles').select('*').eq('id', state.user.id).maybeSingle();
    if (error) console.warn('profile err', error);
    state.profile = data || { full_name: state.user.email, role: 'supervisor', position: 'Giám sát' };
  } catch (e) {
    state.profile = { full_name: state.user.email, role: 'supervisor', position: 'Giám sát' };
  }
}

// ============ EMPLOYEES ============
async function loadEmployees() {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('role', 'employee')
      .order('full_name');
    if (error) throw error;
    state.employees = data || [];
  } catch (e) {
    console.warn('loadEmployees err', e.message);
    state.employees = [];
  }
}

function renderEmployeeSelect() {
  const