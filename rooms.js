// rooms.js — Quản lý danh mục phòng học + gán nhân viên
import { supabase } from './supabase.js';
import { state, $, toast } from './core.js';

function ensureState() {
  if (!state.rooms) state.rooms = [];
  if (!state.roomsAssignments) state.roomsAssignments = {};
  if (!state.roomsSelectedEmp) state.roomsSelectedEmp = null;
  if (!state.roomsChecked) state.roomsChecked = new Set();
  if (!state.roomsOriginalChecked) state.roomsOriginalChecked = new Set();
  if (!state.roomsSearch) state.roomsSearch = '';
  if (!state.roomsBuildingFilter) state.roomsBuildingFilter = 'all';
}

export async function loadRooms(force = false) {
  ensureState();

  const wrap = $('#roomsList');
  if (wrap) wrap.innerHTML = '<p class="hint">⏳ Đang tải danh sách phòng...</p>';

  /* 1. Load cslx_rooms */
  if (force || !state.rooms.length) {
    try {
      const { data, error } = await supabase
        .from('cslx_rooms')
        .select('*')
        .order('building_code', { nullsFirst: false })
        .order('room_code');

      if (error) throw error;
      state.rooms = data || [];
    } catch (err) {
      console.error('[rooms] Load cslx_rooms fail:', err);
      if (wrap) {
        wrap.innerHTML = `<div style="padding:16px;background:#fee2e2;border-radius:10px;color:#991b1b;font-size:13px;line-height:1.5;">
          <strong>⚠️ Không tải được danh sách phòng</strong><br>
          <small>Lỗi: ${err.message || JSON.stringify(err)}</small><br><br>
          <button onclick="location.reload()" style="padding:8px 14px;background:#dc2626;color:#fff;border:none;border-radius:6px;font-weight:600;cursor:pointer;font-family:inherit;font-size:12px;">Thử lại</button>
        </div>`;
      }
      return;
    }
  }

  /* 2. Load cslx_room_assignments */
  if (force || !Object.keys(state.roomsAssignments).length) {
    try {
      const { data, error } = await supabase
        .from('cslx_room_assignments')
        .select('room_code, employee_id');

      if (error) {
        console.warn('[rooms] Load assignments lỗi (bỏ qua):', error);
        state.roomsAssignments = {};
      } else {
        const map = {};
        for (const row of (data || [])) {
          if (!map[row.room_code]) map[row.room_code] = [];
          map[row.room_code].push(row.employee_id);
        }
        state.roomsAssignments = map;
      }
    } catch (err) {
      console.warn('[rooms] Load assignments exception:', err);
      state.roomsAssignments = {};
    }
  }

  renderRooms();
}

