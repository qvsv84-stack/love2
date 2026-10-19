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

// --- HÀM XỬ LÝ VUỐT (SWIPE TO DELETE) ---
function handleSwipe(element, wrapper, deleteBtnWidth, onDelete) {
    let startX = 0;
    let currentX = 0;
    let isDragging = false;
    let isOpen = false;

    // Bấm vào nút Xóa
    wrapper.querySelector('.swipe-delete-btn, .schedule-row-delete').addEventListener('click', () => {
        onDelete();
    });

    element.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        isDragging = false;
        element.style.transition = 'none'; // Bỏ hiệu ứng mượt khi đang kéo
    });

    element.addEventListener('touchmove', (e) => {
        currentX = e.touches[0].clientX;
        let deltaX = currentX - startX;
        
        if (Math.abs(deltaX) > 10) isDragging = true;

        if (isDragging) {
            if (isOpen) deltaX -= deleteBtnWidth; // Nếu đang mở thì tính từ vị trí đã trượt
            if (deltaX > 0) deltaX = 0; // Không cho kéo sang phải
            if (deltaX < -deleteBtnWidth) deltaX = -deleteBtnWidth; // Không kéo quá nút xóa
            element.style.transform = `translateX(${deltaX}px)`;
        }
    });

    element.addEventListener('touchend', () => {
        element.style.transition = 'transform 0.2s'; // Bật lại hiệu ứng mượt
        let deltaX = currentX - startX;
        if (isOpen) deltaX -= deleteBtnWidth;

        if (deltaX < -deleteBtnWidth / 2) {
            // Vuốt quá nửa -> Mở
            element.style.transform = `translateX(-${deleteBtnWidth}px)`;
            isOpen = true;
        } else {
            // Vuốt chưa đủ -> Đóng lại
            element.style.transform = `translateX(0)`;
            isOpen = false;
        }
    });
    
    // Ngăn chặn sự kiện click khi đang vuốt
    element.addEventListener('click', (e) => {
        if (isDragging) {
            e.preventDefault();
            e.stopPropagation();
        } else if (isOpen) {
            element.style.transform = `translateX(0)`;
            isOpen = false;
        }
    });
}

// --- 1. KHỞI TẠO 5 TÒA NHÀ ---
async function initBuildings() {
    const { data: buildings } = await supabaseClient.from('buildings').select('*').order('name');
    if (!buildings || buildings.length < 5) {
        for (let i = 1; i <= 5; i++) {
            const bName = `Tòa nhà B${i}`;
            if (!buildings || !buildings.find(b => b.name === bName)) {
                await supabaseClient.from('buildings').insert([{ name: bName }]);
            }
        }
    }
    switchBuilding(1);
}

// --- 2. CHUYỂN TÒA NHÀ ---
async function switchBuilding(index) {
    document.querySelectorAll('.nav-building').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`.nav-building[data-index="${index}"]`).classList.add('active');
    document.getElementById('header-title').innerText = `Tòa Nhà B${index}`;

    const { data: bData } = await supabaseClient.from('buildings').select('id').eq('name', `Tòa nhà B${index}`).single();
    if (!bData) return;
    currentBuildingId = bData.id;
    loadAreas();
}

// --- 3. LOAD KHU VỰC ---
async function loadAreas() {
    const listEl = document.getElementById('area-list');
    listEl.innerHTML = '<div class="loading-spinner">Đang tải khu vực...</div>';

    const { data: areas } = await supabaseClient.from('areas').select('*').eq('building_id', currentBuildingId).order('created_at', { ascending: true });
    dbAreas = areas || [];

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

        // Cấu trúc bọc Swipe
        const wrapper = document.createElement('div');
        wrapper.className = 'swipe-wrapper';
        
        const deleteBtn = document.createElement('div');
        deleteBtn.className = 'swipe-delete-btn';
        deleteBtn.innerHTML = '🗑️ Xoá';
        
        const card = document.createElement('div');
        card.className = 'area-card';
        card.innerHTML = `
            <div class="area-title">
                ${area.name}
                <span class="area-type-badge">${area.type === 'INDOOR' ? '🏢 Trong nhà' : '🌳 Ngoài trời'}</span>
            </div>
            <div class="area-schedules">${scheduleHtml}</div>
        `;

        wrapper.appendChild(deleteBtn);
        wrapper.appendChild(card);
        
        // Khởi tạo Swipe cho thẻ
        handleSwipe(card, wrapper, 80, () => deleteArea(area.id, area.name));

        // --- LOGIC NHẤN GIỮ (LONG PRESS) ---
        const startPress = (e) => {
            longPressTimer = setTimeout(() => {
                // Hủy bỏ long press nếu người dùng đang vuốt (isDragging)
                if (navigator.vibrate) navigator.vibrate(50);
                openScheduleModal(area);
            }, 800);
        };
        const cancelPress = () => clearTimeout(longPressTimer);

        card.addEventListener('touchstart', startPress);
        card.addEventListener('touchend', cancelPress);
        card.addEventListener('touchmove', cancelPress);
        card.addEventListener('mousedown', startPress);
        card.addEventListener('mouseup', cancelPress);
        card.addEventListener('mouseleave', cancelPress);
        card.addEventListener('contextmenu', e => e.preventDefault());

        listEl.appendChild(wrapper);
    });
}

