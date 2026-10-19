const SUPABASE_URL = 'https://cjswxglxyyqrcfbyyjer.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_jgRKlQFfL09zN_uU3P6SnQ_F_1UAJx9';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- 1. CHUYỂN TRANG (TABS) ---
function switchTab(tabName) {
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    document.querySelectorAll('.nav-bar button').forEach(btn => btn.classList.remove('active'));
    
    document.getElementById(`page-${tabName}`).classList.add('active');
    document.getElementById(`btn-${tabName}`).classList.add('active');

    if (tabName === 'admin') {
        loadAdminDropdowns(); // Load lại dữ liệu mới nhất khi mở trang Admin
    } else {
        fetchTasks(); // Load lại lịch trình khi mở trang Xem
    }
}

// --- 2. TRANG XEM LỊCH (GIÁM SÁT) ---
document.getElementById('current-date').innerText = new Date().toLocaleDateString('vi-VN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

async function fetchTasks() {
    const taskListEl = document.getElementById('task-list');
    taskListEl.innerHTML = '<div class="loading">Đang tải dữ liệu...</div>';

    const { data, error } = await supabaseClient
        .from('schedules')
        .select(`id, start_time, note, tasks ( name ), areas ( name, buildings ( name ) )`)
        .order('start_time', { ascending: true });

    if (error) {
        taskListEl.innerHTML = `<div style="color:red; padding:15px; background:#ffe6e6; border-radius:8px;">Lỗi: ${error.message}</div>`;
        return;
    }

    if (data.length === 0) {
        taskListEl.innerHTML = `<div style="text-align:center; padding:20px; background:white; border-radius:8px;">Chưa có lịch trình nào. Hãy sang tab "Quản Trị" để thêm.</div>`;
        return;
    }

    taskListEl.innerHTML = ''; 
    data.forEach(item => {
        const timeStr = item.start_time.substring(0, 5); 
        const card = document.createElement('div');
        card.className = 'task-card';
        card.id = `task-${item.id}`;
        
        card.innerHTML = `
            <div class="task-info">
                <div class="task-time">${timeStr}</div>
                <div class="task-name">${item.tasks?.name || 'N/A'}</div>
                <div class="task-location">📍 ${item.areas?.buildings?.name || 'N/A'} - ${item.areas?.name || 'N/A'}</div>
                ${item.note ? `<div class="task-note">Ghi chú: ${item.note}</div>` : ''}
            </div>
            <button class="btn-check" onclick="markComplete('${item.id}', this)">Hoàn thành</button>
        `;
        taskListEl.appendChild(card);
    });
}

async function markComplete(scheduleId, btnElement) {
    btnElement.innerText = 'Đang lưu...';
    const { error } = await supabaseClient.from('task_logs').insert([{ schedule_id: scheduleId, status: 'COMPLETED' }]);

    if (error) {
        alert('Lỗi lưu: ' + error.message);
        btnElement.innerText = 'Hoàn thành';
    } else {
        btnElement.innerText = 'Đã xong ✓';
        btnElement.classList.add('done');
        document.getElementById(`task-${scheduleId}`).classList.add('completed');
    }
}

// --- 3. TRANG QUẢN TRỊ (ADMIN) ---

// Hàm load dữ liệu vào các ô Dropdown (Select)
async function loadAdminDropdowns() {
    // Load Tòa nhà cho form Khu vực
    const { data: buildings } = await supabaseClient.from('buildings').select('*').order('name');
    const buildingSelect1 = document.getElementById('area-building-id');
    const buildingSelect2 = document.getElementById('sch-building');
    
    buildingSelect1.innerHTML = '<option value="">-- Chọn Tòa nhà --</option>';
    buildingSelect2.innerHTML = '<option value="">-- Chọn Tòa nhà --</option>';
    if(buildings) {
        buildings.forEach(b => {
            buildingSelect1.innerHTML += `<option value="${b.id}">${b.name}</option>`;
            buildingSelect2.innerHTML += `<option value="${b.id}">${b.name}</option>`;
        });
    }

    // Load Công việc cho form Lịch trình
    const { data: tasks } = await supabaseClient.from('tasks').select('*').order('name');
    const taskSelect = document.getElementById('sch-task');
    taskSelect.innerHTML = '<option value="">-- Chọn Công việc --</option>';
    if(tasks) {
        tasks.forEach(t => taskSelect.innerHTML += `<option value="${t.id}">${t.name}</option>`);
    }
}

// Hàm load Khu vực dựa theo Tòa nhà đã chọn (trong form Lịch trình)
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
    if(areas) {
        areas.forEach(a => areaSelect.innerHTML += `<option value="${a.id}">${a.name}</option>`);
    }
}

// --- 4. XỬ LÝ SỰ KIỆN SUBMIT FORM ---

// Thêm Tòa nhà
document.getElementById('form-building').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('building-name').value;
    const { error } = await supabaseClient.from('buildings').insert([{ name }]);
    if (error) alert('Lỗi: ' + error.message);
    else { alert('Đã thêm Tòa nhà!'); document.getElementById('building-name').value = ''; loadAdminDropdowns(); }
});

// Thêm Khu vực
document.getElementById('form-area').addEventListener('submit', async (e) => {
    e.preventDefault();
    const building_id = document.getElementById('area-building-id').value;
    const name = document.getElementById('area-name').value;
    const type = document.getElementById('area-type').value;
    const { error } = await supabaseClient.from('areas').insert([{ building_id, name, type }]);
    if (error) alert('Lỗi: ' + error.message);
    else { alert('Đã thêm Khu vực!'); document.getElementById('area-name').value = ''; loadAreasForSchedule(); }
});

// Thêm Công việc
document.getElementById('form-task').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('task-name').value;
    const { error } = await supabaseClient.from('tasks').insert([{ name }]);
    if (error) alert('Lỗi: ' + error.message);
    else { alert('Đã thêm Công việc!'); document.getElementById('task-name').value = ''; loadAdminDropdowns(); }
});

// Thêm Lịch trình
document.getElementById('form-schedule').addEventListener('submit', async (e) => {
    e.preventDefault();
    const area_id = document.getElementById('sch-area').value;
    const task_id = document.getElementById('sch-task').value;
    const start_time = document.getElementById('sch-time').value + ':00'; // Thêm giây
    const note = document.getElementById('sch-note').value;

    const { error } = await supabaseClient.from('schedules').insert([{ area_id, task_id, start_time, note, frequency: 'DAILY' }]);
    if (error) alert('Lỗi: ' + error.message);
    else { 
        alert('Đã thêm Lịch trình thành công!'); 
        document.getElementById('sch-note').value = ''; 
        // Không cần reload, lát nữa qua tab Xem là thấy
    }
});

// Khởi chạy lần đầu
fetchTasks();