export function renderRooms() {
  ensureState();
  const wrap = $('#roomsList');
  if (!wrap) return;

  renderEmpBar();

  const filterEl = $('#roomsBuildingFilter');
  if (filterEl) {
    if (filterEl.options.length <= 1 && state.rooms.length > 0) {
      const buildings = [...new Set(state.rooms.map(r => r.building_code).filter(Boolean))].sort();
      filterEl.innerHTML = '<option value="all">Tất cả toà</option>' +
        buildings.map(b => `<option value="${b}">Toà ${b}</option>`).join('');
    }
    if (filterEl.value !== state.roomsBuildingFilter) {
      filterEl.value = state.roomsBuildingFilter;
    }
  }

  const search = (state.roomsSearch || '').toLowerCase().trim();
  const bFilter = state.roomsBuildingFilter || 'all';
  const isAssigning = !!state.roomsSelectedEmp;

  const empMap = {};
  for (const e of state.employees || []) empMap[e.id] = e;

  const filtered = state.rooms.filter(r => {
    if (bFilter !== 'all' && r.building_code !== bFilter) return false;
    if (search) {
      const m = `${r.room_code || ''} ${r.room_name || ''} ${r.note || ''}`.toLowerCase();
      if (!m.includes(search)) return false;
    }
    return true;
  });

  if (!filtered.length) {
    wrap.innerHTML = '<p class="hint">Không tìm thấy phòng nào phù hợp.</p>';
    renderStickyBar();
    return;
  }

  const grouped = {};
  for (const r of filtered) {
    const b = r.building_code || 'Khác';
    if (!grouped[b]) grouped[b] = [];
    grouped[b].push(r);
  }

  let html = '';
  const sortedBuildings = Object.keys(grouped).sort();

  for (const b of sortedBuildings) {
    const roomsInBuilding = grouped[b];
    const codesInBuilding = roomsInBuilding.map(r => r.room_code);
    const allCheckedInBuilding = isAssigning && codesInBuilding.length > 0 &&
      codesInBuilding.every(c => state.roomsChecked.has(c));

    html += `<div class="building-card" style="margin-bottom:16px; border:1px solid var(--border); border-radius:12px; overflow:hidden; background:#fff; box-shadow:0 1px 4px rgba(0,0,0,0.04);">`;
    html += `<div class="building-header" style="padding: 10px 14px; background:var(--ocean-50); border-bottom: 1px solid var(--border); display:flex; justify-content:space-between; align-items:center; gap:8px;">`;
    html += `<span style="color:var(--ocean-700); font-size:15px; font-weight:700;">🏢 Toà ${b}</span>`;
    if (isAssigning) {
      html += `<button class="rooms-select-all" data-building="${b}" data-check="${allCheckedInBuilding ? '0' : '1'}" style="padding:4px 10px; font-size:11px; background:#fff; border:1px solid var(--ocean-200, #bae6fd); border-radius:12px; color:var(--ocean-700); font-weight:600; cursor:pointer;">
        ${allCheckedInBuilding ? '☐ Bỏ chọn toà' : '☑️ Chọn toà'}
      </button>`;
    } else {
      html += `<span style="background:#fff; border:1px solid var(--ocean-200, #bae6fd); padding:2px 10px; border-radius:12px; font-size:12px; font-weight:600; color:var(--ocean-600);">${roomsInBuilding.length} phòng</span>`;
    }
    html += `</div>`;

    html += `<div>`;
    for (const r of roomsInBuilding) {
      const assignedEmps = (state.roomsAssignments[r.room_code] || [])
        .map(id => empMap[id])
        .filter(Boolean);
      const isChecked = state.roomsChecked.has(r.room_code);
      const rowBg = isAssigning && isChecked ? 'background:#e0f2fe;' : '';

      html += `<div class="room-row" data-room="${r.room_code}" style="padding: 12px 14px; border-bottom: 1px solid var(--border); display: flex; align-items: flex-start; gap: 10px; ${rowBg} ${isAssigning ? 'cursor:pointer;' : ''}">`;

      if (isAssigning) {
        html += `<div style="flex-shrink:0; padding-top:2px;">
          <input type="checkbox" class="room-check" data-room="${r.room_code}" ${isChecked ? 'checked' : ''} style="width:20px; height:20px; cursor:pointer; accent-color:var(--ocean-500, #0ea5b7);" />
        </div>`;
      }

      html += `<div style="flex: 1; min-width: 0;">
        <div style="font-weight: 700; font-size: 14px; color: var(--text);">${r.room_code}</div>
        ${r.room_name ? `<div style="font-size: 13px; color: var(--ocean-700); font-weight:500; margin-top: 2px;">${r.room_name}</div>` : ''}
        ${r.note ? `<div style="font-size: 12px; color: #d97706; margin-top: 4px; background:#fef3c7; padding:2px 6px; border-radius:4px; display:inline-block;">📝 ${r.note}</div>` : ''}
        ${assignedEmps.length ? `
          <div style="margin-top:6px; display:flex; flex-wrap:wrap; gap:4px;">
            ${assignedEmps.map(e => {
              const name = e.full_name || e.username || '?';
              const isCurrent = e.id === state.roomsSelectedEmp;
              return `<span style="font-size:11px; padding:2px 8px; border-radius:10px; background:${isCurrent ? 'var(--ocean-500, #0ea5b7)' : '#f1f5f9'}; color:${isCurrent ? '#fff' : '#475569'}; font-weight:600;">👤 ${name}</span>`;
            }).join('')}
          </div>
        ` : ''}
      </div>`;

      html += `<div style="text-align: right; flex-shrink: 0;">
        ${r.capacity ? `<div style="font-size: 12px; font-weight: 600; color: var(--success);">👥 ${r.capacity}</div>` : ''}
        ${r.double_tables ? `<div style="font-size: 10px; color: var(--text-muted);">${r.double_tables} bàn đôi</div>` : ''}
        ${r.single_tables ? `<div style="font-size: 10px; color: var(--text-muted);">${r.single_tables} bàn đơn</div>` : ''}
      </div>`;

      html += `</div>`;
    }
    html += `</div></div>`;
  }

  wrap.innerHTML = html;

  if (isAssigning) {
    wrap.querySelectorAll('.room-check').forEach(cb => {
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        toggleRoomCheck(cb.dataset.room, cb.checked);
      });
    });

    wrap.querySelectorAll('.room-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT') return;
        toggleRoomCheck(row.dataset.room);
      });
    });

    wrap.querySelectorAll('.rooms-select-all').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const b = btn.dataset.building;
        const wantCheck = btn.dataset.check === '1';
        const rooms = grouped[b] || [];
        for (const r of rooms) {
          if (wantCheck) state.roomsChecked.add(r.room_code);
          else state.roomsChecked.delete(r.room_code);
        }
        renderRooms();
      });
    });
  }

  renderStickyBar();
}

