// attendance.js — Chấm công mix building + ngoại cảnh + ca đêm
import { supabase } from './supabase.js';
import {
  state, $, $$, toast, pad, toDateStr, formatDateVN, formatHours,
  floorLabel, roleLabelOf, openModal, closeModal,
  SUPERVISOR_HOURS, DAILY_MAIN_CAP,
  attendanceCache, attendanceCacheKey, invalidateAttendanceCache,
} from './core.js';
import { showPhoneAction } from './phone.js';

function ensureSpecialState() {
  if (!state.specialAreas) state.specialAreas = { external: null, night: null };
  if (!Array.isArray(state.dayAssignments)) state.dayAssignments = [];
}

/* ⭐ Cache day assignments theo ngày (dùng cho cả preview lẫn modal) */
const _dayAssignCache = new Map();
let _previewToken = 0;

async function getDayAssignments(dateStr) {
  if (_dayAssignCache.has(dateStr)) {
    state.dayAssignments = _dayAssignCache.get(dateStr);
    return state.dayAssignments;
  }
  const data = await loadDayAssignments(dateStr);
  _dayAssignCache.set(dateStr, data);
  state.dayAssignments = data;
  return data;
}

export function invalidateDayAssignCache() {
  _dayAssignCache.clear();
}

/* ⭐ SELECTED VIEW DATE — nhấp là hiện panel ngày luôn */
export function setSelectedViewDate(dateStr) {
  const newVal = dateStr || null;
  if (state.selectedViewDate === newVal) return;
  state.selectedViewDate = newVal;
  renderCalendar();
}

function hideDayPreview() {
  _previewToken++;
  const $p = $('#dayPreviewPanel');
  if ($p) $p.style.display = 'none';
}

function renderDayPreview(dateStr) {
  const token = ++_previewToken;
  const $panel  = $('#dayPreviewPanel');
  const $dateEl = $('#dppDate');
  const $body   = $('#dppBody');
  if (!$panel || !$body) return;

  if ($dateEl) $dateEl.textContent = `📅 ${formatDateVN(dateStr)}`;
  $body.innerHTML = '<p style="margin:0;color:var(--text-muted);font-size:13px">⏳ Đang tải...</p>';
  $panel.style.display = 'block';

  getDayAssignments(dateStr)
    .then(() => {
      if (token !== _previewToken) return;
      if (state.selectedViewDate !== dateStr) return;
      _renderDayPreviewImmediate(dateStr);
    })
    .catch(err => {
      if (token !== _previewToken) return;
      if ($body) $body.innerHTML =
        `<p style="margin:0;color:var(--danger);font-size:13px">⚠️ Lỗi tải dữ liệu ngày</p>`;
      console.warn('[preview] getDayAssignments:', err);
    });
}

function _renderDayPreviewImmediate(dateStr) {
  const $panel   = $('#dayPreviewPanel');
  const $body    = $('#dppBody');
  const $editBtn = $('#dppEditBtn');
  if (!$panel || !$body) return;

  const emp = state.employees.find(e => e.id === state.selectedEmployeeId);
  const att = state.attendance.find(a => a.date === dateStr);

  $body.innerHTML = buildDayPreviewBody(att, emp);

  if ($editBtn) {
    if (state.isAdmin && state.selectedEmployeeId) {
      $editBtn.style.display = 'inline-flex';
      $editBtn.onclick = (e) => {
        e.stopPropagation();
        openAttendanceModal(dateStr);
      };
    } else {
      $editBtn.style.display = 'none';
      $editBtn.onclick = null;
    }
  }

  $panel.style.display = 'block';
}

/* ⭐ Preview dùng CÙNG logic chia giờ với modal (calcEntryActualHours) */
function buildDayPreviewBody(att, emp) {
  if (!emp) {
    return `<p style="margin:0;color:var(--text-muted);font-size:13px">Chọn nhân viên để xem chi tiết</p>`;
  }
  if (!att) {
    return `<p style="margin:0;color:var(--text-muted);font-size:13px">📭 Chưa có chấm công ngày này</p>`;
  }
  if (att.mode === 'leave') {
    return `<div style="padding:8px 12px;background:#fef3c7;border-radius:8px;color:#92400e;font-weight:600;font-size:13px">🏖️ Nghỉ phép</div>`;
  }
  if (att.is_off || att.mode === 'off') {
    return `<div style="padding:8px 12px;background:#fee2e2;border-radius:8px;color:#991b1b;font-weight:600;font-size:13px">🚫 OFF — nghỉ</div>`;
  }

  const lines = [];
  let sumMain = 0, sumOT = 0;

  const addLine = (emoji, label, h, isOT, others) => {
    if (isOT) sumOT += h; else sumMain += h;
    const note = formatSharedNote(others);
    const noteHTML = note
      ? `<span style="color:var(--text-muted);font-weight:500;font-size:11px"> (${note})</span>`
      : '';
    lines.push(
      `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;font-size:13px;border-bottom:1px dashed var(--border)">` +
        `<span>${emoji} ${label}${noteHTML}</span><strong>${formatHours(h)}</strong></div>`
    );
  };

  if (Array.isArray(att.areas)) {
    for (const a of att.areas) {
      if (a.type === 'external')      addLine('🌳', 'Ngoại cảnh', calcEntryActualHours(a), false, getPoolForEntry(a).others);
      else if (a.type === 'night')    addLine('🌙', 'Ca đêm',    calcEntryActualHours(a), false, getPoolForEntry(a).others);
      else if (a.building_id && a.floor_id) {
        const b = state.buildings.find(x => x.id === a.building_id);
        const f = state.floors.find(x => x.id === a.floor_id);
        addLine('🏢', `${b?.name || '?'} — ${f ? floorLabel(f.floor_number) : '?'}`,
          calcEntryActualHours(a), false, getPoolForEntry(a).others);
      }
    }
  }

  if (att.mode === 'manual' && Number(att.manual_hours) > 0 &&
      (!att.areas || att.areas.length === 0)) {
    const h = Number(att.manual_hours);
    sumMain += h;
    lines.push(
      `<div style="display:flex;justify-content:space-between;padding:5px 0;font-size:13px;border-bottom:1px dashed var(--border)">` +
        `<span>⏱️ Giờ công</span><strong>${formatHours(h)}</strong></div>`
    );
  }

  if (Array.isArray(att.ot_areas)) {
    for (const a of att.ot_areas) {
      if (a.type === 'sunday_ot') {
        const h = Number(a.hours || 0);
        sumOT += h;
        lines.push(
          `<div style="display:flex;justify-content:space-between;padding:5px 0;font-size:13px;border-bottom:1px dashed var(--border)">` +
            `<span>📅 Tăng ca CN</span><strong>${formatHours(h)}</strong></div>`
        );
      } else if (a.type === 'external') addLine('🌳', 'Ngoại cảnh (OT)', calcEntryActualHours(a), true, getPoolForEntry(a).others);
      else if (a.type === 'night')      addLine('🌙', 'Ca đêm (OT)',    calcEntryActualHours(a), true, getPoolForEntry(a).others);
      else if (a.building_id && a.floor_id) {
        const b = state.buildings.find(x => x.id === a.building_id);
        const f = state.floors.find(x => x.id === a.floor_id);
        addLine('🏢', `${b?.name || '?'} — ${f ? floorLabel(f.floor_number) : '?'} (OT)`,
          calcEntryActualHours(a), true, getPoolForEntry(a).others);
      }
    }
  }

  return (
    (lines.length ? `<div>${lines.join('')}</div>` : '') +
    `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:10px;padding-top:8px;border-top:1px solid var(--border);font-size:13px">` +
      `<span style="color:var(--text-muted)">Công: <strong style="color:var(--text)">${formatHours(sumMain)}</strong></span>` +
      `<span style="color:var(--text-muted)">OT: <strong style="color:var(--warning)">${formatHours(sumOT)}</strong></span>` +
      `<span style="color:var(--text-muted);margin-left:auto">Tổng: <strong style="color:var(--ocean-700)">${formatHours(sumMain + sumOT)}</strong></span>` +
    `</div>`
  );
}

