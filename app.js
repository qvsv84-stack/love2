// 1. KHỞI TẠO SUPABASE
// Thay link và key của bạn vào đây
const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Hiển thị ngày hôm nay
document.getElementById('current-date').innerText = new Date().toLocaleDateString('vi-VN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
});

// 2. HÀM LẤY DỮ LIỆU TỪ DATABASE
async function fetchTasks() {
    const taskListEl = document.getElementById('task-list');

    // Truy vấn bảng schedules, join với areas, buildings và tasks
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

    if (error) {
        console.error('Lỗi lấy dữ liệu:', error);
        taskListEl.innerHTML = `<p class="error">Lỗi tải dữ liệu. Vui lòng kiểm tra console.</p>`;
        return;
    }

    // Nếu không có dữ liệu
    if (data.length === 0) {
        taskListEl.innerHTML = `<p>Chưa có lịch trình nào được tạo.</p>`;
        return;
    }

    // 3. RENDER GIAO DIỆN
    taskListEl.innerHTML = ''; // Xóa chữ Loading
    
    data.forEach(item => {
        // Cắt chuỗi giờ (VD: '08:30:00' -> '08:30')
        const timeStr = item.start_time.substring(0, 5); 
        const taskName = item.tasks?.name || 'Không rõ';
        const areaName = item.areas?.name || 'Không rõ';
        const buildingName = item.areas?.buildings?.name || '';
        const note = item.note ? `<div class="task-note">Ghi chú: ${item.note}</div>` : '';

        // Tạo thẻ div cho mỗi công việc
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

// 4. HÀM ĐÁNH DẤU HOÀN THÀNH (Lưu log lên Supabase)
async function markComplete(scheduleId, btnElement) {
    // Đổi trạng thái nút để tránh bấm 2 lần
    btnElement.innerText = 'Đang lưu...';
    btnElement.disabled = true;

    // Thêm 1 dòng vào bảng task_logs
    const { data, error } = await supabaseClient
        .from('task_logs')
        .insert([
            { 
                schedule_id: scheduleId, 
                staff_name: 'Giám sát viên (Test)', // Sau này lấy từ tài khoản đăng nhập
                status: 'COMPLETED'
            }
        ]);

    if (error) {
        alert('Lỗi khi lưu: ' + error.message);
        btnElement.innerText = 'Hoàn thành';
        btnElement.disabled = false;
    } else {
        // Thành công thì đổi màu nút và thẻ
        btnElement.innerText = 'Đã xong ✓';
        btnElement.classList.add('done');
        document.getElementById(`task-${scheduleId}`).classList.add('completed');
    }
}

// Chạy hàm lấy dữ liệu khi mở app
fetchTasks();