function renderEmpBar() {
  const bar = $('#roomsEmpBar');
  if (!bar) return;

  const currentId = state.roomsSelectedEmp;
  const employees = (state.employees || []).filter(e => e.status !== 'inactive');
  const options = employees.map(e =>
    `<option value="${e.id}" ${e.id === currentId ? 'selected' : ''}>${e.full_name || e.username || 'NV'}</option>`
  ).join('');

  bar.innerHTML = `
    <div style="display:flex; gap:8px; align-items:center; margin-bottom:12px; padding:10px 12px; background:${currentId ? 'var(--ocean-50, #f0f9ff)' : '#fff'}; border:1px solid var(--border); border-radius:10px;">
      <div style="flex:1; min-width:0;">
        <label style="font-size:11px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.6px; display:block; margin-bottom:4px;">
          👤 ${currentId ? 'Đang gán phòng cho' : 'Chọn nhân viên để gán phòng'}
        </label>
        <select id="roomsEmpSelect" class="input" style="width:100%; font-weight:600;">
          <option value="">— Chọn nhân viên —</option>
          ${options}
        </select>
      </div>
      ${currentId ? `<button id="roomsClearEmpBtn" class="btn-secondary" style="padding:8px 12px; font-size:13px; flex-shrink:0;">✕ Thoát</button>` : ''}
    </div>
  `;

  const sel = $('#roomsEmpSelect');
  if (sel) {
    sel.value = currentId || '';
    sel.addEventListener('change', async (e) => {
      await selectEmployeeForRooms(e.target.value || null);
    });
  }
  const clearBtn = $('#roomsClearEmpBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      await selectEmployeeForRooms(null);
    });
  }
}

function renderStickyBar() {
  const bar = $('#roomsStickyBar');
  if (!bar) return;

  if (!state.roomsSelectedEmp) {
    bar.style.display = 'none';
    bar.innerHTML = '';
    return;
  }

  bar.style.display = 'block';

  const count = state.roomsChecked.size;
  const emp = (state.employees || []).find(e => e.id === state.roomsSelectedEmp);
  const empName = emp?.full_name || emp?.username || '';

  bar.innerHTML = `
    <div style="display:flex; align-items:center; gap:10px; padding:12px 14px; background:linear-gradient(135deg, #0e7490, #0891b2); color:#fff; border-radius:14px; box-shadow:0 -2px 12px rgba(0,0,0,0.15);">
      <div style="flex:1; min-width:0;">
        <div style="font-size:10px; opacity:0.85; text-transform:uppercase; letter-spacing:0.6px; font-weight:700;">Đang gán cho</div>
        <div style="font-weight:700; font-size:15px; margin-top:1px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${empName}</div>
        <div style="font-size:12px; opacity:0.9; margin-top:2px;">Đã chọn <strong>${count}</strong> phòng</div>
      </div>
      <button id="roomsCancelBtn" style="padding:9px 14px; font-size:13px; font-weight:600; flex-shrink:0; background:rgba(255,255,255,0.2); color:#fff; border:1px solid rgba(255,255,255,0.35); border-radius:10px; cursor:pointer; font-family:inherit;">
        Huỷ
      </button>
      <button id="roomsSaveBtn" style="padding:9px 14px; font-size:13px; font-weight:700; flex-shrink:0; background:#fff; color:#0e7490; border:none; border-radius:10px; cursor:pointer; font-family:inherit;">
        💾 Lưu
      </button>
    </div>
  `;

  const cancelBtn = $('#roomsCancelBtn');
  if (cancelBtn) cancelBtn.addEventListener('click', async () => {
    const dirty =
      state.roomsChecked.size !== state.roomsOriginalChecked.size ||
      [...state.roomsChecked].some(c => !state.roomsOriginalChecked.has(c));
    if (dirty && !confirm('Huỷ thay đổi chưa lưu?')) return;
    await selectEmployeeForRooms(null);
  });

  const saveBtn = $('#roomsSaveBtn');
  if (saveBtn) saveBtn.addEventListener('click', saveAssignments);
}

