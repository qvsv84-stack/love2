const SUPABASE_URL = 'https://cjswxglxyyqrcfbyyjer.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_jgRKlQFfL09zN_uU3P6SnQ_F_1UAJx9';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- STATE ---
let currentBuildingId = null;
let currentAreaIdForSchedule = null;
let dbAreas = [];
let dbSchedules = [];
let longPressTimer = null;

// --- UTILS ---
function showToast(msg, isErr = false) {
    const t = document.getElementById('toast');
    t.innerText = msg;
    t.style.background = isErr ? 'var(--danger)' : '#333';
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
}
function closeModal(id) { document.getElementById(id).classList.remove('show'); }

// --- 1. KHỞI TẠO 5 TÒA NHÀ (Nếu DB chưa có) ---
async function initBuildings() {
    const { data: buildings } = await supabaseClient.from('buildings').select('*').order('name');
    
    // Nếu chưa có đủ 5 tòa nhà B1-B5, tự động tạo
    if (!buildings || buildings.length < 5) {
        for (let i = 1; i <= 5; i++) {
            const bName = `Tòa nhà B${i}`;
            if (!buildings || !buildings.find(b => b.name === bName)) {
                await supabaseClient.from('buildings').insert([{ name: bName }]);
            }
        }
    }
    // Mặc định load B1
    switchBuilding(1);
}

// --- 2. CHUYỂN TÒA NHÀ ---
async function switchBuilding(index) {
    // Cập nhật UI Bottom Nav
    document.querySelectorAll('.nav-building').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`.nav-building[data-index="${index}"]`).classList.add('active');
    document.getElementById('header-title').innerText = `Tòa Nhà B${index}`;

    // Lấy ID của tòa nhà B(index) từ DB
    const { data: bData } = await supabaseClient.from('buildings').select('id').eq('name', `Tòa nhà B${index}`).single();
    if (!bData) return;
    currentBuildingId = bData.id;

    loadAreas();
}

// --- 3. LOAD KHU VỰC ---
async function loadAreas() {
    const listEl = document.getElementById('area-list');
    listEl.innerHTML = '<div class="loading-spinner">Đang tải khu vực...</div>';

    // Lấy Khu vực của tòa nhà này
    const { data: areas } = await supabaseClient.from('areas').select('*').eq('building_id', currentBuildingId).order('created_at', { ascending: true });
    dbAreas = areas || [];

    // Lấy Lịch trình của các khu vực này (để hiển thị giờ lên Card)
    if (dbAreas.length > 0) {
        const areaIds = dbAreas.map(a => a.id);
        const { data: schedules } = await supabaseClient.from('schedules').select('*, tasks(name)').in('area_id', areaIds).order('start_time');
        dbSchedules = schedules || [];
    } else {
        dbSchedules = [];
    }

    listEl.innerHTML = '';
    if (dbAreas.length === 0) {
        listEl.innerHTML = '<div style="text-align:center; color:#888; margin-top:50px;">Chưa có khu vực nào.<br>Bấm nút + để thêm mới.</div>';
        return;
    }

    dbAreas.forEach(area => {
        // Lấy các giờ của khu vực này
        const areaSchedules = dbSchedules.filter(s => s.area_id === area.id);
        let scheduleHtml = '';
        if (areaSchedules.length > 0) {
            scheduleHtml = areaSchedules.map(s => `
                <div class="schedule-item">
                    <span class="schedule-time">${s.start_time.substring(0,5)}</span>
                    <span>${s.tasks?.name}</span>
                </div>
            `).join('');
        } else {
            scheduleHtml = '<div style="color:#aaa; font-style:italic;">Chưa có giờ làm việc (Nhấn giữ để thêm)</div>';
        }

        const card = document.createElement('div');
        card.className = 'area-card';
        card.innerHTML = `
            <div class="area-title">
                ${area.name}
                <span class="area-type-badge">${area.type === 'INDOOR' ? 'Trong nhà' : 'Ngoài trời'}</span>
            </div>
            <div class="area-schedules">${scheduleHtml}</div>
        `;
        
        // --- LOGIC NHẤN GIỮ (LONG PRESS) ---
        card.addEventListener('touchstart', (e) => {
            longPressTimer = setTimeout(() => {
                // Hành động khi nhấn giữ 800ms
                if (navigator.vibrate) navigator.vibrate(50); // Rung nhẹ (nếu đt hỗ trợ)
                openScheduleModal(area);
            }, 800);
        });
        card.addEventListener('touchend', () => clearTimeout(longPressTimer));
        card.addEventListener('touchmove', () => clearTimeout(longPressTimer));
        // Dành cho chuột (test trên máy tính)
        card.addEventListener('mousedown', () => { longPressTimer = setTimeout(() => openScheduleModal(area), 800); });
        card.addEventListener('mouseup', () => clearTimeout(longPressTimer));
        card.addEventListener('mouseleave', () => clearTimeout(longPressTimer));
        
        // Chặn menu copy/paste của trình duyệt khi nhấn giữ
        card.addEventListener('contextmenu', e => e.preventDefault());

        listEl.appendChild(card);
    });
}

