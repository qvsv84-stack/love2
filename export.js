// export.js
import { supabase } from './supabase.js';

const ROLE_ORDER = { admin: 1, employee: 2, temporary: 3 };
const ROLE_LABELS = {
  admin: 'Giám sát',
  temporary: 'Thời vụ',
  employee: 'Nhân viên',
};

/* ============ LOCAL HELPERS ============ */
function pad(n) { return String(n).padStart(2, '0'); }
function formatDateVN(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}
function floorLabel(n) { return n === 0 ? 'Trệt' : `Tầng ${n}`; }

/* ============ MAIN ENTRY ============ */
export function initExportModule(ctx) {
  // ctx = { state, toast, openModal, closeModal }
  const { state, toast } = ctx;

  function openExportModal() {
    // Default = tháng hiện tại đang xem
    const y = state.currentMonth.getFullYear();
    const m = state.currentMonth.getMonth() + 1;
    $('#exportMonth').value = `${y}-${pad(m)}`;
    $('#exportRole').value = 'all';
    $('#exportStatus').value = 'all';
    document.querySelector('input[name="exportScope"][value="all"]').checked = true;
    $('#exportOnePersonGroup').style.display = 'none';
    $('#exportError').textContent = '';
    fillEmployeeSelectForExport();
    ctx.openModal('exportModal');
  }

  function fillEmployeeSelectForExport() {
    const sel = $('#exportOnePerson');
    if (!sel) return;
    const sorted = sortByRole(state.employees);
    sel.innerHTML = sorted.map(e => {
      const name = e.full_name || e.username || e.email || 'N/A';
      return `<option value="${e.id}">${name}</option>`;
    }).join('');
  }

  function sortByRole(arr) {
    return [...arr].sort((a, b) => {
      const oa = ROLE_ORDER[a.role] || 99;
      const ob = ROLE_ORDER[b.role] || 99;
      if (oa !== ob) return oa - ob;
      const na = a.full_name || a.username || '';
      const nb = b.full_name || b.username || '';
      return na.localeCompare(nb, 'vi');
    });
  }

  async function doExport() {
    if (typeof XLSX === 'undefined') {
      toast('Chưa tải được thư viện Excel, vui lòng refresh trang');
      return;
    }

    const errEl = $('#exportError');
    errEl.textContent = '';

    // 1. Đọc form
    const monthVal = $('#exportMonth').value;
    const roleFilter = $('#exportRole').value;
    const statusFilter = $('#exportStatus').value;
    const scope = document.querySelector('input[name="exportScope"]:checked')?.value || 'all';

    if (!monthVal) { errEl.textContent = 'Chọn tháng'; return; }

    const [year, month] = monthVal.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    const startDate = `${year}-${pad(month)}-01`;
    const endDate = `${year}-${pad(month)}-${pad(daysInMonth)}`;

    // 2. Query profiles (view public - dùng được cho cả guest)
    const btn = $('#exportSubmitBtn');
    btn.disabled = true; btn.textContent = 'Đang xử lý...';

    const { data: profiles, error: e1 } = await supabase
      .from('profiles_public')
      .select('*')
      .order('full_name');

    if (e1) {
      errEl.textContent = 'Lỗi tải nhân viên: ' + e1.message;
      btn.disabled = false; btn.textContent = 'Xuất file';
      return;
    }

    // 3. Filter
    let selected = (profiles || []).filter(p => {
      if (roleFilter !== 'all' && p.role !== roleFilter) return false;
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      return true;
    });

    if (scope === 'one') {
      const oneId = $('#exportOnePerson').value;
      if (!oneId) {
        errEl.textContent = 'Chọn nhân viên';
        btn.disabled = false; btn.textContent = 'Xuất file';
        return;
      }
      selected = selected.filter(p => p.id === oneId);
    }

    if (!selected.length) {
      errEl.textContent = 'Không có nhân viên nào khớp bộ lọc';
      btn.disabled = false; btn.textContent = 'Xuất file';
      return;
    }

    selected = sortByRole(selected);

    // 4. Query attendance
    const ids = selected.map(p => p.id);
    const { data: attendance, error: e2 } = await supabase
      .from('attendance')
      .select('*')
      .in('employee_id', ids)
      .gte('date', startDate)
      .lte('date', endDate);

    if (e2) {
      errEl.textContent = 'Lỗi tải chấm công: ' + e2.message;
      btn.disabled = false; btn.textContent = 'Xuất file';
      return;
    }

    // 5. Build dữ liệu
    const attByEmpDay = {};  // emp_id -> { day: attRow }
    for (const a of attendance || []) {
      if (!attByEmpDay[a.employee_id]) attByEmpDay[a.employee_id] = {};
      const day = Number(a.date.split('-')[2]);
      attByEmpDay[a.employee_id][day] = a;
    }

    // 6. Sheet 1: Bảng công
    const aoa1 = [];
    aoa1.push(['TRƯỜNG ĐẠI HỌC KHOA HỌC XÃ HỘI VÀ NHÂN VĂN']);
    aoa1.push([`BẢNG CHẤM CÔNG THÁNG ${month}/${year}`]);

    const now = new Date();
    aoa1.push([
      `Xuất lúc: ${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ` +
      `${pad(now.getHours())}:${pad(now.getMinutes())}`
    ]);

    const header1 = ['STT', 'Họ tên', 'Chức vụ', 'SĐT'];
    for (let d = 1; d <= daysInMonth; d++) header1.push(d);
    header1.push('Tổng công', 'Tăng ca');
    aoa1.push(header1);

    let stt = 1;
    for (const emp of selected) {
      const row = [
        stt++,
        emp.full_name || '',
        roleLabelOf(emp),
        emp.phone || '',
      ];
      let totalWork = 0;
      let totalOT = 0;

      for (let d = 1; d <= daysInMonth; d++) {
        const att = attByEmpDay[emp.id]?.[d];
        if (!att) { row.push(''); continue; }
        if (att.is_off) { row.push('O'); continue; }
        const h = Number(att.total_hours || 0);
        row.push(h > 0 ? Number(h.toFixed(2)) : '');
        totalWork += h;
        totalOT += Number(att.ot_hours || 0);
      }

      row.push(Number(totalWork.toFixed(2)));
      row.push(Number(totalOT.toFixed(2)));
      aoa1.push(row);
    }

    // 7. Sheet 2: Chi tiết khu vực
    const aoa2 = [['Ngày', 'Họ tên', 'Tòa nhà', 'Tầng', 'Giờ công', 'Tăng ca']];

    const empMap = {};
    for (const p of profiles || []) empMap[p.id] = p;

    const floorMap = {};
    for (const f of state.floors) floorMap[f.id] = f;

    const buildingMap = {};
    for (const b of state.buildings) buildingMap[b.id] = b;

    // Sort attendance theo ngày tăng dần
    const sortedAtt = [...(attendance || [])].sort((a, b) => a.date.localeCompare(b.date));

    for (const a of sortedAtt) {
      const emp = empMap[a.employee_id];
      if (!emp) continue;

      const dateStr = formatDateVN(a.date);

      // Khu vực chính
      for (const area of (a.areas || [])) {
        if (!area.floor_id) continue;
        const floor = floorMap[area.floor_id];
        const building = buildingMap[area.building_id || floor?.building_id];
        aoa2.push([
          dateStr,
          emp.full_name || '',
          building?.name || '',
          floor ? floorLabel(floor.floor_number) : '?',
          Number(Number(area.hours || 0).toFixed(2)),
          0,
        ]);
      }

      // Khu vực tăng ca
      for (const area of (a.ot_areas || [])) {
        if (!area.floor_id) continue;
        const floor = floorMap[area.floor_id];
        const building = buildingMap[area.building_id || floor?.building_id];
        const h = area.hours != null ? Number(area.hours) : Number(floor?.default_hours || 0);
        aoa2.push([
          dateStr,
          emp.full_name || '',
          building?.name || '',
          floor ? floorLabel(floor.floor_number) : '?',
          0,
          Number(h.toFixed(2)),
        ]);
      }
    }

    // 8. Tạo workbook
    const wb = XLSX.utils.book_new();

    // Sheet 1
    const ws1 = XLSX.utils.aoa_to_sheet(aoa1);
    ws1['!cols'] = [
      { wch: 5 }, { wch: 22 }, { wch: 12 }, { wch: 12 },
      ...Array(daysInMonth).fill({ wch: 4 }),
      { wch: 10 }, { wch: 10 },
    ];
    const lastCol1 = 4 + daysInMonth + 2 - 1;  // 0-indexed cột cuối
    ws1['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: lastCol1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: lastCol1 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: lastCol1 } },
    ];
    XLSX.utils.book_append_sheet(wb, ws1, 'BangCong');

    // Sheet 2
    const ws2 = XLSX.utils.aoa_to_sheet(aoa2);
    ws2['!cols'] = [
      { wch: 12 }, { wch: 22 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
    ];
    XLSX.utils.book_append_sheet(wb, ws2, 'ChiTiet');

    // 9. Filename
    let fn = `BangChamCong_${pad(month)}_${year}`;
    if (roleFilter !== 'all') fn += `_${ROLE_LABELS[roleFilter].replace(/\s/g, '')}`;
    if (statusFilter === 'inactive') fn += '_DaVoHieu';
    if (scope === 'one') {
      const name = selected[0].full_name || selected[0].username || 'NhanVien';
      fn += '_' + name.replace(/\s+/g, '');
    }
    fn += '.xlsx';

    try {
      XLSX.writeFile(wb, fn);
      toast('✅ Đã xuất file: ' + fn);
      ctx.closeModal('exportModal');
    } catch (err) {
      errEl.textContent = 'Lỗi tạo file: ' + err.message;
    }

    btn.disabled = false; btn.textContent = 'Xuất file';
  }

  function roleLabelOf(p) {
    if (!p) return 'Nhân viên';
    if (p.role === 'admin') return ROLE_LABELS.admin;
    if (p.role === 'temporary') return ROLE_LABELS.temporary;
    return p.position || ROLE_LABELS.employee;
  }

  return { openExportModal, doExport, fillEmployeeSelectForExport };
}