// app.js — Main entry
import { supabase } from './supabase.js';
import {
  state, $, $$, toast, toDateStr,
  DEFAULT_DOMAIN, LS_KEY,
  showLoginScreen, showGuestView, handleLogout, onLoggedIn,
  invalidateAttendanceCache,
  openModal, closeModal,
} from './core.js';

import { initExportModule } from './export.js';
import { initSalaryModule } from './salary.js';
import { initPhoneModule } from './phone.js';
import { initDebugModule, toggleDebug } from './debug.js';

const APP_BUILD = '2026-11-08-opt-v1';
console.log('%c[App.js] BUILD ' + APP_BUILD, 'color:#0ea5b7;font-weight:bold;font-size:13px');

window.__APP_JS_LOADED__ = true;

window.addEventListener('error', (e) => {
  console.error('[GLOBAL ERROR]', e.message, e.filename, e.lineno);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[UNHANDLED REJECTION]', e.reason);
});

if (typeof window !== 'undefined') {
  window.supabase = supabase;
  window.__diag = async () => {
    const { data } = await supabase.auth.getSession();
    console.log('=== DIAG ===');
    console.log('session:', data.session ? `user=${data.session.user.email}` : 'null');
    console.log('state.user:', state.user?.email || 'null');
    console.log('state.isAdmin:', state.isAdmin);
    console.log('state.employees:', state.employees?.length || 0);
  };
}

let _explicitLogout = false;
let _selfHealAttempts = 0;

function markExplicitLogout() {
  _explicitLogout = true;
  setTimeout(() => { _explicitLogout = false; }, 3000);
}

function withTimeout(promise, ms, fallback = null) {
  return Promise.race([
    promise.catch(err => {
      console.warn('[withTimeout] caught:', err?.message || err);
      return fallback;
    }),
    new Promise(resolve => setTimeout(() => {
      console.warn(`[TIMEOUT] Promise > ${ms}ms — fallback`);
      resolve(fallback);
    }, ms)),
  ]);
}

function isSessionExpired(session) {
  if (!session) return true;
  if (!session.expires_at) return false;
  return Date.now() / 1000 > (session.expires_at - 60);
}

async function clearStaleAuth() {
  try { await supabase.auth.signOut(); } catch {}
  try {
    Object.keys(localStorage)
      .filter(k => k.startsWith('sb-') || k === LS_KEY)
      .forEach(k => localStorage.removeItem(k));
  } catch {}
  state.user = null;
  state.isAdmin = false;
  state.employees = [];
  state.attendance = [];
  state.buildings = [];
  state.floors = [];
  invalidateAttendanceCache();
  if (state.salaryModule) state.salaryModule.invalidateCache();
}

async function tryAutoLogin() {
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (!saved) return null;
    const { username, password } = JSON.parse(saved || '{}');
    if (!username || !password) return null;
    const email = username.includes('@') ? username : `${username}@${DEFAULT_DOMAIN}`;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return null;
    return data.user || null;
  } catch {
    return null;
  }
}

async function ensureSessionAlive() {
  try {
    const { data } = await supabase.auth.getSession();
    if (data?.session && !isSessionExpired(data.session)) return true;
    if (data?.session) {
      const { data: refreshed, error } = await supabase.auth.refreshSession();
      if (!error && refreshed?.session) return true;
    }
    return !!(await tryAutoLogin());
  } catch {
    return false;
  }
}