export function openSelectedDate() {
  if (!state.selectedViewDate) return;
  openAttendanceModal(state.selectedViewDate);
}

export async function loadAttendanceForMonth(forceRefresh = false) {
  if (!state.selectedEmployeeId) { state.attendance = []; return; }
  const y = state.currentMonth.getFullYear();
  const m = state.currentMonth.getMonth();
  const key = attendanceCacheKey(state.selectedEmployeeId, y, m);

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
  if (error) { console.error(error); state.attendance = []; }
  else { state.attendance = data || []; attendanceCache[key] = state.attendance; }
  updateSummary();
}

async function loadDayAssignments(dateStr) {
  try {
    const { data, error } = await supabase
      .from('attendance')
      .select('employee_id, areas, ot_areas')
      .eq('date', dateStr)
      .neq('is_off', true);
    if (error) { console.error(error); return []; }
    return data || [];
  } catch { return []; }
}

function getConflictsForFloor(floorId, excludeEmpId) {
  if (!floorId || !Array.isArray(state.dayAssignments)) return [];
  const empIds = new Set();
  for (const att of state.dayAssignments) {
    if (att.employee_id === excludeEmpId) continue;
    const check = (arr) => {
      if (!Array.isArray(arr)) return;
      for (const a of arr) {
        if ((!a.type || a.type === 'building') && a.floor_id === floorId) {
          empIds.add(att.employee_id);
        }
      }
    };
    check(att.areas);
    check(att.ot_areas);
  }
  return [...empIds].map(id => {
    const emp = state.employees.find(e => e.id === id);
    return emp?.full_name || emp?.username || 'NV khác';
  });
}

function getConflictsForSpecialType(type, excludeEmpId) {
  if (!type || !Array.isArray(state.dayAssignments)) return [];
  const empIds = new Set();
  for (const att of state.dayAssignments) {
    if (att.employee_id === excludeEmpId) continue;
    const check = (arr) => {
      if (!Array.isArray(arr)) return;
      for (const a of arr) {
        if (a.type === type) empIds.add(att.employee_id);
      }
    };
    check(att.areas);
    check(att.ot_areas);
  }
  return [...empIds].map(id => {
    const emp = state.employees.find(e => e.id === id);
    return emp?.full_name || emp?.username || 'NV khác';
  });
}

export function updateSummary() {
  const emp = state.employees.find(e => e.id === state.selectedEmployeeId);

  if (!emp) {
    ['sumName', 'sumRole', 'sumMonthLabel', 'sumTodayDate']
      .forEach(id => { const el = $('#' + id); if (el) el.textContent = '—'; });
    const $pr = $('#sumPhoneRow'); if ($pr) $pr.style.display = 'none';
    const $sd = $('#sumDays'); if ($sd) $sd.textContent = '0';
    const $sw = $('#sumWork'); if ($sw) $sw.textContent = '0h';
    const $so = $('#sumOT'); if ($so) $so.textContent = '0h';
    const $sl = $('#sumLeave'); if ($sl) $sl.textContent = '0';
    const $stw = $('#sumTodayWork'); if ($stw) $stw.textContent = '0h';
    const $sto = $('#sumTodayOT'); if ($sto) $sto.textContent = '0h';
    return;
  }

  $('#sumName').textContent = emp.full_name || emp.username || emp.email || '—';
  $('#sumRole').textContent = roleLabelOf(emp);

  const $phoneRow = $('#sumPhoneRow');
  const $phoneBtn = $('#sumPhoneBtn');
  const $phoneText = $('#sumPhoneText');
  const empPhone = (emp.phone || '').trim();
  if ($phoneRow && $phoneBtn && $phoneText) {
    if (empPhone) {
      $phoneText.textContent = empPhone;
      $phoneBtn.onclick = (ev) => { ev.preventDefault(); showPhoneAction(empPhone); };
      $phoneRow.style.display = 'block';
    } else { $phoneRow.style.display = 'none'; $phoneBtn.onclick = null; }
  }

  const y = state.currentMonth.getFullYear();
  const mo = state.currentMonth.getMonth() + 1;
  $('#sumMonthLabel').textContent = `${pad(mo)}/${y}`;

  let work = 0, ot = 0, workDays = 0, leaveDays = 0, todayWork = 0, todayOT = 0;
  const todayDate = new Date();
  const todayStr = toDateStr(todayDate);

  for (const a of state.attendance) {
    if (a.mode === 'leave') { leaveDays++; continue; }
    if (a.is_off) continue;
    const h = Number(a.total_hours || 0);
    const o = Number(a.ot_hours || 0);
    if (h > 0 || o > 0) workDays++;
    work += h; ot += o;
    if (a.date === todayStr) { todayWork += h; todayOT += o; }
  }

  $('#sumDays').textContent = workDays;
  $('#sumWork').textContent = formatHours(work);
  $('#sumOT').textContent = formatHours(ot);
  $('#sumLeave').textContent = leaveDays;

  const isViewingCurrentMonth =
    y === todayDate.getFullYear() && (mo - 1) === todayDate.getMonth();
  const $today = $('#sumTodaySection');
  if ($today) {
    if (isViewingCurrentMonth) {
      $today.style.display = 'block';
      $('#sumTodayDate').textContent = `${pad(todayDate.getDate())}/${pad(todayDate.getMonth() + 1)}`;
      $('#sumTodayWork').textContent = formatHours(todayWork);
      $('#sumTodayOT').textContent = formatHours(todayOT);
    } else $today.style.display = 'none';
  }
}

