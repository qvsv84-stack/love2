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
                <span style="margin-left:auto;font-weight:700;color:${accentColor};font-size:13px">${formatHours(item.hours)}</span>
              </div>`;
          }).join('')}
        </div>
      </div>
    </div>
  `;
}

/* ═══════════════════════════════════════════════════════════════
   GÁN NHÂN VIÊN VÀO TẦNG (single floor, multi NV)
   ═══════════════════════════════════════════════════════════════ */
export async function openAssignModal(buildingId, floorId) {
  if (!state.isAdmin) { toast('Chỉ admin được gán'); return; }

  if (!state.employees || state.employees.length === 0) {
    try {
      const empMod = await import('./employees.js');
      if (empMod.loadEmployees) await empMod.loadEmployees();
      else if (empMod.loadPublicEmployees) await empMod.loadPublicEmployees();
    } catch (err) { console.warn('[assign] load employees fail:', err); }
  }

  const dateStr = state.areasViewDate || toDateStr(new Date());
  const building = state.buildings.find(b => String(b.id) === String(buildingId));
  const floor = state.floors.find(f => String(f.id) === String(floorId));
  if (!building || !floor) { toast('Không tìm thấy tầng'); return; }

  ensureAssignModal();
  state._assignCtx = { buildingId, floorId, dateStr };

  const { data: allAtt, error } = await supabase
    .from('attendance')
    .select('employee_id, areas, ot_areas, is_off, mode')
    .eq('date', dateStr);
  if (error) { toast('Lỗi tải: ' + error.message); return; }

  const assignedSet = new Set();
  for (const a of (allAtt || [])) {
    if (a.is_off) continue;
    if (a.mode === 'leave' || a.mode === 'off') continue;
    if (!Array.isArray(a.areas)) continue;
    for (const area of a.areas) {
      const t = area.type || 'building';
      if (t !== 'building') continue;
      if (String(area.building_id) === String(buildingId) && String(area.floor_id) === String(floorId)) {
        assignedSet.add(a.employee_id);
      }
    }
  }

  const $title = document.getElementById('assignEmpTitle');
  if ($title) $title.textContent = `Gán NV vào ${floorLabel(floor.floor_number)} — ${building.name}`;
  const $sub = document.getElementById('assignEmpSubtitle');
  if ($sub) $sub.textContent = `Ngày: ${formatDateVN(dateStr)} · Giờ mặc định tầng: ${formatHours(floor.default_hours)}`;

  renderAssignList(assignedSet);

  const $search = document.getElementById('assignEmpSearch');
  if ($search) {
    $search.value = '';
    $search.oninput = () => renderAssignList(assignedSet, $search.value);
  }

  const $saveBtn = document.getElementById('assignEmpSaveBtn');
  if ($saveBtn) {
    $saveBtn.disabled = false;
    $saveBtn.textContent = 'Lưu';
    $saveBtn.onclick = saveAssignments;
  }

  const $modal = document.getElementById('assignEmployeeModal');
  if ($modal) {
    $modal.style.display = 'flex';
    $modal.style.alignItems = 'center';
    $modal.style.justifyContent = 'center';
  }
}

