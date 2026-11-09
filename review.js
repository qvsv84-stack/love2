import { supabase } from './supabase.js';
import { state, $, toast, openModal, closeModal } from './core.js';
import { jumpToEmployeeCalendar } from './buildings.js';

let _reviewsData = {};
let _complaintsData = {};
let _isLoading = false;

export async function loadReviewsTab() {
  const $root = $('#reviewsList');
  if (!$root) return;
  
  $root.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">⏳ Đang tải dữ liệu...</div>';
  
  try {
    // 1. Tải đánh giá và phản ánh
    const [reviewsRes, complaintsRes] = await Promise.all([
      supabase.from('cslx_employee_reviews').select('*'),
      supabase.from('cslx_complaints').select('*').order('created_at', { ascending: false })
    ]);

    if (reviewsRes.error) throw reviewsRes.error;
    if (complaintsRes.error) throw complaintsRes.error;

    // 2. Xử lý dữ liệu
    _reviewsData = {};
    for (const r of (reviewsRes.data || [])) {
      _reviewsData[r.employee_id] = r;
    }

    _complaintsData = {};
    for (const c of (complaintsRes.data || [])) {
      if (!_complaintsData[c.employee_id]) _complaintsData[c.employee_id] = [];
      _complaintsData[c.employee_id].push(c);
    }

    renderReviewsList();
  } catch (err) {
    console.error('[reviews]', err);
    $root.innerHTML = '<div style="text-align:center;padding:40px;color:#dc2626;">⚠ Lỗi tải dữ liệu: ' + err.message + '</div>';
  }
}

function renderReviewsList() {
  const $root = $('#reviewsList');
  if (!$root) return;

  // Lấy danh sách nhân viên (bỏ qua inactive)
  const emps = (state.employees || []).filter(e => e.status !== 'inactive').sort((a, b) => {
    return (a.full_name || '').localeCompare(b.full_name || '', 'vi');
  });

  if (emps.length === 0) {
    $root.innerHTML = '<p class="hint" style="text-align:center;">Chưa có nhân viên.</p>';
    return;
  }

  let html = '';
  for (const emp of emps) {
    const name = emp.full_name || emp.username || 'N/A';
    const initial = name.charAt(0).toUpperCase();
    const review = _reviewsData[emp.id] || {};
    const complaints = _complaintsData[emp.id] || [];
    const complainCount = complaints.length;

    html += `<div class="building-card" style="margin-bottom: 12px; border: 1px solid var(--border); border-radius: 12px; overflow: hidden;">`;
    
    // Phần Header (Avatar + Tên + Số phản ánh)
    html += `  <div style="display:flex; align-items:center; gap:12px; padding:12px 16px; background:#f8fafc; border-bottom:1px solid var(--border);">`;
    html += `    <div style="width:40px; height:40px; border-radius:50%; background:linear-gradient(135deg,#0ea5b7,#0a6b7a); color:white; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:16px; flex-shrink:0;">${initial}</div>`;
    html += `    <div style="flex:1; min-width:0;">`;
    html += `      <div class="emp-name-link" data-emp-id="${emp.id}" style="font-size:16px; font-weight:700; color:var(--ocean-700); cursor:pointer; text-decoration:underline;" title="Xem lịch công">${name}</div>`;
    html += `      <div style="font-size:12px; color:var(--text-muted);">${emp.role === 'admin' ? 'Giám sát' : (emp.role === 'external' ? 'Ngoại cảnh' : (emp.role === 'temporary' ? 'Thời vụ' : 'Nhân viên'))}</div>`;
    html += `    </div>`;
    html += `    <button class="btn-view-complaints" data-emp-id="${emp.id}" style="padding:6px 12px; font-size:13px; font-weight:600; border-radius:8px; border:1px solid ${complainCount > 0 ? '#fca5a5' : '#cbd5e1'}; background:${complainCount > 0 ? '#fee2e2' : '#fff'}; color:${complainCount > 0 ? '#dc2626' : '#475569'}; cursor:pointer; display:flex; align-items:center; gap:6px;">`;
    html += `      🚩 Phản ánh <span style="background:${complainCount > 0 ? '#dc2626' : '#94a3b8'}; color:white; padding:1px 7px; border-radius:10px; font-size:11px;">${complainCount}</span>`;
    html += `    </button>`;
    html += `  </div>`;

    // Phần Đánh giá (Textarea)
    html += `  <div style="padding:12px 16px;">`;
    html += `    <label style="font-size:12px; font-weight:600; color:var(--text-muted); margin-bottom:6px; display:block;">📝 Đánh giá của Admin</label>`;
    html += `    <textarea class="admin-review-input" data-emp-id="${emp.id}" rows="2" placeholder="Nhập đánh giá cho nhân viên này..." style="width:100%; box-sizing:border-box; padding:10px; border:1px solid var(--border); border-radius:8px; font-family:inherit; font-size:14px; resize:vertical; outline:none; background:#fff;">${review.admin_note || ''}</textarea>`;
    html += `  </div>`;

    html += `</div>`;
  }

  $root.innerHTML = html;

  // Gắn sự kiện
  $root.querySelectorAll('.emp-name-link').forEach(el => {
    el.onclick = () => {
      const empId = el.dataset.empId;
      jumpToEmployeeCalendar(empId); // Nhảy sang tab lịch công
    };
  });

  $root.querySelectorAll('.btn-view-complaints').forEach(btn => {
    btn.onclick = () => {
      const empId = btn.dataset.empId;
      const emp = emps.find(e => e.id === empId);
      openComplaintsModal(empId, emp?.full_name || emp?.username || '');
    };
  });

  $root.querySelectorAll('.admin-review-input').forEach(input => {
    input.onblur = async () => {
      const empId = input.dataset.empId;
      const val = input.value.trim();
      const existing = _reviewsData[empId];
      
      // Nếu không có gì thay đổi thì bỏ qua
      if (existing && existing.admin_note === val) return;
      if (!existing && val === '') return;

      input.style.background = '#fef3c7'; // Màu vàng nhạt báo hiệu đang lưu
      
      try {
        const { error } = await supabase.from('cslx_employee_reviews').upsert({
          employee_id: empId,
          admin_note: val,
          updated_at: new Date().toISOString()
        }, { onConflict: 'employee_id' });
        
        if (error) throw error;
        
        // Cập nhật lại cache
        if (!_reviewsData[empId]) _reviewsData[empId] = {};
        _reviewsData[empId].admin_note = val;
        
        input.style.background = '#dcfce7'; // Xanh lá báo lưu thành công
        setTimeout(() => input.style.background = '#fff', 1000);
      } catch (err) {
        console.error('[save review]', err);
        toast('Lỗi lưu đánh giá: ' + err.message);
        input.style.background = '#fee2e2'; // Đỏ báo lỗi
      }
    };
  });
}

