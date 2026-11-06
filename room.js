// rooms.js — Quản lý danh mục phòng học
import { supabase } from './supabase.js';
import { state, $, toast } from './core.js';

export async function loadRooms(force = false) {
  if (!force && state.rooms && state.rooms.length > 0) {
    renderRooms();
    return;
  }

  const wrap = $('#roomsList');
  if (wrap) wrap.innerHTML = '<p class="hint">⏳ Đang tải danh sách phòng...</p>';

  const { data, error } = await supabase
    .from('cslx_rooms')
    .select('*')
    .order('building_code', { nullsFirst: false })
    .order('room_code');

  if (error) {
    console.error(error);
    toast('Lỗi tải phòng học: ' + error.message);
    if (wrap) wrap.innerHTML = '<p class="hint" style="color:var(--danger)">⚠️ Lỗi tải dữ liệu</p>';
    return;
  }

  state.rooms = data || [];
  renderRooms();
}

export function renderRooms() {
  const wrap = $('#roomsList');
  if (!wrap) return;

  if (!state.roomsSearch) state.roomsSearch = '';
  if (!state.roomsBuildingFilter) state.roomsBuildingFilter = 'all';

  // 1. Populate building filter
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

  // 2. Filter data
  const search = (state.roomsSearch || '').toLowerCase().trim();
  const bFilter = state.roomsBuildingFilter || 'all';

  const filtered = state.rooms.filter(r => {
    if (bFilter !== 'all' && r.building_code !== bFilter) return false;
    if (search) {
      const matchCode = (r.room_code || '').toLowerCase().includes(search);
      const matchName = (r.room_name || '').toLowerCase().includes(search);
      const matchNote = (r.note || '').toLowerCase().includes(search);
      if (!matchCode && !matchName && !matchNote) return false;
    }
    return true;
  });

  if (!filtered.length) {
    wrap.innerHTML = '<p class="hint">Không tìm thấy phòng nào phù hợp.</p>';
    return;
  }

  // 3. Group by building_code
  const grouped = {};
  for (const r of filtered) {
    const b = r.building_code || 'Khác';
    if (!grouped[b]) grouped[b] = [];
    grouped[b].push(r);
  }

  // 4. Render
  let html = '';
  const sortedBuildings = Object.keys(grouped).sort();

  for (const b of sortedBuildings) {
    html += `<div class="building-card" style="margin-bottom:16px; border:1px solid var(--border); border-radius:12px; overflow:hidden; background:#fff; box-shadow:0 1px 4px rgba(0,0,0,0.04);">`;
    
    // Header
    html += `<div class="building-header" style="padding: 10px 14px; background:var(--ocean-50); border-bottom: 1px solid var(--border); display:flex; justify-content:space-between; align-items:center;">`;
    html += `<div class="building-header-left"><span class="building-name" style="color:var(--ocean-700); font-size:15px; font-weight:700;">🏢 Toà ${b}</span></div>`;
    html += `<div class="building-header-right"><span style="background:#fff; border:1px solid var(--ocean-200); padding:2px 10px; border-radius:12px; font-size:12px; font-weight:600; color:var(--ocean-600);">${grouped[b].length} phòng</span></div>`;
    html += `</div>`;

    // Body
    html += `<div class="building-body" style="padding: 0;">`;
    for (const r of grouped[b]) {
      html += `
        <div class="room-row" style="padding: 12px 14px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;">
          <div style="flex: 1; min-width: 0;">
            <div style="font-weight: 700; font-size: 14px; color: var(--text);">${r.room_code}</div>
            ${r.room_name ? `<div style="font-size: 13px; color: var(--ocean-700); font-weight:500; margin-top: 2px;">${r.room_name}</div>` : ''}
            ${r.note ? `<div style="font-size: 12px; color: #d97706; margin-top: 4px; background:#fef3c7; padding:2px 6px; border-radius:4px; display:inline-block;">📝 ${r.note}</div>` : ''}
          </div>
          <div style="text-align: right; flex-shrink: 0;">
            ${r.capacity ? `<div style="font-size: 13px; font-weight: 600; color: var(--success);">👥 ${r.capacity} chỗ</div>` : ''}
            ${r.double_tables ? `<div style="font-size: 11px; color: var(--text-muted); margin-top:2px;">Bàn đôi: ${r.double_tables}</div>` : ''}
            ${r.single_tables ? `<div style="font-size: 11px; color: var(--text-muted);">Bàn đơn: ${r.single_tables}</div>` : ''}
          </div>
        </div>
      `;
    }
    html += `</div></div>`;
  }

  wrap.innerHTML = html;
}