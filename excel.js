// excel.js — Bảng công matrix, PNG capture, bulk copy
import { supabase } from './supabase.js';
import {
  state, $, $$, toast, pad, toDateStr, formatDateVN, formatHours,
  sortEmployees, openModal, closeModal, loadHtml2Canvas,
} from './core.js';

/* ============ LOAD EXCEL DATA ============ */
export async function loadExcelData() {
  const y = state.excelMonth.getFullYear();
  const m = state.excelMonth.getMonth() + 1;
  const daysInMonth = new Date(y, m, 0).getDate();
  const startDate = `${y}-${pad(m)}-01`;
  const endDate = `${y}-${pad(m)}-${pad(daysInMonth)}`;

  const $loading = $('#excelLoading');
  const $content = $('#excelContent');
  if ($loading) { $loading.style.display = 'block'; $loading.textContent = 'Đang tải...'; }
  if ($content) $content.style.display = 'none';

  const [profRes, attRes] = await Promise.all([
    supabase.from('profiles').select('*').order('full_name'),
    supabase.from('attendance').select('*')
      .gte('date', startDate).lte('date', endDate),
  ]);

  if (profRes.error || attRes.error) {
    if ($loading) $loading.textContent = 'Lỗi tải dữ liệu: ' +
      (profRes.error?.message || attRes.error?.message);
    return;
  }

  state.excelProfiles = sortEmployees((profRes.data || []).filter(p => p.status !== 'inactive'));
  state.excelAttendance = attRes.data || [];

  if ($loading) $loading.style.display = 'none';
  if ($content) $content.style.display = 'block';

  renderExcelBlocks(y, m, daysInMonth);
}

/* ============ BUILD MAP ============ */
function buildAttMap() {
  const map = {};
  for (const a of state.excelAttendance) {
    if (!map[a.employee_id]) map[a.employee_id] = {};
    const day = Number(a.date.split('-')[2]);
    map[a.employee_id][day] = a;
  }
  return map;
}

/* ============ CELL DATA ============ */
function getCellData(att) {
  if (!att) return { nc: '', ot: '', ncCls: 'val-empty', otCls: 'val-empty' };
  if (att.mode === 'leave') return { nc: 'P', ot: '', ncCls: 'val-leave', otCls: 'val-empty' };
  if (att.is_off) return { nc: 'O', ot: '', ncCls: 'val-off', otCls: 'val-empty' };

  const th = Number(att.total_hours || 0);
  const oh = Number(att.ot_hours || 0);
  let ncVal = '', otVal = '';
  if (th > 0) {
    const days = th / 8;
    ncVal = Number.isInteger(days) ? String(days) : days.toFixed(2).replace(/\.?0+$/, '');
  }
  if (oh > 0) {
    otVal = Number.isInteger(oh) ? String(oh) : oh.toFixed(2).replace(/\.?0+$/, '');
  }
  return { nc: ncVal, ot: otVal, ncCls: ncVal ? '' : 'val-empty', otCls: otVal ? '' : 'val-empty' };
}