async function getPreviousAttendance(employeeId, beforeDate) {
  const { data, error } = await supabase
    .from('attendance').select('*')
    .eq('employee_id', employeeId)
    .lt('date', beforeDate)
    .order('date', { ascending: false })
    .limit(1);
  if (error) { console.error(error); return null; }
  return data?.[0] || null;
}

function getEntryDefaultHours(entry) {
  if (entry.type === 'building') {
    if (!entry.floor_id) return 0;
    const f = state.floors.find(x => x.id === entry.floor_id);
    return f ? Number(f.default_hours || 0) : 0;
  }
  if (!state.specialAreas) return 0;
  const sp = state.specialAreas[entry.type];
  return sp ? Number(sp.default_hours || 0) : 0;
}

function getPoolForEntry(entry) {
  const selfId = state.selectedEmployeeId;
  const entryType = entry.type || 'building';
  const floorId = entry.floor_id;
  const entryHours = (entry.hours != null && entry.hours > 0) ? Number(entry.hours) : null;
  const defaultHours = getEntryDefaultHours(entry);

  const empIds = new Set();
  const others = [];
  let maxHours = defaultHours > 0 ? defaultHours : 0;

  const resolveHours = (h) => {
    const v = (h != null && h !== '' && !isNaN(Number(h)) && Number(h) > 0) ? Number(h) : defaultHours;
    return v;
  };

  if (Array.isArray(state.dayAssignments)) {
    for (const att of state.dayAssignments) {
      if (att.employee_id === selfId) continue;
      const check = (arr) => {
        if (!Array.isArray(arr)) return;
        for (const a of arr) {
          const aType = a.type || 'building';
          if (aType !== entryType) continue;
          if (entryType === 'building' && a.floor_id !== floorId) continue;

          if (!empIds.has(att.employee_id)) {
            empIds.add(att.employee_id);
            const emp = state.employees.find(e => e.id === att.employee_id);
            others.push(emp?.full_name || emp?.username || 'NV khác');
          }
          const resolved = resolveHours(a.hours);
          if (resolved > maxHours) maxHours = resolved;
        }
      };
      check(att.areas);
      check(att.ot_areas);
    }
  }

  empIds.add(selfId);
  const selfResolved = entryHours != null ? entryHours : defaultHours;
  if (selfResolved > maxHours) maxHours = selfResolved;

  return { count: empIds.size, maxHours: maxHours > 0 ? maxHours : defaultHours, defaultHours, others };
}

function formatSharedNote(others) {
  if (!others || others.length === 0) return '';
  const first3 = others.slice(0, 3).join(', ');
  const more = others.length > 3 ? ` +${others.length - 3} người` : '';
  return `làm cùng ${first3}${more}`;
}

function calcEntryActualHours(entry) {
  const entryHours = (entry.hours != null && entry.hours > 0) ? Number(entry.hours) : null;

  if (state.batchDates && state.batchDates.length > 0) {
    return entryHours != null ? entryHours : getEntryDefaultHours(entry);
  }

  const pool = getPoolForEntry(entry);
  if (pool.count > 1) return pool.maxHours / pool.count;
  return entryHours != null ? entryHours : pool.defaultHours;
}

function updateEntryHints() {
  document.querySelectorAll('.area-entry-hint').forEach(el => {
    const idx = Number(el.dataset.idx);
    const wrapType = el.dataset.wrapType;
    const arr = wrapType === 'otAreaPicker' ? state.modalOtAreas : state.modalAreas;
    const entry = arr[idx];

    if (!entry) { el.style.display = 'none'; return; }

    const valid = entry.type === 'building' ? (entry.building_id && entry.floor_id) : true;
    if (!valid) { el.style.display = 'none'; return; }

    const h = calcEntryActualHours(entry);
    const pool = getPoolForEntry(entry);
    const sharedNote = formatSharedNote(pool.others);

    if (h > 0) {
      el.innerHTML = `→ Sẽ cộng <strong>${formatHours(h)}</strong>${sharedNote ? ` <span style="color:var(--text-muted);font-weight:500">(${sharedNote})</span>` : ''}`;
      el.style.display = 'block';
    } else {
      el.style.display = 'none';
    }
  });
}

function buildSummaryHTML(template) {
  if (!template) return '';

  if (template.mode === 'leave') {
    return `<div class="summary-status leave">🏖️ Phép — không tính công</div>`;
  }
  if (template.is_off || template.mode === 'off') {
    return `<div class="summary-status off">🚫 OFF — nghỉ</div>`;
  }

  const lines = [];

  const buildLine = (emoji, label, entry) => {
    const h = calcEntryActualHours(entry);
    const pool = getPoolForEntry(entry);
    const note = formatSharedNote(pool.others);
    const noteHTML = note ? ` <span class="summary-shared">(${note})</span>` : '';
    return `<div class="summary-line-item">${emoji} ${label} — <strong>${formatHours(h)}</strong>${noteHTML}</div>`;
  };

  if (Array.isArray(template.areas) && template.areas.length > 0) {
    for (const a of template.areas) {
      if (a.type === 'external') lines.push(buildLine('🌳', 'Ngoại cảnh', a));
      else if (a.type === 'night') lines.push(buildLine('🌙', 'Ca đêm', a));
      else if (a.building_id && a.floor_id) {
        const b = state.buildings.find(x => x.id === a.building_id);
        const f = state.floors.find(x => x.id === a.floor_id);
        const bName = b?.name || '?';
        const fName = f ? floorLabel(f.floor_number) : '?';
        lines.push(buildLine('🏢', `${bName} — ${fName}`, a));
      }
    }
  }

  if (template.mode === 'manual' && Number(template.manual_hours) > 0 && (!template.areas || template.areas.length === 0)) {
    lines.push(`<div class="summary-line-item">⏱️ Giờ công — <strong>${formatHours(template.manual_hours)}</strong></div>`);
  }

  if (Array.isArray(template.ot_areas) && template.ot_areas.length > 0) {
    for (const a of template.ot_areas) {
      if (a.type === 'sunday_ot') {
        lines.push(`<div class="summary-line-item">📅 Tăng ca CN — <strong>${formatHours(a.hours)}</strong></div>`);
      } else if (a.type === 'external') lines.push(buildLine('🌳', 'Ngoại cảnh (OT)', a));
      else if (a.type === 'night') lines.push(buildLine('🌙', 'Ca đêm (OT)', a));
      else if (a.building_id && a.floor_id) {
        const b = state.buildings.find(x => x.id === a.building_id);
        const f = state.floors.find(x => x.id === a.floor_id);
        const bName = b?.name || '?';
        const fName = f ? floorLabel(f.floor_number) : '?';
        lines.push(buildLine('🏢', `${bName} — ${fName} (OT)`, a));
      }
    }
  }

  const linesHTML = lines.length > 0
    ? lines.join('')
    : `<div class="summary-line-item" style="color:var(--text-muted);font-style:italic;font-weight:400">Chưa có khu vực</div>`;

  const totalMain = Number(template.total_hours || 0);
  const totalOT = Number(template.ot_hours || 0);

  return `
    <div class="summary-lines">${linesHTML}</div>
    <div class="summary-totals">
      <div><span>Công</span><strong>${formatHours(totalMain)}</strong></div>
      <div><span>Tăng ca</span><strong>${formatHours(totalOT)}</strong></div>
      <div><span>Tổng</span><strong style="color:var(--ocean-700)">${formatHours(totalMain + totalOT)}</strong></div>
    </div>
  `;
}