// ─────────────────────── MODAL PHẢN ÁNH ───────────────────────
function ensureComplaintsModal() {
  let $m = document.getElementById('complaintsModal');
  if ($m) return $m;
  
  let html = `<div id="complaintsModal" class="modal-overlay" style="display:none;z-index:10001;align-items:center;justify-content:center;padding:12px;">
    <div style="background:#fff;border-radius:18px;max-width:500px;width:100%;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
      
      <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 18px;border-bottom:1px solid var(--border);flex-shrink:0;">
        <h3 id="complaintsTitle" style="margin:0;font-size:17px;font-weight:700;color:var(--ocean-700);">🚩 Phản ánh</h3>
        <button id="complaintsCloseBtn" type="button" style="background:var(--ocean-50);border:none;width:32px;height:32px;border-radius:8px;font-size:15px;color:var(--text-muted);cursor:pointer;font-family:inherit;">✕</button>
      </div>
      
      <div style="padding:16px;overflow-y:auto;flex:1;min-height:0;background:#f8fafc;">
        <div id="complaintsListContainer"></div>
      </div>

      <div style="padding:14px 16px;border-top:1px solid var(--border);flex-shrink:0;background:#fff;">
        <p style="margin:0 0 10px 0; font-size:13px; font-weight:600; color:var(--text);">Thêm phản ánh mới:</p>
        <input type="text" id="compReporter" class="input" placeholder="Tên người phản ánh..." style="width:100%; box-sizing:border-box; margin-bottom:8px; padding:8px 10px; font-size:13px; border:1px solid var(--border); border-radius:6px; font-family:inherit;" />
        <input type="text" id="compArea" class="input" placeholder="Khu vực (VD: Tầng 1, Cổng trường...)" style="width:100%; box-sizing:border-box; margin-bottom:8px; padding:8px 10px; font-size:13px; border:1px solid var(--border); border-radius:6px; font-family:inherit;" />
        <textarea id="compContent" class="input" placeholder="Nội dung phản ánh..." rows="2" style="width:100%; box-sizing:border-box; margin-bottom:10px; padding:8px 10px; font-size:13px; border:1px solid var(--border); border-radius:6px; font-family:inherit; resize:none;"></textarea>
        <button id="btnAddComplaint" class="btn-primary" style="width:100%; padding:10px; font-size:14px; font-weight:700; border-radius:8px;">Gửi phản ánh</button>
      </div>
      
    </div>
  </div>`;
  
  document.body.insertAdjacentHTML('beforeend', html);
  $m = document.getElementById('complaintsModal');
  
  const closeFn = () => { $m.style.display = 'none'; };
  document.getElementById('complaintsCloseBtn').onclick = closeFn;
  $m.onclick = (e) => { if (e.target === $m) closeFn(); };
  
  return $m;
}

let _currentComplaintsEmpId = null;

