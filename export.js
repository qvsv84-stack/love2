// export.js
import { supabase } from './supabase.js';

const ROLE_ORDER = { admin: 1, employee: 2, temporary: 3, external: 4 };
const ROLE_LABELS = {
  admin: 'Giám sát',
  temporary: 'Thời vụ',
  employee: 'Nhân viên',
  external: 'Ngoại cảnh',
};

function pad(n) { return String(n).padStart(2, '0'); }
function formatDateVN(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}
function floorLabel(n) { return n === 0 ? 'Trệt' : `Tầng ${n}`; }

export function initExportModule(ctx) {
  const { state, toast } = ctx;

  let cachedData = null;
  let isLoading = false;

  /* ---------- MỞ MODAL ---------- */
  async function openExportModal() {
    const y = state.currentMonth.getFullYear();
    const m = state.currentMonth.getMonth() + 1;

    $('#exportMonth').value = `${y}-${pad(m)}`;
    $('#exportRole').value = 'all';
    $('#exportStatus').value = 'all';
    const allRadio = document.querySelector('input[name="exportScope"][value="all"]');
    if (allRadio) allRadio.checked = true;
    $('#exportOnePersonGroup').style.display = 'none';
    $('#exportError').textContent = '';
    fillEmployeeSelectForExport();

    cachedData = null;
    ctx.openModal('exportModal');

    await loadMonthData(y, m);
  }

  async function loadMonthData(year, month) {
    if (isLoading) return;
    isLoading = true;

    const btn = $('#exportSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Đang tải dữ liệu...';

    const daysInMonth = new Date(year, month, 0).getDate();
    const startDate = `${year}-${pad(month)}-01`;
    const endDate = `${year}-${pad(month)}-${pad(daysInMonth)}`;

    try {
      const [profRes, attRes] = await Promise.all([
        supabase.from('profiles_public').select('*').order('full_name'),
        supabase.from('attendance').select('*').gte('date', startDate).lte('date', endDate),
      ]);

      if (profRes.error) throw profRes.error;
      if (attRes.error) throw attRes.error;

      cachedData = {
        year, month, daysInMonth,
        profiles: profRes.data || [],
        attendance: attRes.data || [],
      };

      btn.textContent = '📥 Tải file';
      btn.disabled = false;
      $('#exportError').textContent = '';
    } catch (err) {
      $('#exportError').textContent = 'Lỗi tải dữ liệu: ' + err.message;
      btn.textContent = 'Thử lại';
      btn.disabled = false;
    } finally {
      isLoading = false;
    }
  }

  async function onMonthChanged() {
    const val = $('#exportMonth').value;
    if (!val) return;
    const [y, m] = val.split('-').map(Number);
    cachedData = null;
    await loadMonthData(y, m);
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

  function roleLabelOf(p) {
    if (!p) return 'Nhân viên';
    if (p.role === 'admin') return ROLE_LABELS.admin;
    if (p.role === 'temporary') return ROLE_LABELS.temporary;
    if (p.role === 'external') return ROLE_LABELS.external;
    return p.position || ROLE_LABELS.employee;
  }

  /* ---------- XUẤT CHẤM CÔNG ---------- */
  function doExport() {
    if (typeof XLSX === 'undefined') {
      toast('Chưa tải được thư viện Excel, vui lòng refresh trang');
      return;
    }

    if (!cachedData) {
      toast('Vui lòng chờ dữ liệu tải xong');
      return;
    }

    const errEl = $('#exportError');
    errEl.textContent = '';

    const roleFilter = $('#exportRole').value;
    const statusFilter = $('#exportStatus').value;
    const scope = document.querySelector('input[name="exportScope"]:checked')?.value || 'all';

    const { year, month, daysInMonth, profiles, attendance } = cachedData;

    let selected = (profiles || []).filter(p => {
      if (roleFilter !== 'all' && p.role !== roleFilter) return false;
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      return true;
    });

    if (scope === 'one') {
      const oneId = $('#exportOnePerson').value;
      if (!oneId) { errEl.textContent = 'Chọn nhân viên'; return; }
      selected = selected.filter(p => p.id === oneId);
    }

    if (!selected.length) {
      errEl.textContent = 'Không có nhân viên nào khớp bộ lọc';
      return;
    }

    selected = sortByRole(selected);
    const selectedIds = new Set(selected.map(p => p.id));
    const attFiltered = (attendance || []).filter(a => selectedIds.has(a.employee_id));

    const attByEmpDay = {};
    for (const a of attFiltered) {
      if (!attByEmpDay[a.employee_id]) attByEmpDay[a.employee_id] = {};
      const day = Number(a.date.split('-')[2]);
      attByEmpDay[a.employee_id][day] = a;
    }

    // SHEET 1 — Bảng công
    const aoa1 = [];
    aoa1.push(['TRƯỜNG ĐẠI HỌC KHOA HỌC XÃ HỘI VÀ NHÂN VĂN']);
    aoa1.push([`BẢNG CHẤM CÔNG THÁNG ${month}/${year}`]);

    const now = new Date();
    aoa1.push([
      `Xuất lúc: ${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ` +
      `${pad(now.getHours())}:${pad(now.getMinutes())}`
    ]);
    aoa1.push(['Ghi chú: số = giờ công | O = nghỉ (OFF) | P = phép (không tính công)']);

    const header1 = ['STT', 'Họ tên', 'Chức vụ', 'SĐT'];
    for (let d = 1; d <= daysInMonth; d++) header1.push(d);
    header1.push('Ngày công', 'Phép', 'Tổng công', 'Tăng ca');
    aoa1.push(header1);

    let stt = 1;
    for (const emp of selected) {
      const row = [stt++, emp.full_name || '', roleLabelOf(emp), emp.phone || ''];
      let totalWork = 0;
      let totalOT = 0;
      let workDays = 0;
      let leaveDays = 0;

      for (let d = 1; d <= daysInMonth; d++) {
        const att = attByEmpDay[emp.id]?.[d];
        if (!att) { row.push(''); continue; }

        if (att.mode === 'leave') {
          row.push('P');
          leaveDays += 1;
          continue;
        }
        if (att.is_off) {
          row.push('O');
          continue;
        }

        const h = Number(att.total_hours || 0);
        const ot = Number(att.ot_hours || 0);
        row.push(h > 0 ? Number(h.toFixed(2)) : '');
        if (h > 0 || ot > 0) workDays += 1;
        totalWork += h;
        totalOT += ot;
      }

      row.push(workDays);
      row.push(leaveDays);
      row.push(Number(totalWork.toFixed(2)));
      row.push(Number(totalOT.toFixed(2)));
      aoa1.push(row);
    }

    // SHEET 2 — Chi tiết khu vực
    const aoa2 = [['Ngày', 'Họ tên', 'Tòa nhà', 'Tầng', 'Giờ công', 'Tăng ca']];

    const empMap = {};
    for (const p of profiles || []) empMap[p.id] = p;

    const floorMap = {};
    for (const f of state.floors) floorMap[f.id] = f;

    const buildingMap = {};
    for (const b of state.buildings) buildingMap[b.id] = b;

    const sortedAtt = [...attFiltered].sort((a, b) => a.date.localeCompare(b.date));

    for (const a of sortedAtt) {
      const emp = empMap[a.employee_id];
      if (!emp) continue;
      const dateStr = formatDateVN(a.date);

      // Bỏ qua ngày Phép + OFF trong sheet 2
      if (a.mode === 'leave') continue;
      if (a.is_off) continue;

      for (const area of (a.areas || [])) {
        if (!area.floor_id) continue;
        const floor = floorMap[area.floor_id];
        const building = buildingMap[area.building_id || floor?.building_id];
        aoa2.push([
          dateStr, emp.full_name || '', building?.name || '',
          floor ? floorLabel(floor.floor_number) : '?',
          Number(Number(area.hours || 0).toFixed(2)), 0,
        ]);
      }

      for (const area of (a.ot_areas || [])) {
        if (!area.floor_id) continue;
        const floor = floorMap[area.floor_id];
        const building = buildingMap[area.building_id || floor?.building_id];
        const h = area.hours != null ? Number(area.hours) : Number(floor?.default_hours || 0);
        aoa2.push([
          dateStr, emp.full_name || '', building?.name || '',
          floor ? floorLabel(floor.floor_number) : '?',
          0, Number(h.toFixed(2)),
        ]);
      }
    }

    const wb = XLSX.utils.book_new();

    const ws1 = XLSX.utils.aoa_to_sheet(aoa1);
    ws1['!cols'] = [
      { wch: 5 }, { wch: 22 }, { wch: 12 }, { wch: 12 },
      ...Array(daysInMonth).fill({ wch: 4 }),
      { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 10 },
    ];
    const lastCol1 = 4 + daysInMonth + 4 - 1;
    ws1['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: lastCol1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: lastCol1 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: lastCol1 } },
      { s: { r: 3, c: 0 }, e: { r: 3, c: lastCol1 } },
    ];
    XLSX.utils.book_append_sheet(wb, ws1, 'BangCong');

    const ws2 = XLSX.utils.aoa_to_sheet(aoa2);
    ws2['!cols'] = [
      { wch: 12 }, { wch: 22 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
    ];
    XLSX.utils.book_append_sheet(wb, ws2, 'ChiTiet');

    let fn = `BangChamCong_${pad(month)}_${year}`;
    if (roleFilter !== 'all') fn += `_${ROLE_LABELS[roleFilter].replace(/\s/g, '')}`;
    if (statusFilter === 'inactive') fn += '_DaVoHieu';
    if (scope === 'one') {
      const name = selected[0].full_name || selected[0].username || 'NhanVien';
      fn += '_' + name.replace(/\s+/g, '');
    }
    fn += '.xlsx';

    try {
      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      const blob = new Blob([wbout], { type: mimeType });

      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

      if (isIOS) {
        const file = new File([blob], fn, { type: mimeType });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({
            files: [file],
            title: 'Bảng chấm công',
            text: fn,
          }).then(() => {
            toast('✅ Đã chia sẻ file');
            closeAfterSuccess();
          }).catch((shareErr) => {
            if (shareErr.name === 'AbortError') return;
            downloadBlob(blob, fn);
            toast('✅ Đã tải file: ' + fn);
            closeAfterSuccess();
          });
          return;
        }
        downloadBlob(blob, fn);
        toast('✅ Đã tải file: ' + fn);
        closeAfterSuccess();
        return;
      }

      downloadBlob(blob, fn);
      toast('✅ Đã tải file: ' + fn);
      closeAfterSuccess();
    } catch (err) {
      errEl.textContent = 'Lỗi tạo file: ' + err.message;
    }
  }

  /* ---------- XUẤT BẢNG CÔNG (theo giờ) ---------- */
  function doExportSalary() {
    if (typeof XLSX === 'undefined') {
      toast('Chưa tải được thư viện Excel');
      return;
    }
    const data = state.salaryData || [];
    const meta = state.salaryMeta || {};
    if (!data.length || !meta.month) {
      toast('Chưa có dữ liệu, vui lòng chờ tải xong');
      return;
    }

    // Tổng
    let totalWork = 0, totalOT = 0, totalWorkDays = 0, totalLeaveDays = 0;
    for (const e of data) {
      totalWork += e.workHours;
      totalOT += e.otHours;
      totalWorkDays += e.workDays;
      totalLeaveDays += e.leaveDays || 0;
    }
    const totalHours = totalWork + totalOT;

    const aoa = [];
    aoa.push(['TRƯỜNG ĐẠI HỌC KHOA HỌC XÃ HỘI VÀ NHÂN VĂN']);
    aoa.push([`BẢNG TỔNG HỢP CÔNG THÁNG ${meta.month}/${meta.year}`]);
    aoa.push([`Ngày công chuẩn: ${meta.workingDays} ngày (T2 - T7, nghỉ Chủ nhật)`]);

    const now = new Date();
    aoa.push([
      `Xuất lúc: ${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ` +
      `${pad(now.getHours())}:${pad(now.getMinutes())}`
    ]);
    aoa.push(['Ghi chú: Ngày phép không tính vào giờ công, chỉ ghi nhận để theo dõi.']);
    aoa.push([]);
    aoa.push(['STT', 'Họ tên', 'Chức vụ', 'SĐT', 'Vị trí (toà)', 'Ngày công', 'Ngày phép', 'Giờ công', 'Giờ OT', 'Tổng giờ']);

    data.forEach((e, idx) => {
      aoa.push([
        idx + 1,
        e.name,
        e.roleLabel,
        e.phone || '',
        (e.primaryBuildingName && e.primaryBuildingName !== '—') ? e.primaryBuildingName : '',
        e.workDays,
        e.leaveDays || 0,
        Number(e.workHours.toFixed(2)),
        Number(e.otHours.toFixed(2)),
        Number(e.totalHours.toFixed(2)),
      ]);
    });

    aoa.push([]);
    aoa.push([
      '', '', '', '', 'TỔNG CỘNG',
      totalWorkDays,
      totalLeaveDays,
      Number(totalWork.toFixed(2)),
      Number(totalOT.toFixed(2)),
      Number(totalHours.toFixed(2)),
    ]);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [
      { wch: 5 }, { wch: 22 }, { wch: 12 }, { wch: 14 },
      { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
    ];
    const lastCol = 9;
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: lastCol } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: lastCol } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: lastCol } },
      { s: { r: 3, c: 0 }, e: { r: 3, c: lastCol } },
      { s: { r: 4, c: 0 }, e: { r: 4, c: lastCol } },
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'TongCong');

    const fn = `BangTongCong_${pad(meta.month)}_${meta.year}.xlsx`;

    try {
      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      const blob = new Blob([wbout], { type: mimeType });

      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

      if (isIOS) {
        const file = new File([blob], fn, { type: mimeType });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: 'Bảng tổng công', text: fn })
            .then(() => toast('✅ Đã chia sẻ file'))
            .catch((err) => {
              if (err.name === 'AbortError') return;
              downloadBlob(blob, fn);
              toast('✅ Đã tải file: ' + fn);
            });
          return;
        }
        downloadBlob(blob, fn);
        toast('✅ Đã tải file: ' + fn);
        return;
      }

      downloadBlob(blob, fn);
      toast('✅ Đã tải file: ' + fn);
    } catch (err) {
      toast('Lỗi tạo file: ' + err.message);
    }
  }

  function closeAfterSuccess() {
    setTimeout(() => ctx.closeModal('exportModal'), 300);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  return {
    openExportModal,
    doExport,
    doExportSalary,
    onMonthChanged,
    fillEmployeeSelectForExport,
  };
}