/* ============ MATRIX BLOCK ============ */
function renderMatrixBlock(y, m, fromDay, toDay, attMap) {
  const todayStr = toDateStr(new Date());
  const todayPrefix = `${y}-${pad(m)}`;
  const todayDay = todayStr.startsWith(todayPrefix) ? Number(todayStr.split('-')[2]) : -1;

  let html = '<table class="excel-matrix"><thead><tr>';
  html += '<th class="th-name">Nhân viên</th>';
  for (let d = fromDay; d <= toDay; d++) {
    const dow = new Date(y, m - 1, d).getDay();
    const clsArr = [];
    if (dow === 0) clsArr.push('th-sunday');
    if (d === todayDay) clsArr.push('th-today');
    html += `<th class="${clsArr.join(' ')}">${d}</th>`;
  }
  html += '</tr></thead><tbody>';

  for (const emp of state.excelProfiles) {
    const empAtt = attMap[emp.id] || {};
    const name = emp.full_name || emp.username || '';
    const safeName = name.replace(/"/g, '&quot;');

    let rowNC = '<tr class="row-nc">';
    let rowOT = '<tr class="row-ot">';

    rowNC += `<td rowspan="2" class="td-name" data-emp="${emp.id}" title="${safeName} — Tap để lưu/chia sẻ">${name}</td>`;

    for (let d = fromDay; d <= toDay; d++) {
      const att = empAtt[d];
      const dow = new Date(y, m - 1, d).getDay();
      const cls = dow === 0 ? 'td-sunday' : '';
      const cell = getCellData(att);

      rowNC += `<td class="${cls} ${cell.ncCls}">${cell.nc}</td>`;
      rowOT += `<td class="${cls} ${cell.otCls}">${cell.ot}</td>`;
    }

    rowNC += '</tr>';
    rowOT += '</tr>';
    html += rowNC + rowOT;
  }
  html += '</tbody></table>';
  return html;
}

/* ============ RENDER BLOCKS ============ */
export function renderExcelBlocks(y, m, daysInMonth) {
  const attMap = buildAttMap();

  const block1 = $('#excelBlock1');
  const block2 = $('#excelBlock2');

  const mid = 15;
  if (block1) {
    block1.innerHTML = renderMatrixBlock(y, m, 1, Math.min(mid, daysInMonth), attMap);
  }
  if (block2) {
    if (daysInMonth > mid) {
      block2.innerHTML = renderMatrixBlock(y, m, mid + 1, daysInMonth, attMap);
      block2.style.display = 'block';
      const part2Label = block2.previousElementSibling;
      if (part2Label && part2Label.classList.contains('excel-part-label')) {
        part2Label.style.display = 'inline-block';
      }
    } else {
      block2.innerHTML = '';
      block2.style.display = 'none';
      const part2Label = block2.previousElementSibling;
      if (part2Label && part2Label.classList.contains('excel-part-label')) {
        part2Label.style.display = 'none';
      }
    }
  }

  $$('[data-emp]').forEach(el => {
    el.addEventListener('click', () => {
      openExcelActionModal(el.dataset.emp);
    });
  });
}

/* ============ MONTH CHANGE ============ */
export function onExcelMonthChanged() {
  const val = $('#excelMonth').value;
  if (!val) return;
  const [y, m] = val.split('-').map(Number);
  state.excelMonth = new Date(y, m - 1, 1);
  loadExcelData();
}

/* ============ ACTION MODAL ============ */
export function openExcelActionModal(empId) {
  const emp = state.excelProfiles.find(e => e.id === empId);
  if (!emp) return;
  state.excelActionEmpId = empId;
  const el = $('#excelActionName');
  if (el) el.textContent = emp.full_name || emp.username || '—';
  openModal('excelActionModal');
}

/* ============ CAPTURE TABLE HTML ============ */
function buildCaptureTableHTML(profiles, attMap, year, month, daysInMonth, title, opts = {}) {
  const hideNameColumn = !!opts.hideNameColumn;

  let html = '';

  if (title) {
    html += `<div class="excel-capture-title">${title}</div>`;
    html += `<div class="excel-capture-subtitle">BẢNG CÔNG THÁNG ${month}/${year}</div>`;
  }

  html += '<table class="excel-capture-table"><thead><tr>';
  if (!hideNameColumn) {
    html += '<th class="th-name">Nhân viên</th>';
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month - 1, d).getDay();
    const cls = dow === 0 ? 'th-sunday' : '';
    html += `<th class="${cls}">${d}</th>`;
  }
  html += '</tr></thead><tbody>';

  for (const emp of profiles) {
    const empAtt = attMap[emp.id] || {};
    const name = emp.full_name || emp.username || '';

    let rowNC = '<tr class="row-nc">';
    let rowOT = '<tr class="row-ot">';

    if (!hideNameColumn) {
      rowNC += `<td rowspan="2" class="td-name">${name}</td>`;
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const att = empAtt[d];
      const dow = new Date(year, month - 1, d).getDay();
      const cls = dow === 0 ? 'td-sunday' : '';
      const cell = getCellData(att);

      rowNC += `<td class="${cls} ${cell.ncCls}">${cell.nc}</td>`;
      rowOT += `<td class="${cls} ${cell.otCls}">${cell.ot}</td>`;
    }

    rowNC += '</tr>';
    rowOT += '</tr>';
    html += rowNC + rowOT;
  }

  html += '</tbody></table>';
  return html;
}

/* ============ CAPTURE PNG (nhận opts) ============ */
async function captureExcelPNG(profilesToCapture, title, filename, opts = {}) {
  try {
    await loadHtml2Canvas();
  } catch {
    toast('Không tải được thư viện ảnh');
    return null;
  }

  const monthDate = opts.monthDate || state.excelMonth;
  const y = monthDate.getFullYear();
  const m = monthDate.getMonth() + 1;
  const daysInMonth = new Date(y, m, 0).getDate();

  const attMap = opts.attMap || buildAttMap();

  const captureArea = $('#excelCaptureArea');
  if (!captureArea) return null;

  const tableHTML = buildCaptureTableHTML(
    profilesToCapture, attMap, y, m, daysInMonth, title,
    { hideNameColumn: opts.hideNameColumn }
  );
  captureArea.innerHTML = `
    <div style="display:inline-block;background:white;padding:0;">
      ${tableHTML}
      <div style="text-align:center;padding:10px;font-size:11px;color:#5c7c82;font-family:'Be Vietnam Pro',sans-serif;border-top:1px solid #d4eef2;">
        Xuất lúc ${pad(new Date().getDate())}/${pad(new Date().getMonth() + 1)}/${new Date().getFullYear()} ${pad(new Date().getHours())}:${pad(new Date().getMinutes())}
        · NC = Ngày công (8h) · OT = Tăng ca
      </div>
    </div>
  `;

  await new Promise(r => setTimeout(r, 100));

  try {
    const target = captureArea.firstElementChild;
    const canvas = await window.html2canvas(target, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      logging: false,
    });

    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        if (!blob) { resolve(null); return; }
        resolve({ blob, filename });
      }, 'image/png', 0.95);
    });
  } catch (err) {
    console.error(err);
    toast('Lỗi render ảnh: ' + err.message);
    return null;
  }
}

