async function openSettingsModal(){
  if (!state.isAdmin) return;
  
  openModal('checkinUpdateModal');
  
  const $coords = $('#checkinUpdateCoords');
  const $list = $('#checkinIpList');
  const $btnAdd = $('#btnAddCurrentIp');
  
  if ($coords) $coords.innerHTML = '⏳ Đang lấy IP mạng hiện tại...';
  if ($btnAdd) $btnAdd.style.display = 'none';
  
  // Kiểm tra xem có đang dùng 4G không (Network Information API)
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const isCellular = conn && (conn.type === 'cellular' || conn.effectiveType === '4g' && !conn.type); // Fallback
  // Lưu ý: API này không hỗ trợ trên iOS, nên nếu undefined ta sẽ cho qua nhưng hiện cảnh báo.
  
  const currentIp = await getPublicIP();
  const loc = state.checkinLocation;
  const currentAllowed = loc?.allowed_ips || [];
  
  if ($coords) {
    if (!currentIp) {
      $coords.innerHTML = `<span style="color:#dc2626;">❌ Lỗi mạng. Không lấy được IP.</span>`;
    } else {
      let warningHtml = '';
      if (conn && conn.type === 'cellular') {
        warningHtml = `<div style="font-size:13px; color:#dc2626; font-weight:bold; margin-top:8px; background:#fee2e2; padding:8px; border-radius:6px;">⚠ CẢNH BÁO: Bạn đang dùng mạng 4G!</div>`;
      }
      
      $coords.innerHTML = `
        <div style="font-size:18px; font-weight:bold; color:var(--ocean-700);">${currentIp}</div>
        <div style="font-size:12px; color:var(--text-muted); margin-top:4px;">IP của mạng bạn đang kết nối</div>
        ${warningHtml}
      `;
    }
  }

  // Render danh sách IP
  if ($list) {
    if (currentAllowed.length === 0) {
      $list.innerHTML = `<div style="color:#b45309; font-size:13px; text-align:center; padding:10px;">Chưa có WiFi nào được lưu.</div>`;
    } else {
      $list.innerHTML = currentAllowed.map(ip => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 12px; background:#f1f5f9; border-radius:8px; margin-bottom:8px; border:1px solid #e2e8f0;">
          <span style="font-weight:600; font-size:14px;">${ip}</span>
          <button class="btn-remove-ip" data-ip="${ip}" style="background:#fee2e2; color:#dc2626; border:none; padding:6px 12px; border-radius:6px; font-size:12px; font-weight:bold; cursor:pointer;">Xoá</button>
        </div>
      `).join('');
      
      $list.querySelectorAll('.btn-remove-ip').forEach(btn => {
        btn.onclick = async () => {
          if (!confirm('Xoá IP này khỏi danh sách cho phép?')) return;
          const ipToRemove = btn.dataset.ip;
          const newIps = currentAllowed.filter(i => i !== ipToRemove);
          await supabase.from('cslx_checkin_location').update({ allowed_ips: newIps }).eq('id', LOCATION_ID);
          toast('Đã xoá IP');
          await loadLocation();
          openSettingsModal();
        };
      });
    }
  }

  // Nút thêm IP
  if ($btnAdd) {
    if (currentIp && !currentAllowed.includes(currentIp)) {
      $btnAdd.style.display = 'block';
      $btnAdd.textContent = '+ Lưu WiFi này cho Nhân viên';
      $btnAdd.disabled = false;
      
      // Nếu đang dùng 4G, đổi màu nút hoặc cảnh báo
      if (conn && conn.type === 'cellular') {
        $btnAdd.style.background = '#dc2626'; // Màu đỏ cảnh báo
      } else {
        $btnAdd.style.background = ''; // Màu mặc định
      }

      $btnAdd.onclick = async () => {
        // Nếu phát hiện là 4G, chặn không cho lưu (áp dụng cho Android)
        if (conn && conn.type === 'cellular') {
          if(!confirm('⚠️ Bạn đang dùng 4G. IP này là của nhà mạng, không phải WiFi trường. Bạn có CHẮC CHẮN muốn lưu IP 4G này không?')) return;
        }

        $btnAdd.textContent = '⏳ Đang lưu...';
        $btnAdd.disabled = true;
        const newIps = [...currentAllowed, currentIp];
        const { error } = await supabase.from('cslx_checkin_location').upsert({ id: LOCATION_ID, allowed_ips: newIps }, { onConflict: 'id' });
        
        if (error) {
          toast('Lỗi: ' + error.message);
          $btnAdd.textContent = '+ Lưu WiFi này cho Nhân viên';
          $btnAdd.disabled = false;
        } else {
          toast(`✅ Đã lưu IP thành công!`);
          await loadLocation();
          openSettingsModal();
        }
      };
    } else if (currentIp && currentAllowed.includes(currentIp)) {
      $coords.innerHTML += `<div style="font-size:13px; color:#16a34a; font-weight:bold; margin-top:6px;">✓ IP này đã được lưu trong hệ thống</div>`;
    }
  }
}