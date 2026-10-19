// 1. THÔNG TIN SUPABASE ĐÃ ĐƯỢC ĐIỀN SẴN
const SUPABASE_URL = 'https://cjswxglxyyqrcfbyyjer.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_jgRKlQFfL09zN_uU3P6SnQ_F_1UAJx9';

let supabaseClient;

try {
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (e) {
    document.getElementById('task-list').innerHTML = `<p style="color:red; font-weight:bold;">Lỗi khởi tạo Supabase: Kiểm tra lại link hoặc Key!</p>`;
}

// Hiển thị ngày hôm nay
document.getElementById('current-date').innerText = new Date().toLocaleDateString('vi-VN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
});

// 2. HÀM LẤY DỮ LIỆU
async function fetchTasks() {
    const taskListEl = document.getElementById('task-list');

    if (!supabaseClient) return;

    // Lấy dữ liệu từ bảng schedules và liên kết với các bảng khác
    const { data, error } = await supabaseClient
        .from('schedules')
        .select(`
            id,
            start_time,
            note,
            tasks ( name ),
            areas ( name, buildings ( name ) )
        `)
        .order('start_time', { ascending: true });

    // NẾU CÓ LỖI TỪ SUPABASE (Thường do RLS chặn quyền đọc)
    if (error) {
        taskListEl.innerHTML = `
            <div style="background: #ffe6e6; padding: 15px; border-radius: 8px; color: #d8000c; margin-top: 20px;">
                <strong>Lỗi kết nối Supabase:</strong><br>
                ${error.message}<br><br>
                <i>*Cách sửa: Vào Supabase -> Table Editor -> Chọn bảng schedules -> Bấm nút RLS và tắt nó đi. Làm tương tự với bảng task_logs.</i>
            </div>`;
        return;
    }

    // NẾU KHÔNG CÓ DỮ LIỆU NÀO
    if (data.length === 0) {
        taskListEl.innerHTML = `
            <div style="text-align: center; color: #666; padding: 20px; background: white; border-radius: 8px; margin-top: 20px;">
                <p>Chưa có dữ liệu công việc nào.</p>
                <p>Hãy vào <b>Supabase -> Table Editor</b> để thêm dữ liệu mẫu (Tòa nhà, Khu vực, Công việc, Lịch trình).</p>
            </div>`;
        return;
    }

    // 3. HIỂN THỊ DỮ LIỆU
    taskListEl.innerHTML = ''; 
    
    data.forEach(item => {
        const timeStr = item.start_time.substring(0, 5); // Cắt chuỗi '08:30:00' thành '08:30'
        const taskName = item.tasks?.name || 'Chưa rõ công việc';
        const areaName = item.areas?.name || 'Chưa rõ khu vực';
        const buildingName = item.areas?.buildings?.name || 'Chưa rõ tòa nhà';
        const note = item.note ? `<div class="task-note">Ghi chú: ${item.note}</div>` : '';

        const card = document.createElement('div');
        card.className = 'task-card';
        card.id = `task-${item.id}`;
        
        card.innerHTML = `
            <div class="task-info">
                <div class="task-time">${timeStr}</div>
                <div class="task-name">${taskName}</div>
                <div class="task-location">📍 ${buildingName} - ${areaName}</div>
                ${note}
            </div>
            <button class="btn-check" onclick="markComplete('${item.id}', this)">Hoàn thành</button>
        `;
        
        taskListEl.appendChild(card);
    });
}

// 4. HÀM LƯU LỊCH SỬ KHI BẤM NÚT HOÀN THÀNH
async function markComplete(scheduleId, btnElement) {
    btnElement.innerText = 'Đang lưu...';
    btnElement.disabled = true;

    // Thêm 1 dòng vào bảng task_logs
    const { error } = await supabaseClient
        .from('task_logs')
        .insert([{ schedule_id: scheduleId, status: 'COMPLETED' }]);

    if (error) {
        alert('Lỗi khi lưu: ' + error.message + '\nHãy kiểm tra lại quyền (RLS) của bảng task_logs xem đã cho phép Insert chưa.');
        btnElement.innerText = 'Hoàn thành';
        btnElement.disabled = false;
    } else {
        btnElement.innerText = 'Đã xong ✓';
        btnElement.classList.add('done');
        document.getElementById(`task-${scheduleId}`).classList.add('completed');
    }
}

// Chạy app
fetchTasks();