const SUPABASE_URL = 'https://cjswxglxyyqrcfbyyjer.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_jgRKlQFfL09zN_uU3P6SnQ_F_1UAJx9';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- STATE QUẢN LÝ ---
let db = { buildings: [], areas: [], tasks: [], schedules: [] };
let editContext = { type: null, id: null }; // Lưu trạng thái đang Sửa cái gì

// --- TIỆN ÍCH ---
function showToast(msg, isError = false) {
    const t = document.getElementById('toast');
    t.innerText = msg;
    t.style.background = isError ? 'var(--danger)' : '#333';
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
}

document.getElementById('current-date').innerText = new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit' });

function switchMainTab(tab) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.bottom-nav button').forEach(b => b.classList.remove('active'));
    document.getElementById(`page-${tab}`).classList.add('active');
    document.getElementById(`btn-${tab}`).classList.add('active');
    
    if (tab === 'admin') { fetchAllDataForAdmin(); document.getElementById('fab-add').style.display = 'flex'; }
    else { fetchTasksForToday(); document.getElementById('fab-add').style.display = 'none'; }
}

function switchAdminTab(tab) {
    document.querySelectorAll('.segment-control button').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.admin-content').forEach(c => c.classList.remove('active'));
    event.target.classList.add('active');
    document.getElementById(`admin-tab-${tab}`).classList.add('active');
}

// --- 1. TRANG GIÁM SÁT (VIEW) ---
async function fetchTasksForToday() {
    const listEl = document.getElementById('task-list');
    listEl.innerHTML = '<div class="loading-spinner">Đang tải...</div>';

    // Lấy giờ hiện tại để check trễ
    const now = new Date();
    const currentTimeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');

    // Query lấy lịch trình + Log của ngày hôm nay
    const { data: schedules, error } = await supabaseClient
        .from('schedules')
        .select(`id, start_time, note, tasks ( name ), areas ( name, buildings ( name ) )`)
        .order('start_time', { ascending: true });

    if (error) return listEl.innerHTML = `<div style="color:red">Lỗi: ${error.message}</div>`;

    // Lấy log hôm nay để biết task nào xong rồi
    const { data: logs } = await supabaseClient.from('task_logs').select('schedule_id').eq('log_date', new Date().toISOString().split('T')[0]);
    const completedIds = logs ? logs.map(l => l.schedule_id) : [];

    listEl.innerHTML = '';
    let currentSection = '';

    schedules.forEach(item => {
        const timeStr = item.start_time.substring(0, 5);
        const hour = parseInt(timeStr.split(':')[0]);
        let sectionName = hour < 12 ? '🌅 Ca Sáng' : (hour < 18 ? '☀️ Ca Chiều' : '🌙 Ca Tối');

        if (sectionName !== currentSection) {
            listEl.innerHTML += `<div class="section-title">${sectionName}</div>`;
            currentSection = sectionName;
        }

        const isDone = completedIds.includes(item.id);
        const isOverdue = !isDone && (currentTimeStr > timeStr); // Quá giờ & chưa làm

        const card = document.createElement('div');
        card.className = `task-card ${isDone ? 'completed' : ''} ${isOverdue ? 'overdue' : ''}`;
        card.innerHTML = `
            <div class="task-info">
                <div class="task-time">
                    ${timeStr} 
                    ${isOverdue ? '<span class="badge-overdue">Quá hạn</span>' : ''}
                </div>
                <div class="task-name">${item.tasks?.name}</div>
                <div class="task-loc">📍 ${item.areas?.buildings?.name} • ${item.areas?.name}</div>
            </div>
            <button class="btn-check ${isDone ? 'done' : ''}" 
                onclick="markTaskDone('${item.id}', this)" ${isDone ? 'disabled' : ''}>
                ${isDone ? 'Đã xong ✓' : 'Xong'}
            </button>
        `;
        listEl.appendChild(card);
    });
}

async function markTaskDone(scheduleId, btn) {
    btn.innerText = '...'; btn.disabled = true;
    const { error } = await supabaseClient.from('task_logs').insert([{ schedule_id: scheduleId, status: 'COMPLETED' }]);
    
    if (error) { showToast('Lỗi: ' + error.message, true); btn.innerText = 'Xong'; btn.disabled = false; }
    else { showToast('Đã ghi nhận!'); fetchTasksForToday(); }
}

// --- 2. TRANG QUẢN TRỊ (ADMIN) ---
async function fetchAllDataForAdmin() {
    // Tải toàn bộ data để render
    const [bRes, aRes, tRes, sRes] = await Promise.all([
        supabaseClient.from('buildings').select('*').order('name'),
        supabaseClient.from('areas').select('*, buildings(name)').order('name'),
        supabaseClient.from('tasks').select('*').order('name'),
        supabaseClient.from('schedules').select('*, tasks(name), areas(name, buildings(name))').order('start_time')
    ]);

    db.buildings = bRes.data || [];
    db.areas = aRes.data || [];
    db.tasks = tRes.data || [];
    db.schedules = sRes.data || [];

    renderAdminSchedules();
    renderAdminCategories();
}

function renderAdminSchedules() {
    const el = document.getElementById('admin-schedule-list');
    el.innerHTML = db.schedules.length ? '' : '<p style="text-align:center; color:#888; padding:20px;">Chưa có lịch trình nào.</p>';
    
    db.schedules.forEach(s => {
        const div = document.createElement('div');
        div.className = 'admin-item';
        div.innerHTML = `
            <div class="item-info">
                <h4>[${s.start_time.substring(0,5)}] ${s.tasks?.name}</h4>
                <p>${s.areas?.buildings?.name} - ${s.areas?.name}</p>
            </div>
            <div class="item-actions">
                <button class="btn-icon btn-edit" onclick="openModal('schedule', '${s.id}')">✏️</button>
                <button class="btn-icon btn-delete" onclick="deleteItem('schedules', '${s.id}')">🗑️</button>
            </div>
        `;
        el.appendChild(div);
    });
}