async function selectEmployeeForRooms(empId) {
  ensureState();
  state.roomsSelectedEmp = empId || null;
  state.roomsChecked = new Set();
  state.roomsOriginalChecked = new Set();

  if (empId) {
    for (const roomCode in state.roomsAssignments) {
      if (state.roomsAssignments[roomCode].includes(empId)) {
        state.roomsChecked.add(roomCode);
        state.roomsOriginalChecked.add(roomCode);
      }
    }
  }

  renderRooms();
}

function toggleRoomCheck(roomCode, forceState = null) {
  if (!state.roomsSelectedEmp) return;
  let nowChecked;
  if (forceState === null) {
    nowChecked = !state.roomsChecked.has(roomCode);
  } else {
    nowChecked = !!forceState;
  }
  if (nowChecked) state.roomsChecked.add(roomCode);
  else state.roomsChecked.delete(roomCode);
  renderRooms();
}

async function saveAssignments() {
  const empId = state.roomsSelectedEmp;
  if (!empId) return;

  const newSet = new Set(state.roomsChecked);
  const oldSet = new Set(state.roomsOriginalChecked);

  const toAdd = [...newSet].filter(c => !oldSet.has(c));
  const toRemove = [...oldSet].filter(c => !newSet.has(c));

  if (!toAdd.length && !toRemove.length) {
    toast('Không có thay đổi');
    return;
  }

  const btn = $('#roomsSaveBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang lưu...'; }

  try {
    if (toRemove.length) {
      const { error } = await supabase
        .from('cslx_room_assignments')
        .delete()
        .eq('employee_id', empId)
        .in('room_code', toRemove);
      if (error) throw error;
    }

    if (toAdd.length) {
      const rows = toAdd.map(rc => ({ room_code: rc, employee_id: empId }));
      const { error } = await supabase
        .from('cslx_room_assignments')
        .upsert(rows, { onConflict: 'room_code,employee_id', ignoreDuplicates: true });
      if (error) throw error;
    }

    for (const rc of toRemove) {
      const arr = state.roomsAssignments[rc];
      if (arr) {
        const idx = arr.indexOf(empId);
        if (idx >= 0) arr.splice(idx, 1);
        if (!arr.length) delete state.roomsAssignments[rc];
      }
    }
    for (const rc of toAdd) {
      if (!state.roomsAssignments[rc]) state.roomsAssignments[rc] = [];
      if (!state.roomsAssignments[rc].includes(empId)) {
        state.roomsAssignments[rc].push(empId);
      }
    }

    const emp = (state.employees || []).find(e => e.id === empId);
    toast(`✅ Đã lưu ${newSet.size} phòng cho ${emp?.full_name || emp?.username || ''}`);

    await selectEmployeeForRooms(empId);
  } catch (err) {
    console.error('[rooms save]', err);
    toast('Lỗi lưu: ' + (err.message || 'không xác định'));
    if (btn) { btn.disabled = false; btn.textContent = '💾 Lưu'; }
  }
}