function openComplaintsModal(empId, empName) {
  _currentComplaintsEmpId = empId;
  const $m = ensureComplaintsModal();
  
  document.getElementById('complaintsTitle').textContent = `🚩 Phản ánh: ${empName}`;
  document.getElementById('compReporter').value = '';
  document.getElementById('compArea').value = '';
  document.getElementById('compContent').value = '';
  
  renderComplaintsList();
  
  const $btnAdd = document.getElementById('btnAddComplaint');
  $btnAdd.onclick = async () => {
    const reporter = document.getElementById('compReporter').value.trim();
    const area = document.getElementById('compArea').value.trim();
    const content = document.getElementById('compContent').value.trim();
    
    if (!reporter || !content) { toast('Vui lòng nhập tên người phản ánh và nội dung'); return; }
    
    $btnAdd.disabled = true; $btnAdd.textContent = '⏳ Đang gửi...';
    
    try {
      const { data, error } = await supabase.from('cslx_complaints').insert({
        employee_id: empId,
        reporter_name: reporter,
        content: content,
        area: area || 'Không xác định'
      }).select();
      
      if (error) throw error;
      
      toast('✅ Đã thêm phản ánh');
      document.getElementById('compReporter').value = '';
      document.getElementById('compArea').value = '';
      document.getElementById('compContent').value = '';
      
      // Cập nhật lại cache
      if (!_complaintsData[empId]) _complaintsData[empId] = [];
      if (data && data.length > 0) _complaintsData[empId].unshift(data[0]);
      
      renderComplaintsList();
      
      // Cập nhật lại con số trên danh sách chính
      const $badgeBtn = document.querySelector(`.btn-view-complaints[data-emp-id="${empId}"]`);
      if ($badgeBtn) {
         const count = _complaintsData[empId].length;
         $badgeBtn.innerHTML = `🚩 Phản ánh <span style="background:#dc2626; color:white; padding:1px 7px; border-radius:10px; font-size:11px;">${count}</span>`;
         $badgeBtn.style.border = '1px solid #fca5a5';
         $badgeBtn.style.background = '#fee2e2';
         $badgeBtn.style.color = '#dc2626';
      }
      
    } catch (err) {
      console.error(err);
      toast('Lỗi: ' + err.message);
    } finally {
      $btnAdd.disabled = false; $btnAdd.textContent = 'Gửi phản ánh';
    }
  };

  $m.style.display = 'flex';
}

function renderComplaintsList() {
  const $container = document.getElementById('complaintsListContainer');
  if (!$container) return;
  
  const list = _complaintsData[_currentComplaintsEmpId] || [];
  
  if (list.length === 0) {
    $container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted); font-size:14px;">Chưa có phản ánh nào.</div>';
    return;
  }
  
  let html = '';
  for (const c of list) {
    const dateStr = new Date(c.created_at).toLocaleString('vi-VN');
    html += `<div style="background:#fff; border:1px solid #e2e8f0; border-radius:10px; padding:12px; margin-bottom:10px; box-shadow:0 1px 3px rgba(0,0,0,0.02); position:relative;">`;
    
    // Nút xoá (chỉ admin)
    html += `<button class="btn-del-complaint" data-id="${c.id}" style="position:absolute; top:10px; right:10px; background:none; border:none; font-size:16px; cursor:pointer; color:#dc2626;" title="Xoá phản ánh">🗑</button>`;
    
    html += `<div style="font-size:12px; color:#64748b; margin-bottom:6px;">`;
    html += `👤 <strong style="color:#0f172a;">${c.reporter_name}</strong> · 📍 ${c.area} · 🕒 ${dateStr}`;
    html += `</div>`;
    
    html += `<div style="font-size:14px; color:#1e293b; line-height:1.5; padding-right:20px;">`;
    html += `${c.content}`;
    html += `</div>`;
    
    html += `</div>`;
  }
  
  $container.innerHTML = html;
  
  $container.querySelectorAll('.btn-del-complaint').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Xoá phản ánh này?')) return;
      const id = btn.dataset.id;
      
      try {
        const { error } = await supabase.from('cslx_complaints').delete().eq('id', id);
        if (error) throw error;
        
        _complaintsData[_currentComplaintsEmpId] = _complaintsData[_currentComplaintsEmpId].filter(x => x.id !== id);
        renderComplaintsList();
        
        // Cập nhật lại con số trên danh sách chính
        const count = _complaintsData[_currentComplaintsEmpId].length;
        const $badgeBtn = document.querySelector(`.btn-view-complaints[data-emp-id="${_currentComplaintsEmpId}"]`);
        if ($badgeBtn) {
           if (count === 0) {
             $badgeBtn.innerHTML = `🚩 Phản ánh <span style="background:#94a3b8; color:white; padding:1px 7px; border-radius:10px; font-size:11px;">0</span>`;
             $badgeBtn.style.border = '1px solid #cbd5e1';
             $badgeBtn.style.background = '#fff';
             $badgeBtn.style.color = '#475569';
           } else {
             $badgeBtn.innerHTML = `🚩 Phản ánh <span style="background:#dc2626; color:white; padding:1px 7px; border-radius:10px; font-size:11px;">${count}</span>`;
           }
        }
      } catch (err) {
        toast('Lỗi xoá: ' + err.message);
      }
    };
  });
}