/* ═══════════════════════════════════════════════════════════════
   ⭐ MỚI: Xuất 1 NV từ tab Lịch công — dùng chung logic
   ═══════════════════════════════════════════════════════════════ */
export async function exportMonthPNGForEmployee(empId, monthDate) {
  if (!state.isAdmin) { toast('Chỉ admin được xuất'); return; }
  if (!empId) { toast('Chọn nhân viên trước'); return; }

  const emp = state.employees.find(e => e.id === empId);
  if (!emp) { toast('Không tìm thấy nhân viên'); return; }

  const targetMonth = monthDate || state.currentMonth;
  const y = targetMonth.getFullYear();
  const m = targetMonth.getMonth() + 1;
  const daysInMonth = new Date(y, m, 0).getDate();
  const start = `${y}-${pad(m)}-01`;
  const end = `${y}-${pad(m)}-${pad(daysInMonth)}`;

  // Ưu tiên dùng state.attendance nếu đúng NV + đúng tháng (tránh fetch lại)
  let attList = null;
  if (state.selectedEmployeeId === empId &&
      state.currentMonth.getFullYear() === y &&
      state.currentMonth.getMonth() === m - 1 &&
      Array.isArray(state.attendance) && state.attendance.length > 0) {
    attList = state.attendance;
  }

  if (!attList) {
    const { data, error } = await supabase
      .from('attendance').select('*')
      .eq('employee_id', empId)
      .gte('date', start).lte('date', end);
    if (error) { toast('Lỗi: ' + error.message); return; }
    attList = data || [];
  }

  // Build attMap cho riêng NV này
  const attMap = { [empId]: {} };
  for (const a of attList) {
    if (!a.date.startsWith(`${y}-${pad(m)}`)) continue;
    const day = Number(a.date.split('-')[2]);
    attMap[empId][day] = a;
  }

  const name = emp.full_name || emp.username || 'NhanVien';
  const safeName = name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_ÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠƯẠ-ỹ]/g, '');
  const filename = `BangCong_${safeName}_${pad(m)}_${y}.png`;

  toast('⏳ Đang tạo ảnh...');

  const result = await captureExcelPNG(
    [emp],
    name,
    filename,
    {
      hideNameColumn: true,   // ⭐ ẩn cột tên — chỉ giữ title ở trên
      attMap,
      monthDate: targetMonth,
    }
  );
  if (!result) return;

  downloadBlob(result.blob, result.filename);
  toast('📷 Đã lưu ảnh: ' + result.filename);
}

/* ============ SAVE / SHARE ONE ============ */
export async function saveExcelOne() {
  const empId = state.excelActionEmpId;
  if (!empId) return;
  const emp = state.excelProfiles.find(e => e.id === empId);
  if (!emp) return;

  closeModal('excelActionModal');
  toast('⏳ Đang tạo ảnh...');

  const name = emp.full_name || emp.username || 'NhanVien';
  const safeName = name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_ÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠƯẠ-ỹ]/g, '');

  const result = await captureExcelPNG([emp], name, `BangCong_${safeName}.png`);
  if (!result) return;

  downloadBlob(result.blob, result.filename);
  toast('📷 Đã lưu ảnh: ' + result.filename);
}

export async function shareExcelOne() {
  const empId = state.excelActionEmpId;
  if (!empId) return;
  const emp = state.excelProfiles.find(e => e.id === empId);
  if (!emp) return;

  closeModal('excelActionModal');
  toast('⏳ Đang tạo ảnh...');

  const name = emp.full_name || emp.username || 'NhanVien';
  const safeName = name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_ÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠƯẠ-ỹ]/g, '');

  const result = await captureExcelPNG([emp], name, `BangCong_${safeName}.png`);
  if (!result) return;

  await sharePNG(result.blob, result.filename, `Bảng công ${name}`);
}