function bindEvents() {
  $('#loginBtn').addEventListener('click', showLoginScreen);
  $('#guestLoginBtn').addEventListener('click', showLoginScreen);
  $('#cancelLoginBtn').addEventListener('click', showGuestView);
  $('#logoutBtn').addEventListener('click', () => { markExplicitLogout(); handleLogout(); });

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    let raw = $('#loginEmail').value.trim();
    if (!raw) { $('#loginError').textContent = 'Nhập tên đăng nhập'; return; }
    if (!raw.includes('@')) raw = `${raw}@${DEFAULT_DOMAIN}`;
    const pass = $('#loginPassword').value;
    const remember = $('#rememberPass').checked;
    $('#loginError').textContent = '';
    const { data, error } = await supabase.auth.signInWithPassword({ email: raw, password: pass });
    if (error) {
      $('#loginError').textContent = 'Sai tên đăng nhập hoặc mật khẩu';
      return;
    }
    if (remember) {
      localStorage.setItem(LS_KEY, JSON.stringify({ username: $('#loginEmail').value.trim(), password: pass }));
    } else localStorage.removeItem(LS_KEY);
    _selfHealAttempts = 0;
    try {
      await onLoggedIn(data.user);
    } catch (err) {
      console.error('[login] onLoggedIn failed:', err);
      toast('Lỗi tải dữ liệu: ' + (err?.message || 'không rõ'));
    }
  });

  const debugBtn = $('#debugBtn');
  if (debugBtn) debugBtn.addEventListener('click', toggleDebug);

  $$('.tab-btn').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  $('#employeeSelect').addEventListener('change', async (e) => {
    const { loadAttendanceForMonth, renderCalendar, exitSelectionMode } = await import('./attendance.js');
    state.selectedEmployeeId = e.target.value;
    if (state.selectionMode) exitSelectionMode();
    await loadAttendanceForMonth();
    renderCalendar();
  });

  $('#prevMonth').addEventListener('click', () => changeMonth(-1));
  $('#nextMonth').addEventListener('click', () => changeMonth(1));

  $('#todayAttendanceBtn').addEventListener('click', async () => {
    if (!state.isAdmin) return;
    if (!state.selectedEmployeeId) { toast('Chọn nhân viên trước'); return; }
    const { openAttendanceModal } = await import('./attendance.js');
    openAttendanceModal(toDateStr(new Date()));
  });

  $('#selectionToggleBtn').addEventListener('click', async () => {
    const { toggleSelectionMode } = await import('./attendance.js');
    toggleSelectionMode();
  });
  $('#cancelSelectionBtn').addEventListener('click', async () => {
    const { exitSelectionMode } = await import('./attendance.js');
    exitSelectionMode();
  });
  $('#applySelectionBtn').addEventListener('click', async () => {
    if (state.selectedDates.size === 0) return;
    const { openAttendanceModal } = await import('./attendance.js');
    const dates = [...state.selectedDates].sort();
    openAttendanceModal(dates[0], dates);
  });

  const $delSelBtn = $('#deleteSelectionBtn');
  if ($delSelBtn) {
    $delSelBtn.addEventListener('click', async () => {
      if (!state.isAdmin || !state.selectedEmployeeId || state.selectedDates.size === 0) return;
      const dates = [...state.selectedDates].sort();
      const emp = state.employees.find(e => e.id === state.selectedEmployeeId);
      const empName = emp?.full_name || emp?.username || 'nhân viên';
      if (!confirm(`Xoá chấm công của "${empName}" cho ${dates.length} ngày?`)) return;
      const { error } = await supabase.from('attendance').delete()
        .eq('employee_id', state.selectedEmployeeId).in('date', dates);
      if (error) { toast('Xoá thất bại: ' + error.message); return; }
      toast(`Đã xoá ${dates.length} ngày ✓`);
      invalidateAttendanceCache(state.selectedEmployeeId);
      const att = await import('./attendance.js');
      att.invalidateDayAssignCache();
      if (state.salaryModule) state.salaryModule.invalidateCache();
      await att.loadAttendanceForMonth(true);
      att.renderCalendar();
      att.exitSelectionMode();
    });
  }

  const $bulkCopyBtn = $('#bulkCopyBtn');
  if ($bulkCopyBtn) {
    $bulkCopyBtn.addEventListener('click', async () => {
      const { handleBulkCopyBtnClick } = await import('./attendance.js');
      handleBulkCopyBtnClick();
    });
  }

  const $exportMonthBtn = $('#exportMonthBtn');
  if ($exportMonthBtn) {
    $exportMonthBtn.addEventListener('click', async () => {
      if (!state.selectedEmployeeId) { toast('Chọn nhân viên trước'); return; }
      try {
        const { exportMonthPNGForEmployee } = await import('./excel.js');
        await exportMonthPNGForEmployee(state.selectedEmployeeId, state.currentMonth);
      } catch (err) {
        console.error('[exportMonth]', err);
        toast('Lỗi xuất ảnh: ' + (err.message || 'không xác định'));
      }
    });
  }

  const roomsSearchEl = $('#roomsSearch');
  if (roomsSearchEl) {
    roomsSearchEl.addEventListener('input', async (e) => {
      state.roomsSearch = e.target.value;
      try { const m = await import('./rooms.js'); m.renderRooms(); } catch {}
    });
  }
  const roomsFilterEl = $('#roomsBuildingFilter');
  if (roomsFilterEl) {
    roomsFilterEl.addEventListener('change', async (e) => {
      state.roomsBuildingFilter = e.target.value;
      try { const m = await import('./rooms.js'); m.renderRooms(); } catch {}
    });
  }

  const areasSearchEl = $('#areasSearch');
  if (areasSearchEl) {
    areasSearchEl.addEventListener('input', async (e) => {
      state.areasSearch = e.target.value;
      const b = await import('./buildings.js'); b.renderBuildings();
    });
  }
  const areasRoleFilterEl = $('#areasRoleFilter');
  if (areasRoleFilterEl) {
    areasRoleFilterEl.addEventListener('change', async (e) => {
      state.areasRoleFilter = e.target.value;
      const b = await import('./buildings.js'); b.renderBuildings();
    });
  }

  const $areasViewDate = $('#areasViewDate');
  if ($areasViewDate) {
    if (!$areasViewDate.value) $areasViewDate.value = state.areasViewDate || toDateStr(new Date());
    state.areasViewDate = $areasViewDate.value;
    const handleDateChange = async () => {
      const newDate = $areasViewDate.value;
      if (!newDate || state.areasViewDate === newDate) return;
      state.areasViewDate = newDate;
      state.areasBulkEmpId = null;
      state._bulkAssignments = new Set();
      const b = await import('./buildings.js');
      await b.loadDayAssignments(newDate);
      b.renderBuildings();
    };
    $areasViewDate.addEventListener('change', handleDateChange);
  }

  const $areasTodayBtn = $('#areasTodayBtn');
  if ($areasTodayBtn) {
    $areasTodayBtn.addEventListener('click', async () => {
      const today = toDateStr(new Date());
      if (state.areasViewDate === today) return;
      state.areasViewDate = today;
      const $dp = $('#areasViewDate'); if ($dp) $dp.value = today;
      state.areasBulkEmpId = null;
      state._bulkAssignments = new Set();
      const b = await import('./buildings.js');
      await b.loadDayAssignments(today);
      b.renderBuildings();
    });
  }

  const $bulkEmpSelect = $('#areasBulkEmpSelect');
  if ($bulkEmpSelect) {
    $bulkEmpSelect.addEventListener('change', async (e) => {
      const m = await import('./buildings.js'); m.handleBulkSelectChange(e);
    });
  }
  const $bulkSaveBtn = $('#areasBulkSaveBtnTop');
  if ($bulkSaveBtn) {
    $bulkSaveBtn.addEventListener('click', async () => {
      const m = await import('./buildings.js'); m.saveBulkAssignments();
    });
  }
  const $bulkCancelBtn = $('#areasBulkCancelBtn');
  if ($bulkCancelBtn) {
    $bulkCancelBtn.addEventListener('click', async () => {
      const m = await import('./buildings.js'); m.cancelBulkAssign();
    });
  }
  const $resetBtn = $('#areasResetBtn');
  if ($resetBtn) {
    $resetBtn.addEventListener('click', async () => {
      const m = await import('./buildings.js'); m.handleResetAreasData();
    });
  }

  const $createBuildingBtn = document.querySelector('[data-create="building"]');
  if ($createBuildingBtn) $createBuildingBtn.addEventListener('click', () => openModal('buildingModal'));
  const $createExternalBtn = $('#createExternalBtn');
  if ($createExternalBtn) $createExternalBtn.addEventListener('click', async () => {
    if (!state.isAdmin) { toast('Chỉ Giám sát được tạo khu vực'); return; }
    const m = await import('./buildings.js'); m.openSpecialAreaModal('external');
  });
  const $createNightBtn = $('#createNightBtn');
  if ($createNightBtn) $createNightBtn.addEventListener('click', async () => {
    if (!state.isAdmin) { toast('Chỉ Giám sát được tạo khu vực'); return; }
    const m = await import('./buildings.js'); m.openSpecialAreaModal('night');
  });

  $('#exportExcelBtn').addEventListener('click', () => { if (state.exportModule) state.exportModule.openExportModal(); });
  $('#exportModal').addEventListener('click', (e) => { if (e.target.id === 'exportModal') closeModal('exportModal'); });
  $('#exportSubmitBtn').addEventListener('click', () => { if (state.exportModule) state.exportModule.doExport().catch(console.error); });
  $$('input[name="exportScope"]').forEach(r => {
    r.addEventListener('change', () => {
      const grp = $('#exportOnePersonGroup');
      if (grp) grp.style.display = r.value === 'one' ? 'block' : 'none';
    });
  });
  $('#exportMonth').addEventListener('change', () => { if (state.exportModule) state.exportModule.onMonthChanged().catch(console.error); });

  $('#salaryMonth').addEventListener('change', () => { if (state.salaryModule) state.salaryModule.onMonthChanged(); });
  $('#salaryRoleFilter').addEventListener('change', () => { if (state.salaryModule) state.salaryModule.onRoleFilterChanged(); });
  $('#salarySearch').addEventListener('input', () => { if (state.salaryModule) state.salaryModule.onSearchChanged(); });
  $('#salarySort').addEventListener('change', () => { if (state.salaryModule) state.salaryModule.onSortChanged(); });
  $('#salaryExportBtn').addEventListener('click', () => { if (state.exportModule?.doExportSalary) state.exportModule.doExportSalary().catch(console.error); });

  const excelMonthEl = $('#excelMonth');
  if (excelMonthEl) excelMonthEl.addEventListener('change', async () => {
    const m = await import('./excel.js'); m.onExcelMonthChanged();
  });
  const bindExcel = async (id, fn) => {
    const el = $(id);
    if (el) el.addEventListener('click', async () => {
      const m = await import('./excel.js'); m[fn]();
    });
  };
  bindExcel('#excelSaveAllBtn', 'saveExcelAll');
  bindExcel('#excelShareAllBtn', 'shareExcelAll');
  bindExcel('#excelSaveOneBtn', 'saveExcelOne');
  bindExcel('#excelShareOneBtn', 'shareExcelOne');
  const excelActionModal = $('#excelActionModal');
  if (excelActionModal) excelActionModal.addEventListener('click', (e) => { if (e.target.id === 'excelActionModal') closeModal('excelActionModal'); });

  // ==== ATTENDANCE MODAL ====
  $('#attendanceModal').addEventListener('click', (e) => { if (e.target.id === 'attendanceModal') closeModal('attendanceModal'); });
  $$('input[name="attMode"]').forEach(r => r.addEventListener('change', async () => {
    const att = await import('./attendance.js');
    att.toggleModeSections(r.value); att.updatePreview();
  }));
  $('#manualHours').addEventListener('input', async () => { (await import('./attendance.js')).updatePreview(); });
  $$('input[name="supMode"]').forEach(r => r.addEventListener('change', async () => {
    const att = await import('./attendance.js');
    att.toggleSupOtGroup(r.value); att.updatePreview();
  }));
  $('#supOtHours').addEventListener('input', async () => { (await import('./attendance.js')).updatePreview(); });
  const $sundayCheck = $('#sundayOtCheck');
  if ($sundayCheck) $sundayCheck.addEventListener('change', async () => {
    const att = await import('./attendance.js');
    att.toggleSundayOtSection($sundayCheck.checked); att.updatePreview();
  });
  const $sundayHours = $('#sundayOtHours');
  if ($sundayHours) $sundayHours.addEventListener('input', async () => { (await import('./attendance.js')).updatePreview(); });

  $('#addMainAreaBtn').addEventListener('click', async () => {
    state.modalAreas.push({ type: 'building', building_id: '', floor_id: '' });
    const att = await import('./attendance.js');
    att.renderMainAreaPicker(); att.updatePreview();
  });
  $('#addOtAreaBtn').addEventListener('click', async () => {
    state.modalOtAreas.push({ type: 'building', building_id: '', floor_id: '' });
    const att = await import('./attendance.js');
    att.renderOtAreaPicker(); att.updatePreview();
  });
  $('#saveAttendanceBtn').addEventListener('click', async () => {
    const att = await import('./attendance.js'); att.saveAttendance();
  });

  $('#buildingModal').addEventListener('click', (e) => { if (e.target.id === 'buildingModal') closeModal('buildingModal'); });
  $('#saveBuildingBtn').addEventListener('click', async () => { (await import('./buildings.js')).saveBuilding(); });
  const $specialModal = $('#specialAreaModal');
  if ($specialModal) $specialModal.addEventListener('click', (e) => { if (e.target.id === 'specialAreaModal') closeModal('specialAreaModal'); });
  const $saveSpecialBtn = $('#saveSpecialAreaBtn');
  if ($saveSpecialBtn) $saveSpecialBtn.addEventListener('click', async () => { (await import('./buildings.js')).saveSpecialArea(); });
  $('#floorModal').addEventListener('click', (e) => { if (e.target.id === 'floorModal') closeModal('floorModal'); });
  $('#saveFloorsBtn').addEventListener('click', async () => { (await import('./buildings.js')).saveFloors(); });

  // ==== EMPLOYEES ====
  $('#addEmployeeBtn').addEventListener('click', () => {
    $('#empUsername').value = ''; $('#empPassword').value = '';
    $('#empFullName').value = ''; $('#empPhone').value = '';
    $('#empCreateError').textContent = '';
    openModal('employeeModal');
  });
  $('#employeeModal').addEventListener('click', (e) => { if (e.target.id === 'employeeModal') closeModal('employeeModal'); });
  $('#saveEmployeeBtn').addEventListener('click', async () => { (await import('./employees.js')).createEmployee(); });
  $('#editEmployeeModal').addEventListener('click', (e) => { if (e.target.id === 'editEmployeeModal') closeModal('editEmployeeModal'); });
  $('#saveEditEmpBtn').addEventListener('click', async () => { (await import('./employees.js')).saveEditEmployee(); });

  ['#empPhone', '#editEmpPhone'].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener('input', (e) => { e.target.value = e.target.value.replace(/[^0-9]/g, '').slice(0, 10); });
  });

  $$('[data-close]').forEach(btn => btn.addEventListener('click', () => closeModal(btn.dataset.close)));

  // ==== AUTH LISTENER ====
  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session?.user) {
      _selfHealAttempts = 0;
      if (!state.user || state.user.id !== session.user.id) {
        try { await onLoggedIn(session.user); }
        catch (err) { console.warn('[SIGNED_IN]', err); }
      }
      return;
    }
    if (event === 'SIGNED_OUT') {
      if (_explicitLogout) {
        _explicitLogout = false;
        state.user = null;
        invalidateAttendanceCache();
        if (state.salaryModule) state.salaryModule.invalidateCache();
        showGuestView();
        return;
      }
      if (_selfHealAttempts < 3) {
        _selfHealAttempts++;
        setTimeout(async () => {
          try {
            const { data, error } = await supabase.auth.refreshSession();
            if (!error && data?.session) return;
          } catch {}
          const ok = !!(await tryAutoLogin());
          if (!ok) { state.user = null; showGuestView(); }
        }, 150);
        return;
      }
      state.user = null;
      showGuestView();
      return;
    }
  });

  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    if (!state.user) return;
    const alive = await ensureSessionAlive();
    if (!alive) showGuestView();
  });

  window.addEventListener('online', () => {
    if (state.user) ensureSessionAlive().catch(() => {});
  });

  let _lastAdminTabsState = null;
  setInterval(() => {
    const wantDisplay = state.isAdmin ? '' : 'none';
    if (_lastAdminTabsState === wantDisplay) return;
    _lastAdminTabsState = wantDisplay;
    ['[data-tab="areas"]', '[data-tab="employees"]', '[data-tab="salary"]', '[data-tab="excel"]', '[data-tab="sql"]'].forEach(sel => {
      const $tab = document.querySelector(sel);
      if ($tab) $tab.style.display = wantDisplay;
    });
  }, 800);
}