function showSummaryView(template) {
  state.editingTemplate = template;

  const $c = $('#attSummaryContent');
  if ($c) $c.innerHTML = buildSummaryHTML(template);

  const $sv = $('#attSummaryView'); if ($sv) $sv.style.display = 'block';
  const $ev = $('#attEditorView'); if ($ev) $ev.style.display = 'none';
  const $sticky = $('#attPreviewSticky'); if ($sticky) $sticky.style.display = 'none';

  const $save = $('#saveAttendanceBtn'); if ($save) $save.style.display = 'none';
  const $edit = $('#attEditBtn'); if ($edit) $edit.style.display = 'block';
  const $cancel = $('#attCancelBtn'); if ($cancel) $cancel.textContent = 'Đóng';

  const $pn = $('#prefillNote'); if ($pn) $pn.style.display = 'none';
  const $bn = $('#batchNote'); if ($bn) $bn.style.display = 'none';
}

function showEditorView() {
  const $sv = $('#attSummaryView'); if ($sv) $sv.style.display = 'none';
  const $ev = $('#attEditorView'); if ($ev) $ev.style.display = 'block';

  const $sticky = $('#attPreviewSticky');
  if ($sticky) $sticky.style.display = state.isSupervisorMode ? 'none' : 'flex';

  const $save = $('#saveAttendanceBtn'); if ($save) $save.style.display = 'block';
  const $edit = $('#attEditBtn'); if ($edit) $edit.style.display = 'none';
  const $cancel = $('#attCancelBtn'); if ($cancel) $cancel.textContent = 'Huỷ';
}

function applySundayToggle(dateStr, batchDates) {
  const $sundayToggle = $('#sundayOtToggle');
  if (!$sundayToggle) return;

  let isSunday = false;
  if (!batchDates && dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    isSunday = d.getDay() === 0;
  }

  const hasSavedSundayOt = isSundayOtChecked();

  $sundayToggle.style.display = (isSunday || hasSavedSundayOt) ? 'flex' : 'none';

  if (!isSunday && !hasSavedSundayOt) {
    const $check = $('#sundayOtCheck');
    if ($check) $check.checked = false;
    const $hours = $('#sundayOtHours');
    if ($hours) $hours.value = '';
    toggleSundayOtSection(false);
  }
}

export async function openAttendanceModal(dateStr, batchDates = null) {
  if (!state.isAdmin) { toast('Chỉ Giám sát được chấm công'); return; }
  if (!state.selectedEmployeeId) { toast('Chọn nhân viên trước'); return; }

  _previewToken++;
  ensureSpecialState();
  state.editingDate = dateStr;
  state.batchDates = batchDates;
  state.dayAssignments = [];

  const emp = state.employees.find(e => e.id === state.selectedEmployeeId);
  const targetIsSupervisor = emp?.role === 'admin';
  state.isSupervisorMode = targetIsSupervisor;

  let template = null, source = 'none', prevDate = null;
  if (!batchDates) {
    template = state.attendance.find(a => a.date === dateStr) || null;
    if (template) source = 'existing';
  }

  if (targetIsSupervisor) openSupervisorModeContent(template);
  else openEmployeeModeContent(template);

  $('#attModalTitle').textContent = batchDates
    ? `Chấm công ${batchDates.length} ngày — ${emp?.full_name || ''}`
    : `Chấm công — ${emp?.full_name || ''} — ${formatDateVN(dateStr)}`;
  $('#supervisorModeSection').style.display = targetIsSupervisor ? 'block' : 'none';
  $('#employeeModeSection').style.display = targetIsSupervisor ? 'none' : 'block';

  showPrefillNote(source, prevDate);
  showBatchNote(batchDates);
  applySundayToggle(dateStr, batchDates);

  if (!batchDates && template && source === 'existing') {
    showSummaryView(template);
  } else {
    showEditorView();
  }

  const $edit = $('#attEditBtn');
  if ($edit) {
    $edit.onclick = () => {
      const tpl = state.editingTemplate;
      if (state.isSupervisorMode) openSupervisorModeContent(tpl);
      else openEmployeeModeContent(tpl);
      applySundayToggle(state.editingDate, state.batchDates);
      showEditorView();
      updatePreview();
    };
  }

  updatePreview();
  openModal('attendanceModal');

  const bgTasks = [];

  if (!state.buildings || !state.buildings.length) {
    bgTasks.push(
      import('./buildings.js')
        .then(b => b.loadBuildings())
        .catch(err => console.warn('[bg buildings]', err))
    );
  }

  if (!batchDates) {
    bgTasks.push(
      getDayAssignments(dateStr)
        .then(() => updateEntryHints())
        .catch(err => console.warn('[bg day]', err))
    );
  }

  Promise.all(bgTasks).then(async () => {
    updateEntryHints();

    if (!batchDates && template && source === 'existing') {
      const saved = state.attendance.find(a => a.date === dateStr);
      if (saved) {
        const $c = $('#attSummaryContent');
        if ($c) $c.innerHTML = buildSummaryHTML(saved);
      }
    }

    if (!template && !batchDates) {
      try {
        const prev = await getPreviousAttendance(state.selectedEmployeeId, dateStr);
        if (prev) {
          const stillDefault = document.querySelector('input[name="attMode"]:checked')?.value === 'default';
          const pickerEmpty = state.modalAreas.length === 1 && !state.modalAreas[0].building_id;
          if (stillDefault && pickerEmpty) {
            prevDate = prev.date;
            if (targetIsSupervisor) openSupervisorModeContent(prev);
            else openEmployeeModeContent(prev);
            showPrefillNote('previous', prevDate);
            showEditorView();
            updatePreview();
          }
        }
      } catch (err) { console.warn('[bg prev]', err); }
    }
  });
}

