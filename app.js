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
} from './buildings.js';

import {
  loadAttendanceForMonth, updateSummary, openAttendanceModal,
  renderMainAreaPicker, renderOtAreaPicker,
  toggleModeSections, toggleSupOtGroup, toggleSundayOtSection, updatePreview,
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
import { initDebugModule, toggleDebug, dbg } from './debug.js';

function bindEvents() {
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
    dbg('info', 'Đăng nhập: ' + raw);
    const { data, error } = await supabase.auth.signInWithPassword({ email: raw, password: pass });
    if (error) {
      dbg('error', 'Login fail: ' + error.message);
      $('#loginError').textContent = 'Sai tên đăng nhập hoặc mật khẩu';
      return;
    }
    dbg('ok', 'Login OK: ' + data.user.email);

    if (remember) {
      localStorage.setItem(LS_KEY, JSON.stringify({
        username: $('#loginEmail').value.trim(), password: pass,
      }));
    } else localStorage.removeItem(LS_KEY);

    await onLoggedIn(data.user);
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
    const todayStr = toDateStr(new Date());
    openAttendanceModal(todayStr);
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
      if (!state.isAdmin) { toast('Chỉ Giám sát được xoá'); return; }
      if (!state.selectedEmployeeId) { toast('Chọn nhân viên'); return; }
      if (state.selectedDates.size === 0) return;

      const dates = [...state.selectedDates].sort();
      const emp = state.employees.find(e => e.id === state.selectedEmployeeId);
      const empName = emp?.full_name || emp?.username || 'nhân viên';

      const ok = confirm(`Xoá chấm công của "${empName}" cho ${dates.length} ngày?\n\nKhông thể hoàn tác.`);
      if (!ok) return;

      const { error } = await supabase.from('attendance').delete()
        .eq('employee_id', state.selectedEmployeeId)
        .in('date', dates);

      if (error) { toast('Xoá thất bại: ' + error.message); return; }

      toast(`Đã xoá ${dates.length} ngày ✓`);
      invalidateAttendanceCache(state.selectedEmployeeId);
      if (state.salaryModule) state.salaryModule.invalidateCache();
      await loadAttendanceForMonth(true);
      renderCalendar();
      exitSelectionMode();

      import('./buildings.js').then(b => {
        b.loadDayAssignments(state.areasViewDate)
          .then(() => b.renderBuildings())
          .catch(() => {});
      }).catch(() => {});
    });
  }

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

  /* ⭐ Bind date picker xem ngày cũ */
  const $areasViewDate = $('#areasViewDate');
  if ($areasViewDate) {
    // Set mặc định hôm nay nếu chưa có
    $areasViewDate.value = state.areasViewDate || toDateStr(new Date());
    state.areasViewDate = $areasViewDate.value;

    $areasViewDate.addEventListener('change', async (e) => {
      const newDate = e.target.value;
      if (!newDate) return;
      state.areasViewDate = newDate;
      dbg('info', 'Xem khu vực ngày: ' + newDate);

      const b = await import('./buildings.js');
      await b.loadDayAssignments(newDate);
      b.renderBuildings();
    });
  }

  const $createBuildingBtn = document.querySelector('[data-create="building"]');
  if ($createBuildingBtn) {
    $createBuildingBtn.addEventListener('click', () => openModal('buildingModal'));
  }
  const $createExternalBtn = $('#createExternalBtn');
  if ($createExternalBtn) {
    $createExternalBtn.addEventListener('click', () => {
      if (!state.isAdmin) { toast('Chỉ Giám sát được tạo khu vực'); return; }
      openSpecialAreaModal('external');
    });
  }
  const $createNightBtn = $('#createNightBtn');
  if ($createNightBtn) {
    $createNightBtn.addEventListener('click', () => {
      if (!state.isAdmin) { toast('Chỉ Giám sát được tạo khu vực'); return; }
      openSpecialAreaModal('night');
    });
  }

  $('#exportExcelBtn').addEventListener('click', () => {
    if (state.exportModule) state.exportModule.openExportModal();
  });
  $('#exportModal').addEventListener('click', (e) => {
    if (e.target.id === 'exportModal') closeModal('exportModal');
  });
  $('#exportSubmitBtn').addEventListener('click', () => {
    if (state.exportModule) state.exportModule.doExport().catch(err => {
      console.error(err);
      dbg('error', 'Export fail: ' + err.message);
    });
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

  const $sundayCheck = $('#sundayOtCheck');
  if ($sundayCheck) {
    $sundayCheck.addEventListener('change', () => {
      toggleSundayOtSection($sundayCheck.checked);
      updatePreview();
    });
  }
  const $sundayHours = $('#sundayOtHours');
  if ($sundayHours) {
    $sundayHours.addEventListener('input', updatePreview);
  }

  $('#addMainAreaBtn').addEventListener('click', () => {
    state.modalAreas.push({ type: 'building', building_id: '', floor_id: '', hours: null });
    renderMainAreaPicker();
    updatePreview();
  });
  $('#addOtAreaBtn').addEventListener('click', () => {
    state.modalOtAreas.push({ type: 'building', building_id: '', floor_id: '', hours: null });
    renderOtAreaPicker();
    updatePreview();
  });
  $('#saveAttendanceBtn').addEventListener('click', saveAttendance);

  $('#buildingModal').addEventListener('click', (e) => {
    if (e.target.id === 'buildingModal') closeModal('buildingModal');
  });
  $('#saveBuildingBtn').addEventListener('click', saveBuilding);

  const $specialModal = $('#specialAreaModal');
  if ($specialModal) {
    $specialModal.addEventListener('click', (e) => {
      if (e.target.id === 'specialAreaModal') closeModal('specialAreaModal');
    });
  }
  const $saveSpecialBtn = $('#saveSpecialAreaBtn');
  if ($saveSpecialBtn) $saveSpecialBtn.addEventListener('click', saveSpecialArea);

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

  ['#empPhone', '#editEmpPhone'].forEach(id => {
    const el = $(id);
    if (el) {
      el.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/[^0-9]/g, '').slice(0, 10);
      });
    }
  });

  $$('[data-close]').forEach(btn =>
    btn.addEventListener('click', () => closeModal(btn.dataset.close)));

  supabase.auth.onAuthStateChange((_event, session) => {
    if (!session && state.user) {
      invalidateAttendanceCache();
      if (state.salaryModule) state.salaryModule.invalidateCache();
      showGuestView();
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  dbg('ok', '🚀 App khởi động');

  initDebugModule();

  try {
    dbg('info', 'Init export module...');
    state.exportModule = initExportModule({ state, toast, openModal, closeModal });

    dbg('info', 'Init salary module...');
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

    dbg('info', 'Init phone module...');
    initPhoneModule();

    dbg('info', 'Bind events...');
    bindEvents();

    dbg('info', 'Init auth...');
    await initAuth();

    dbg('ok', '✅ App ready');
  } catch (err) {
    dbg('error', '💥 App init crash: ' + err.message);
    console.error(err);
    const loading = $('#loading');
    if (loading) {
      loading.innerHTML =
        '<div style="text-align:center;padding:24px;font-family:sans-serif">' +
        '<p style="color:#e74c3c;font-weight:700;margin-bottom:12px">⚠️ Lỗi khởi động</p>' +
        '<p style="font-size:13px;color:#5c7c82;margin-bottom:16px">' + (err.message || '') + '</p>' +
        '<button id="errDebugBtn" style="padding:10px 20px;background:#e74c3c;color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer">🔍 Mở Debug</button>' +
        '</div>';
      setTimeout(() => {
        const b = document.getElementById('errDebugBtn');
        if (b) b.addEventListener('click', async () => {
          const mod = await import('./debug.js');
          mod.openDebug();
          mod.runAll();
        });
      }, 50);
    }
  }
});