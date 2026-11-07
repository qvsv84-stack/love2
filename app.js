// app.js — Main entry
import { supabase } from './supabase.js';
import {
  state, $, $$, toast, toDateStr,
  DEFAULT_DOMAIN, LS_KEY,
  initAuth, showLoginScreen, showGuestView, handleLogout, onLoggedIn,
  invalidateAttendanceCache,
  openModal, closeModal,
} from './core.js';

import {
  loadPublicEmployees, loadEmployees, renderEmployeeList,
  saveEditEmployee, createEmployee, openEditEmployeeModal,
} from './employees.js';

import {
  loadBuildings, loadDayAssignments, loadTodayAssignments, renderBuildings,
  saveBuilding, saveFloors,
  openSpecialAreaModal, saveSpecialArea,
  handleBulkSelectChange,
  saveBulkAssignments,
  cancelBulkAssign,
  handleResetAreasData,
} from './buildings.js';

import {
  loadAttendanceForMonth, updateSummary, openAttendanceModal,
  renderMainAreaPicker, renderOtAreaPicker,
  toggleModeSections, toggleSupOtGroup, toggleSundayOtSection, updatePreview,
  saveAttendance, toggleSelectionMode, exitSelectionMode,
  renderCalendar, switchTab, changeMonth,
  openSelectedDate,
  invalidateDayAssignCache,
  handleBulkCopyBtnClick,
} from './attendance.js';

import {
  loadExcelData, onExcelMonthChanged,
  saveExcelOne, shareExcelOne, saveExcelAll, shareExcelAll,
  bulkCopySubmit,
  exportMonthPNGForEmployee,
} from './excel.js';

import { initExportModule } from './export.js';
import { initSalaryModule } from './salary.js';
import { initPhoneModule } from './phone.js';
import { initDebugModule, toggleDebug, dbg } from './debug.js';

const APP_BUILD = '2026-11-08-final-v11-exportfix';
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
    console.log('state.buildings:', state.buildings?.length || 0);
    console.log('state.floors:', state.floors?.length || 0);
    console.log('copyMode:', state.copyMode);
    console.log('selectedEmployeeId:', state.selectedEmployeeId);
    console.log('currentMonth:', state.currentMonth?.toISOString?.().slice(0, 7));
  };
};

const _authLog = [];
function logAuth(event, session) {
  const entry = {
    time: new Date().toLocaleTimeString('vi-VN'),
    event,
    session: session ? (session.user?.email || 'yes') : 'null',
    stateUser: state.user?.email || 'null',
  };
  _authLog.push(entry);
  if (_authLog.length > 50) _authLog.shift();
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
      console.warn('[withTimeout] caught error:', err?.message || err);
      return fallback;
    }),
    new Promise(resolve => setTimeout(() => {
      console.warn(`[TIMEOUT] Promise quá ${ms}ms — dùng fallback`);
      resolve(fallback);
    }, ms)),
  ]);
}

function isSessionExpired(session) {
  if (!session) return true;
  if (!session.expires_at) return false;
  return Date.now() / 1000 > (session.expires_at - 60);
}

async function forceLogout(reason) {
  console.warn('[forceLogout]', reason);
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
  showGuestView();
}

async function afterLoginRedirect() {
  const start = Date.now();
  while (Date.now() - start < 4000) {
    if (state.user && (state.employees?.length > 0 || state.isAdmin)) break;
    await new Promise(r => setTimeout(r, 150));
  }

  if (!state.user) return;
  if (state.isAdmin) return;

  try {
    switchTab('checkin');
  } catch (err) {
    console.warn('[afterLoginRedirect] switchTab fail:', err);
  }
}

function getAreasViewDate() {
  const $dp = $('#areasViewDate');
  if ($dp && $dp.value) return $dp.value;
  return state.areasViewDate || toDateStr(new Date());
}

