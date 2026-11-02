// salary.js
import { supabase } from './supabase.js';

const ROLE_ORDER = { admin: 1, employee: 2, temporary: 3, external: 4 };

function pad(n) { return String(n).padStart(2, '0'); }

/* Tách tên gọi (chữ cuối): "Lê Văn Anh" → "Anh" */
function getLastName(fullName) {
  if (!fullName) return '';
  const parts = String(fullName).trim().split(/\s+/);
  return parts[parts.length - 1] || '';
}

export function initSalaryModule(ctx) {
  const { state, formatHours, roleLabelOf, toast } = ctx;

  const cache = { year: null, month: null, profiles: null, attendance: null };

  async function loadSalaryForMonth(forceRefresh = false) {
    const y = state.salaryMonth.getFullYear();
    const m = state.salaryMonth.getMonth() + 1;

    const daysInMonth = new Date(y, m, 0).getDate();
    const startDate = `${y}-${pad(m)}-01`;
    const endDate = `${y}-${pad(m)}-${pad(daysInMonth)}`;

    const needFetch = forceRefresh
      || !cache.profiles
      || cache.year !== y
      || cache.month !== m;

    if (needFetch) {
      const $list = document.getElementById('salaryList');
      if ($list) $list.innerHTML = '<p class="hint">Đang tải...</p>';

      state.salaryData = [];
      state.salaryMeta = null;
      const $summary = document.getElementById('salarySummary');
      if ($summary) $summary.innerHTML = '';
      const $total = document.getElementById('salaryTotal');
      if ($total) $total.innerHTML = '';

      const [profRes, attRes] = await Promise.all([
        supabase.from('profiles').select('*').order('full_name'),
        supabase.from('attendance')
          .select('employee_id, date, total_hours, ot_hours, is_off, areas, ot_areas')
          .gte('date', startDate).lte('date', endDate),
      ]);

      if (profRes.error || attRes.error) {
        if ($list) {
          $list.innerHTML = '<p class="hint" style="color:var(--danger)">Lỗi tải dữ liệu: ' +
            (profRes.error?.message || attRes.error?.message) + '</p>';
        }
        return;
      }

      cache.year = y;
      cache.month = m;
      cache.profiles = profRes.data || [];
      cache.attendance = attRes.data || [];
    }

    computeSalary();
    renderSalary();
  }

  function computeSalary() {
    if (!cache.profiles) return;

    const { year, month, profiles, attendance } = cache;
    const daysInMonth = new Date(year, month, 0).getDate();

    // Đếm ngày công chuẩn T2-T7
    let workingDays = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const dow = new Date(year, month - 1, d).getDay();
      if (dow !== 0) workingDays++;
    }
    if (workingDays === 0) workingDays = 1;

    // Map building_id -> name (dùng state.buildings đã load)
    const buildingMap = {};
    for (const b of (state.buildings || [])) buildingMap[b.id] = b.name;

    // Filter role
    const filterVal = state.salaryRoleFilter || 'nv_tv';
    const includeRoles =
      filterVal === 'all' ? ['admin', 'employee', 'temporary', 'external'] :
      filterVal === 'employee' ? ['employee'] :
      filterVal === 'temporary' ? ['temporary'] :
      filterVal === 'external' ? ['external'] :
      ['employee', 'temporary'];

    const search = (state.salarySearch || '').toLowerCase().trim();

    const selected = profiles.filter(p => {
      if (!includeRoles.includes(p.role)) return false;
      if (p.status === 'inactive') return false;
      if (search) {
        const name = (p.full_name || '').toLowerCase();
        const phone = (p.phone || '').toLowerCase();
        const username = (p.username || '').toLowerCase();
        if (!name.includes(search) && !phone.includes(search) && !username.includes(search)) {
          return false;
        }
      }
      return true;
    });

    // Group attendance + đếm building per employee
    const attByEmp = {};
    const buildingCountByEmp = {};  // emp_id -> { building_id: count }

    for (const a of attendance) {
      if (!attByEmp[a.employee_id]) attByEmp[a.employee_id] = { work: 0, ot: 0, days: 0 };

      if (!a.is_off) {
        const h = Number(a.total_hours || 0);
        const ot = Number(a.ot_hours || 0);
        if (h > 0 || ot > 0) {
          attByEmp[a.employee_id].work += h;
          attByEmp[a.employee_id].ot += ot;
          attByEmp[a.employee_id].days += 1;
        }
      }

      // Đếm building (1 ngày tính 1 lần cho mỗi toà)
      if (!buildingCountByEmp[a.employee_id]) buildingCountByEmp[a.employee_id] = {};
      const buildingsSeen = new Set();
      if (Array.isArray(a.areas)) {
        for (const area of a.areas) {
          if (area.building_id) buildingsSeen.add(area.building_id);
        }
      }
      if (Array.isArray(a.ot_areas)) {
        for (const area of a.ot_areas) {
          if (area.building_id) buildingsSeen.add(area.building_id);
        }
      }
      for (const bid of buildingsSeen) {
        buildingCountByEmp[a.employee_id][bid] =
          (buildingCountByEmp[a.employee_id][bid] || 0) + 1;
      }
    }

    // Build result
    const result = selected.map(p => {
      const att = attByEmp[p.id] || { work: 0, ot: 0, days: 0 };
      const totalHours = att.work + att.ot;

      // Tìm building chính (nhiều ngày nhất)
      let primaryBuildingName = '—';
      let primaryBuildingId = null;
      let maxCount = 0;
      const bmap = buildingCountByEmp[p.id] || {};
      for (const [bid, cnt] of Object.entries(bmap)) {
        if (cnt > maxCount) {
          maxCount = cnt;
          primaryBuildingId = bid;
          primaryBuildingName = buildingMap[bid] || '—';
        }
      }

      return {
        id: p.id,
        name: p.full_name || p.username || '',
        lastName: getLastName(p.full_name || p.username || ''),
        role: p.role,
        roleLabel: roleLabelOf(p),
        phone: p.phone || '',
        days: att.days,
        workHours: att.work,
        otHours: att.ot,
        totalHours,
        primaryBuildingId,
        primaryBuildingName,
      };
    });

    // Sort
    const sortVal = state.salarySort || 'hours_desc';
    result.sort((a, b) => {
      if (sortVal === 'hours_desc') {
        if (b.totalHours !== a.totalHours) return b.totalHours - a.totalHours;
        return a.name.localeCompare(b.name, 'vi');
      }
      if (sortVal === 'hours_asc') {
        if (a.totalHours !== b.totalHours) return a.totalHours - b.totalHours;
        return a.name.localeCompare(b.name, 'vi');
      }
      if (sortVal === 'name') {
        // Theo tên gọi (chữ cuối)
        if (a.lastName && b.lastName) {
          const cmp = a.lastName.localeCompare(b.lastName, 'vi');
          if (cmp !== 0) return cmp;
        }
        return a.name.localeCompare(b.name, 'vi');
      }
      if (sortVal === 'position') {
        // Theo vị trí (toà) → cùng toà thì theo tên
        const ba = a.primaryBuildingName || '';
        const bb = b.primaryBuildingName || '';
        const cmpb = ba.localeCompare(bb, 'vi');
        if (cmpb !== 0) return cmpb;
        return a.lastName.localeCompare(b.lastName, 'vi') || a.name.localeCompare(b.name, 'vi');
      }
      return 0;
    });

    state.salaryData = result;
    state.salaryMeta = { year, month, workingDays };
  }

  function renderSalary() {
    const meta = state.salaryMeta || {};
    const data = state.salaryData || [];

    // Tổng
    let totalWork = 0, totalOT = 0;
    for (const e of data) {
      totalWork += e.workHours;
      totalOT += e.otHours;
    }
    const totalHoursAll = totalWork + totalOT;

    // Summary: ngày công chuẩn + tổng giờ
    const $summary = document.getElementById('salarySummary');
    if ($summary) {
      $summary.innerHTML = `
        <div class="salary-meta">
          <div class="salary-meta-item">
            <span class="label">Ngày công chuẩn</span>
            <span class="value">${meta.workingDays || 0} ngày</span>
          </div>
          <div class="salary-meta-item">
            <span class="label">Tổng công</span>
            <span class="value">${formatHours(totalWork)}</span>
          </div>
          <div class="salary-meta-item">
            <span class="label">Tổng OT</span>
            <span class="value">${formatHours(totalOT)}</span>
          </div>
        </div>
      `;
    }

    // List
    const $list = document.getElementById('salaryList');
    if ($list) {
      if (!data.length) {
        const search = state.salarySearch || '';
        $list.innerHTML = `<p class="hint">Không có nhân viên nào${search ? ' khớp "' + search + '"' : ' trong nhóm đã chọn'}</p>`;
      } else {
        $list.innerHTML = data.map(e => `
          <div class="salary-card">
            <div class="salary-card-head">
              <div class="avatar">${(e.name || '?').charAt(0).toUpperCase()}</div>
              <div class="salary-card-info">
                <div class="name">${e.name}</div>
                <div class="role">${e.roleLabel}${e.primaryBuildingName && e.primaryBuildingName !== '—' ? ' · ' + e.primaryBuildingName : ''}${e.phone ? ' · ' + e.phone : ''}</div>
              </div>
              <div class="salary-hours">
                ${formatHours(e.totalHours)}
                <small>${e.days} ngày</small>
              </div>
            </div>
            <div class="salary-card-detail">
              ${formatHours(e.workHours)} công + ${formatHours(e.otHours)} OT
            </div>
          </div>
        `).join('');
      }
    }

    // Total
    const $total = document.getElementById('salaryTotal');
    if ($total) {
      $total.innerHTML = `
        <div class="salary-total-box">
          <span>TỔNG CỘNG (${data.length} người)</span>
          <strong>${formatHours(totalHoursAll)}</strong>
        </div>
      `;
    }
  }

  function onMonthChanged() {
    const val = document.getElementById('salaryMonth').value;
    if (!val) return;
    const [y, m] = val.split('-').map(Number);
    state.salaryMonth = new Date(y, m - 1, 1);
    cache.year = null;
    cache.month = null;
    loadSalaryForMonth(true);
  }

  function onRoleFilterChanged() {
    state.salaryRoleFilter = document.getElementById('salaryRoleFilter').value;
    if (!cache.profiles) { loadSalaryForMonth(true); return; }
    computeSalary();
    renderSalary();
  }

  function onSearchChanged() {
    state.salarySearch = document.getElementById('salarySearch').value;
    if (!cache.profiles) { loadSalaryForMonth(true); return; }
    computeSalary();
    renderSalary();
  }

  function onSortChanged() {
    state.salarySort = document.getElementById('salarySort').value;
    if (!cache.profiles) { loadSalaryForMonth(true); return; }
    computeSalary();
    renderSalary();
  }

  return {
    loadSalaryForMonth,
    renderSalary,
    onMonthChanged,
    onRoleFilterChanged,
    onSearchChanged,
    onSortChanged,
  };
}