function ensureAssignModal() {
  const $modal = document.getElementById('assignEmployeeModal');
  const required = ['assignEmpTitle','assignEmpSubtitle','assignEmpSearch','assignEmpList','assignEmpSaveBtn','assignEmpCloseBtn','assignEmpCancelBtn'];
  if ($modal) {
    const missing = required.filter(id => !document.getElementById(id));
    if (missing.length === 0) return;
    $modal.remove();
  }

  const html = `
    <div id="assignEmployeeModal" class="modal-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:10001;padding:20px;box-sizing:border-box;">
      <div style="background:#fff;border-radius:14px;max-width:460px;width:100%;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid #e5e7eb;flex-shrink:0;">
          <h3 id="assignEmpTitle" style="margin:0;font-size:16px;font-weight:700;color:#111827;">Gán nhân viên</h3>
          <button type="button" id="assignEmpCloseBtn" style="background:none;border:none;font-size:22px;cursor:pointer;color:#6b7280;padding:0;width:32px;height:32px;line-height:1;border-radius:6px;">✕</button>
        </div>
        <div style="padding:14px 18px;overflow-y:auto;flex:1;">
          <p id="assignEmpSubtitle" style="font-size:13px;color:#6b7280;margin:0 0 12px 0;line-height:1.5;"></p>
          <input type="text" id="assignEmpSearch" placeholder="🔍 Tìm tên hoặc số điện thoại..." autocomplete="off" style="width:100%;box-sizing:border-box;margin-bottom:10px;padding:10px 12px;border:1px solid #e5e7eb;border-radius:8px;font-family:inherit;font-size:14px;outline:none;" />
          <div id="assignEmpList" style="max-height:380px;overflow-y:auto;background:#fff;border:1px solid #e5e7eb;border-radius:10px;"></div>
          <p style="font-size:11.5px;color:#6b7280;margin:10px 0 0 0;line-height:1.5;">
            💡 Tick = gán vào tầng này. Bỏ tick = xoá khỏi tầng.
          </p>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:10px;padding:14px 18px;border-top:1px solid #e5e7eb;flex-shrink:0;">
          <button type="button" id="assignEmpCancelBtn" style="padding:10px 18px;font-family:inherit;font-size:14px;border:1px solid #e5e7eb;background:#fff;border-radius:8px;cursor:pointer;font-weight:600;color:#374151;">Huỷ</button>
          <button type="button" id="assignEmpSaveBtn" style="padding:10px 18px;font-family:inherit;font-size:14px;background:#0ea5b7;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600;">Lưu</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);

  const closeModalDirect = () => {
    const $m = document.getElementById('assignEmployeeModal');
    if ($m) $m.style.display = 'none';
  };
  document.getElementById('assignEmpCloseBtn').onclick = closeModalDirect;
  document.getElementById('assignEmpCancelBtn').onclick = closeModalDirect;
  document.getElementById('assignEmployeeModal').addEventListener('click', (e) => {
    if (e.target.id === 'assignEmployeeModal') closeModalDirect();
  });
}

function renderAssignList(assignedSet, searchTerm = '') {
  const $list = document.getElementById('assignEmpList');
  if (!$list) return;

  const term = (searchTerm || '').toLowerCase().trim();
  const employees = (state.employees || [])
    .filter(e => e.status !== 'inactive')
    .filter(e => {
      if (!term) return true;
      const name = (e.full_name || '').toLowerCase();
      const username = (e.username || '').toLowerCase();
      const phone = (e.phone || '').toLowerCase();
      return name.includes(term) || username.includes(term) || phone.includes(term);
    })
    .sort((a, b) => {
      const an = (a.full_name || a.username || '').toLowerCase();
      const bn = (b.full_name || b.username || '').toLowerCase();
      return an.localeCompare(bn, 'vi');
    });

  if (!employees.length) {
    $list.innerHTML = '<p style="padding:16px;text-align:center;margin:0;color:#6b7280;font-size:13px;">Không có nhân viên phù hợp</p>';
    return;
  }

  const roleMap = { admin: 'Giám sát', employee: 'Nhân viên', temporary: 'Thời vụ', external: 'Ngoại cảnh' };

  $list.innerHTML = employees.map(e => {
    const name = e.full_name || e.username || '—';
    const role = roleMap[e.role] || e.role || '';
    const phone = e.phone || '';
    const checked = assignedSet.has(e.id);
    return `
      <label style="display:flex;padding:10px 12px;border-bottom:1px solid #f3f4f6;gap:10px;cursor:pointer;align-items:center;">
        <input type="checkbox" data-emp-id="${e.id}" ${checked ? 'checked' : ''} style="width:20px;height:20px;flex-shrink:0;accent-color:#0ea5b7;cursor:pointer;" />
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#111827;">${name}</div>
          <div style="font-size:11.5px;color:#6b7280;margin-top:1px;">${role}${phone ? ' · ' + phone : ''}</div>
        </div>
        ${checked ? '<span style="font-size:11px;color:#16a34a;font-weight:600;flex-shrink:0;">✓ Đang gán</span>' : ''}
      </label>
    `;
  }).join('');
}

/* ⭐ FIX #1: Confirm Replace/Share khi thêm NV vào tầng đã có người */
async function saveAssignments() {
  const ctx = state._assignCtx;
  if (!ctx) { toast('Thiếu thông tin'); return; }
  const { buildingId, floorId, dateStr } = ctx;

  const checkedIds = new Set();
  document.querySelectorAll('#assignEmpList input[type="checkbox"]:checked').forEach(cb => {
    checkedIds.add(cb.dataset.empId);
  });

  const $btn = document.getElementById('assignEmpSaveBtn');
  if ($btn) { $btn.disabled = true; $btn.textContent = '⏳ Đang lưu...'; }

  try {
    const { data: allAtt, error: fetchErr } = await supabase
      .from('attendance').select('*').eq('date', dateStr);
    if (fetchErr) throw fetchErr;

    // ⭐ FIX #1: Detect existing users on floor
    const existingFloorUsers = (allAtt || []).filter(a => {
      if (a.is_off) return false;
      if (a.mode === 'leave' || a.mode === 'off') return false;
      return (a.areas || []).some(x =>
        (x.type === 'building' || !x.type) &&
        String(x.building_id) === String(buildingId) &&
        String(x.floor_id) === String(floorId));
    }).map(a => a.employee_id);

    if (existingFloorUsers.length > 0) {
      const newlyAdded = [...checkedIds].filter(id => !existingFloorUsers.includes(id));
      const existingStillChecked = existingFloorUsers.filter(id => checkedIds.has(id));

      if (newlyAdded.length > 0 && existingStillChecked.length > 0) {
        const existingNames = existingStillChecked.map(id => {
          const e = state.employees.find(x => x.id === id);
          return e?.full_name || e?.username || '?';
        }).join(', ');
        const newNames = newlyAdded.map(id => {
          const e = state.employees.find(x => x.id === id);
          return e?.full_name || e?.username || '?';
        }).join(', ');

        const share = confirm(
          `⚠️ Tầng này đã có: ${existingNames}\n\nĐang thêm: ${newNames}\n\n` +
          `OK = LÀM CHUNG (giữ tất cả)\n` +
          `Cancel = THAY THẾ (chỉ giữ ${newNames})`
        );

        if (!share) {
          const ok = confirm(`Xác nhận THAY THẾ?\n\nXoá: ${existingNames}\nChỉ giữ: ${newNames}`);
          if (!ok) {
            if ($btn) { $btn.disabled = false; $btn.textContent = 'Lưu'; }
            return;
          }
          existingStillChecked.forEach(id => checkedIds.delete(id));
        }
      }
    }

    const allActiveEmps = (state.employees || []).filter(e => e.status !== 'inactive');
    const toUpsert = [];
    const toDelete = [];

    for (const emp of allActiveEmps) {
      const existing = (allAtt || []).find(a => a.employee_id === emp.id);
      const empChecked = checkedIds.has(emp.id);
      const existingAreas = Array.isArray(existing?.areas) ? existing.areas : [];
      const hasFloor = existingAreas.some(a =>
        (a.type === 'building' || !a.type) &&
        String(a.building_id) === String(buildingId) &&
        String(a.floor_id) === String(floorId));

      if (empChecked && !hasFloor) {
        const newAreas = [...existingAreas, { type: 'building', building_id: buildingId, floor_id: floorId, hours: null }];
        toUpsert.push({
          employee_id: emp.id, date: dateStr, areas: newAreas,
          ot_areas: existing?.ot_areas || [], mode: existing?.mode || 'default',
          total_hours: Number(existing?.total_hours || 0), ot_hours: Number(existing?.ot_hours || 0),
          is_off: !!existing?.is_off, manual_hours: existing?.manual_hours ?? null,
        });
      } else if (!empChecked && hasFloor) {
        const newAreas = existingAreas.filter(a =>
          !((a.type === 'building' || !a.type) &&
            String(a.building_id) === String(buildingId) &&
            String(a.floor_id) === String(floorId)));
        const hasOt = Array.isArray(existing?.ot_areas) && existing.ot_areas.length > 0;
        const hasManual = existing?.mode === 'manual' && Number(existing?.manual_hours) > 0;
        const isLeaveOrOff = existing?.mode === 'leave' || existing?.mode === 'off' || existing?.is_off;
        if (newAreas.length === 0 && !hasOt && !hasManual && !isLeaveOrOff) toDelete.push(emp.id);
        else {
          toUpsert.push({
            employee_id: emp.id, date: dateStr, areas: newAreas,
            ot_areas: existing?.ot_areas || [], mode: existing?.mode || 'default',
            total_hours: Number(existing?.total_hours || 0), ot_hours: Number(existing?.ot_hours || 0),
            is_off: !!existing?.is_off, manual_hours: existing?.manual_hours ?? null,
          });
        }
      }
    }

    if (!toUpsert.length && !toDelete.length) {
      toast('Không có thay đổi');
      const $m = document.getElementById('assignEmployeeModal');
      if ($m) $m.style.display = 'none';
      if ($btn) { $btn.disabled = false; $btn.textContent = 'Lưu'; }
      return;
    }

    if (toUpsert.length) {
      const { error } = await supabase.from('attendance').upsert(toUpsert, { onConflict: 'employee_id,date' });
      if (error) throw error;
    }
    if (toDelete.length) {
      const { error } = await supabase.from('attendance').delete().in('employee_id', toDelete).eq('date', dateStr);
      if (error) throw error;
    }

    toast(`✅ Đã lưu: ${toUpsert.length} cập nhật${toDelete.length > 0 ? `, ${toDelete.length} xoá` : ''}`);

    const $m = document.getElementById('assignEmployeeModal');
    if ($m) $m.style.display = 'none';

    try {
      const core = await import('./core.js');
      if (core.invalidateAttendanceCache) core.invalidateAttendanceCache();
    } catch {}

    await loadDayAssignments(dateStr);
    renderBuildings();

    try {
      const changedIds = new Set([...toUpsert.map(u => u.employee_id), ...toDelete]);
      const att = await import('./attendance.js');
      if (att.invalidateDayAssignCache) att.invalidateDayAssignCache();
      if (state.selectedEmployeeId && changedIds.has(state.selectedEmployeeId)) {
        if (att.loadAttendanceForMonth) await att.loadAttendanceForMonth(true);
        if (att.renderCalendar) att.renderCalendar();
      }
    } catch (err) { console.warn('[assign] recalc:', err); }

    if (state.salaryModule) state.salaryModule.invalidateCache();
  } catch (err) {
    console.error('[assign] save:', err);
    toast('Lỗi lưu: ' + (err.message || 'không xác định'));
  } finally {
    if ($btn) { $btn.disabled = false; $btn.textContent = 'Lưu'; }
  }
}

/* ═══════════════════════════════════════════════════════════════
   FIX #3: BULK ASSIGN — 1 NV, nhiều tầng
   ═══════════════════════════════════════════════════════════════ */
export function handleBulkSelectChange(e) {
  state.areasBulkEmpId = e.target.value || null;

  if (state.areasBulkEmpId) {
    const set = new Set();
    const empId = state.areasBulkEmpId;

    for (const fid in state.floorAssignments) {
      const assigns = state.floorAssignments[fid] || [];
      if (assigns.some(a => a.employee_id === empId)) set.add(String(fid));
    }
    if (state.externalAssignments.some(a => a.employee_id === empId)) set.add('__external__');
    if (state.nightAssignments.some(a => a.employee_id === empId)) set.add('__night__');

    state._bulkAssignments = set;
  } else {
    state._bulkAssignments = new Set();
  }

  renderBuildings();
}

export async function saveBulkAssignments() {
  const empId = state.areasBulkEmpId;
  if (!empId) { toast('Chưa chọn nhân viên'); return; }

  const emp = state.employees.find(e => e.id === empId);
  if (!emp) return;

  const dateStr = state.areasViewDate || toDateStr(new Date());
  const selectedSet = state._bulkAssignments || new Set();

  const $btn = document.getElementById('areasBulkSaveBtnTop');
  if ($btn) { $btn.disabled = true; $btn.textContent = '⏳ Đang lưu...'; }

  try {
    const { data: existing, error } = await supabase
      .from('attendance').select('*')
      .eq('employee_id', empId).eq('date', dateStr).maybeSingle();
    if (error) throw error;

    // Confirm ghi đè special mode
    if (existing && (existing.is_off || existing.mode === 'leave' || existing.mode === 'off' || existing.mode === 'manual')) {
      const ok = confirm(`NV đang có "${existing.mode || 'off'}" ngày này. Ghi đè bằng gán tầng mới?`);
      if (!ok) {
        if ($btn) { $btn.disabled = false; $btn.textContent = '💾 Lưu gán'; }
        return;
      }
    }

    // Build new areas from selection
    const newAreas = [];
    for (const key of selectedSet) {
      if (key === '__external__') {
        newAreas.push({ type: 'external', hours: null });
        continue;
      }
      if (key === '__night__') {
        newAreas.push({ type: 'night', hours: null });
        continue;
      }
      const floor = state.floors.find(f => String(f.id) === String(key));
      if (!floor) continue;
      newAreas.push({ type: 'building', building_id: floor.building_id, floor_id: floor.id, hours: null });
    }

    const finalAreas = newAreas;
    const finalOtAreas = existing?.ot_areas || [];
    const finalMode = existing?.mode || 'default';
    const finalManualHours = existing?.manual_hours ?? null;
    const finalIsOff = !!existing?.is_off;

    const isEmpty = finalAreas.length === 0
      && finalOtAreas.length === 0
      && finalMode === 'default'
      && !finalManualHours
      && !finalIsOff;

    if (isEmpty) {
      if (existing) {
        const { error: delErr } = await supabase.from('attendance').delete().eq('id', existing.id);
        if (delErr) throw delErr;
        toast('✅ Đã xoá toàn bộ gán');
      } else {
        toast('Không có thay đổi');
      }
    } else {
      const { error: saveErr } = await supabase.from('attendance').upsert({
        employee_id: empId,
        date: dateStr,
        areas: finalAreas,
        ot_areas: finalOtAreas,
        mode: finalMode,
        manual_hours: finalManualHours,
        is_off: finalIsOff,
        total_hours: Number(existing?.total_hours || 0),
        ot_hours: Number(existing?.ot_hours || 0),
      }, { onConflict: 'employee_id,date' });
      if (saveErr) throw saveErr;
      toast(`✅ Đã gán ${newAreas.length} khu vực cho ${emp.full_name || emp.username}`);
    }

    // Reset bulk mode
    state.areasBulkEmpId = null;
    state._bulkAssignments = new Set();

    try {
      const core = await import('./core.js');
      if (core.invalidateAttendanceCache) core.invalidateAttendanceCache();
    } catch {}

    try {
      const att = await import('./attendance.js');
      if (att.invalidateDayAssignCache) att.invalidateDayAssignCache();
    } catch {}

    await loadDayAssignments(dateStr);
    renderBuildings();

    if (state.salaryModule) state.salaryModule.invalidateCache();
  } catch (err) {
    console.error('[bulk] save:', err);
    toast('Lỗi: ' + (err.message || 'không xác định'));
  } finally {
    if ($btn) { $btn.disabled = false; $btn.textContent = '💾 Lưu gán'; }
  }
}

export function cancelBulkAssign() {
  state.areasBulkEmpId = null;
  state._bulkAssignments = new Set();
  renderBuildings();
}

/* ═══════════════════════════════════════════════════════════════
   FIX #3: RESET — xoá data ngày / tháng
   ═══════════════════════════════════════════════════════════════ */
export async function handleResetAreasData() {
  const dateStr = state.areasViewDate || toDateStr(new Date());

  if (!confirm(`⚠️ Xoá SẠCH data khu vực ngày ${formatDateVN(dateStr)}?\n\nBao gồm: khu vực chính, ngoại cảnh, ca đêm, tăng ca CN, thủ công, phép, OFF.\n\nKhông thể hoàn tác!`)) return;

  const wantMonth = confirm(
    `Xoá cả THÁNG không?\n\n` +
    `OK = Xoá TOÀN BỘ tháng ${dateStr.slice(5, 7)}/${dateStr.slice(0, 4)}\n` +
    `Cancel = Chỉ xoá ngày ${formatDateVN(dateStr)}`
  );

  let query = supabase.from('attendance').delete();

  if (wantMonth) {
    const [y, m] = dateStr.split('-').map(Number);
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const end = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    query = query.gte('date', start).lte('date', end);
  } else {
    query = query.eq('date', dateStr);
  }

  const { error } = await query;
  if (error) { toast('Lỗi xoá: ' + error.message); return; }

  toast(`✅ Đã xoá ${wantMonth ? 'toàn bộ tháng' : 'ngày ' + formatDateVN(dateStr)}`);

  try {
    const core = await import('./core.js');
    if (core.invalidateAttendanceCache) core.invalidateAttendanceCache();
  } catch {}

  try {
    const att = await import('./attendance.js');
    if (att.invalidateDayAssignCache) att.invalidateDayAssignCache();
  } catch {}

  // Reset bulk mode nếu đang bật
  state.areasBulkEmpId = null;
  state._bulkAssignments = new Set();

  await loadDayAssignments(dateStr);
  renderBuildings();

  if (state.salaryModule) state.salaryModule.invalidateCache();
}

/* ═══════════════════════════════════════════════════════════════
   SPECIAL AREAS
   ═══════════════════════════════════════════════════════════════ */
let _editingSpecialType = null;

export function openSpecialAreaModal(type) {
  if (!state.isAdmin) { toast('Chỉ Giám sát được tạo khu vực'); return; }
  ensureState();

  _editingSpecialType = type;
  const existing = state.specialAreas[type];

  const titleMap = {
    external: existing ? 'Sửa Ngoại cảnh' : 'Tạo Ngoại cảnh',
    night: existing ? 'Sửa Ca đêm' : 'Tạo Ca đêm',
  };

  $('#specialAreaTitle').textContent = titleMap[type] || 'Khu vực đặc biệt';
  $('#specialAreaName').value = existing?.name || (type === 'external' ? 'Ngoại cảnh' : 'Ca đêm');
  $('#specialAreaName').placeholder = type === 'external' ? 'VD: Ngoại cảnh' : 'VD: Ca đêm';
  $('#specialAreaHours').value = existing?.default_hours ?? 8;
  $('#specialAreaError').textContent = '';
  openModal('specialAreaModal');
}

export async function saveSpecialArea() {
  if (!state.isAdmin) return;
  if (!_editingSpecialType) return;

  const name = $('#specialAreaName').value.trim();
  const hours = Number($('#specialAreaHours').value);
  const errEl = $('#specialAreaError');
  errEl.textContent = '';

  if (name.length < 2) { errEl.textContent = 'Tên quá ngắn'; return; }
  if (isNaN(hours) || hours < 0 || hours > 24) {
    errEl.textContent = 'Giờ phải từ 0 đến 24';
    return;
  }

  const btn = $('#saveSpecialAreaBtn');
  btn.disabled = true; btn.textContent = 'Đang lưu...';

  const existing = state.specialAreas[_editingSpecialType];
  let error;
  if (existing) {
    const res = await supabase.from('special_areas').update({ name, default_hours: hours }).eq('id', existing.id);
    error = res.error;
  } else {
    const res = await supabase.from('special_areas').insert({ type: _editingSpecialType, name, default_hours: hours });
    error = res.error;
  }

  btn.disabled = false; btn.textContent = 'Lưu';

  if (error) {
    errEl.textContent = error.message || 'Lưu thất bại';
    return;
  }

  toast(existing ? 'Đã cập nhật ✓' : 'Đã tạo mới ✓');
  closeModal('specialAreaModal');
  await loadBuildings();

  if (state.salaryModule) state.salaryModule.invalidateCache();
  const attendance = await import('./attendance.js');
  attendance.updateSummary();
}

export async function deleteSpecialArea(type) {
  if (!state.isAdmin) return;
  ensureState();
  const existing = state.specialAreas[type];
  if (!existing) return;

  const title = type === 'external' ? 'Ngoại cảnh' : 'Ca đêm';
  if (!confirm(`Xoá "${title}"?\n\n• Chỉ xoá cấu hình khu vực\n• Dữ liệu chấm công cũ vẫn được giữ nguyên\n\nTiếp tục?`)) return;

  const { error } = await supabase.from('special_areas').delete().eq('id', existing.id);
  if (error) { toast('Xoá thất bại: ' + error.message); return; }

  toast('🗑 Đã xoá');
  await loadBuildings();
}

export async function jumpToEmployeeCalendar(empId) {
  const emp = state.employees.find(e => e.id === empId);
  if (!emp) { toast('Không tìm thấy nhân viên'); return; }

  state.selectedEmployeeId = empId;
  const sel = $('#employeeSelect');
  if (sel) sel.value = empId;

  const attendance = await import('./attendance.js');
  attendance.switchTab('calendar');
  await attendance.loadAttendanceForMonth();
  attendance.renderCalendar();

  toast(`📅 Đang xem lịch của ${emp.full_name || emp.username || ''}`);
}

export async function deleteBuilding(id) {
  if (!confirm('Xoá toà nhà này và tất cả tầng?')) return;
  const { error } = await supabase.from('buildings').delete().eq('id', id);
  if (error) { toast('Xoá thất bại'); return; }
  toast('Đã xoá');

  const { invalidateAttendanceCache } = await import('./core.js');
  invalidateAttendanceCache();
  if (state.salaryModule) state.salaryModule.invalidateCache();

  state.expandedBuildings?.delete(id);
  await loadBuildings();
  const attendance = await import('./attendance.js');
  await attendance.loadAttendanceForMonth();
  attendance.renderCalendar();
}

export async function saveBuilding() {
  if (!state.isAdmin) { toast('Chỉ Giám sát được thêm toà nhà'); return; }
  const name = $('#buildingName').value.trim();
  const count = parseInt($('#buildingFloors').value, 10);
  const noGround = $('#noGroundFloor').checked;

  if (!name) { toast('Nhập tên toà nhà'); return; }
  if (!count || count < 1) { toast('Số tầng lầu không hợp lệ'); return; }
  if (count > 50) { toast('Tối đa 50 tầng lầu'); return; }

  const { data: b, error } = await supabase.from('buildings').insert({ name }).select().single();
  if (error) { toast('Lỗi: ' + error.message); return; }

  const startFloor = noGround ? 1 : 0;
  const floors = [];
  for (let i = 0; i < count; i++) {
    floors.push({ building_id: b.id, floor_number: startFloor + i, default_hours: 8 });
  }
  const { error: e2 } = await supabase.from('floors').insert(floors);
  if (e2) { toast('Lỗi tạo tầng: ' + e2.message); return; }

  toast(`Đã tạo ${name} với ${floors.length} mặt bằng`);
  closeModal('buildingModal');
  $('#buildingName').value = '';
  $('#buildingFloors').value = '1';
  $('#noGroundFloor').checked = false;
  if (state.salaryModule) state.salaryModule.invalidateCache();
  await loadBuildings();
}

export function openFloorSetup(buildingId) {
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

export async function saveFloors() {
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

  const { invalidateAttendanceCache } = await import('./core.js');
  invalidateAttendanceCache();
  if (state.salaryModule) state.salaryModule.invalidateCache();

  await loadBuildings();
  const attendance = await import('./attendance.js');
  await attendance.loadAttendanceForMonth();
  attendance.renderCalendar();
}