async function reloadAreasForDate(dateStr) {
  if (!dateStr) dateStr = toDateStr(new Date());
  state.areasViewDate = dateStr;
  const $dp = $('#areasViewDate');
  if ($dp && $dp.value !== dateStr) $dp.value = dateStr;

  state.areasBulkEmpId = null;
  state._bulkAssignments = new Set();

  try {
    const b = await import('./buildings.js');
    await b.loadDayAssignments(dateStr);
    b.renderBuildings();
  } catch (err) {
    console.warn('[reloadAreas] failed:', err);
  }
}

async function tryAutoLogin() {
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (!saved) return false;
    const { username, password } = JSON.parse(saved || '{}');
    if (!username || !password) return false;
    const email = username.includes('@') ? username : `${username}@${DEFAULT_DOMAIN}`;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return false;
    if (!state.user) {
      try {
        await onLoggedIn(data.user);
        setTimeout(afterLoginRedirect, 200);
      } catch (err) { console.warn('[autoLogin onLoggedIn]', err); }
    }
    return true;
  } catch (err) {
    return false;
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
    return await tryAutoLogin();
  } catch (err) {
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
      setTimeout(afterLoginRedirect, 200);
    } catch (err) {
      console.error('[login] onLoggedIn failed:', err);
      toast('Lỗi tải dữ liệu: ' + (err?.message || 'không rõ'));
    }
  });

  const debugBtn = $('#debugBtn');
  if (debugBtn) debugBtn.addEventListener('click', toggleDebug);

  $$('.tab-btn').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  $('#employeeSelect').addEventListener('change', async (e) => {
    state.selectedEmployeeId = e.target.value;
    if (state.selectionMode) exitSelectionMode();
    await loadAttendanceForMonth();
    renderCalendar();
  });

  $('#prevMonth').addEventListener('click', () => changeMonth(-1));
  $('#nextMonth').addEventListener('click', () => changeMonth(1));

  $('#todayAttendanceBtn').addEventListener('click', () => {
    if (!state.isAdmin) return;
    if (!state.selectedEmployeeId) { toast('Chọn nhân viên trước'); return; }
    openAttendanceModal(toDateStr(new Date()));
  });

  $('#selectionToggleBtn').addEventListener('click', toggleSelectionMode);
  $('#cancelSelectionBtn').addEventListener('click', exitSelectionMode);
  $('#applySelectionBtn').addEventListener('click', () => {
    if (state.selectedDates.size === 0) return;
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
      invalidateDayAssignCache();
      if (state.salaryModule) state.salaryModule.invalidateCache();
      await loadAttendanceForMonth(true);
      renderCalendar();
      exitSelectionMode();
      reloadAreasForDate(getAreasViewDate());
    });
  }

  // ⭐ NÚT COPY NGÀY — dùng hàm từ attendance.js
  const $bulkCopyBtn = $('#bulkCopyBtn');
  if ($bulkCopyBtn) {
    $bulkCopyBtn.addEventListener('click', handleBulkCopyBtnClick);
  }

  // ⭐ NÚT XUẤT CÔNG THÁNG — dùng hàm từ excel.js
  const $exportMonthBtn = $('#exportMonthBtn');
  if ($exportMonthBtn) {
    $exportMonthBtn.addEventListener('click', async () => {
      if (!state.selectedEmployeeId) {
        toast('Chọn nhân viên trước');
        return;
      }
      try {
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
      try {
        const m = await import('./rooms.js');
        m.renderRooms();
      } catch (err) { console.warn('[rooms]', err); }
    });
  }
  const roomsFilterEl = $('#roomsBuildingFilter');
  if (roomsFilterEl) {
    roomsFilterEl.addEventListener('change', async (e) => {
      state.roomsBuildingFilter = e.target.value;
      try {
        const m = await import('./rooms.js');
        m.renderRooms();
      } catch (err) { console.warn('[rooms]', err); }
    });
  }

  const areasSearchEl = $('#areasSearch');
  if (areasSearchEl) {
    areasSearchEl.addEventListener('input', (e) => { state.areasSearch = e.target.value; renderBuildings(); });
  }
  const areasRoleFilterEl = $('#areasRoleFilter');
  if (areasRoleFilterEl) {
    areasRoleFilterEl.addEventListener('change', (e) => { state.areasRoleFilter = e.target.value; renderBuildings(); });
  }

  const $areasViewDate = $('#areasViewDate');
  if ($areasViewDate) {
    if (!$areasViewDate.value) $areasViewDate.value = state.areasViewDate || toDateStr(new Date());
    state.areasViewDate = $areasViewDate.value;
    const handleDateChange = async () => {
      const newDate = $areasViewDate.value;
      if (!newDate || state.areasViewDate === newDate) return;
      await reloadAreasForDate(newDate);
    };
    $areasViewDate.addEventListener('change', handleDateChange);
    $areasViewDate.addEventListener('input', handleDateChange);
  }

  const $areasTodayBtn = $('#areasTodayBtn');
  if ($areasTodayBtn) {
    $areasTodayBtn.addEventListener('click', async () => {
      const today = toDateStr(new Date());
      if (state.areasViewDate === today) return;
      await reloadAreasForDate(today);
    });
  }

  // ⭐ BULK ASSIGN — Chọn NV + Lưu/Huỷ
  const $bulkEmpSelect = $('#areasBulkEmpSelect');
  if ($bulkEmpSelect) {
    $bulkEmpSelect.addEventListener('change', handleBulkSelectChange);
  }

  const $bulkSaveBtn = $('#areasBulkSaveBtnTop');
  if ($bulkSaveBtn) {
    $bulkSaveBtn.addEventListener('click', saveBulkAssignments);
  }

  const $bulkCancelBtn = $('#areasBulkCancelBtn');
  if ($bulkCancelBtn) {
    $bulkCancelBtn.addEventListener('click', cancelBulkAssign);
  }

  // ⭐ RESET
  const $resetBtn = $('#areasResetBtn');
  if ($resetBtn) {
    $resetBtn.addEventListener('click', handleResetAreasData);
  }

  const $createBuildingBtn = document.querySelector('[data-create="building"]');
  if ($createBuildingBtn) $createBuildingBtn.addEventListener('click', () => openModal('buildingModal'));
  const $createExternalBtn = $('#createExternalBtn');
  if ($createExternalBtn) $createExternalBtn.addEventListener('click', () => {
    if (!state.isAdmin) { toast('Chỉ Giám sát được tạo khu vực'); return; }
    openSpecialAreaModal('external');
  });
  const $createNightBtn = $('#createNightBtn');
  if ($createNightBtn) $createNightBtn.addEventListener('click', () => {
    if (!state.isAdmin) { toast('Chỉ Giám sát được tạo khu vực'); return; }
    openSpecialAreaModal('night');
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
  if (excelActionModal) excelActionModal.addEventListener('click', (e) => { if (e.target.id === 'excelActionModal') closeModal('excelActionModal'); });

  $('#attendanceModal').addEventListener('click', (e) => { if (e.target.id === 'attendanceModal') closeModal('attendanceModal'); });
  $$('input[name="attMode"]').forEach(r => r.addEventListener('change', () => { toggleModeSections(r.value); updatePreview(); }));
  $('#manualHours').addEventListener('input', updatePreview);
  $$('input[name="supMode"]').forEach(r => r.addEventListener('change', () => { toggleSupOtGroup(r.value); updatePreview(); }));
  $('#supOtHours').addEventListener('input', updatePreview);
  const $sundayCheck = $('#sundayOtCheck');
  if ($sundayCheck) $sundayCheck.addEventListener('change', () => { toggleSundayOtSection($sundayCheck.checked); updatePreview(); });
  const $sundayHours = $('#sundayOtHours');
  if ($sundayHours) $sundayHours.addEventListener('input', updatePreview);

  $('#addMainAreaBtn').addEventListener('click', () => {
    state.modalAreas.push({ type: 'building', building_id: '', floor_id: '' });
    renderMainAreaPicker(); updatePreview();
  });
  $('#addOtAreaBtn').addEventListener('click', () => {
    state.modalOtAreas.push({ type: 'building', building_id: '', floor_id: '' });
    renderOtAreaPicker(); updatePreview();
  });
  $('#saveAttendanceBtn').addEventListener('click', saveAttendance);

  $('#buildingModal').addEventListener('click', (e) => { if (e.target.id === 'buildingModal') closeModal('buildingModal'); });
  $('#saveBuildingBtn').addEventListener('click', saveBuilding);
  const $specialModal = $('#specialAreaModal');
  if ($specialModal) $specialModal.addEventListener('click', (e) => { if (e.target.id === 'specialAreaModal') closeModal('specialAreaModal'); });
  const $saveSpecialBtn = $('#saveSpecialAreaBtn');
  if ($saveSpecialBtn) $saveSpecialBtn.addEventListener('click', saveSpecialArea);
  $('#floorModal').addEventListener('click', (e) => { if (e.target.id === 'floorModal') closeModal('floorModal'); });
  $('#saveFloorsBtn').addEventListener('click', saveFloors);

  $('#addEmployeeBtn').addEventListener('click', () => {
    $('#empUsername').value = ''; $('#empPassword').value = '';
    $('#empFullName').value = ''; $('#empPhone').value = '';
    $('#empCreateError').textContent = '';
    openModal('employeeModal');
  });
  $('#employeeModal').addEventListener('click', (e) => { if (e.target.id === 'employeeModal') closeModal('employeeModal'); });
  $('#saveEmployeeBtn').addEventListener('click', createEmployee);
  $('#editEmployeeModal').addEventListener('click', (e) => { if (e.target.id === 'editEmployeeModal') closeModal('editEmployeeModal'); });
  $('#saveEditEmpBtn').addEventListener('click', saveEditEmployee);

  ['#empPhone', '#editEmpPhone'].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener('input', (e) => { e.target.value = e.target.value.replace(/[^0-9]/g, '').slice(0, 10); });
  });

  $$('[data-close]').forEach(btn => btn.addEventListener('click', () => closeModal(btn.dataset.close)));

  supabase.auth.onAuthStateChange(async (event, session) => {
    logAuth(event, session);
    if (event === 'SIGNED_IN' && session?.user) {
      _selfHealAttempts = 0;
      if (!state.user || state.user.id !== session.user.id) {
        try {
          await onLoggedIn(session.user);
          setTimeout(afterLoginRedirect, 200);
        } catch (err) { console.warn('[SIGNED_IN]', err); }
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
          const ok = await tryAutoLogin();
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

    let existingSession = null;
    try {
      const { data } = await withTimeout(supabase.auth.getSession(), 3000, { data: { session: null } });
      existingSession = data?.session || null;
    } catch (err) {
      console.warn('[App] getSession error:', err);
    }

    if (existingSession && isSessionExpired(existingSession)) {
      try {
        const { data: refreshed, error } = await withTimeout(
          supabase.auth.refreshSession(), 5000, { data: null, error: 'timeout' }
        );
        if (error || !refreshed?.session) {
          await forceLogout('Session expired & refresh failed');
          return;
        }
        existingSession = refreshed.session;
      } catch (err) {
        await forceLogout('Refresh exception');
        return;
      }
    }

    if (!existingSession) {
      const restored = await withTimeout(tryAutoLogin(), 5000, false);
      if (restored) return;
    }

    try {
      const result = await withTimeout(initAuth(), 8000, null);
      if (result === null) {
        const { data } = await supabase.auth.getSession();
        if (!data.session || isSessionExpired(data.session)) {
          await forceLogout('initAuth timeout with expired session');
          return;
        }
      }
      if (state.user) {
        setTimeout(afterLoginRedirect, 200);
      }
    } catch (err) {
      console.error('[App] initAuth error:', err);
      const msg = String(err?.message || err || '').toLowerCase();
      const status = err?.status || err?.code || 0;
      if (status === 401 || msg.includes('jwt') || msg.includes('401') || msg.includes('unauthorized') || msg.includes('expired')) {
        await forceLogout('initAuth 401/JWT error');
        return;
      }
      showGuestView();
      return;
    }

    console.log('[App] ✅ App ready');
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