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
  if (!state.specialAreas) {
    state.specialAreas = { external: null, night: null };
  }
}

/* ============ LOAD ============ */
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
  if (error) {
    console.error(error);
    state.attendance = [];
  } else {
    state.attendance = data || [];
    attendanceCache[key] = state.attendance;
  }
  updateSummary();
}

/* ============ SUMMARY ============ */
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
      $phoneBtn.onclick = (ev) => {
        ev.preventDefault();
        showPhoneAction(empPhone);
      };
      $phoneRow.style.display = 'block';
    } else {
      $phoneRow.style.display = 'none';
      $phoneBtn.onclick = null;
    }
  }

  const y = state.currentMonth.getFullYear();
  const mo = state.currentMonth.getMonth() + 1;
  $('#sumMonthLabel').textContent = `${pad(mo)}/${y}`;

  let work = 0, ot = 0;
  let workDays = 0;
  let leaveDays = 0;
  let todayWork = 0, todayOT = 0;

  const todayDate = new Date();
  const todayStr = toDateStr(todayDate);

  for (const a of state.attendance) {
    if (a.mode === 'leave') { leaveDays++; continue; }
    if (a.is_off) continue;

    const h = Number(a.total_hours || 0);
    const o = Number(a.ot_hours || 0);
    if (h > 0 || o > 0) workDays++;
    work += h;
    ot += o;

    if (a.date === todayStr) {
      todayWork += h;
      todayOT += o;
    }
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
    } else {
      $today.style.display = 'none';
    }
  }
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