function showPrefillNote(source, prevDate) {
  const el = $('#prefillNote');
  if (source === 'previous' && prevDate) {
    el.textContent = `📋 Đã điền sẵn theo ngày ${formatDateVN(prevDate)} — sửa lại nếu cần`;
    el.style.display = 'block';
  } else el.style.display = 'none';
}

function showBatchNote(batchDates) {
  const el = $('#batchNote');
  if (batchDates && batchDates.length > 1) {
    const sorted = [...batchDates].sort();
    const list = sorted.slice(0, 5).map(formatDateVN).join(', ');
    const more = sorted.length > 5 ? ` ... +${sorted.length - 5} ngày` : '';
    el.textContent = `📅 Sẽ áp dụng cho ${sorted.length} ngày: ${list}${more}`;
    el.style.display = 'block';
  } else el.style.display = 'none';
}

function openSupervisorModeContent(template) {
  let mode = 'default', otH = 0;
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
  ensureSpecialState();
  const validFloorIds = new Set(state.floors.map(f => f.id));
  const validBuildingIds = new Set(state.buildings.map(b => b.id));

  state.modalAreas = [];
  state.modalOtAreas = [];

  if (template && Array.isArray(template.areas) && template.areas.length) {
    for (const a of template.areas) {
      if (a.type === 'external' || a.type === 'night') {
        state.modalAreas.push({ type: a.type, hours: Number(a.hours || 0) });
      } else if (a.building_id && a.floor_id) {
        if (validBuildingIds.has(a.building_id) && validFloorIds.has(a.floor_id)) {
          state.modalAreas.push({
            type: 'building',
            building_id: a.building_id,
            floor_id: a.floor_id,
            hours: a.hours != null ? Number(a.hours) : null,
          });
        }
      }
    }
  }
  if (!state.modalAreas.length) {
    state.modalAreas = [{ type: 'building', building_id: '', floor_id: '', hours: null }];
  }

  const isSundayOt = template && Array.isArray(template.ot_areas) && template.ot_areas.some(a => a.type === 'sunday_ot');
  const sundayOtHours = isSundayOt ? Number(template.ot_areas.find(a => a.type === 'sunday_ot')?.hours || 0) : 0;

  const $sundayCheck = $('#sundayOtCheck');
  const $sundayHours = $('#sundayOtHours');
  if ($sundayCheck) $sundayCheck.checked = isSundayOt;
  if ($sundayHours) $sundayHours.value = sundayOtHours > 0 ? sundayOtHours : '';

  if (template && Array.isArray(template.ot_areas) && template.ot_areas.length) {
    for (const a of template.ot_areas) {
      if (a.type === 'sunday_ot') continue;
      if (a.type === 'external' || a.type === 'night') {
        state.modalOtAreas.push({ type: a.type, hours: Number(a.hours || 0) });
      } else if (a.building_id && a.floor_id) {
        if (validBuildingIds.has(a.building_id) && validFloorIds.has(a.floor_id)) {
          state.modalOtAreas.push({
            type: 'building',
            building_id: a.building_id,
            floor_id: a.floor_id,
            hours: a.hours != null ? Number(a.hours) : null,
          });
        }
      }
    }
  }

  renderMainAreaPicker();
  renderOtAreaPicker();

  let mode = 'default';
  if (template) {
    if (template.mode === 'leave') mode = 'leave';
    else if (template.is_off || template.mode === 'off') mode = 'off';
    else if (template.mode === 'manual') {
      const hasAreas = Array.isArray(template.areas) && template.areas.length > 0;
      mode = hasAreas ? 'default' : 'manual';
    }
  }

  $$('input[name="attMode"]').forEach(r => r.checked = r.value === mode);
  toggleModeSections(mode);
  $('#manualHours').value = template?.manual_hours ?? '';
  toggleSundayOtSection(isSundayOt);
}

