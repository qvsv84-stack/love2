// buildings.js — Quản lý toà nhà, tầng, khu vực đặc biệt (Ngoại cảnh/Ca đêm/Tuỳ chỉnh) + Tăng ca CN
import { supabase } from './supabase.js';
import {
  state, $, $$, toast,
  formatHours, formatDateVN, floorLabel, toDateStr,
  openModal, closeModal,
} from './core.js';
import { showPhoneAction } from './phone.js';

/* ============ LOAD ============ */
export async function loadBuildings() {
  const { data: buildings, error: e1 } = await supabase.from('buildings').select('*').order('name');
  if (e1) { console.error(e1); return; }
  state.buildings = buildings || [];

  if (state.buildings.length) {
    const ids = state.buildings.map(b => b.id);
    const { data: floors } = await supabase
      .from('floors').select('*').in('building_id', ids).order('floor_number');
    state.floors = floors || [];
  } else {
    state.floors = [];
  }

  renderBuildings();
}

export async function loadTodayAssignments() {
  const todayStr = toDateStr(new Date());
  const { data, error } = await supabase
    .from('attendance')
    .select('employee_id, areas, ot_areas, is_off, mode, total_hours, ot_hours')
    .eq('date', todayStr)
    .neq('is_off', true);

  if (error) {
    console.error(error);
    state.floorAssignments = {};
    state.externalAssignments = [];
    state.nightAssignments = [];
    state.customAssignments = [];
    state.sundayOtAssignments = [];
    return;
  }

  const mainUsersByFloor = {};
  const otAutoUsersByFloor = {};

  // ⭐ 4 mảng track riêng
  const externalAssignments = [];
  const nightAssignments = [];
  const customAssignments = [];
  const sundayOtAssignments = [];

  for (const a of data) {
    // Phân tích areas (main)
    if (Array.isArray(a.areas)) {
      for (const area of a.areas) {
        if (area.type === 'external') {
          externalAssignments.push({
            employee_id: a.employee_id,
            hours: Number(area.hours || 0),
          });
        } else if (area.type === 'night') {
          nightAssignments.push({
            employee_id: a.employee_id,
            hours: Number(area.hours || 0),
          });
        } else if (area.type === 'custom') {
          customAssignments.push({
            employee_id: a.employee_id,
            hours: Number(area.hours || 0),
          });
        } else if (area.building_id && area.floor_id) {
          // Building bình thường → đếm cho share
          if (a.mode === 'default' || a.mode === 'manual') {
            const fid = area.floor_id;
            if (!mainUsersByFloor[fid]) mainUsersByFloor[fid] = new Set();
            mainUsersByFloor[fid].add(a.employee_id);
          }
        }
      }
    }

    // Phân tích ot_areas
    if (Array.isArray(a.ot_areas)) {
      for (const area of a.ot_areas) {
        if (area.type === 'sunday_ot') {
          sundayOtAssignments.push({
            employee_id: a.employee_id,
            hours: Number(area.hours || 0),
          });
        } else if (area.type === 'external') {
          externalAssignments.push({
            employee_id: a.employee_id,
            hours: Number(area.hours || 0),
            isOt: true,
          });
        } else if (area.type === 'night') {
          nightAssignments.push({
            employee_id: a.employee_id,
            hours: Number(area.hours || 0),
            isOt: true,
          });
        } else if (area.type === 'custom') {
          customAssignments.push({
            employee_id: a.employee_id,
            hours: Number(area.hours || 0),
            isOt: true,
          });
        } else if (area.building_id && area.floor_id) {
          const fid = area.floor_id;
          const h = area.hours;
          if (h != null && h !== '' && !isNaN(Number(h))) continue;
          if (!otAutoUsersByFloor[fid]) otAutoUsersByFloor[fid] = new Set();
          otAutoUsersByFloor[fid].add(a.employee_id);
        }
      }
    }
  }

  // ⭐ Gộp entries cùng employee_id trong mỗi mảng
  const merge = (arr) => {
    const map = {};
    for (const item of arr) {
      const k = item.employee_id;
      if (!map[k]) {
        map[k] = { employee_id: k, hours: 0, hasOt: false };
      }
      map[k].hours += item.hours;
      if (item.isOt) map[k].hasOt = true;
    }
    return Object.values(map);
  };

  state.externalAssignments = merge(externalAssignments);
  state.nightAssignments = merge(nightAssignments);
  state.customAssignments = merge(customAssignments);
  state.sundayOtAssignments = merge(sundayOtAssignments);

  // Build floorAssignments (chỉ building bình thường)
  const map = {};

  for (const a of data) {
    const perFloor = {};
    let mainRawTotal = 0;
    let otRawTotal = 0;

    if ((a.mode === 'default' || a.mode === 'manual') && Array.isArray(a.areas)) {
      for (const area of a.areas) {
        if (area.type && area.type !== 'building') continue;
        if (!area.building_id || !area.floor_id) continue;
        const fid = area.floor_id;
        if (!perFloor[fid]) perFloor[fid] = { main: 0, ot: 0 };

        const floor = state.floors.find(x => x.id === fid);
        const floorDefault = floor ? Number(floor.default_hours || 0) : 0;
        const cnt = mainUsersByFloor[fid]?.size || 1;
        const raw = floorDefault / cnt;

        perFloor[fid].main += raw;
        mainRawTotal += raw;
      }
    }

    if (Array.isArray(a.ot_areas)) {
      for (const area of a.ot_areas) {
        if (area.type && area.type !== 'building') continue;
        if (!area.building_id || !area.floor_id) continue;
        const fid = area.floor_id;
        if (!perFloor[fid]) perFloor[fid] = { main: 0, ot: 0 };

        const h = area.hours;
        const isManual = h != null && h !== '' && !isNaN(Number(h));
        let raw;
        if (isManual) {
          raw = Number(h);
        } else {
          const floor = state.floors.find(x => x.id === fid);
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
      for (const fid in perFloor) {
        perFloor[fid].main = perFloor[fid].main * (mainFromDB / mainRawTotal);
      }
    }
    if (otRawTotal > 0) {
      for (const fid in perFloor) {
        perFloor[fid].ot = perFloor[fid].ot * (otFromDB / otRawTotal);
      }
    }

    for (const [fid, h] of Object.entries(perFloor)) {
      if (!map[fid]) map[fid] = [];
      const existing = map[fid].find(x => x.employee_id === a.employee_id);
      if (existing) {
        existing.main_hours += h.main;
        existing.ot_hours += h.ot;
      } else {
        map[fid].push({
          employee_id: a.employee_id,
          main_hours: h.main,
          ot_hours: h.ot,
        });
      }
    }
  }

  state.floorAssignments = map;

  const hint = $('#areasHint');
  if (hint) {
    hint.textContent = `📅 Đang hiển thị nhân viên được phân công hôm nay (${formatDateVN(todayStr)})`;
  }
}

/* ============ HELPER: render 1 card đặc biệt ============ */
function renderSpecialCard(opts) {
  const {
    emoji, title, subtitle, items, colorStart, colorEnd, borderColor, avatarGrad,
    filteredEmpIds, formatHoursFn,
  } = opts;

  const visible = items.filter(x => filteredEmpIds.has(x.employee_id));
  if (!visible.length) return '';

  return `
    <div class="building-card" style="border-color:${borderColor};background:linear-gradient(135deg,${colorStart},${colorEnd})">
      <h3 style="color:${avatarGrad.split(',')[1].replace(')', '')}">${emoji} ${title}
        <span class="floor-count" style="background:${colorEnd};color:${avatarGrad.split(',')[1].replace(')', '')}">${visible.length} người</span>
      </h3>
      <div class="building-floors">
        ${visible.map(item => {
          const emp = state.employees.find(e => e.id === item.employee_id);
          if (!emp) return '';
          const name = emp.full_name || emp.username || '';
          return `
            <div class="floor-assignee" style="padding:6px 0">
              <div class="assignee-avatar" style="background:linear-gradient(135deg,${avatarGrad})">${name.charAt(0).toUpperCase()}</div>
              <div class="assignee-info">
                <span class="assignee-name" data-jump-emp="${emp.id}" title="Xem lịch công">${name}</span>
                ${emp.phone ? `<span class="assignee-phone"><a class="phone-link" data-phone="${emp.phone}" href="javascript:void(0)">${emp.phone}</a></span>` : ''}
              </div>
              <span style="margin-left:auto;font-weight:700;color:${avatarGrad.split(',')[1].replace(')', '')};font-size:13px">
                ${formatHoursFn(item.hours)}${item.hasOt ? ' ⚡' : ''}
              </span>
            </div>`;
        }).join('')}
      </div>
    </div>
  `;
}

/* ============ RENDER ============ */
export function renderBuildings() {
  const wrap = $('#buildingsList');
  const $sum = $('#areasSummary');
  if (!wrap) return;

  // Đảm bảo các mảng tồn tại
  if (!Array.isArray(state.externalAssignments)) state.externalAssignments = [];
  if (!Array.isArray(state.nightAssignments)) state.nightAssignments = [];
  if (!Array.isArray(state.customAssignments)) state.customAssignments = [];
  if (!Array.isArray(state.sundayOtAssignments)) state.sundayOtAssignments = [];

  const hasAnySpecial =
    state.externalAssignments.length ||
    state.nightAssignments.length ||
    state.customAssignments.length ||
    state.sundayOtAssignments.length;

  if (!state.buildings.length && !hasAnySpecial) {
    wrap.innerHTML = '<p class="hint">Chưa có toà nhà nào. Nhấn "+ Thêm tòa nhà".</p>';
    if ($sum) $sum.style.display = 'none';
    return;
  }

  const search = (state.areasSearch || '').toLowerCase().trim();
  const roleFilter = state.areasRoleFilter || 'all';

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

  // Đếm NV đi làm hôm nay (gồm cả building + 4 loại đặc biệt)
  const workingNVIds = new Set();
  for (const fid in state.floorAssignments) {
    const assigns = state.floorAssignments[fid] || [];
    for (const a of assigns) {
      if (nvEmpIds.has(a.employee_id)) workingNVIds.add(a.employee_id);
    }
  }
  for (const arr of [state.externalAssignments, state.nightAssignments, state.customAssignments, state.sundayOtAssignments]) {
    for (const item of arr) {
      if (nvEmpIds.has(item.employee_id)) workingNVIds.add(item.employee_id);
    }
  }
  const totalNV = nvEmployees.length;
  const workingNVCount = workingNVIds.size;

  // Đếm tầng có người (chỉ building)
  const floorsWithPeople = new Set();
  for (const b of state.buildings) {
    const floors = state.floors.filter(f => f.building_id === b.id);
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
        <span class="areas-summary-label">👥 Nhân viên đi làm hôm nay</span>
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
      ${isFiltered ? `<div style="font-size:11px;color:var(--text-muted);margin-top:6px;text-align:center;padding-top:6px;border-top:1px dashed var(--border)">🔍 Đang lọc — số liệu tầng chỉ tính người khớp bộ lọc</div>` : ''}
    `;
  }

  /* ⭐ 4 card đặc biệt */
  const externalHtml = renderSpecialCard({
    emoji: '🌳',
    title: 'Ngoại cảnh',
    items: state.externalAssignments,
    colorStart: '#f0fdf4', colorEnd: '#dcfce7', borderColor: '#a7f3d0',
    avatarGrad: '#16a34a,#15803d',
    filteredEmpIds, formatHoursFn: formatHours,
  });

  const nightHtml = renderSpecialCard({
    emoji: '🌙',
    title: 'Ca đêm',
    items: state.nightAssignments,
    colorStart: '#eef2ff', colorEnd: '#e0e7ff', borderColor: '#c7d2fe',
    avatarGrad: '#6366f1,#4338ca',
    filteredEmpIds, formatHoursFn: formatHours,
  });

  const customHtml = renderSpecialCard({
    emoji: '🎯',
    title: 'Tuỳ chỉnh',
    items: state.customAssignments,
    colorStart: '#f8fafc', colorEnd: '#f1f5f9', borderColor: '#cbd5e1',
    avatarGrad: '#64748b,#475569',
    filteredEmpIds, formatHoursFn: formatHours,
  });

  const sundayOtHtml = renderSpecialCard({
    emoji: '📅',
    title: 'Tăng ca CN',
    items: state.sundayOtAssignments,
    colorStart: '#fff7ed', colorEnd: '#fed7aa', borderColor: '#fdba74',
    avatarGrad: '#ea580c,#c2410c',
    filteredEmpIds, formatHoursFn: formatHours,
  });

  /* Building cards thường */
  const buildingsHtml = state.buildings.map(b => {
    const floors = state.floors.filter(f => f.building_id === b.id)
      .sort((a, c) => a.floor_number - c.floor_number);

    const floorRows = floors.map(f => {
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

      return `
        <div class="floor-row${visible.length > 0 ? ' has-assignees' : ''}">
          <div class="floor-row-head">
            <span class="floor-name">${floorLabel(f.floor_number)} ${peopleBadge}</span>
            <span class="floor-hours">${formatHours(f.default_hours)}</span>
          </div>
          ${assigneesHtml}
        </div>`;
    }).join('') || '<p class="hint" style="margin:0">Chưa setup tầng</p>';

    return `
      <div class="building-card" data-id="${b.id}">
        <h3>${b.name} <span class="floor-count">${floors.length} mặt bằng</span></h3>
        <div class="building-floors">${floorRows}</div>
        <div class="building-actions">
          <button class="btn-small" data-setup="${b.id}">⚙️ Setup giờ tầng</button>
          <button class="btn-small" data-delete="${b.id}" style="background:#fee2e2;color:#e74c3c">🗑 Xoá</button>
        </div>
      </div>`;
  }).join('');

  wrap.innerHTML = externalHtml + nightHtml + customHtml + sundayOtHtml + buildingsHtml;

  // Bind events
  wrap.querySelectorAll('[data-setup]').forEach(btn =>
    btn.addEventListener('click', () => openFloorSetup(btn.dataset.setup)));
  wrap.querySelectorAll('[data-delete]').forEach(btn =>
    btn.addEventListener('click', () => deleteBuilding(btn.dataset.delete)));

  wrap.querySelectorAll('[data-phone]').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      showPhoneAction(el.dataset.phone);
    });
  });

  wrap.querySelectorAll('[data-jump-emp]').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      jumpToEmployeeCalendar(el.dataset.jumpEmp);
    });
  });
}

/* ============ JUMP ============ */
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

/* ============ DELETE ============ */
export async function deleteBuilding(id) {
  if (!confirm('Xoá toà nhà này và tất cả tầng?')) return;
  const { error } = await supabase.from('buildings').delete().eq('id', id);
  if (error) { toast('Xoá thất bại'); return; }
  toast('Đã xoá');

  const { invalidateAttendanceCache } = await import('./core.js');
  invalidateAttendanceCache();
  if (state.salaryModule) state.salaryModule.invalidateCache();

  await loadBuildings();
  const attendance = await import('./attendance.js');
  await attendance.loadAttendanceForMonth();
  attendance.renderCalendar();
}

/* ============ SAVE BUILDING ============ */
export async function saveBuilding() {
  if (!state.isAdmin) { toast('Chỉ Giám sát được thêm toà nhà'); return; }
  const name = $('#buildingName').value.trim();
  const count = parseInt($('#buildingFloors').value, 10);
  const noGround = $('#noGroundFloor').checked;

  if (!name) { toast('Nhập tên toà nhà'); return; }
  if (!count || count < 1) { toast('Số tầng lầu không hợp lệ'); return; }
  if (count > 50) { toast('Tối đa 50 tầng lầu'); return; }

  const { data: b, error } = await supabase
    .from('buildings').insert({ name }).select().single();
  if (error) { toast('Lỗi: ' + error.message); return; }

  const startFloor = noGround ? 1 : 0;
  const floors = [];
  for (let i = 0; i < count; i++) {
    floors.push({
      building_id: b.id,
      floor_number: startFloor + i,
      default_hours: 8,
    });
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

/* ============ FLOOR SETUP ============ */
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