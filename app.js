const SUPABASE_URL = 'https://cjswxglxyyqrcfbyyjer.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_jgRKlQFfL09zN_uU3P6SnQ_F_1UAJx9';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- TIỆN ÍCH UI ---
function showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    toast.innerText = message;
    toast.style.backgroundColor = isError ? 'var(--danger)' : '#333';
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

function switchTab(tabName) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.bottom-nav button').forEach(b => b.classList.remove('active'));
    document.getElementById(`page-${tabName}`).classList.add('active');
    document.getElementById(`btn-${tabName}`).classList.add('active');

    if (tabName === 'admin') {
        loadAdminDropdowns();
    } else {
        fetchTasks();
    }
}

// --- XỬ LÝ LỊCH TRÌNH & GIÁM SÁT ---
document.getElementById('current-date').innerText = new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });

async function fetchTasks() {
    const taskListEl = document.getElementById('task-list');
    taskListEl.innerHTML = '<div class="loading-spinner">⏳ Đang đồng bộ dữ liệu...</div>';

    // Lấy dữ liệu schedules + join bảng
    const { data, error } = await supabaseClient
        .from('schedules')
        .select(`id, start_time, note, tasks ( name ), areas ( name, buildings ( name ) )`)
        .order('start_time', { ascending: true });

    if (error) {
        taskListEl.innerHTML = `<div class="empty-state" style="color:var(--danger)">Lỗi: ${error.message}</div>`;
        return;
    }

    if (data.length === 0) {
        taskListEl.innerHTML = `<div class="empty-state">Chưa có lịch trình. Hãy sang tab Quản Trị để thêm mới.</div>`;
        return;
    }

    taskListEl.innerHTML = ''; 
    
    // Lấy giờ hiện tại để check trạng thái trễ
    const now = new Date();
    const currentTimeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');

    // Phân nhóm theo ca
    let currentSection = '';
    
    data.forEach(item => {
        const timeStr = item.start_time.substring(0, 5); // "08:30"
        const hour = parseInt(timeStr.split(':')[0]);
        
        // Logic phân ca
        let sectionName = '';
        if (hour < 12) sectionName = '🌅 Ca Sáng';
        else if (hour < 18) sectionName = '☀️ Ca Chiều';
        else sectionName = '🌙 Ca Tối';

        if (sectionName !== currentSection) {
            taskListEl.innerHTML += `<div class="section-title">${sectionName}</div>`;
            currentSection = sectionName;
        }

        // Check quá hạn (Nếu giờ hiện tại > giờ task + 30 phút thì coi là trễ)
        const isOverdue = currentTimeStr > timeStr; // Đơn giản hóa: Quá giờ là tính là overdue nếu chưa done (Trong thực tế cần check log)

        const card = document.createElement('div');
        card.className = `task-card`;
        card.id = `task-${item.id}`;
        
        card.innerHTML = `
            <div class="task-info">
                <div class="task-time">${timeStr} ${isOverdue ? '<span style="font-size:12px; color:var(--danger)">(Quá giờ)</span>' : ''}</div>
                <div class="task-name">${item.tasks?.name || 'N/A'}</div>
                <div class="task-location">📍 ${item.areas?.buildings?.name || 'N/A'} • ${item.areas?.name || 'N/A'}</div>
                ${item.note ? `<div class="task-note">Ghi chú: ${item.note}</div>` : ''}
            </div>
            <button class="btn-check" onclick="markComplete('${item.id}', this)">Xong</button>
        `;
        taskListEl.appendChild(card);
    });
}

async function markComplete(scheduleId, btnElement) {
    const originalText = btnElement.innerText;
    btnElement.innerText = 'Lưu...';
    btnElement.disabled = true;

    const { error } = await supabaseClient
        .from('task_logs')
        .insert([{ schedule_id: scheduleId, status: 'COMPLETED' }]);

    if (error) {
        showToast('Lỗi: ' + error.message, true);
        btnElement.innerText = originalText;
        btnElement.disabled = false;
    } else {
        showToast('Đã đánh dấu hoàn thành!');
        btnElement.innerText = 'Đã xong ✓';
        btnElement.classList.add('done');
        document.getElementById(`task-${scheduleId}`).classList.add('completed');
    }
}

