// salary.js
import { supabase } from './supabase.js';

const BASE_SALARY = 4800000;   // 4,800,000 VNĐ
const HOURS_PER_DAY = 8;
const ROLE_ORDER = { admin: 1, employee: 2, temporary: 3 };

function pad(n) { return String(n).padStart(2, '0'); }

export function initSalaryModule(ctx) {
  const { state, formatHours, formatVND, roleLabelOf, toast } = ctx;

  const cache = { year: null, month: null, profiles: null, attendance: null };

  /* ============ LOAD DATA TỪ SUPABASE ============ */
  async function loadSalaryForMonth() {
    const y = state.salaryMonth.getFullYear();
    const m = state.salaryMonth.getMonth() + 1;

    const daysInMonth = new Date(y, m, 0).getDate();
    const startDate = `${y}-${pad(m)}-01`;
    const endDate = `${y}-${pad(m)}-${pad(daysInMonth)}`;

    const needFetch = !cache.profiles || cache.year !== y || cache.month !== m;

    if (needFetch) {
      const $list = document.getElementById('salaryList');
      if ($list) $list.innerHTML = '<p class="hint">Đang tải...</p>';

      const [profRes, attRes] = await Promise.all([
        supabase.from('profiles').select('*').order('full_name'),
        supabase.from('attendance')
          .select('employee_id, date, total_hours, ot_hours, is_off')
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

    // ⭐ Rebuild data theo filter hiện tại
    computeSalary();
    renderSalary();
  }

  /* ============ TÍNH LƯƠNG — TÁCH RIÊNG ĐỂ REBUILD ============ */
  function computeSalary() {
    if (!cache.profiles) return;

    const { year, month, profiles, attendance } = cache;
    const daysInMonth = new Date(year, month, 0).getDate();

    // Đếm ngày công chuẩn: T2-T7 (loại CN)
    let workingDays = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const dow = new Date(year, month - 1, d).getDay();
      if (dow !== 0) workingDays++;
    }
    if (workingDays === 0) workingDays = 1;

    const dailyRate = BASE_SALARY / workingDays;
    const hourlyRate = dailyRate / HOURS_PER_DAY;

    // ⭐ Filter theo role — CHẠY MỖI LẦN computeSalary
    const filterVal = state.salaryRoleFilter || 'nv_tv';
    const includeRoles =
      filterVal === 'all' ? ['admin', 'employee', 'temporary'] :
      filterVal === 'employee' ? ['employee'] :
      filterVal === 'temporary' ? ['temporary'] :
      ['employee', 'temporary'];

    const selected = profiles.filter(p =>
      includeRoles.includes(p.role) && p.status !== 'inactive'
    );

    // Group attendance theo employee
    const attByEmp = {};
    for (const a of attendance) {
      if (!attByEmp[a.employee_id]) attByEmp[a.employee_id] = { work: 0, ot: 0, days: 0 };
      if (a.is_off) continue;
      const h = Number(a.total_hours || 0);
      const ot = Number(a.ot_hours || 0);
      if (h > 0 || ot > 0) {
        attByEmp[a.employee_id].work += h;
        attByEmp[a.employee_id].ot += ot;
        attByEmp[a.employee_id].days += 1;
      }
    }

    // Build kết quả
    const result = selected.map(p => {
      const att = attByEmp[p.id] || { work: 0, ot: 0, days: 0 };
      const totalHours = att.work + att.ot;
      return {
        id: p.id,
        name: p.full_name || p.username || '',
        role: p.role,
        roleLabel: roleLabelOf(p),
        phone: p.phone || '',
        days: att.days,
        workHours: att.work,
        otHours: att.ot,
        totalHours,
        salary: totalHours * hourlyRate,
      };
    }).sort((a, b) => {
      const oa = ROLE_ORDER[a.role] || 99;
      const ob = ROLE_ORDER[b.role] || 99;
      if (oa !== ob) return oa - ob;
      return a.name.localeCompare(b.name, 'vi');
    });

    state.salaryData = result;
    state.salaryMeta = { year, month, workingDays, dailyRate, hourlyRate };
  }

  /* ============ RENDER UI ============ */
  function renderSalary() {
    const meta = state.salaryMeta || {};
    const data = state.salaryData || [];

    const $summary = document.getElementById('salarySummary');
    if ($summary) {
      $summary.innerHTML = `
        <div class="salary-meta">
          <div class="salary-meta-item">
            <span class="label">Ngày công chuẩn</span>
            <span class="value">${meta.workingDays || 0} ngày</span>
          </div>
          <div class="salary-meta-item">
            <span class="label">Lương/ngày</span>
            <span class="value">${formatVND(meta.dailyRate || 0)}</span>
          </div>
          <div class="salary-meta-item">
            <span class="label">Lương/giờ</span>
            <span class="value">${formatVND(meta.hourlyRate || 0)}</span>
          </div>
        </div>
      `;
    }

    const $list = document.getElementById('salaryList');
    if ($list) {
      if (!data.length) {
        $list.innerHTML = '<p class="hint">Không có nhân viên nào trong nhóm đã chọn</p>';
      } else {
        $list.innerHTML = data.map(e => `
          <div class="salary-card">
            <div class="salary-card-head">
              <div class="avatar">${(e.name || '?').charAt(0).toUpperCase()}</div>
              <div class="salary-card-info">
                <div class="name">${e.name}</div>
                <div class="role">${e.roleLabel}${e.phone ? ' · ' + e.phone : ''}</div>
              </div>
              <div class="salary-amount">${formatVND(e.salary)}</div>
            </div>
            <div class="salary-card-detail">
              ${e.days} ngày · ${formatHours(e.workHours)} công + ${formatHours(e.otHours)} OT = <strong>${formatHours(e.totalHours)}</strong>
            </div>
          </div>
        `).join('');
      }
    }

    const total = data.reduce((s, e) => s + e.salary, 0);
    const $total = document.getElementById('salaryTotal');
    if ($total) {
      $total.innerHTML = `
        <div class="salary-total-box">
          <span>TỔNG CỘNG (${data.length} người)</span>
          <strong>${formatVND(total)}</strong>
        </div>
      `;
    }
  }

  /* ============ ĐỔI THÁNG ============ */
  function onMonthChanged() {
    const val = document.getElementById('salaryMonth').value;
    if (!val) return;
    const [y, m] = val.split('-').map(Number);
    state.salaryMonth = new Date(y, m - 1, 1);
    cache.year = null;   // force refetch
    loadSalaryForMonth();
  }

  /* ============ ĐỔI FILTER ROLE — ⭐ FIX ============ */
  function onRoleFilterChanged() {
    state.salaryRoleFilter = document.getElementById('salaryRoleFilter').value;

    if (!cache.profiles) {
      // Chưa fetch lần nào → load
      loadSalaryForMonth();
      return;
    }

    // ⭐ Rebuild data từ cache + render — KHÔNG cần fetch lại
    computeSalary();
    renderSalary();
  }

  return { loadSalaryForMonth, renderSalary, onMonthChanged, onRoleFilterChanged };
}