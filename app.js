const SUPABASE_URL = 'https://cjswxglxyyqrcfbyyjer.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_jgRKlQFfL09zN_uU3P6SnQ_F_1UAJx9';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ==========================================
// MODULE: UI (Xử lý DOM, Toast, Modal)
// ==========================================
const UI = {
    showLoader(show) {
        document.getElementById('global-loader').classList.toggle('hidden', !show);
    },
    showToast(msg, isErr = false) {
        const t = document.getElementById('toast');
        t.innerText = msg;
        t.className = `toast show ${isErr ? 'error' : ''}`;
        setTimeout(() => t.classList.remove('show'), 2500);
    },
    openModal(id) {
        document.getElementById(id).classList.add('show');
        document.body.style.overflow = 'hidden'; // Chặn scroll body
    },
    closeModal(id) {
        document.getElementById(id).classList.remove('show');
        document.body.style.overflow = ''; // Mở lại scroll
    },
    addScheduleRow(time = '', content = '') {
        const container = document.getElementById('schedule-rows');
        const wrapper = document.createElement('div');
        wrapper.className = 'schedule-row-wrapper';
        
        const deleteBtn = document.createElement('div');
        deleteBtn.className = 'schedule-row-delete';
        deleteBtn.innerText = 'Xoá';
        
        const row = document.createElement('div');
        row.className = 'schedule-row';
        row.innerHTML = `
            <input type="time" class="input-time" value="${time}" required step="60">
            <input type="text" class="input-task" placeholder="Nội dung (VD: Quét sàn)" value="${content}" required maxlength="100">
        `;

        wrapper.appendChild(deleteBtn);
        wrapper.appendChild(row);
        
        // Tương tác vuốt xoá
        this.bindSwipeToDelete(row, wrapper, 60, () => wrapper.remove());
        container.appendChild(wrapper);
    },

    // Hàm dùng chung xử lý vuốt (Swipe)
    bindSwipeToDelete(element, wrapper, deleteBtnWidth, onDelete) {
        let startX = 0, startY = 0, currentX = 0;
        let isDragging = false, isOpen = false;

        wrapper.querySelector('.swipe-delete-btn, .schedule-row-delete').addEventListener('click', onDelete);

        element.addEventListener('touchstart', (e) => {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            isDragging = false;
            element.style.transition = 'none';
        }, { passive: true });

        element.addEventListener('touchmove', (e) => {
            if (!startX || !startY) return;
            const deltaX = e.touches[0].clientX - startX;
            const deltaY = e.touches[0].clientY - startY;

            // Nếu vuốt dọc nhiều hơn ngang -> Cho phép scroll trang, không vuốt xóa
            if (!isDragging && Math.abs(deltaY) > Math.abs(deltaX)) return; 
            
            // Nếu vuốt ngang nhiều hơn -> Kích hoạt xóa
            if (Math.abs(deltaX) > Math.abs(deltaY)) {
                isDragging = true;
                e.preventDefault(); // Chặn scroll khi đang vuốt xóa
            }

            if (isDragging) {
                currentX = deltaX;
                let moveX = isOpen ? currentX - deleteBtnWidth : currentX;
                if (moveX > 0) moveX = 0;
                if (moveX < -deleteBtnWidth) moveX = -deleteBtnWidth;
                element.style.transform = `translateX(${moveX}px)`;
            }
        }, { passive: false });

        element.addEventListener('touchend', () => {
            element.style.transition = 'transform 0.2s';
            if (isDragging) {
                let moveX = isOpen ? currentX - deleteBtnWidth : currentX;
                if (moveX < -deleteBtnWidth / 2) {
                    element.style.transform = `translateX(-${deleteBtnWidth}px)`;
                    isOpen = true;
                } else {
                    element.style.transform = `translateX(0)`;
                    isOpen = false;
                }
            }
            startX = 0; startY = 0;
        });
        
        // Click ra ngoài để đóng
        element.addEventListener('click', (e) => {
            if (isDragging) { e.preventDefault(); e.stopPropagation(); return; }
            if (isOpen) { element.style.transform = 'translateX(0)'; isOpen = false; e.preventDefault(); }
        });
    }
};