// --- 4. THÊM KHU VỰC MỚI ---
function openAddAreaModal() {
    document.getElementById('modal-area').classList.add('show');
    document.getElementById('area-name').value = '';
}

document.getElementById('form-area').onsubmit = async (e) => {
    e.preventDefault();
    const name = document.getElementById('area-name').value;
    
    const { error } = await supabaseClient.from('areas').insert([{ 
        building_id: currentBuildingId, 
        name: name,
        type: 'INDOOR' // Mặc định trong nhà, có thể sửa sau
    }]);

    if (error) showToast('Lỗi: ' + error.message, true);
    else {
        showToast('Đã thêm khu vực!');
        closeModal('modal-area');
        loadAreas();
    }
};

// --- 5. MODAL THÊM GIỜ LÀM VIỆC (KHI NHẤN GIỮ) ---
function openScheduleModal(area) {
    currentAreaIdForSchedule = area.id;
    document.getElementById('schedule-area-title').innerText = `Giờ làm việc: ${area.name}`;
    document.getElementById('modal-schedule').classList.add('show');
    
    const rowsContainer = document.getElementById('schedule-rows');
    rowsContainer.innerHTML = '';

    // Hiển thị các giờ đã có (nếu có) để user thấy
    const existing = dbSchedules.filter(s => s.area_id === area.id);
    if (existing.length > 0) {
        existing.forEach(s => addScheduleRow(s.start_time.substring(0,5), s.tasks?.name));
    } else {
        addScheduleRow(); // Tạo 1 dòng trống mặc định
    }
}

function addScheduleRow(time = '', content = '') {
    const container = document.getElementById('schedule-rows');
    const div = document.createElement('div');
    div.className = 'schedule-row';
    div.innerHTML = `
        <input type="time" class="input-time" value="${time}" required>
        <input type="text" class="input-task" placeholder="Nội dung (VD: Quét sàn)" value="${content}" required>
        <button type="button" class="btn-delete-row" onclick="this.parentElement.remove()">✕</button>
    `;
    container.appendChild(div);
}

// Lưu Lịch Trình (Xử lý cả logic lưu Task mới)
async function saveSchedules() {
    const rows = document.querySelectorAll('#schedule-rows .schedule-row');
    if (rows.length === 0) return closeModal('modal-schedule');

    const btn = document.querySelector('#modal-schedule .btn-primary');
    btn.innerText = 'Đang lưu...'; btn.disabled = true;

    let successCount = 0;

    for (const row of rows) {
        const time = row.querySelector('.input-time').value;
        const taskName = row.querySelector('.input-task').value;

        if (!time || !taskName) continue;

        // 1. Kiểm tra xem Task này có trong bảng `tasks` chưa
        let taskId;
        const { data: existingTask } = await supabaseClient.from('tasks').select('id').eq('name', taskName).single();
        
        if (existingTask) {
            taskId = existingTask.id;
        } else {
            // Nếu chưa có, tạo mới
            const { data: newTask } = await supabaseClient.from('tasks').insert([{ name: taskName }]).select().single();
            taskId = newTask.id;
        }

        // 2. Xoá các schedule cũ của khu vực này (để tránh trùng lặp khi sửa) 
        // *Lưu ý: Để đơn giản, ta xoá hết giờ cũ của Area rồi thêm lại từ đầu
        if (successCount === 0) {
            await supabaseClient.from('schedules').delete().eq('area_id', currentAreaIdForSchedule);
        }

        // 3. Insert lịch trình mới
        const { error } = await supabaseClient.from('schedules').insert([{
            area_id: currentAreaIdForSchedule,
            task_id: taskId,
            start_time: time + ':00',
            frequency: 'DAILY'
        }]);

        if (!error) successCount++;
    }

    btn.innerText = 'Lưu Tất Cả'; btn.disabled = false;
    showToast(`Đã lưu ${successCount} khung giờ!`);
    closeModal('modal-schedule');
    loadAreas(); // Cập nhật lại danh sách ngoài màn hình chính
}

// Chạy app
initBuildings();