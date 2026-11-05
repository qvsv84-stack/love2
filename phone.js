// phone.js — Module xử lý SĐT: Gọi / Zalo / Copy
// Tách riêng để dễ fix Zalo, không ảnh hưởng app.js

export function initPhoneModule(ctx) {
  const { toast, openModal, closeModal } = ctx;

  let currentPhone = '';

  /* ========== MỞ MODAL ========== */
  function showPhoneAction(phone) {
    if (!phone) return;
    currentPhone = String(phone).trim();
    const el = document.getElementById('phoneActionNumber');
    if (el) el.textContent = currentPhone;
    openModal('phoneActionModal');
  }

  /* ========== GỌI ĐIỆN ========== */
  function callPhoneNumber() {
    if (!currentPhone) return;
    window.location.href = 'tel:' + currentPhone;
    closeModal('phoneActionModal');
  }

  /* ========== SAO CHÉP ========== */
  async function copyPhoneNumber() {
    if (!currentPhone) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(currentPhone);
      } else {
        const ta = document.createElement('textarea');
        ta.value = currentPhone;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      toast('📋 Đã sao chép ' + currentPhone);
      closeModal('phoneActionModal');
    } catch {
      toast('Không sao chép được');
    }
  }

  /* ========== KIỂM TRA THIẾT BỊ ========== */
  function isMobile() {
    const ua = (navigator.userAgent || '').toLowerCase();
    return /android|iphone|ipad|ipod|mobile/i.test(ua);
  }

  /* ========== MỞ ZALO ==========
   * Chiến lược:
   * - Mobile: dùng deep link `zalo://` → mở app trực tiếp
   *   + Recovery sau 1.2s nếu bị kẹt trang trắng (chưa cài app / app crash)
   *   + Toast hướng dẫn sau 3s nếu app không mở
   * - Desktop: KHÔNG thử deep link (chắc chắn fail) → hiện modal hướng dẫn + tự copy SĐT
   * - Không dùng iframe (iOS Safari 16+ block)
   * - Không fallback zalo.me (Zalo giới hạn, hay báo "không tồn tại")
   */
  function openZalo() {
    if (!currentPhone) return;
    closeModal('phoneActionModal');

    if (!isMobile()) {
      showZaloDesktopHint(currentPhone);
      return;
    }

    // Mobile: thử deep link
    const deepLink = `zalo://conversation?phone=${encodeURIComponent(currentPhone)}`;
    const returnUrl = window.location.href;
    let recovered = false;

    try {
      window.location.href = deepLink;
    } catch (_) {
      // Một số browser block — recovery sẽ lo
    }

    // Recovery: sau 1.2s nếu URL không còn là http(s) → đang kẹt trang trắng → quay về
    setTimeout(() => {
      if (recovered) return;
      recovered = true;
      const href = window.location.href;
      if (href !== returnUrl && !href.startsWith('http')) {
        try {
          window.location.replace(returnUrl);
        } catch (_) {
          try { window.history.back(); } catch (__) {}
        }
      }
    }, 1200);

    // Sau 3s: vẫn ở trang gốc (app không mở) → hiện hướng dẫn
    setTimeout(() => {
      if (window.location.href === returnUrl) {
        toast('Zalo chưa mở. Vào app Zalo, tìm số ' + currentPhone, 4000);
      }
    }, 3000);
  }

  /* ========== HƯỚNG DẪN DESKTOP ========== */
  function showZaloDesktopHint(phone) {
    // Tự copy SĐT
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(phone).catch(() => {});
    } else {
      try {
        const ta = document.createElement('textarea');
        ta.value = phone;
        ta.style.cssText = 'position:fixed;left:-9999px;';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      } catch (_) {}
    }

    // Modal hướng dẫn
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,46,51,0.6);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(2px);';
    modal.innerHTML = `
      <div style="background:white;border-radius:16px;padding:24px;max-width:400px;width:100%;text-align:center;font-family:'Be Vietnam Pro',sans-serif;">
        <div style="font-size:44px;margin-bottom:12px;line-height:1;">💬</div>
        <h3 style="font-size:17px;font-weight:700;margin:0 0 8px;color:#0f2e33;">Mở Zalo để chat</h3>
        <p style="font-size:13.5px;color:#5c7c82;margin:0 0 16px;line-height:1.5;">
          Zalo không hỗ trợ mở trực tiếp trên máy tính.<br>Vui lòng làm theo 2 bước sau:
        </p>
        <div style="background:#f0fdfe;padding:14px 16px;border-radius:10px;text-align:left;font-size:13.5px;color:#0f2e33;margin-bottom:14px;line-height:1.8;">
          <div>① Mở app Zalo trên điện thoại</div>
          <div>② Tìm số: <strong style="color:#0068ff;font-size:15px;">${phone}</strong></div>
        </div>
        <p style="font-size:12px;color:#16a34a;margin:0 0 14px;font-weight:600;">
          ✓ Số đã được sao chép tự động
        </p>
        <button
          style="width:100%;padding:12px;background:#0068ff;color:white;border:none;border-radius:10px;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;"
          data-close-zalo-modal>
          Đã hiểu
        </button>
      </div>
    `;

    // Đóng khi click backdrop
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });

    document.body.appendChild(modal);

    // Nút "Đã hiểu"
    const btn = modal.querySelector('[data-close-zalo-modal]');
    if (btn) btn.addEventListener('click', () => modal.remove());
  }

  /* ========== BIND EVENTS ========== */
  function bindEvents() {
    const callBtn = document.getElementById('phoneCallBtn');
    const copyBtn = document.getElementById('phoneCopyBtn');
    const zaloBtn = document.getElementById('phoneZaloBtn');
    const modal = document.getElementById('phoneActionModal');

    if (callBtn) callBtn.addEventListener('click', callPhoneNumber);
    if (copyBtn) copyBtn.addEventListener('click', copyPhoneNumber);
    if (zaloBtn) zaloBtn.addEventListener('click', openZalo);

    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target.id === 'phoneActionModal') closeModal('phoneActionModal');
      });
    }
  }

  bindEvents();

  /* ========== API ========== */
  return {
    showPhoneAction,
  };
}