// --- QUẢN TRỊ (ADMIN) ---
async function loadAdminDropdowns() {
    // Tòa nhà
    const { data: buildings } = await supabaseClient.from('buildings').select('*').order('name');
    const bSelects = [document.getElementById('area-building-id'), document.getElementById('sch-building')];
    bSelects.forEach(sel => sel.innerHTML = '<option value="">-- Chọn Tòa nhà --</option>');
    
    if(buildings) {
        buildings.forEach(b => {
            bSelects.forEach(sel => sel.innerHTML += `<option value="${b.id}">${b.name}</option>`);
        });
    }

    // Công việc
    const { data: tasks } = await supabaseClient.from('tasks').select('*').order('name');
    const taskSelect = document.getElementById('sch-task');
    taskSelect.innerHTML = '<option value="">-- Chọn Công việc --</option>';
    if(tasks) tasks.forEach(t => taskSelect.innerHTML += `<option value="${t.id}">${t.name}</option>`);
}

async function loadAreasForSchedule() {
    const buildingId = document.getElementById('sch-building').value;
    const areaSelect = document.getElementById('sch-area');
    areaSelect.innerHTML = '<option value="">-- Đang tải... --</option>';
    
    if (!buildingId) {
        areaSelect.innerHTML = '<option value="">-- Chọn Khu vực --</option>';
        return;
    }

    const { data: areas } = await supabaseClient.from('areas').select('*').eq('building_id', buildingId).order('name');
    areaSelect.innerHTML = '<option value="">-- Chọn Khu vực --</option>';
    if(areas) areas.forEach(a => areaSelect.innerHTML += `<option value="${a.id}">${a.name}</option>`);
}

// Xử lý Submit
document.getElementById('form-building').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('building-name').value;
    const { error } = await supabaseClient.from('buildings').insert([{ name }]);
    if (error) showToast('Lỗi: ' + error.message, true);
    else { 
        showToast('Thêm Tòa nhà thành công'); 
        document.getElementById('building-name').value = ''; 
        loadAdminDropdowns(); 
    }
});

document.getElementById('form-area').addEventListener('submit', async (e) => {
    e.preventDefault();
    const building_id = document.getElementById('area-building-id').value;
    const name = document.getElementById('area-name').value;
    const type = document.getElementById('area-type').value;
    const { error } = await supabaseClient.from('areas').insert([{ building_id, name, type }]);
    if (error) showToast('Lỗi: ' + error.message, true);
    else { showToast('Thêm Khu vực thành công'); document.getElementById('area-name').value = ''; loadAreasForSchedule(); }
});

document.getElementById('form-task').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('task-name').value;
    const { error } = await supabaseClient.from('tasks').insert([{ name }]);
    if (error) showToast('Lỗi: ' + error.message, true);
    else { showToast('Thêm Công việc thành công'); document.getElementById('task-name').value = ''; loadAdminDropdowns(); }
});

document.getElementById('form-schedule').addEventListener('submit', async (e) => {
    e.preventDefault();
    const area_id = document.getElementById('sch-area').value;
    const task_id = document.getElementById('sch-task').value;
    const start_time = document.getElementById('sch-time').value + ':00'; 
    const note = document.getElementById('sch-note').value;

    const { error } = await supabaseClient.from('schedules').insert([{ area_id, task_id, start_time, note, frequency: 'DAILY' }]);
    if (error) showToast('Lỗi: ' + error.message, true);
    else { 
        showToast('Gán lịch thành công!'); 
        document.getElementById('sch-note').value = ''; 
    }
});

// Khởi chạy
fetchTasks();