/* ============ SAVE / SHARE ALL ============ */
export async function saveExcelAll() {
  if (!state.excelProfiles.length) { toast('Chưa có dữ liệu'); return; }

  toast('⏳ Đang tạo ảnh toàn bộ...');

  const y = state.excelMonth.getFullYear();
  const m = state.excelMonth.getMonth() + 1;

  const result = await captureExcelPNG(
    state.excelProfiles,
    'BẢNG CÔNG TOÀN CÔNG TY',
    `BangCong_All_${pad(m)}_${y}.png`
  );
  if (!result) return;

  downloadBlob(result.blob, result.filename);
  toast('📷 Đã lưu ảnh: ' + result.filename);
}

export async function shareExcelAll() {
  if (!state.excelProfiles.length) { toast('Chưa có dữ liệu'); return; }

  toast('⏳ Đang tạo ảnh toàn bộ...');

  const y = state.excelMonth.getFullYear();
  const m = state.excelMonth.getMonth() + 1;

  const result = await captureExcelPNG(
    state.excelProfiles,
    'BẢNG CÔNG TOÀN CÔNG TY',
    `BangCong_All_${pad(m)}_${y}.png`
  );
  if (!result) return;

  await sharePNG(result.blob, result.filename, 'Bảng công toàn công ty');
}

/* ============ SHARE PNG ============ */
async function sharePNG(blob, filename, title) {
  const file = new File([blob], filename, { type: 'image/png' });

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  if (isIOS && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text: filename });
      toast('✅ Đã chia sẻ ảnh');
    } catch (err) {
      if (err.name === 'AbortError') return;
      downloadBlob(blob, filename);
    }
  } else if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text: filename });
      toast('✅ Đã chia sẻ ảnh');
    } catch (err) {
      if (err.name === 'AbortError') return;
      downloadBlob(blob, filename);
    }
  } else {
    downloadBlob(blob, filename);
    toast('✅ Đã tải ảnh: ' + filename);
  }
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

/* ============ BULK COPY ============ */
export async function bulkCopySubmit() {
  const src = $('#bulkSourceDate').value;
  const tgt = $('#bulkTargetDate').value;
  if (!src || !tgt) { toast('Chọn ngày nguồn và đích'); return; }
  if (src === tgt) { toast('Ngày nguồn và đích phải khác nhau'); return; }

  const btn = $('#bulkCopySubmit');
  btn.disabled = true; btn.textContent = 'Đang copy...';

  const { data: srcData, error: e1 } = await supabase
    .from('attendance').select('*').eq('date', src);

  if (e1) {
    toast('Lỗi: ' + e1.message);
    btn.disabled = false; btn.textContent = 'Copy';
    return;
  }
  if (!srcData || !srcData.length) {
    toast('Ngày nguồn không có dữ liệu');
    btn.disabled = false; btn.textContent = 'Copy';
    return;
  }

  const { data: tgtData } = await supabase
    .from('attendance').select('employee_id').eq('date', tgt);
  const tgtIds = new Set((tgtData || []).map(e => e.employee_id));

  const toCopy = srcData.filter(a => !tgtIds.has(a.employee_id));
  if (!toCopy.length) {
    toast('Tất cả nhân viên đã có dữ liệu ngày đích');
    btn.disabled = false; btn.textContent = 'Copy';
    return;
  }

  const ok = confirm(
    `Sẽ copy ${toCopy.length} nhân viên từ ${formatDateVN(src)} sang ${formatDateVN(tgt)}.` +
    (tgtIds.size > 0 ? `\n\n(${tgtIds.size} người đã có ngày đích sẽ bị bỏ qua)` : '') +
    `\n\nTiếp tục?`
  );
  if (!ok) { btn.disabled = false; btn.textContent = 'Copy'; return; }

  const payloads = toCopy.map(a => ({
    employee_id: a.employee_id,
    date: tgt,
    total_hours: a.total_hours,
    ot_hours: a.ot_hours,
    is_off: a.is_off,
    mode: a.mode,
    manual_hours: a.manual_hours,
    areas: a.areas,
    ot_areas: a.ot_areas,
  }));

  const { error: e2 } = await supabase
    .from('attendance').upsert(payloads, { onConflict: 'employee_id,date' });

  btn.disabled = false; btn.textContent = 'Copy';

  if (e2) { toast('Lỗi: ' + e2.message); return; }

  toast(`Đã copy ${payloads.length} bản ghi ✓`);
  closeModal('bulkCopyModal');

  const { invalidateAttendanceCache } = await import('./core.js');
  invalidateAttendanceCache();
  if (state.salaryModule) state.salaryModule.invalidateCache();

  const attendance = await import('./attendance.js');
  const buildings = await import('./buildings.js');

  await attendance.loadAttendanceForMonth(true);
  await buildings.loadTodayAssignments();
  attendance.renderCalendar();
  buildings.renderBuildings();
}