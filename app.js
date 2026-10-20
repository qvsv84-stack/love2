const SUPABASE_URL = 'https://cjswxglxyyqrcfbyyjer.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_jgRKlQFfL09zN_uU3P6SnQ_F_1UAJx9';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ==========================================
// MODULE: UI (Xử lý DOM, Toast, Modal, Drawer)
// ==========================================
const UI = {
    showLoader(show) { document.getElementById('global-loader').classList.toggle('hidden', !show); },
    showToast(msg, isErr = false) {
        const t = document.getElementById('toast');
        t.innerText = msg;
        t.className = `toast show ${isErr ? 'error' : ''}`;
        setTimeout(() => t.classList.remove('show'), 2500);
    },
    
    // Quản lý Modal Bottom Sheet
    openModal(id) { document.getElementById(id).classList.add('show'); document.body.style.overflow = 'hidden'; },
    closeModal(id) { document.getElementById(id).classList.remove('show'); document.body.style.overflow = ''; },

    // Quản lý Menu Drawer
    openDrawer() { 
        document.getElementById('sidebar').classList.add('open'); 
        document.getElementById('drawer-overlay').classList.add('show'); 
        document.body.style.overflow = 'hidden'; 
    },
    closeDrawer() { 
        document.getElementById('sidebar').classList.remove('open'); 
        document.getElementById('drawer-overlay').classList.remove('show'); 
        document.body.style.overflow = ''; 
    },

    // Mở Modal Sửa Tòa nhà
    openEditBuildingModal() {
        const currentB = App.state.buildings.find(b => b.id === App.state.currentBuildingId);
        if (!currentB) return;
        document.getElementById('building-modal-title').innerText = 'Sửa Tên Tòa Nhà';
        document.getElementById('building-name').value = currentB.name;
        App.state.editingBuildingId = currentB.id;
        this.openModal('modal-building');
    },

    // Mở Modal Thêm Tòa nhà
    openAddBuildingModal() {
        document.getElementById('building-modal-title').innerText = 'Thêm Tòa Nhà Mới';
        document.getElementById('building-name').value = '';
        App.state.editingBuildingId = null;
        this.closeDrawer(); // Đóng menu trước khi mở modal
        setTimeout(() => this.openModal('modal-building'), 300); // Đợi menu đóng xong mới mở modal
    },

    openAddAreaModal() {
        document.getElementById('area-name').value = '';
        this.openModal('modal-area');
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
        this.bindSwipeToDelete(row, wrapper, 60, () => wrapper.remove());
        container.appendChild(wrapper);

        setTimeout(() => {
            const modalBody = document.querySelector('#modal-schedule .bottom-sheet');
            if (modalBody) modalBody.scrollTop = modalBody.scrollHeight;
        }, 50);
    },

    bindSwipeToDelete(element, wrapper, deleteBtnWidth, onDelete) {
        let startX = 0, startY = 0, currentX = 0;
        let isDragging = false, isOpen = false;

        wrapper.querySelector('.swipe-delete-btn, .schedule-row-delete').addEventListener('click', onDelete);

        element.addEventListener('touchstart', (e) => {
            startX = e.touches[0].clientX; startY = e.touches[0].clientY;
            isDragging = false; element.style.transition = 'none';
        }, { passive: true });

        element.addEventListener('touchmove', (e) => {
            if (!startX || !startY) return;
            const deltaX = e.touches[0].clientX - startX;
            const deltaY = e.touches[0].clientY - startY;
            if (!isDragging && Math.abs(deltaY) > Math.abs(deltaX)) return; 
            if (Math.abs(deltaX) > Math.abs(deltaY)) { isDragging = true; e.preventDefault(); }

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
                    element.style.transform = `translateX(-${deleteBtnWidth}px)`; isOpen = true;
                } else {
                    element.style.transform = `translateX(0)`; isOpen = false;
                }
            }
            startX = 0; startY = 0;
        });
        
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
        buildings: [],
        currentBuildingId: null,
        currentAreaId: null,
        areas: [],
        longPressTimer: null,
        editingBuildingId: null
    },

    async init() {
        const { data: buildings } = await supabaseClient.from('buildings').select('id, name').order('created_at', { ascending: true });
        
        if (!buildings || buildings.length === 0) {
            const { data: newB } = await supabaseClient.from('buildings').insert([{ name: 'Tòa nhà B1' }]).select();
            this.state.buildings = newB;
        } else {
            this.state.buildings = buildings;
        }

        this.renderBuildingSidebar();
        this.switchBuilding(this.state.buildings[0].id);
    },

    // Render danh sách tòa nhà vào Menu Drawer
    renderBuildingSidebar() {
        const list = document.getElementById('building-list');
        list.innerHTML = '';

        this.state.buildings.forEach(b => {
            const div = document.createElement('div');
            div.className = `building-item ${b.id === this.state.currentBuildingId ? 'active' : ''}`;
            div.innerHTML = `<span>🏢 ${b.name}</span>`;
            div.onclick = () => this.switchBuilding(b.id);
            list.appendChild(div);
        });
    },

    async switchBuilding(buildingId) {
        this.state.currentBuildingId = buildingId;
        UI.closeDrawer(); // Chọn xong thì tự động đóng menu
        
        // Cập nhật lại UI của Sidebar
        this.renderBuildingSidebar();

        const currentB = this.state.buildings.find(b => b.id === buildingId);
        document.getElementById('header-title').innerText = currentB ? currentB.name : 'Lỗi';
        document.getElementById('btn-edit-building').style.display = 'flex';

        this.loadAreas();
    },

    async loadAreas() {
        const listEl = document.getElementById('area-list');
        listEl.innerHTML = '<div class="skeleton-card"></div><div class="skeleton-card"></div>';

        const { data, error } = await supabaseClient
            .from('areas')
            .select(`id, name, type, schedules ( id, start_time, tasks ( name ) )`)
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
            const sortedSchedules = (area.schedules || []).sort((a, b) => a.start_time.localeCompare(b.start_time));
            let scheduleHtml = sortedSchedules.length > 0 
                ? sortedSchedules.map(s => `<div class="schedule-item"><span class="schedule-time">${s.start_time.substring(0,5)}</span><span>${s.tasks?.name || 'N/A'}</span></div>`).join('')
                : '<div style="color:#aaa; font-style:italic;">Chưa có giờ làm việc (Nhấn giữ để thêm)</div>';

            const wrapper = document.createElement('div');
            wrapper.className = 'swipe-wrapper';
            
            const deleteBtn = document.createElement('div');
            deleteBtn.className = 'swipe-delete-btn';
            deleteBtn.innerHTML = '🗑️ Xoá';
            
            const card = document.createElement('div');
            card.className = 'area-card';
            card.innerHTML = `
                <div class="area-title">${area.name}<span class="area-type-badge">${area.type === 'INDOOR' ? '🏢 Trong nhà' : '🌳 Ngoài trời'}</span></div>
                <div class="area-schedules">${scheduleHtml}</div>
            `;

            wrapper.appendChild(deleteBtn);
            wrapper.appendChild(card);
            
            UI.bindSwipeToDelete(card, wrapper, 80, () => this.deleteArea(area.id, area.name));
            this.bindLongPress(card, area);
            listEl.appendChild(wrapper);
        });
    },

    bindLongPress(element, area) {
        let startX = 0, startY = 0;
        const startPress = (e) => {
            const touch = e.touches ? e.touches[0] : e;
            startX = touch.clientX; startY = touch.clientY;
            element.classList.add('pressed');
            this.state.longPressTimer = setTimeout(() => {
                if (navigator.vibrate) navigator.vibrate(50);
                element.classList.remove('pressed');
                this.openScheduleModal(area);
            }, 800);
        };
        const cancelPress = () => { clearTimeout(this.state.longPressTimer); element.classList.remove('pressed'); };
        const handleMove = (e) => {
            if (!this.state.longPressTimer) return;
            const touch = e.touches ? e.touches[0] : e;
            if (Math.abs(touch.clientX - startX) > 10 || Math.abs(touch.clientY - startY) > 10) cancelPress();
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
        if (existing.length > 0) existing.forEach(s => UI.addScheduleRow(s.start_time.substring(0,5), s.tasks?.name || ''));
        else UI.addScheduleRow();
    },

    async saveSchedules() {
        const rows = document.querySelectorAll('#schedule-rows .schedule-row');
        if (rows.length === 0) return UI.closeModal('modal-schedule');

        const btn = document.getElementById('btn-save-schedules');
        btn.innerText = 'Đang xử lý...'; btn.disabled = true;
        UI.showLoader(true);

        try {
            const formData = Array.from(rows).map(row => ({
                time: row.querySelector('.input-time').value,
                taskName: row.querySelector('.input-task').value.trim()
            })).filter(item => item.time && item.taskName);

            await supabaseClient.from('schedules').delete().eq('area_id', this.state.currentAreaId);

            if (formData.length === 0) {
                UI.showToast('Đã xoá toàn bộ giờ làm việc');
                UI.closeModal('modal-schedule');
                this.loadAreas();
                return;
            }

            const uniqueTaskNames = [...new Set(formData.map(f => f.taskName))];
            const { data: existingTasks } = await supabaseClient.from('tasks').select('id, name').in('name', uniqueTaskNames);
            const taskMap = new Map(existingTasks.map(t => [t.name, t.id]));
            const newTaskNames = uniqueTaskNames.filter(name => !taskMap.has(name));

            if (newTaskNames.length > 0) {
                const newTasksPayload = newTaskNames.map(name => ({ name }));
                const { data: createdTasks } = await supabaseClient.from('tasks').insert(newTasksPayload).select();
                createdTasks.forEach(t => taskMap.set(t.name, t.id));
            }

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

document.getElementById('form-building').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-save-building');
    const name = document.getElementById('building-name').value.trim();
    const isEdit = App.state.editingBuildingId !== null;

    btn.innerText = 'Đang lưu...'; btn.disabled = true;

    let error;
    if (isEdit) {
        const res = await supabaseClient.from('buildings').update({ name }).eq('id', App.state.editingBuildingId);
        error = res.error;
    } else {
        const res = await supabaseClient.from('buildings').insert([{ name }]);
        error = res.error;
    }

    btn.innerText = 'Lưu Tòa Nhà'; btn.disabled = false;

    if (error) return UI.showToast('Lỗi: ' + error.message, true);
    
    UI.showToast(isEdit ? 'Đã cập nhật tên' : 'Đã thêm tòa nhà');
    UI.closeModal('modal-building');
    
    // Load lại danh sách tòa nhà mới
    const { data: newBuildings } = await supabaseClient.from('buildings').select('id, name').order('created_at', { ascending: true });
    App.state.buildings = newBuildings;
    App.renderBuildingSidebar();
    
    if (isEdit) {
        if (App.state.currentBuildingId === App.state.editingBuildingId) {
            document.getElementById('header-title').innerText = name;
        }
    } else {
        // Nếu thêm mới, tự động chuyển sang tòa nhà vừa thêm
        const newlyAdded = newBuildings.find(b => b.name === name);
        if (newlyAdded) App.switchBuilding(newlyAdded.id);
    }
});

document.getElementById('form-area').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-save-area');
    const name = document.getElementById('area-name').value.trim();
    const type = document.getElementById('area-type').value;
    
    if (App.state.areas.some(a => a.name.toLowerCase() === name.toLowerCase())) {
        return UI.showToast('Tên khu vực này đã tồn tại!', true);
    }

    btn.innerText = 'Đang lưu...'; btn.disabled = true;
    const { error } = await supabaseClient.from('areas').insert([{ building_id: App.state.currentBuildingId, name, type }]);
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