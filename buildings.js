// buildings.js — Toà nhà, tầng, special areas, gán nhân viên vào tầng
import { supabase } from './supabase.js';
import {
  state, $, $$, toast,
  formatHours, formatDateVN, floorLabel, toDateStr,
  openModal, closeModal,
} from './core.js';
import { showPhoneAction } from './phone.js';

function ensureState() {
  if (!state.specialAreas) state.specialAreas = { external: null, night: null };
  if (!Array.isArray(state.externalAssignments)) state.externalAssignments = [];
  if (!Array.isArray(state.nightAssignments)) state.nightAssignments = [];
  if (!Array.isArray(state.sundayOtAssignments)) state.sundayOtAssignments = [];
  if (!(state.expandedBuildings instanceof Set)) state.expandedBuildings = new Set();
  if (!state._assignCtx) state._assignCtx = null;
  if (!state._bulkAssignments) state._bulkAssignments = new Set();
  if (state.areasBulkEmpId === undefined) state.areasBulkEmpId = null;
}

export async function loadBuildings() {
  ensureState();

  const { data: buildings, error: e1 } = await supabase.from('buildings').select('*').order('name');
  if (e1) { console.error(e1); return; }
  state.buildings = buildings || [];

  if (state.buildings.length) {
    const ids = state.buildings.map(b => b.id);
    const { data: floors } = await supabase
      .from('floors').select('*').in('building_id', ids).order('floor_number');
    state.floors = floors || [];
  } else state.floors = [];

  if (state.buildings.length > 0 && state.expandedBuildings.size === 0) {
    state.expandedBuildings.add(state.buildings[0].id);
  }

  const { data: special, error: e2 } = await supabase.from('special_areas').select('*');
  if (!e2 && special) {
    state.specialAreas = { external: null, night: null };
    for (const row of special) {
      if (row.type === 'external' || row.type === 'night') {
        state.specialAreas[row.type] = row;
      }
    }
  }

  renderBuildings();
}