// Lazy proxy cho changeMonth / switchTab
async function switchTab(name) {
  const m = await import('./attendance.js');
  m.switchTab(name);
}
async function changeMonth(delta) {
  const m = await import('./attendance.js');
  m.changeMonth(delta);
}

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[App] DOMContentLoaded — BUILD ' + APP_BUILD);
  initDebugModule();

  try {
    state.exportModule = initExportModule({ state, toast, openModal, closeModal });
    state.salaryModule = initSalaryModule({
      state, toast,
      formatHours: (h) => {
        if (h == null || isNaN(h)) return '0h';
        const n = Number(h);
        if (Number.isInteger(n)) return n + 'h';
        return n.toFixed(2).replace(/\.?0+$/, '') + 'h';
      },
      formatVND: (n) => {
        if (!n || isNaN(n)) return '0 đ';
        return new Intl.NumberFormat('vi-VN').format(Math.round(n)) + ' đ';
      },
      roleLabelOf: (p) => {
        const ROLE_LABELS = { admin: 'Giám sát', temporary: 'Thời vụ', employee: 'Nhân viên', external: 'Ngoại cảnh' };
        if (!p) return 'Nhân viên';
        if (p.role === 'admin') return ROLE_LABELS.admin;
        if (p.role === 'temporary') return ROLE_LABELS.temporary;
        if (p.role === 'external') return ROLE_LABELS.external;
        return p.position || ROLE_LABELS.employee;
      },
    });
    initPhoneModule();
    bindEvents();
    console.log('[App] bindEvents OK');

    // ⭐ BƯỚC 1: getSession 1 lần duy nhất, timeout ngắn
    let session = null;
    try {
      const { data } = await withTimeout(
        supabase.auth.getSession(), 2000,
        { data: { session: null } }
      );
      session = data?.session || null;
    } catch {}

    // ⭐ CASE 1: Session còn hạn → login ngay
    if (session && !isSessionExpired(session)) {
      try {
        await onLoggedIn(session.user);
      } catch (err) {
        console.error('[App] onLoggedIn:', err);
        await showGuestView();
      }
      return;
    }

    // ⭐ CASE 2: Session hết hạn → refresh (không gọi initAuth nữa)
    if (session) {
      try {
        const { data: refreshed, error } = await withTimeout(
          supabase.auth.refreshSession(), 3000,
          { data: null, error: 'timeout' }
        );
        if (!error && refreshed?.session) {
          try {
            await onLoggedIn(refreshed.session.user);
          } catch (err) {
            console.error('[App] onLoggedIn:', err);
            await showGuestView();
          }
          return;
        }
      } catch {}
      await clearStaleAuth();
      await showGuestView();
      return;
    }

    // ⭐ CASE 3: Không có session → thử auto-login từ credentials
    try {
      const user = await withTimeout(tryAutoLogin(), 3500, null);
      if (user) {
        try {
          await onLoggedIn(user);
        } catch (err) {
          console.error('[App] onLoggedIn:', err);
          await showGuestView();
        }
        return;
      }
    } catch {}

    // ⭐ CASE 4: Guest view
    await showGuestView();
    console.log('[App] ✅ App ready (guest)');
  } catch (err) {
    console.error('💥 App init crash:', err);
    const loading = $('#loading');
    if (loading) {
      loading.innerHTML =
        '<div style="text-align:center;padding:24px;font-family:sans-serif">' +
        '<p style="color:#e74c3c;font-weight:700;margin-bottom:12px">⚠️ Lỗi khởi động</p>' +
        '<p style="font-size:13px;color:#5c7c82;margin-bottom:16px">' + (err.message || '') + '</p>' +
        '<button onclick="localStorage.clear();location.reload()" style="padding:10px 20px;background:#0ea5b7;color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer">🔄 Xoá session & Tải lại</button>' +
        '</div>';
    }
  }
});