// --- HÀM XOÁ KHU VỰC ---
async function deleteArea(areaId, areaName) {
    if (!confirm(`Bạn có chắc muốn xoá khu vực "${areaName}"?\nTất cả giờ làm việc bên trong cũng sẽ bị xoá.`)) return;
    
    // Xóa Area trong Database (Lịch trình sẽ tự động xóa theo nhờ Cascade)
    const { error } = await supabaseClient.from('areas').delete().eq('id', areaId);
    
    if (error) {
        showToast('Lỗi xoá: ' + error.message, true);
    } else {
        showToast('Đã xoá khu vực!');
        loadAreas(); // Load lại danh sách
    }
}

// --- 4. THÊM KHU VỰC MỚI ---
function openAddAreaModal() {
    document.getElementById('modal-area').classList.add('show');
    document.getElementById('area-name').value = '';
}

document.getElementById('form-area').onsubmit = async (e) => {
    e.preventDefault();
    const name = document.getElementById('area-name').value;
    const type = document.getElementById('area-type').value;
    
    const { error } = await supabaseClient.from('areas').insert([{ 
        building_id: currentBuildingId, name: name, type: type 
    }]);

    if (error) showToast('Lỗi: ' + error.message, true);
    else {
        showToast('Đã thêm khu vực!');
        closeModal('modal-area');
        loadAreas();
    }
};

// --- 5. MODAL THÊM GIỜ LÀM VIỆC ---
function openScheduleModal(area) {
    currentAreaIdForSchedule = area.id;
    document.getElementById('schedule-area-title').innerText = `Giờ làm việc: ${area.name}`;
    document.getElementById('modal-schedule').classList.add('show');
    
    const rowsContainer = document.getElementById('schedule-rows');
    rowsContainer.innerHTML = '';

    const existing = dbSchedules.filter(s => s.area_id === area.id);
    if (existing.length > 0) {
        existing.forEach(s => addScheduleRow(s.start_time.substring(0,5), s.tasks?.name));
    } else {
        addScheduleRow(); // Tạo 1 dòng trống mặc định
    }
}

function addScheduleRow(time = '', content = '') {
    const container = document.getElementById('schedule-rows');
    
    // Cấu trúc Swipe cho dòng giờ
    const wrapper = document.createElement('div');
    wrapper.className = 'schedule-row-wrapper';
    
    const deleteBtn = document.createElement('div');
    deleteBtn.className = 'schedule-row-delete';
    deleteBtn.innerHTML = 'Xoá';
    
    const row = document.createElement('div');
    row.className = 'schedule-row';
    row.innerHTML = `
        <input type="time" class="input-time" value="${time}" required>
        <input type="text" class="input-task" placeholder="Nội dung (VD: Quét sàn)" value="${content}" required>
    `;

    wrapper.appendChild(deleteBtn);
    wrapper.appendChild(row);

    // Khởi tạo Swipe cho dòng (kéo 60px để hiện nút Xoá)
    handleSwipe(row, wrapper, 60, () => {
        wrapper.remove(); // Xoá phần tử khỏi DOM
    });

    container.appendChild(wrapper);
}

// Lưu Lịch Trình
async function saveSchedules() {
    const rows = document.querySelectorAll('#schedule-rows .schedule-row');
    if (rows.length === 0) return closeModal('modal-schedule');

    const btn = document.querySelector('#modal-schedule .btn-primary');
    btn.innerText = 'Đang lưu...'; btn.disabled = true;

    let successCount = 0;

    // Xoá lịch trình cũ của khu vực này
    await supabaseClient.from('schedules').delete().eq('area_id', currentAreaIdForSchedule);

    for (const row of rows) {
        const time = row.querySelector('.input-time').value;
        const taskName = row.querySelector('.input-task').value;

        if (!time || !taskName) continue;

        let taskId;
        const { data: existingTask } = await supabaseClient.from('tasks').select('id').eq('name', taskName).single();
        
        if (existingTask) {
            taskId = existingTask.id;
        } else {
            const { data: newTask } = await supabaseClient.from('tasks').insert([{ name: taskName }]).select().single();
            taskId = newTask.id;
        }

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
    loadAreas();
}

// Bắt đầu chạy
initBuildings();