function renderAdminCategories() {
    // Render Tòa nhà
    document.getElementById('list-buildings').innerHTML = db.buildings.map(b => `
        <div class="cat-item">
            <span>${b.name}</span>
            <div>
                <button class="btn-icon btn-delete" onclick="deleteItem('buildings', '${b.id}')">🗑️</button>
            </div>
        </div>
    `).join('');

    // Render Khu vực
    document.getElementById('list-areas').innerHTML = db.areas.map(a => `
        <div class="cat-item">
            <span>${a.name} (${a.buildings?.name})</span>
            <button class="btn-icon btn-delete" onclick="deleteItem('areas', '${a.id}')">🗑️</button>
        </div>
    `).join('');

    // Render Tasks
    document.getElementById('list-tasks').innerHTML = db.tasks.map(t => `
        <div class="cat-item">
            <span>${t.name}</span>
            <button class="btn-icon btn-delete" onclick="deleteItem('tasks', '${t.id}')">🗑️</button>
        </div>
    `).join('');
}

// --- 3. MODAL (THÊM / SỬA) ---
function openModal(type = 'schedule', id = null) {
    editContext = { type, id };
    const overlay = document.getElementById('modal-overlay');
    const title = document.getElementById('modal-title');
    const fields = document.getElementById('form-fields');
    
    overlay.classList.add('show');
    
    if (type === 'schedule') {
        title.innerText = id ? 'Sửa Lịch Trình' : 'Thêm Lịch Trình';
        const sch = id ? db.schedules.find(x => x.id === id) : null;

        fields.innerHTML = `
            <select id="f-building" required><option value="">-- Chọn Tòa nhà --</option></select>
            <select id="f-area" required><option value="">-- Chọn Khu vực --</option></select>
            <select id="f-task" required><option value="">-- Chọn Công việc --</option></select>
            <input type="time" id="f-time" required value="${sch ? sch.start_time.substring(0,5) : ''}">
            <input type="text" id="f-note" placeholder="Ghi chú..." value="${sch ? sch.note || '' : ''}">
        `;

        // Load data vào select
        const bSelect = document.getElementById('f-building');
        db.buildings.forEach(b => bSelect.innerHTML += `<option value="${b.id}">${b.name}</option>`);
        const tSelect = document.getElementById('f-task');
        db.tasks.forEach(t => tSelect.innerHTML += `<option value="${t.id}">${t.name}</option>`);

        // Xử lý logic chọn Nhà -> Hiện Khu vực
        bSelect.onchange = () => {
            const bId = bSelect.value;
            const aSelect = document.getElementById('f-area');
            aSelect.innerHTML = '<option value="">-- Chọn Khu vực --</option>';
            db.areas.filter(a => a.building_id === bId).forEach(a => aSelect.innerHTML += `<option value="${a.id}">${a.name}</option>`);
        };

        // Nếu đang Sửa thì điền dữ liệu cũ vào
        if (sch) {
            bSelect.value = sch.areas.building_id;
            bSelect.onchange();
            document.getElementById('f-area').value = sch.area_id;
            document.getElementById('f-task').value = sch.task_id;
        }
    } 
    // Tương tự cho các loại khác (Tòa nhà, Khu vực, Công việc) nếu cần Sửa
    else if (type === 'building') {
        title.innerText = 'Thêm Tòa Nhà';
        fields.innerHTML = `<input type="text" id="f-name" placeholder="Tên tòa nhà..." required>`;
    }
}

function closeModal() {
    document.getElementById('modal-overlay').classList.remove('show');
}

// Xử lý Lưu Form
document.getElementById('dynamic-form').onsubmit = async (e) => {
    e.preventDefault();
    const { type, id } = editContext;

    if (type === 'schedule') {
        const payload = {
            area_id: document.getElementById('f-area').value,
            task_id: document.getElementById('f-task').value,
            start_time: document.getElementById('f-time').value + ':00',
            note: document.getElementById('f-note').value,
            frequency: 'DAILY'
        };
        
        let res;
        if (id) res = await supabaseClient.from('schedules').update(payload).eq('id', id);
        else res = await supabaseClient.from('schedules').insert([payload]);

        if (res.error) showToast('Lỗi: ' + res.error.message, true);
        else { closeModal(); fetchAllDataForAdmin(); showToast('Đã lưu!'); }
    }
    else if (type === 'building') {
        const name = document.getElementById('f-name').value;
        const res = await supabaseClient.from('buildings').insert([{ name }]);
        if (!res.error) { closeModal(); fetchAllDataForAdmin(); showToast('Đã thêm!'); }
    }
};

// --- 4. XOÁ DỮ LIỆU ---
async function deleteItem(table, id) {
    if (!confirm('Bạn có chắc chắn muốn xoá? Thao tác này không thể hoàn tác.')) return;
    
    const { error } = await supabaseClient.from(table).delete().eq('id', id);
    if (error) showToast('Lỗi xoá: ' + error.message, true);
    else { showToast('Đã xoá!'); fetchAllDataForAdmin(); }
}

// Nút FAB (Thêm)
document.getElementById('fab-add').onclick = () => {
    // Nếu đang ở tab Lịch trình thì thêm Lịch trình, nếu ở Danh mục thì thêm Tòa nhà (VD)
    const isScheduleTab = document.getElementById('admin-tab-schedule').classList.contains('active');
    if (isScheduleTab) openModal('schedule');
    else openModal('building');
};

// Khởi chạy lần đầu
fetchTasksForToday();