function renderAreaPickerInto(wrapId, areasState, isOt) {
  const rerender = () => renderAreaPickerInto(wrapId, areasState, isOt);
  const wrap = $('#' + wrapId);
  if (!wrap) return;

  ensureSpecialState();

  if (!areasState.length) {
    wrap.innerHTML = '<p class="hint" style="margin:0 0 4px">Chưa có khu vực. Bấm "+ Thêm" bên dưới.</p>';
    return;
  }

  wrap.innerHTML = areasState.map((entry, idx) => {
    const type = entry.type || 'building';
    const hasExternal = !!state.specialAreas.external;
    const hasNight = !!state.specialAreas.night;

    const typeOpts = `
      <option value="building" ${type === 'building' ? 'selected' : ''}>🏢 Toà nhà</option>
      ${hasExternal ? `<option value="external" ${type === 'external' ? 'selected' : ''}>🌳 Ngoại cảnh</option>` : ''}
      ${hasNight ? `<option value="night" ${type === 'night' ? 'selected' : ''}>🌙 Ca đêm</option>` : ''}
    `;

    let contentHtml = '';
    let conflictHtml = '';

    if (type === 'building') {
      const bOpts = state.buildings.map(b =>
        `<option value="${b.id}" ${b.id === entry.building_id ? 'selected' : ''}>${b.name}</option>`
      ).join('');
      const floorsOfB = state.floors.filter(f => f.building_id === entry.building_id);
      const fOpts = floorsOfB.map(f =>
        `<option value="${f.id}" ${f.id === entry.floor_id ? 'selected' : ''}>
          ${floorLabel(f.floor_number)} (${formatHours(f.default_hours)})
        </option>`
      ).join('');

      const floor = entry.floor_id ? state.floors.find(x => x.id === entry.floor_id) : null;
      const displayVal = entry.hours != null ? entry.hours : '';
      const placeholder = floor ? formatHours(floor.default_hours) : 'Tự động';
      const hoursInput = `<input type="number" class="area-hours-input" data-hours-idx="${idx}"
        step="0.5" min="0" max="24" value="${displayVal}" placeholder="${placeholder}" title="Để trống = tự động chia sẻ" />`;

      if (entry.floor_id) {
        const conflicts = getConflictsForFloor(entry.floor_id, state.selectedEmployeeId);
        if (conflicts.length > 0) {
          conflictHtml = `<div class="area-conflict">⚠️ Cùng tầng với ${conflicts.join(', ')} — sẽ chia đều</div>`;
        }
      }

      contentHtml = `
        <select class="area-building"><option value="">-- Toà nhà --</option>${bOpts}</select>
        <select class="area-floor"><option value="">-- Tầng --</option>${fOpts}</select>
        ${hoursInput}
      `;
    } else {
      const special = state.specialAreas[type];
      const defaultH = special?.default_hours ?? null;
      const displayVal = entry.hours != null ? entry.hours : (defaultH != null ? defaultH : '');
      const label = type === 'external' ? 'Giờ ngoại cảnh' : 'Giờ ca đêm';
      const specialName = special?.name || (type === 'external' ? 'Ngoại cảnh' : 'Ca đêm');

      const conflicts = getConflictsForSpecialType(type, state.selectedEmployeeId);
      if (conflicts.length > 0) {
        conflictHtml = `<div class="area-conflict">⚠️ Cùng ${specialName.toLowerCase()} với ${conflicts.join(', ')} — sẽ chia đều</div>`;
      }

      contentHtml = `
        <div style="flex:1 1 auto;display:flex;align-items:center;gap:8px;min-width:0">
          <span style="font-size:13px;font-weight:600;color:var(--ocean-700);white-space:nowrap">
            ${type === 'external' ? '🌳' : '🌙'} ${specialName}:
          </span>
          <input type="number" class="area-hours-input" data-hours-idx="${idx}"
            step="0.5" min="0" max="24" value="${displayVal}" placeholder="${label}" />
        </div>
      `;
    }

    return `
      <div class="area-entry" data-idx="${idx}" data-type="${type}">
        <select class="area-type">${typeOpts}</select>
        ${contentHtml}
        <button class="remove-area" data-remove="${idx}">✕</button>
        ${conflictHtml}
        <div class="area-entry-hint" data-idx="${idx}" data-wrap-type="${wrapId}"></div>
      </div>`;
  }).join('');

  wrap.querySelectorAll('.area-entry').forEach(entryEl => {
    const idx = Number(entryEl.dataset.idx);
    const typeSel = entryEl.querySelector('.area-type');
    const bSel = entryEl.querySelector('.area-building');
    const fSel = entryEl.querySelector('.area-floor');
    const hInput = entryEl.querySelector('.area-hours-input');
    const removeBtn = entryEl.querySelector('.remove-area');

    if (typeSel) {
      typeSel.addEventListener('change', () => {
        const newType = typeSel.value;
        if (newType === 'building') {
          areasState[idx] = { type: 'building', building_id: '', floor_id: '', hours: null };
        } else {
          const special = state.specialAreas[newType];
          const autoHours = special?.default_hours != null ? Number(special.default_hours) : null;
          areasState[idx] = { type: newType, hours: autoHours };
        }
        rerender();
        updatePreview();
      });
    }
    if (bSel) {
      bSel.addEventListener('change', () => {
        areasState[idx].building_id = bSel.value;
        areasState[idx].floor_id = '';
        areasState[idx].hours = null;
        rerender();
        updatePreview();
      });
    }
    if (fSel) {
      fSel.addEventListener('change', () => {
        areasState[idx].floor_id = fSel.value;
        areasState[idx].hours = null;
        rerender();
        updatePreview();
      });
    }
    if (hInput) {
      hInput.addEventListener('input', () => {
        const raw = hInput.value.trim();
        areasState[idx].hours = raw === '' ? null : Number(raw);
        updatePreview();
      });
    }
    removeBtn.addEventListener('click', () => {
      areasState.splice(idx, 1);
      if (!areasState.length) {
        areasState.push({ type: 'building', building_id: '', floor_id: '', hours: null });
      }
      rerender();
      updatePreview();
    });
  });

  updateEntryHints();
}

export function renderMainAreaPicker() { renderAreaPickerInto('mainAreaPicker', state.modalAreas, false); }
export function renderOtAreaPicker() { renderAreaPickerInto('otAreaPicker', state.modalOtAreas, true); }

export function toggleModeSections(mode) {
  const m = $('#manualHoursGroup'); if (m) m.style.display = mode === 'manual' ? 'block' : 'none';
  const a = $('#mainAreaSection'); if (a) a.style.display = mode === 'default' ? 'block' : 'none';
  const o = $('#otSection'); if (o) o.style.display = (mode === 'off' || mode === 'leave') ? 'none' : 'block';
}

export function toggleSundayOtSection(isChecked) {
  const normal = $('#otNormalSection');
  const sunday = $('#sundayOtGroup');
  if (normal) normal.style.display = isChecked ? 'none' : 'block';
  if (sunday) sunday.style.display = isChecked ? 'block' : 'none';
}

export function toggleSupOtGroup(mode) {
  const g = $('#supOtGroup'); if (g) g.style.display = mode === 'ot' ? 'block' : 'none';
}

function getSelectedMode() { return document.querySelector('input[name="attMode"]:checked')?.value || 'default'; }
function getSelectedSupMode() { return document.querySelector('input[name="supMode"]:checked')?.value || 'default'; }
function isSundayOtChecked() { const $c = $('#sundayOtCheck'); return !!($c && $c.checked); }
function getSundayOtHours() { const $h = $('#sundayOtHours'); return $h ? Number($h.value || 0) : 0; }

function entryHours(entry) {
  if (!entry) return 0;
  if (entry.type === 'external' || entry.type === 'night') {
    if (entry.hours != null && !isNaN(entry.hours) && entry.hours > 0) return Number(entry.hours);
    const sp = state.specialAreas?.[entry.type];
    return sp ? Number(sp.default_hours || 0) : 0;
  }
  if (entry.hours != null && !isNaN(entry.hours) && entry.hours > 0) return Number(entry.hours);
  if (entry.floor_id) {
    const f = state.floors.find(x => x.id === entry.floor_id);
    if (f) return Number(f.default_hours || 0);
  }
  return 0;
}

function computeMainHoursRaw() {
  const mode = getSelectedMode();
  if (mode === 'off' || mode === 'leave') return 0;
  if (mode === 'manual') return Number($('#manualHours').value || 0);
  let h = 0;
  for (const entry of state.modalAreas) h += entryHours(entry);
  return h;
}
function computeMainHours() { return Math.min(computeMainHoursRaw(), DAILY_MAIN_CAP); }
function computeOverflow() { return Math.max(0, computeMainHoursRaw() - DAILY_MAIN_CAP); }
function computeOtHoursRaw() {
  if (isSundayOtChecked()) return getSundayOtHours();
  let h = 0;
  for (const entry of state.modalOtAreas) h += entryHours(entry);
  return h;
}
function computeOtHours() {
  if (isSundayOtChecked()) return getSundayOtHours();
  return computeOtHoursRaw() + computeOverflow();
}

function computePreviewMain() {
  const mode = getSelectedMode();
  if (mode === 'off' || mode === 'leave') return 0;
  if (mode === 'manual') return Number($('#manualHours').value || 0);
  let total = 0;
  for (const entry of state.modalAreas) {
    if (entry.type === 'building' && (!entry.building_id || !entry.floor_id)) continue;
    total += calcEntryActualHours(entry);
  }
  return total;
}

