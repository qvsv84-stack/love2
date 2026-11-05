// app.js — Main entry: import modules, bind events, khởi động
import { supabase } from './supabase.js';
import {
  state, $, $$, toast, toDateStr,
  DEFAULT_DOMAIN, LS_KEY,
  initAuth, showLoginScreen, showGuestView, handleLogout,
  openModal, closeModal,
} from './core.js';

import {
  loadPublicEmployees, loadEmployees, renderEmployeeList,
  saveEditEmployee, createEmployee, openEditEmployeeModal,
} from './employees.js';

import {
  loadBuildings, loadTodayAssignments, renderBuildings,
  saveBuilding, saveFloors,
} from './buildings.js';

import {
  loadAttendanceForMonth, updateSummary, openAttendanceModal,
  renderMainAreaPicker, renderOtAreaPicker,
  toggleModeSections, toggleSupOtGroup, updatePreview,
  saveAttendance, toggleSelectionMode, exitSelectionMode,
  renderCalendar, switchTab, changeMonth,
} from './attendance.js';

import {
  loadExcelData, onExcelMonthChanged,
  saveExcelOne, shareExcelOne, saveExcelAll, shareExcelAll,
  bulkCopySubmit,
} from './excel.js';

import { initExportModule } from './export.js';
import { initSalaryModule } from './salary.js';
import { initPhoneModule } from './phone.js';

/* ============ BIND EVENTS ============ */
function bindEvents() {
  /* --- Login / Logout / Guest --- */
  $('#loginBtn').addEventListener('click', showLoginScreen);
  $('#guestLoginBtn').addEventListener('click', showLoginScreen);
  $('#cancelLoginBtn').addEventListener('click', showGuestView);
  $('#logoutBtn').addEventListener('click', handleLogout);

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

    const { onLoggedIn } = await import('./core.js');
    await onLoggedIn(data.user);
  });

  /* --- Tabs --- */
  $$('.tab-btn').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  /* --- Employee select --- */
  $('#employeeSelect').addEventListener('change', async (e) => {
    state.selectedEmployeeId = e.target.value;
    if (state.selectionMode) exitSelectionMode();
    await loadAttendanceForMonth();
    renderCalendar();
  });

  /* --- Month nav --- */
  $('#prevMonth').addEventListener('click', () => changeMonth(-1));
  $('#nextMonth').addEventListener('click', () => changeMonth(1));

  /* --- Quick attendance (today) --- */
  $('#todayAttendanceBtn').addEventListener('click', () => {
    if (!state.isAdmin) return;
    if (!state.selectedEmployeeId) { toast('Chọn nhân viên trước'); return; }
    const todayStr = toDateStr(new Date());
    openAttendanceModal(todayStr);
  });

  /* --- Selection mode --- */
  $('#selectionToggleBtn').addEventListener('click', toggleSelectionMode);
  $('#cancelSelectionBtn').addEventListener('click', exitSelectionMode);
  $('#applySelectionBtn').addEventListener('click', () => {
    if (state.selectedDates.size === 0) return;
    const dates = [...state.selectedDates].sort();
    openAttendanceModal(dates[0], dates);
  });

  /* --- Bulk copy modal --- */
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

  /* --- Areas filters --- */
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

  /* --- Export (attendance excel) --- */
  $('#exportExcelBtn').addEventListener('click', () => {
    if (state.exportModule) state.exportModule.openExportModal();
  });
  $('#exportModal').addEventListener('click', (e) => {
    if (e.target.id === 'exportModal') closeModal('exportModal');
  });
  $('#exportSubmitBtn').addEventListener('click', () => {
    if (state.exportModule) state.exportModule.doExport().catch(err => console.error(err));
  });
  $$('input[name="exportScope"]').forEach(r => {
    r.addEventListener('change', () => {
      const grp = $('#exportOnePersonGroup');
      if (grp) grp.style.display = r.value === 'one' ? 'block' : 'none';
    });
  });
  $('#exportMonth').addEventListener('change', () => {
    if (state.exportModule) state.exportModule.onMonthChanged().catch(err => console.error(err));
  });

  /* --- Salary --- */
  $('#salaryMonth').addEventListener('change', () => {
    if (state.salaryModule) state.salaryModule.onMonthChanged();
  });
  $('#salaryRoleFilter').addEventListener('change', () => {
    if (state.salaryModule) state.salaryModule.onRoleFilterChanged();
  });
  $('#salarySearch').addEventListener('input', () => {
    if (state.salaryModule) state.salaryModule.onSearchChanged();
  });
  $('#salarySort').addEventListener('change', () => {
    if (state.salaryModule) state.salaryModule.onSortChanged();
  });
  $('#salaryExportBtn').addEventListener('click', () => {
    if (state.exportModule && state.exportModule.doExportSalary) {
      state.exportModule.doExportSalary().catch(err => console.error(err));
    }
  });

  /* --- Excel tab --- */
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

  /* --- Attendance modal --- */
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

  /* --- Building modal --- */
  $('#addBuildingBtn').addEventListener('click', () => openModal('buildingModal'));
  $('#buildingModal').addEventListener('click', (e) => {
    if (e.target.id === 'buildingModal') closeModal('buildingModal');
  });
  $('#saveBuildingBtn').addEventListener('click', saveBuilding);

  /* --- Floor modal --- */
  $('#floorModal').addEventListener('click', (e) => {
    if (e.target.id === 'floorModal') closeModal('floorModal');
  });
  $('#saveFloorsBtn').addEventListener('click', saveFloors);

  /* --- Employee create modal --- */
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

  /* --- Employee edit modal --- */
  $('#editEmployeeModal').addEventListener('click', (e) => {
    if (e.target.id === 'editEmployeeModal') closeModal('editEmployeeModal');
  });
  $('#saveEditEmpBtn').addEventListener('click', saveEditEmployee);

  /* --- Phone input numeric-only --- */
  ['#empPhone', '#editEmpPhone'].forEach(id => {
    const el = $(id);
    if (el) {
      el.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/[^0-9]/g, '').slice(0, 10);
      });
    }
  });

  /* --- data-close buttons --- */
  $$('[data-close]').forEach(btn =>
    btn.addEventListener('click', () => closeModal(btn.dataset.close)));

  /* --- Auth state change --- */
  supabase.auth.onAuthStateChange((_event, session) => {
    if (!session && state.user) {
      import('./core.js').then(({ invalidateAttendanceCache }) => {
        invalidateAttendanceCache();
        if (state.salaryModule) state.salaryModule.invalidateCache();
        showGuestView();
      });
    }
  });
}

/* ============ DOM READY ============ */
document.addEventListener('DOMContentLoaded', () => {
  // Init 3 module con
  state.exportModule = initExportModule({
    state, toast, openModal, closeModal,
  });

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
      const ROLE_LABELS = {
        admin: 'Giám sát',
        temporary: 'Thời vụ',
        employee: 'Nhân viên',
        external: 'Ngoại cảnh',
      };
      if (!p) return 'Nhân viên';
      if (p.role === 'admin') return ROLE_LABELS.admin;
      if (p.role === 'temporary') return ROLE_LABELS.temporary;
      if (p.role === 'external') return ROLE_LABELS.external;
      return p.position || ROLE_LABELS.employee;
    },
  });

  initPhoneModule();

  bindEvents();
  initAuth();
});