// ==========================================
// MODULE: APP (Xử lý Logic & Database)
// ==========================================
const App = {
    state: {
        currentBuildingId: null,
        currentAreaId: null,
        areas: [],
        longPressTimer: null,
    },

    async init() {
        // Đảm bảo luôn có 5 toà nhà
        const { data: buildings } = await supabaseClient.from('buildings').select('*').order('name');
        if (!buildings || buildings.length < 5) {
            for (let i = 1; i <= 5; i++) {
                const bName = `Tòa nhà B${i}`;
                if (!buildings || !buildings.find(b => b.name === bName)) {
                    await supabaseClient.from('buildings').insert([{ name: bName }]);
                }
            }
        }
        this.switchBuilding(1);
    },

    async switchBuilding(index) {
        document.querySelectorAll('.nav-building').forEach(btn => btn.classList.remove('active'));
        document.querySelector(`.nav-building[data-index="${index}"]`).classList.add('active');
        document.getElementById('header-title').innerText = `Tòa Nhà B${index}`;

        // Dùng lệnh .single() sẽ báo lỗi nếu tìm thấy > 1, nên dùng limit(1)
        const { data: bData } = await supabaseClient.from('buildings').select('id').eq('name', `Tòa nhà B${index}`).limit(1).single();
        if (!bData) return;
        
        this.state.currentBuildingId = bData.id;
        this.loadAreas();
    },

    async loadAreas() {
        const listEl = document.getElementById('area-list');
        listEl.innerHTML = '<div class="skeleton-card"></div><div class="skeleton-card"></div>';

        // TỐI ƯU: Lấy luôn cả Schedules và Tasks trong 1 câu query duy nhất
        const { data, error } = await supabaseClient
            .from('areas')
            .select(`
                id, name, type,
                schedules ( id, start_time, tasks ( name ) )
            `)
            .eq('building_id', this.state.currentBuildingId)
            .order('created_at', { ascending: true });

        if (error) {
            listEl.innerHTML = `<div style="text-align:center; color:var(--danger); padding:20px;">Lỗi tải dữ liệu</div>`;
            return;
        }

        this.state.areas = data || [];
        listEl.innerHTML = '';

        if (data.length === 0) {
            listEl.innerHTML = '<div style="text-align:center; color:#888; margin-top:50px;">Chưa có khu vực nào.<br>Bấm nút + để thêm mới.</div>';
            return;
        }

        data.forEach(area => {
            // Sắp xếp schedule theo giờ
            const sortedSchedules = (area.schedules || []).sort((a, b) => a.start_time.localeCompare(b.start_time));
            
            let scheduleHtml = sortedSchedules.length > 0 
                ? sortedSchedules.map(s => `
                    <div class="schedule-item">
                        <span class="schedule-time">${s.start_time.substring(0,5)}</span>
                        <span>${s.tasks?.name || 'N/A'}</span>
                    </div>`).join('')
                : '<div style="color:#aaa; font-style:italic;">Chưa có giờ làm việc (Nhấn giữ để thêm)</div>';

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
            
            // Gắn sự kiện Vuốt Xóa
            UI.bindSwipeToDelete(card, wrapper, 80, () => this.deleteArea(area.id, area.name));

            // Gắn sự kiện Nhấn giữ
            this.bindLongPress(card, area);

            listEl.appendChild(wrapper);
        });
    },

    bindLongPress(element, area) {
        let startX = 0, startY = 0;
        
        const startPress = (e) => {
            const touch = e.touches ? e.touches[0] : e;
            startX = touch.clientX;
            startY = touch.clientY;
            
            element.classList.add('pressed'); // Hiệu ứng visual
            
            this.state.longPressTimer = setTimeout(() => {
                if (navigator.vibrate) navigator.vibrate(50); // Rung phản hồi
                element.classList.remove('pressed');
                this.openScheduleModal(area);
            }, 800);
        };
        
        const cancelPress = (e) => {
            clearTimeout(this.state.longPressTimer);
            element.classList.remove('pressed');
        };

        const handleMove = (e) => {
            if (!this.state.longPressTimer) return;
            const touch = e.touches ? e.touches[0] : e;
            // Nếu ngón tay di chuyển quá 10px (vuốt) -> Hủy nhấn giữ
            if (Math.abs(touch.clientX - startX) > 10 || Math.abs(touch.clientY - startY) > 10) {
                cancelPress();
            }
        };

        element.addEventListener('touchstart', startPress);
        element.addEventListener('touchend', cancelPress);
        element.addEventListener('touchmove', handleMove);
        element.addEventListener('touchcancel', cancelPress);
        element.addEventListener('mousedown', startPress);
        element.addEventListener('mouseup', cancelPress);
        element.addEventListener('mouseleave', cancelPress);
        element.addEventListener('contextmenu', e => e.preventDefault());
    },

    async deleteArea(areaId, areaName) {
        if (!confirm(`Xoá khu vực "${areaName}"?\nMọi giờ làm việc bên trong cũng sẽ bị xoá.`)) return;
        
        UI.showLoader(true);
        const { error } = await supabaseClient.from('areas').delete().eq('id', areaId);
        UI.showLoader(false);
        
        if (error) UI.showToast('Lỗi xoá: ' + error.message, true);
        else { UI.showToast('Đã xoá khu vực'); this.loadAreas(); }
    },

    openScheduleModal(area) {
        this.state.currentAreaId = area.id;
        document.getElementById('schedule-area-title').innerText = `Giờ làm việc: ${area.name}`;
        UI.openModal('modal-schedule');
        
        const rowsContainer = document.getElementById('schedule-rows');
        rowsContainer.innerHTML = '';

        const existing = area.schedules || [];
        if (existing.length > 0) {
            existing.forEach(s => UI.addScheduleRow(s.start_time.substring(0,5), s.tasks?.name || ''));
        } else {
            UI.addScheduleRow();
        }
    },

    async saveSchedules() {
        const rows = document.querySelectorAll('#schedule-rows .schedule-row');
        if (rows.length === 0) return UI.closeModal('modal-schedule');

        const btn = document.getElementById('btn-save-schedules');
        btn.innerText = 'Đang xử lý...'; btn.disabled = true;
        UI.showLoader(true);

        try {
            // 1. Thu thập dữ liệu từ form
            const formData = Array.from(rows).map(row => ({
                time: row.querySelector('.input-time').value,
                taskName: row.querySelector('.input-task').value.trim()
            })).filter(item => item.time && item.taskName);

            // Check trùng giờ
            const times = formData.map(f => f.time);
            if (new Set(times).size !== times.length) {
                throw new Error("Có khung giờ bị trùng nhau. Vui lòng kiểm tra lại.");
            }

            // 2. Xoá tất cả lịch trình cũ của khu vực này
            await supabaseClient.from('schedules').delete().eq('area_id', this.state.currentAreaId);

            if (formData.length === 0) {
                UI.showToast('Đã xoá toàn bộ giờ làm việc');
                UI.closeModal('modal-schedule');
                this.loadAreas();
                return;
            }

            // 3. Lấy danh sách các Task hiện có (Tối ưu Bulk)
            const uniqueTaskNames = [...new Set(formData.map(f => f.taskName))];
            const { data: existingTasks } = await supabaseClient.from('tasks').select('id, name').in('name', uniqueTaskNames);
            
            const taskMap = new Map(existingTasks.map(t => [t.name, t.id]));
            const newTaskNames = uniqueTaskNames.filter(name => !taskMap.has(name));

            // 4. Insert các Task mới (nếu có) - Bulk Insert
            if (newTaskNames.length > 0) {
                const newTasksPayload = newTaskNames.map(name => ({ name }));
                const { data: createdTasks } = await supabaseClient.from('tasks').insert(newTasksPayload).select();
                createdTasks.forEach(t => taskMap.set(t.name, t.id));
            }

            // 5. Tạo payload Schedules và Bulk Insert
            const schedulesPayload = formData.map(item => ({
                area_id: this.state.currentAreaId,
                task_id: taskMap.get(item.taskName),
                start_time: item.time + ':00',
                frequency: 'DAILY'
            }));

            const { error: insertError } = await supabaseClient.from('schedules').insert(schedulesPayload);
            if (insertError) throw insertError;

            UI.showToast(`Đã lưu ${schedulesPayload.length} khung giờ`);
            UI.closeModal('modal-schedule');
            this.loadAreas();

        } catch (error) {
            UI.showToast(error.message, true);
        } finally {
            btn.innerText = 'Lưu Tất Cả'; btn.disabled = false;
            UI.showLoader(false);
        }
    }
};

// ==========================================
// BIND EVENTS & START
// ==========================================
document.getElementById('form-area').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-save-area');
    const name = document.getElementById('area-name').value.trim();
    const type = document.getElementById('area-type').value;
    
    // Check trùng tên khu vực
    if (App.state.areas.some(a => a.name.toLowerCase() === name.toLowerCase())) {
        return UI.showToast('Tên khu vực này đã tồn tại!', true);
    }

    btn.innerText = 'Đang lưu...'; btn.disabled = true;
    
    const { error } = await supabaseClient.from('areas').insert([{ 
        building_id: App.state.currentBuildingId, name, type 
    }]);

    btn.innerText = 'Tạo Khu Vực'; btn.disabled = false;

    if (error) UI.showToast('Lỗi: ' + error.message, true);
    else {
        UI.showToast('Đã thêm khu vực mới');
        UI.closeModal('modal-area');
        App.loadAreas();
        e.target.reset();
    }
});

// Khởi động app
App.init();