function computePreviewOt() {
  if (isSundayOtChecked()) return getSundayOtHours();
  let total = 0;
  for (const entry of state.modalOtAreas) {
    if (entry.type === 'building' && (!entry.building_id || !entry.floor_id)) continue;
    total += calcEntryActualHours(entry);
  }
  return total;
}

export function updatePreview() {
  if (state.isSupervisorMode) {
    const mode = getSelectedSupMode();
    const isOff = mode === 'off', isLeave = mode === 'leave';
    const mainH = (isOff || isLeave) ? 0 : SUPERVISOR_HOURS;
    const otH = mode === 'ot' ? Number($('#supOtHours').value || 0) : 0;
    const $mp = $('#supMainPreview'); if ($mp) $mp.textContent = isLeave ? 'PHÉP' : (isOff ? 'OFF' : formatHours(SUPERVISOR_HOURS));
    const $op = $('#supOtPreview'); if ($op) $op.textContent = formatHours(otH);
    const $tp = $('#supTotalPreview'); if ($tp) $tp.textContent = isLeave ? 'PHÉP' : formatHours(mainH + otH);
    return;
  }

  const mode = getSelectedMode();
  const isInactive = mode === 'off' || mode === 'leave';

  const actualMain = computePreviewMain();
  const mainCapped = Math.min(actualMain, DAILY_MAIN_CAP);
  const overflow = Math.max(0, actualMain - DAILY_MAIN_CAP);

  const actualOtRaw = isInactive ? 0 : computePreviewOt();
  const actualOt = isInactive ? 0 : (actualOtRaw + overflow);

  const $m = $('#mainHoursPreview'); if ($m) $m.textContent = mode === 'leave' ? 'PHÉP' : (mode === 'off' ? 'OFF' : formatHours(mainCapped));
  const $o = $('#otHoursPreview'); if ($o) $o.textContent = formatHours(actualOt);
  const $t = $('#totalHoursPreview'); if ($t) $t.textContent = mode === 'leave' ? 'PHÉP' : formatHours(mainCapped + actualOt);

  const $n = $('#shareNote');
  if ($n) {
    const hasBuildingAuto = state.modalAreas.some(a => a.type === 'building' && a.floor_id && (a.hours == null || a.hours === 0));
    $n.style.display = (mode === 'default' && mainCapped > 0 && hasBuildingAuto) ? 'block' : 'none';
  }

  updateEntryHints();
}

function buildSupervisorPayload() {
  const mode = getSelectedSupMode();
  const isOff = mode === 'off', isLeave = mode === 'leave';
  const otH = mode === 'ot' ? Number($('#supOtHours').value || 0) : 0;
  if (mode === 'ot' && otH <= 0) { toast('Nhập số giờ tăng ca (> 0)'); return null; }
  if (isLeave) return { employee_id: state.selectedEmployeeId, total_hours: 0, ot_hours: 0, is_off: false, mode: 'leave', manual_hours: null, areas: [], ot_areas: [] };
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

function serializeArea(entry) {
  if (entry.type === 'building') {
    return {
      type: 'building',
      building_id: entry.building_id,
      floor_id: entry.floor_id,
      hours: entry.hours != null && !isNaN(entry.hours) && entry.hours > 0 ? Number(entry.hours) : null,
    };
  }
  return {
    type: entry.type,
    hours: entry.hours != null && !isNaN(entry.hours) && entry.hours > 0 ? Number(entry.hours) : null,
  };
}

function buildEmployeePayload() {
  const mode = getSelectedMode();
  if (mode === 'leave') return { employee_id: state.selectedEmployeeId, total_hours: 0, ot_hours: 0, is_off: false, mode: 'leave', manual_hours: null, areas: [], ot_areas: [] };
  if (mode === 'off') return { employee_id: state.selectedEmployeeId, total_hours: 0, ot_hours: 0, is_off: true, mode: 'off', manual_hours: null, areas: [], ot_areas: [] };
  if (mode === 'manual') {
    const mh = Number($('#manualHours').value || 0);
    if (mh <= 0) { toast('Nhập số giờ công (> 0)'); return null; }
    return {
      employee_id: state.selectedEmployeeId,
      total_hours: Math.min(mh, DAILY_MAIN_CAP),
      ot_hours: computeOtHours(),
      is_off: false, mode: 'manual', manual_hours: mh,
      areas: [],
      ot_areas: isSundayOtChecked()
        ? [{ type: 'sunday_ot', hours: getSundayOtHours() }]
        : state.modalOtAreas.filter(a => entryHours(a) > 0).map(a => serializeArea(a)),
    };
  }

  const validAreas = state.modalAreas.filter(a => {
    if (a.type === 'building') return a.building_id && a.floor_id;
    return true;
  });
  if (!validAreas.length) { toast('Chọn ít nhất 1 khu vực hoặc nhập giờ'); return null; }

  let totalMain = 0;
  for (const entry of validAreas) totalMain += entryHours(entry);
  const mainCapped = Math.min(totalMain, DAILY_MAIN_CAP);

  let otAreas = [];
  if (isSundayOtChecked()) {
    const sh = getSundayOtHours();
    if (sh > 0) otAreas = [{ type: 'sunday_ot', hours: sh }];
  } else {
    otAreas = state.modalOtAreas.filter(a => entryHours(a) > 0).map(a => serializeArea(a));
  }
  const totalOt = isSundayOtChecked() ? getSundayOtHours() : otAreas.reduce((s, a) => s + Number(a.hours || 0), 0);

  return {
    employee_id: state.selectedEmployeeId,
    total_hours: mainCapped,
    ot_hours: totalOt,
    is_off: false, mode: 'default', manual_hours: null,
    areas: validAreas.map(a => serializeArea(a)),
    ot_areas: otAreas,
  };
}

export async function saveAttendance() {
  if (!state.isAdmin) { toast('Chỉ Giám sát được chấm công'); return; }
  if (!state.selectedEmployeeId) return;
  const basePayload = state.isSupervisorMode ? buildSupervisorPayload() : buildEmployeePayload();
  if (!basePayload) return;
  const dates = state.batchDates && state.batchDates.length > 0 ? [...state.batchDates] : [state.editingDate];

  if (dates.length > 1) {
    const { data } = await supabase.from('attendance').select('date').eq('employee_id', state.selectedEmployeeId).in('date', dates);
    if (data && data.length > 0) {
      const ok = confirm(`${data.length}/${dates.length} ngày đã có dữ liệu sẽ bị GHI ĐÈ.\n\nTiếp tục?`);
      if (!ok) return;
    }
  }

  const payloads = dates.map(date => ({ ...basePayload, date }));
  const { error } = await supabase.from('attendance').upsert(payloads, { onConflict: 'employee_id,date' });
  if (error) { toast('Lưu thất bại: ' + error.message); return; }

  toast(`Đã lưu ${dates.length} ngày ✓`);

  // ⭐ Invalidate preview cache vì assignments đã thay đổi
  invalidateDayAssignCache();

  const wasSelection = state.selectionMode;
  state.batchDates = null;
  if (wasSelection) exitSelectionMode();

  invalidateAttendanceCache(state.selectedEmployeeId);
  if (state.salaryModule) state.salaryModule.invalidateCache();

  await loadAttendanceForMonth(true);
  renderCalendar();

  import('./buildings.js').then(buildings => {
    buildings.loadDayAssignments(state.areasViewDate)
      .then(() => buildings.renderBuildings())
      .catch(err => console.warn(err));
  }).catch(err => console.warn(err));

  if (dates.length === 1 && !wasSelection) {
    await getDayAssignments(dates[0]);
    const saved = state.attendance.find(a => a.date === dates[0]);
    if (saved) {
      showSummaryView(saved);
      return;
    }
  }

  closeModal('attendanceModal');
}

export function toggleSelectionMode() {
  if (state.selectionMode) exitSelectionMode();
  else {
    state.selectionMode = true;
    state.selectedDates.clear();

    state.selectedViewDate = null;
    const $vrow = $('#viewDateRow'); if ($vrow) $vrow.style.display = 'none';

    const bar = $('#selectionBar'); if (bar) bar.style.display = 'block';
    const btn = $('#selectionToggleBtn');
    if (btn) { btn.textContent = '✕ Thoát chọn'; btn.classList.add('active'); }
    updateSelectionCount();
    renderCalendar();
  }
}

export function exitSelectionMode() {
  state.selectionMode = false;
  state.selectedDates.clear();
  const bar = $('#selectionBar'); if (bar) bar.style.display = 'none';
  const btn = $('#selectionToggleBtn');
  if (btn) { btn.textContent = '☑️ Chọn nhiều ngày'; btn.classList.remove('active'); }
  renderCalendar();
}

export function toggleDateSelection(dateStr) {
  if (state.selectedDates.has(dateStr)) state.selectedDates.delete(dateStr);
  else state.selectedDates.add(dateStr);
  updateSelectionCount();
  renderCalendar();
}

export function updateSelectionCount() {
  const n = state.selectedDates.size;
  const c = $('#selectionCount'); if (c) c.textContent = `${n} ngày đã chọn`;
  const a = $('#applySelectionBtn'); if (a) a.disabled = n === 0;
  const d = $('#deleteSelectionBtn'); if (d) d.disabled = n === 0;
}

export function renderCalendar() {
  const y = state.currentMonth.getFullYear();
  const m = state.currentMonth.getMonth();
  const $ml = $('#monthLabel'); if ($ml) $ml.textContent = `Tháng ${m + 1}/${y}`;
  const grid = $('#calendarGrid');
  if (!grid) return;

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
    let cls = 'cal-day', sub = '';
    if (att) {
      if (att.mode === 'leave') { cls += ' leave-day'; sub = 'P'; }
      else if (att.is_off) { cls += ' off-day'; sub = 'OFF'; }
      else {
        cls += ' has-data';
        const totalH = Number(att.total_hours || 0) + Number(att.ot_hours || 0);
        sub = totalH > 0 ? formatHours(totalH) : '';
      }
    }
    if (dateStr === todayStr) cls += ' today';
    if (state.selectionMode && state.selectedDates.has(dateStr)) cls += ' selected';
    if (!state.selectionMode && state.selectedViewDate === dateStr) cls += ' selected-view';

    html += `<div class="${cls}" data-date="${dateStr}">
      <span class="day-num">${d}</span>
      ${sub ? `<span class="day-hours">${sub}</span>` : ''}
    </div>`;
  }
  grid.innerHTML = html;

  if (state.selectionMode) {
    grid.querySelectorAll('.cal-day:not(.empty)').forEach(el =>
      el.addEventListener('click', () => toggleDateSelection(el.dataset.date)));
  } else if (state.isAdmin) {
    grid.querySelectorAll('.cal-day:not(.empty)').forEach(el =>
      attachCalendarSelect(el, el.dataset.date));
  }

  // ⭐ Sync day preview panel
  if (!state.selectionMode && state.selectedViewDate) {
    renderDayPreview(state.selectedViewDate);
  } else {
    hideDayPreview();
  }
}