/* ============ OPEN MODAL ============ */
export async function openAttendanceModal(dateStr, batchDates = null) {
  if (!state.isAdmin) { toast('Chỉ Giám sát được chấm công'); return; }
  if (!state.selectedEmployeeId) { toast('Chọn nhân viên trước'); return; }

  ensureSpecialState();

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

  // ⭐ Toggle sticky preview theo mode
  const $sticky = $('#attPreviewSticky');
  if ($sticky) $sticky.style.display = targetIsSupervisor ? 'none' : 'flex';

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

  const isSundayOt = template &&
    Array.isArray(template.ot_areas) &&
    template.ot_areas.some(a => a.type === 'sunday_ot');
  const sundayOtHours = isSundayOt
    ? Number(template.ot_areas.find(a => a.type === 'sunday_ot')?.hours || 0)
    : 0;

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

/* ============ AREA PICKER ============ */
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

      let hoursInput = '';
      if (isOt) {
        const floor = entry.floor_id ? state.floors.find(x => x.id === entry.floor_id) : null;
        const displayVal = entry.hours != null ? entry.hours : '';
        const placeholder = floor ? formatHours(floor.default_hours) : 'Giờ';
        hoursInput = `<input type="number" class="area-hours-input" data-hours-idx="${idx}"
          step="0.5" min="0" max="24" value="${displayVal}" placeholder="${placeholder}" title="Để trống = chia sẻ tự động" />`;
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
        rerender();
        updatePreview();
      });
    }

    if (fSel) {
      fSel.addEventListener('change', () => {
        areasState[idx].floor_id = fSel.value;
        if (isOt) {
          areasState[idx].hours = null;
          if (hInput) {
            const floor = state.floors.find(x => x.id === fSel.value);
            hInput.value = '';
            hInput.placeholder = floor ? formatHours(floor.default_hours) : 'Giờ';
          }
        }
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
}

export function renderMainAreaPicker() {
  renderAreaPickerInto('mainAreaPicker', state.modalAreas, false);
}

export function renderOtAreaPicker() {
  renderAreaPickerInto('otAreaPicker', state.modalOtAreas, true);
}

/* ============ MODE TOGGLES ============ */
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

function getSelectedMode() {
  return document.querySelector('input[name="attMode"]:checked')?.value || 'default';
}

function getSelectedSupMode() {
  return document.querySelector('input[name="supMode"]:checked')?.value || 'default';
}

function isSundayOtChecked() {
  const $c = $('#sundayOtCheck');
  return !!($c && $c.checked);
}

function getSundayOtHours() {
  const $h = $('#sundayOtHours');
  return $h ? Number($h.value || 0) : 0;
}

/* ============ HOURS CALC ============ */
function entryHours(entry) {
  if (!entry) return 0;
  if (entry.type === 'external' || entry.type === 'night') {
    return Number(entry.hours || 0);
  }
  if (entry.hours != null && !isNaN(entry.hours) && entry.hours > 0) {
    return Number(entry.hours);
  }
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
  for (const entry of state.modalAreas) {
    h += entryHours(entry);
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
  if (isSundayOtChecked()) return getSundayOtHours();

  let h = 0;
  for (const entry of state.modalOtAreas) {
    h += entryHours(entry);
  }
  return h;
}

function computeOtHours() {
  if (isSundayOtChecked()) return getSundayOtHours();
  return computeOtHoursRaw() + computeOverflow();
}

/* ============ PREVIEW ============ */
export function updatePreview() {
  if (state.isSupervisorMode) {
    const mode = getSelectedSupMode();
    const isOff = mode === 'off';
    const isLeave = mode === 'leave';
    const mainH = (isOff || isLeave) ? 0 : SUPERVISOR_HOURS;
    const otH = mode === 'ot' ? Number($('#supOtHours').value || 0) : 0;
    const $mp = $('#supMainPreview'); if ($mp) $mp.textContent = isLeave ? 'PHÉP' : (isOff ? 'OFF' : formatHours(SUPERVISOR_HOURS));
    const $op = $('#supOtPreview'); if ($op) $op.textContent = formatHours(otH);
    const $tp = $('#supTotalPreview'); if ($tp) $tp.textContent = isLeave ? 'PHÉP' : formatHours(mainH + otH);
    return;
  }

  const mode = getSelectedMode();
  const isInactive = mode === 'off' || mode === 'leave';
  const mainH = computeMainHours();
  const otH = isInactive ? 0 : computeOtHours();
  const $m = $('#mainHoursPreview'); if ($m) $m.textContent = mode === 'leave' ? 'PHÉP' : (mode === 'off' ? 'OFF' : formatHours(mainH));
  const $o = $('#otHoursPreview'); if ($o) $o.textContent = formatHours(otH);
  const $t = $('#totalHoursPreview'); if ($t) $t.textContent = mode === 'leave' ? 'PHÉP' : formatHours(mainH + otH);
  const $n = $('#shareNote'); if ($n) {
    const hasBuildingAuto = state.modalAreas.some(a => a.type === 'building' && a.floor_id && (a.hours == null || a.hours === 0));
    $n.style.display = (mode === 'default' && mainH > 0 && hasBuildingAuto) ? 'block' : 'none';
  }
}

/* ============ PAYLOAD ============ */
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

function serializeArea(entry) {
  if (entry.type === 'building') {
    return {
      type: 'building',
      building_id: entry.building_id,
      floor_id: entry.floor_id,
      hours: entry.hours != null ? Number(entry.hours) : null,
    };
  }
  return {
    type: entry.type,
    hours: Number(entry.hours || 0),
  };
}

function buildEmployeePayload() {
  const mode = getSelectedMode();

  if (mode === 'leave') {
    return {
      employee_id: state.selectedEmployeeId,
      total_hours: 0, ot_hours: 0, is_off: false,
      mode: 'leave', manual_hours: null, areas: [], ot_areas: [],
    };
  }

  if (mode === 'off') {
    return {
      employee_id: state.selectedEmployeeId,
      total_hours: 0, ot_hours: 0, is_off: true,
      mode: 'off', manual_hours: null, areas: [], ot_areas: [],
    };
  }

  if (mode === 'manual') {
    const mh = Number($('#manualHours').value || 0);
    if (mh <= 0) {
      toast('Nhập số giờ công (> 0)');
      return null;
    }
    const otH = computeOtHours();
    return {
      employee_id: state.selectedEmployeeId,
      total_hours: Math.min(mh, DAILY_MAIN_CAP),
      ot_hours: otH,
      is_off: false,
      mode: 'manual',
      manual_hours: mh,
      areas: [],
      ot_areas: isSundayOtChecked()
        ? [{ type: 'sunday_ot', hours: getSundayOtHours() }]
        : state.modalOtAreas
          .filter(a => entryHours(a) > 0)
          .map(a => serializeArea(a)),
    };
  }

  // default
  const validAreas = state.modalAreas.filter(a => {
    if (a.type === 'building') return a.building_id && a.floor_id;
    return entryHours(a) > 0;
  });

  if (!validAreas.length) {
    toast('Chọn ít nhất 1 khu vực hoặc nhập giờ');
    return null;
  }

  const hasNonBuilding = validAreas.some(a => a.type !== 'building');
  const hasBuildingWithManualHours = validAreas.some(a =>
    a.type === 'building' && a.hours != null && a.hours > 0
  );

  let totalMain = 0;
  for (const entry of validAreas) totalMain += entryHours(entry);

  let finalMode;
  let manualHours = null;
  if (!hasNonBuilding && !hasBuildingWithManualHours) {
    finalMode = 'default';
    manualHours = null;
  } else {
    finalMode = 'manual';
    manualHours = totalMain;
  }

  const mainCapped = Math.min(totalMain, DAILY_MAIN_CAP);

  let otAreas = [];
  if (isSundayOtChecked()) {
    const sh = getSundayOtHours();
    if (sh > 0) otAreas = [{ type: 'sunday_ot', hours: sh }];
  } else {
    otAreas = state.modalOtAreas
      .filter(a => entryHours(a) > 0)
      .map(a => serializeArea(a));
  }

  const totalOt = isSundayOtChecked()
    ? getSundayOtHours()
    : otAreas.reduce((s, a) => s + Number(a.hours || 0), 0) + Math.max(0, totalMain - DAILY_MAIN_CAP);

  return {
    employee_id: state.selectedEmployeeId,
    total_hours: mainCapped,
    ot_hours: totalOt,
    is_off: false,
    mode: finalMode,
    manual_hours: manualHours,
    areas: validAreas.map(a => serializeArea(a)),
    ot_areas: otAreas,
  };
}

/* ============ SAVE ============ */
export async function saveAttendance() {
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

  invalidateAttendanceCache(state.selectedEmployeeId);
  if (state.salaryModule) state.salaryModule.invalidateCache();

  await loadAttendanceForMonth(true);
  renderCalendar();

  import('./buildings.js')
    .then(buildings => {
      buildings.loadTodayAssignments()
        .then(() => buildings.renderBuildings())
        .catch(err => console.warn('[saveAttendance] refresh areas failed:', err));
    })
    .catch(err => console.warn('[saveAttendance] import buildings failed:', err));
}

/* ============ SELECTION MODE ============ */
export function toggleSelectionMode() {
  if (state.selectionMode) {
    exitSelectionMode();
  } else {
    state.selectionMode = true;
    state.selectedDates.clear();
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
  if (state.selectedDates.has(dateStr)) {
    state.selectedDates.delete(dateStr);
  } else {
    state.selectedDates.add(dateStr);
  }
  updateSelectionCount();
  renderCalendar();
}

export function updateSelectionCount() {
  const n = state.selectedDates.size;
  const c = $('#selectionCount'); if (c) c.textContent = `${n} ngày đã chọn`;
  const a = $('#applySelectionBtn'); if (a) a.disabled = n === 0;
}

/* ============ CALENDAR ============ */
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

/* ============ SWITCH TAB ============ */
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
    import('./buildings.js')
      .then(b => {
        b.loadTodayAssignments()
          .then(() => b.renderBuildings())
          .catch(err => console.warn('[switchTab areas] failed:', err));
      })
      .catch(err => console.warn('[switchTab areas] import failed:', err));
  }

  if (name === 'excel' && state.isAdmin) {
    const y = state.excelMonth.getFullYear();
    const m = state.excelMonth.getMonth() + 1;
    $('#excelMonth').value = `${y}-${String(m).padStart(2, '0')}`;
    import('./excel.js')
      .then(e => e.loadExcelData())
      .catch(err => console.warn('[switchTab excel] failed:', err));
  }
}

/* ============ CHANGE MONTH ============ */
export async function changeMonth(delta) {
  const d = new Date(state.currentMonth);
  d.setMonth(d.getMonth() + delta);
  state.currentMonth = d;
  await loadAttendanceForMonth();
  renderCalendar();
}