/* ⭐ FIX #2: Tính đúng giờ external/night theo pool + default_hours */
export async function loadDayAssignments(dateStr = null) {
  ensureState();

  const targetDate = dateStr || state.areasViewDate || toDateStr(new Date());

  const { data, error } = await supabase
    .from('attendance')
    .select('employee_id, areas, ot_areas, is_off, mode, total_hours, ot_hours')
    .eq('date', targetDate)
    .neq('is_off', true);

  if (error) {
    console.error(error);
    state.floorAssignments = {};
    state.externalAssignments = [];
    state.nightAssignments = [];
    state.sundayOtAssignments = [];
    return;
  }

  const mainUsersByFloor = {};
  const otAutoUsersByFloor = {};

  const externalDefault = Number(state.specialAreas?.external?.default_hours || 0);
  const nightDefault = Number(state.specialAreas?.night?.default_hours || 0);

  /* ⭐ FIX: Tính pool external/night theo default_hours + count */
  const specialPools = {
    external: { users: new Set(), maxHours: 0, defaultH: externalDefault },
    night: { users: new Set(), maxHours: 0, defaultH: nightDefault },
  };

  // Pass 1: đếm users + max hours cho external/night + đếm floor
  for (const a of data) {
    if (Array.isArray(a.areas)) {
      for (const area of a.areas) {
        const t = area.type || 'building';
        if (t === 'external' || t === 'night') {
          const info = specialPools[t];
          if (!info.users.has(a.employee_id)) {
            info.users.add(a.employee_id);
            const h = (area.hours != null && !isNaN(Number(area.hours)) && Number(area.hours) > 0)
              ? Number(area.hours)
              : info.defaultH;
            if (h > info.maxHours) info.maxHours = h;
          }
        } else if (area.building_id && area.floor_id) {
          const fid = String(area.floor_id);
          if (!mainUsersByFloor[fid]) mainUsersByFloor[fid] = new Set();
          mainUsersByFloor[fid].add(a.employee_id);
        }
      }
    }
    if (Array.isArray(a.ot_areas)) {
      for (const area of a.ot_areas) {
        const t = area.type || 'building';
        if (t === 'external' || t === 'night') {
          const info = specialPools[t];
          if (!info.users.has(a.employee_id)) {
            info.users.add(a.employee_id);
            const h = (area.hours != null && !isNaN(Number(area.hours)) && Number(area.hours) > 0)
              ? Number(area.hours)
              : info.defaultH;
            if (h > info.maxHours) info.maxHours = h;
          }
        } else if (t === 'building' && area.building_id && area.floor_id) {
          const fid = String(area.floor_id);
          const h = area.hours;
          if (h != null && h !== '' && !isNaN(Number(h))) continue;
          if (!otAutoUsersByFloor[fid]) otAutoUsersByFloor[fid] = new Set();
          otAutoUsersByFloor[fid].add(a.employee_id);
        }
      }
    }
  }

  // Pass 2: build external/night/sunday_ot arrays
  const externalByEmp = {};
  const nightByEmp = {};
  const sundayOtByEmp = {};
  const empSpecialDone = {};

  for (const a of data) {
    const empId = a.employee_id;
    const empAreas = [...(a.areas || []), ...(a.ot_areas || [])];

    for (const area of empAreas) {
      const t = area.type || 'building';

      if (t === 'sunday_ot') {
        if (!sundayOtByEmp[empId]) sundayOtByEmp[empId] = { employee_id: empId, hours: 0 };
        sundayOtByEmp[empId].hours += Number(area.hours || 0);
        continue;
      }

      if (t === 'external' || t === 'night') {
        if (empSpecialDone[empId]?.[t]) continue;
        if (!empSpecialDone[empId]) empSpecialDone[empId] = {};
        empSpecialDone[empId][t] = true;

        const info = specialPools[t];
        const count = info.users.size;
        const perPerson = count > 0 ? info.maxHours / count : info.defaultH;
        const map = t === 'external' ? externalByEmp : nightByEmp;
        map[empId] = { employee_id: empId, hours: perPerson, shared: count };
      }
    }
  }

  // Pass 3: build floor assignments (main + OT)
  const map = {};

  for (const a of data) {
    const perFloor = {};
    let mainRawTotal = 0, otRawTotal = 0;

    if (Array.isArray(a.areas)) {
      for (const area of a.areas) {
        const t = area.type || 'building';
        if (t === 'external' || t === 'night') continue;
        if (!area.building_id || !area.floor_id) continue;
        const fid = String(area.floor_id);
        if (!perFloor[fid]) perFloor[fid] = { main: 0, ot: 0 };

        const floor = state.floors.find(x => String(x.id) === fid);
        const floorDefault = floor ? Number(floor.default_hours || 0) : 0;
        const cnt = mainUsersByFloor[fid]?.size || 1;
        const raw = floorDefault / cnt;

        perFloor[fid].main += raw;
        mainRawTotal += raw;
      }
    }

    if (Array.isArray(a.ot_areas)) {
      for (const area of a.ot_areas) {
        const t = area.type || 'building';
        if (t === 'external' || t === 'night' || t === 'sunday_ot') continue;
        if (!area.building_id || !area.floor_id) continue;
        const fid = String(area.floor_id);
        if (!perFloor[fid]) perFloor[fid] = { main: 0, ot: 0 };

        const h = area.hours;
        const isManual = h != null && h !== '' && !isNaN(Number(h));
        let raw;
        if (isManual) raw = Number(h);
        else {
          const floor = state.floors.find(x => String(x.id) === fid);
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
      for (const fid in perFloor) perFloor[fid].main = perFloor[fid].main * (mainFromDB / mainRawTotal);
    }
    if (otRawTotal > 0) {
      for (const fid in perFloor) perFloor[fid].ot = perFloor[fid].ot * (otFromDB / otRawTotal);
    }

    for (const [fid, h] of Object.entries(perFloor)) {
      if (!map[fid]) map[fid] = [];
      const existing = map[fid].find(x => x.employee_id === a.employee_id);
      if (existing) {
        existing.main_hours += h.main;
        existing.ot_hours += h.ot;
      } else {
        map[fid].push({ employee_id: a.employee_id, main_hours: h.main, ot_hours: h.ot });
      }
    }
  }

  state.floorAssignments = map;
  state.externalAssignments = Object.values(externalByEmp);
  state.nightAssignments = Object.values(nightByEmp);
  state.sundayOtAssignments = Object.values(sundayOtByEmp);

  const hint = $('#areasHint');
  if (hint) {
    const isToday = targetDate === toDateStr(new Date());
    hint.textContent = isToday
      ? `📅 Đang hiển thị nhân viên được phân công hôm nay (${formatDateVN(targetDate)})`
      : `📅 Đang xem lại ngày ${formatDateVN(targetDate)}`;
  }
}

export async function loadTodayAssignments() {
  return loadDayAssignments(toDateStr(new Date()));
}

/* ⭐ Populate dropdown bulk assign */
function populateBulkEmpSelect() {
  const $sel = document.getElementById('areasBulkEmpSelect');
  if (!$sel) return;

  const emps = (state.employees || [])
    .filter(e => e.status !== 'inactive')
    .sort((a, b) => {
      const an = (a.full_name || a.username || '').toLowerCase();
      const bn = (b.full_name || b.username || '').toLowerCase();
      return an.localeCompare(bn, 'vi');
    });

  const wantCount = emps.length + 1;
  if ($sel.querySelectorAll('option').length !== wantCount) {
    $sel.innerHTML = '<option value="">👤 Chọn nhân viên (gán nhanh nhiều tầng)</option>' +
      emps.map(e => `<option value="${e.id}">${e.full_name || e.username || ''}</option>`).join('');
  }
  $sel.value = state.areasBulkEmpId || '';
}

export function renderBuildings() {
  ensureState();

  const wrap = $('#buildingsList');
  const $sum = $('#areasSummary');
  if (!wrap) return;

  updateCreateButtons();
  populateBulkEmpSelect();

  // ⭐ Show/hide bulk actions row
  const $bulkActions = document.getElementById('areasBulkActions');
  if ($bulkActions) $bulkActions.style.display = state.areasBulkEmpId ? 'flex' : 'none';

  const $datePicker = $('#areasViewDate');
  if ($datePicker && !$datePicker.value) {
    $datePicker.value = state.areasViewDate || toDateStr(new Date());
  }

  const hasAny =
    state.buildings.length ||
    state.externalAssignments.length ||
    state.nightAssignments.length ||
    state.sundayOtAssignments.length ||
    state.specialAreas.external ||
    state.specialAreas.night;

  if (!hasAny) {
    wrap.innerHTML = '<p class="hint">Chưa có khu vực nào. Bấm nút "+ Thêm" phía trên để tạo.</p>';
    if ($sum) $sum.style.display = 'none';
    return;
  }

  const search = (state.areasSearch || '').toLowerCase().trim();
  const roleFilter = state.areasRoleFilter || 'all';
  const bulkMode = !!state.areasBulkEmpId;

  const filteredEmpIds = new Set();
  state.employees.filter(e => {
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
  for (const arr of [state.externalAssignments, state.nightAssignments, state.sundayOtAssignments]) {
    for (const item of arr) {
      if (nvEmpIds.has(item.employee_id)) workingNVIds.add(item.employee_id);
    }
  }
  const totalNV = nvEmployees.length;
  const workingNVCount = workingNVIds.size;

  const floorsWithPeople = new Set();
  for (const b of state.buildings) {
    const floors = state.floors.filter(f => b.id === f.building_id);
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
        <span class="areas-summary-label">👥 Nhân viên đi làm</span>
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
      ${isFiltered ? `<div style="font-size:11px;color:var(--text-muted);margin-top:6px;text-align:center;padding-top:6px;border-top:1px dashed var(--border)">🔍 Đang lọc</div>` : ''}
    `;
  }

  const externalHtml = renderSpecialCard({
    type: 'external',
    record: state.specialAreas.external,
    items: state.externalAssignments,
    emoji: '🌳',
    title: 'Ngoại cảnh',
    colorStart: '#f0fdf4',
    colorEnd: '#dcfce7',
    borderColor: '#a7f3d0',
    accentColor: '#15803d',
    avatarGrad: '#16a34a, #15803d',
    filteredEmpIds,
    bulkMode,
  });

  const nightHtml = renderSpecialCard({
    type: 'night',
    record: state.specialAreas.night,
    items: state.nightAssignments,
    emoji: '🌙',
    title: 'Ca đêm',
    colorStart: '#eef2ff',
    colorEnd: '#e0e7ff',
    borderColor: '#c7d2fe',
    accentColor: '#4338ca',
    avatarGrad: '#6366f1, #4338ca',
    filteredEmpIds,
    bulkMode,
  });

  const sundayOtHtml = state.sundayOtAssignments.length > 0
    ? renderSimpleCard({
        emoji: '📅',
        title: 'Tăng ca CN',
        items: state.sundayOtAssignments,
        colorStart: '#fff7ed',
        colorEnd: '#fed7aa',
        borderColor: '#fdba74',
        accentColor: '#c2410c',
        avatarGrad: '#ea580c, #c2410c',
        filteredEmpIds,
      })
    : '';

  const expanded = state.expandedBuildings;
  const buildingsHtml = state.buildings.map(b => {
    const floors = state.floors.filter(f => b.id === f.building_id)
      .sort((a, c) => a.floor_number - c.floor_number);

    const isExpanded = expanded.has(b.id);

    let peopleCount = 0;
    for (const f of floors) {
      const assigns = state.floorAssignments[f.id] || [];
      const visible = assigns.filter(a => filteredEmpIds.has(a.employee_id));
      peopleCount += visible.length;
    }

    const floorRows = isExpanded ? floors.map(f => {
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

      // ⭐ FIX #3: Checkbox khi ở bulk mode, button khi bình thường
      let assignControl = '';
      if (bulkMode) {
        const key = String(f.id);
        const isChecked = state._bulkAssignments?.has(key) || false;
        assignControl = `<input type="checkbox" class="bulk-assign-check" data-key="${key}" ${isChecked ? 'checked' : ''} style="width:22px;height:22px;cursor:pointer;accent-color:#0ea5b7;margin:0;flex-shrink:0;" />`;
      } else if (state.isAdmin) {
        assignControl = `<button type="button" class="btn-assign-floor" data-assign-b="${b.id}" data-assign-f="${f.id}" style="padding:4px 10px;font-size:11px;background:#eff6ff;color:#1d4ed8;border:1px solid #93c5fd;border-radius:6px;cursor:pointer;font-family:inherit;font-weight:600;white-space:nowrap;">+ Gán</button>`;
      }

      return `
        <div class="floor-row${visible.length > 0 ? ' has-assignees' : ''}">
          <div class="floor-row-head">
            <span class="floor-name">${floorLabel(f.floor_number)} ${peopleBadge}</span>
            <span style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end;">
              <span class="floor-hours">${formatHours(f.default_hours)}</span>
              ${assignControl}
            </span>
          </div>
          ${assigneesHtml}
        </div>`;
    }).join('') : '';

    return `
      <div class="building-card" data-id="${b.id}">
        <div class="building-header" data-toggle-building="${b.id}">
          <div class="building-header-left">
            <span class="building-chevron">${isExpanded ? '▼' : '▶'}</span>
            <span class="building-name">${b.name}</span>
          </div>
          <div class="building-header-right">
            ${peopleCount > 0 ? `<span class="building-people">${peopleCount} người</span>` : ''}
            <span class="building-count">${floors.length} tầng</span>
          </div>
        </div>
        ${isExpanded ? `<div class="building-body">
          <div class="building-floors">
            ${floorRows || '<p class="hint" style="margin:0">Chưa setup tầng</p>'}
          </div>
          <div class="building-actions">
            <button class="btn-small" data-setup="${b.id}">⚙️ Setup giờ tầng</button>
            <button class="btn-small" data-delete="${b.id}" style="background:#fee2e2;color:#e74c3c">🗑 Xoá</button>
          </div>
        </div>` : ''}
      </div>`;
  }).join('');

  wrap.innerHTML = externalHtml + nightHtml + sundayOtHtml + buildingsHtml;

  wrap.querySelectorAll('[data-toggle-building]').forEach(el => {
    el.addEventListener('click', () => {
      const bid = el.dataset.toggleBuilding;
      if (!(state.expandedBuildings instanceof Set)) state.expandedBuildings = new Set();
      if (state.expandedBuildings.has(bid)) state.expandedBuildings.delete(bid);
      else state.expandedBuildings.add(bid);
      renderBuildings();
    });
  });

  wrap.querySelectorAll('[data-setup]').forEach(btn =>
    btn.addEventListener('click', () => openFloorSetup(btn.dataset.setup)));
  wrap.querySelectorAll('[data-delete]').forEach(btn =>
    btn.addEventListener('click', () => deleteBuilding(btn.dataset.delete)));
  wrap.querySelectorAll('[data-special-edit]').forEach(btn =>
    btn.addEventListener('click', () => openSpecialAreaModal(btn.dataset.specialEdit)));
  wrap.querySelectorAll('[data-special-delete]').forEach(btn =>
    btn.addEventListener('click', () => deleteSpecialArea(btn.dataset.specialDelete)));

  wrap.querySelectorAll('[data-phone]').forEach(el => {
    el.addEventListener('click', (ev) => { ev.stopPropagation(); ev.preventDefault(); showPhoneAction(el.dataset.phone); });
  });

  wrap.querySelectorAll('[data-jump-emp]').forEach(el => {
    el.addEventListener('click', (ev) => { ev.stopPropagation(); ev.preventDefault(); jumpToEmployeeCalendar(el.dataset.jumpEmp); });
  });

  wrap.querySelectorAll('.btn-assign-floor').forEach(btn => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      openAssignModal(btn.dataset.assignB, btn.dataset.assignF);
    });
  });

  // ⭐ FIX #3: Bind checkboxes cho bulk mode
  wrap.querySelectorAll('.bulk-assign-check').forEach(cb => {
    cb.addEventListener('change', () => {
      if (!(state._bulkAssignments instanceof Set)) state._bulkAssignments = new Set();
      const key = cb.dataset.key;
      if (cb.checked) state._bulkAssignments.add(key);
      else state._bulkAssignments.delete(key);
    });
  });

  // ⭐ Bind checkbox cho external/night (nếu ở bulk mode)
  wrap.querySelectorAll('.bulk-assign-special').forEach(cb => {
    cb.addEventListener('change', () => {
      if (!(state._bulkAssignments instanceof Set)) state._bulkAssignments = new Set();
      const key = cb.dataset.key;
      if (cb.checked) state._bulkAssignments.add(key);
      else state._bulkAssignments.delete(key);
    });
  });
}

function updateCreateButtons() {
  const $ext = $('#createExternalBtn');
  const $night = $('#createNightBtn');
  if ($ext) {
    $ext.textContent = state.specialAreas.external ? '⚙️ Sửa ngoại cảnh' : '+ Thêm ngoại cảnh';
  }
  if ($night) {
    $night.textContent = state.specialAreas.night ? '⚙️ Sửa ca đêm' : '+ Thêm ca đêm';
  }
}

function renderSpecialCard(opts) {
  const {
    type, record, items, emoji, title,
    colorStart, colorEnd, borderColor, accentColor, avatarGrad, filteredEmpIds,
    bulkMode,
  } = opts;

  if (!record) return '';

  const visible = items.filter(x => filteredEmpIds.has(x.employee_id));
  const headerRight = visible.length > 0
    ? `<span class="building-people" style="background:${colorEnd};color:${accentColor}">${visible.length} người</span>`
    : `<span class="building-people" style="background:${colorEnd};color:${accentColor}">Chưa có ai</span>`;

  const rowsHtml = visible.length > 0
    ? visible.map(item => {
        const emp = state.employees.find(e => e.id === item.employee_id);
        if (!emp) return '';
        const name = emp.full_name || emp.username || '';
        const sharedNote = (item.shared && item.shared > 1) ? ` <span style="font-size:11px;opacity:0.75;font-weight:500">(chia ${item.shared} người)</span>` : '';
        return `
          <div class="floor-assignee" style="padding:6px 0">
            <div class="assignee-avatar" style="background:linear-gradient(135deg, ${avatarGrad})">${name.charAt(0).toUpperCase()}</div>
            <div class="assignee-info">
              <span class="assignee-name" data-jump-emp="${emp.id}" title="Xem lịch công">${name}</span>
              ${emp.phone ? `<span class="assignee-phone"><a class="phone-link" data-phone="${emp.phone}" href="javascript:void(0)">${emp.phone}</a></span>` : ''}
            </div>
            <span style="margin-left:auto;font-weight:700;color:${accentColor};font-size:13px;text-align:right">${formatHours(item.hours)}${sharedNote}</span>
          </div>`;
      }).join('')
    : `<p class="hint" style="margin:0;font-size:12px;background:transparent;border:none;color:${accentColor}">
         Chưa có nhân viên nào làm ${title.toLowerCase()}.
       </p>`;

  // ⭐ Checkbox bulk mode cho external/night
  let bulkCheckbox = '';
  if (bulkMode) {
    const key = `__${type}__`;
    const isChecked = state._bulkAssignments?.has(key) || false;
    bulkCheckbox = `<input type="checkbox" class="bulk-assign-special" data-key="${key}" ${isChecked ? 'checked' : ''} style="width:22px;height:22px;cursor:pointer;accent-color:${accentColor};margin:0;flex-shrink:0;" />`;
  }

  return `
    <div class="building-card" style="border-color:${borderColor};background:linear-gradient(135deg, ${colorStart}, ${colorEnd})">
      <div class="building-header" style="background:transparent">
        <div class="building-header-left">
          <span class="building-name" style="color:${accentColor}">${emoji} ${title}</span>
        </div>
        <div class="building-header-right" style="display:flex;gap:10px;align-items:center;">
          ${headerRight}
          ${bulkCheckbox}
        </div>
      </div>
      <div style="padding:0 16px 8px;color:${accentColor};font-size:12px;font-weight:600">
        📌 Giờ mặc định: ${formatHours(record.default_hours)}
        ${record.name && record.name !== title ? ` · ${record.name}` : ''}
      </div>
      <div class="building-body">
        <div class="building-floors" style="margin-top:4px">
          ${rowsHtml}
        </div>
        <div class="building-actions" style="margin-top:10px">
          <button class="btn-small" data-special-edit="${type}" style="background:${colorEnd};color:${accentColor}">⚙️ Sửa</button>
          <button class="btn-small" data-special-delete="${type}" style="background:#fee2e2;color:#e74c3c">🗑 Xoá</button>
        </div>
      </div>
    </div>
  `;
}

function renderSimpleCard(opts) {
  const { emoji, title, items, colorStart, colorEnd, borderColor, accentColor, avatarGrad, filteredEmpIds } = opts;
  const visible = items.filter(x => filteredEmpIds.has(x.employee_id));
  if (!visible.length) return '';

  return `
    <div class="building-card" style="border-color:${borderColor};background:linear-gradient(135deg, ${colorStart}, ${colorEnd})">
      <div class="building-header" style="background:transparent">
        <div class="building-header-left">
          <span class="building-name" style="color:${accentColor}">${emoji} ${title}</span>
        </div>
        <div class="building-header-right">
          <span class="building-people" style="background:${colorEnd};color:${accentColor}">${visible.length} người</span>
        </div>
      </div>
      <div class="building-body">
        <div class="building-floors">
          ${visible.map(item => {
            const emp = state.employees.find(e => e.id === item.employee_id);
            if (!emp) return '';
            const name = emp.full_name || emp.username || '';
            return `
              <div class="floor-assignee" style="padding:6px 0">
                <div class="assignee-avatar" style="background:linear-gradient(135deg, ${avatarGrad})">${name.charAt(0).toUpperCase()}</div>
                <div class="assignee-info">
                  <span class="assignee-name" data-jump-emp="${emp.id}" title="Xem lịch công">${name}</span>
                  ${emp.phone ? `<span class="assignee-phone"><a class="phone-link" data-phone="${emp.phone}" href="javascript:void(0)">${emp.phone}</a></span>` : ''}
                </div>
                <span style="margin-left:auto;font-weight:700;color