/* ⭐ touchstart (mobile, 0ms) + click (desktop) với dedupe 400ms */
function attachCalendarSelect(el, dateStr) {
  let lastFire = 0;

  const handle = (e) => {
    const now = Date.now();
    if (now - lastFire < 400) return;
    lastFire = now;

    if (e) {
      if (e.cancelable) e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();
    }

    try { if (navigator.vibrate) navigator.vibrate(10); } catch {}

    if (state.selectedViewDate === dateStr) {
      setSelectedViewDate(null);
    } else {
      setSelectedViewDate(dateStr);
    }
  };

  el.addEventListener('touchstart', (e) => handle(e), { passive: false });
  el.addEventListener('click', (e) => handle(e));
}

export function switchTab(name) {
  $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab-content').forEach(c => c.classList.toggle('active', c.id === 'tab-' + name));

  if (name === 'salary' && state.isAdmin && state.salaryModule) {
    const y = state.salaryMonth.getFullYear();
    const m = state.salaryMonth.getMonth() + 1;
    $('#salaryMonth').value = `${y}-${String(m).padStart(2, '0')}`;
    $('#salaryRoleFilter').value = state.salaryRoleFilter;
    $('#salarySearch').value = state.salarySearch || '';
    $('#salarySort').value = state.salarySort || 'hours_desc';
    state.salaryModule.loadSalaryForMonth(false);
  }
  if (name === 'areas' && state.isAdmin) {
    import('./buildings.js').then(b => {
      const targetDate = state.areasViewDate || toDateStr(new Date());
      const $dp = $('#areasViewDate');
      if ($dp && !$dp.value) $dp.value = targetDate;
      b.loadDayAssignments(targetDate).then(() => b.renderBuildings()).catch(err => console.warn(err));
    }).catch(err => console.warn(err));
  }
  if (name === 'excel' && state.isAdmin) {
    const y = state.excelMonth.getFullYear();
    const m = state.excelMonth.getMonth() + 1;
    $('#excelMonth').value = `${y}-${String(m).padStart(2, '0')}`;
    import('./excel.js').then(e => e.loadExcelData()).catch(err => console.warn(err));
  }
}

export async function changeMonth(delta) {
  const d = new Date(state.currentMonth);
  d.setMonth(d.getMonth() + delta);
  state.currentMonth = d;

  state.selectedViewDate = null;
  const $row = $('#viewDateRow'); if ($row) $row.style.display = 'none';

  await loadAttendanceForMonth();
  renderCalendar();
}