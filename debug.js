// debug.js — Panel debug: log, test imports, check auth, network
import { $, toast } from './core.js';

let _logLines = [];
let _panelEl = null;
let _logEl = null;
let _isOpen = false;

/* ============ LOG ============ */
export function dbg(level, msg, extra) {
  const t = new Date();
  const time = `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}:${String(t.getSeconds()).padStart(2,'0')}`;
  const line = { time, level, msg, extra };
  _logLines.push(line);
  if (_logLines.length > 500) _logLines.shift();

  console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log']('[DBG]', msg, extra || '');

  if (_logEl) _appendLogLine(line);
}

function _appendLogLine(line) {
  const div = document.createElement('div');
  div.className = 'dbg-line dbg-' + line.level;
  div.innerHTML = `<span class="dbg-time">${line.time}</span><span class="dbg-msg">${_esc(line.msg)}</span>`;
  _logEl.appendChild(div);
  _logEl.scrollTop = _logEl.scrollHeight;
}

function _esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ============ BUILD PANEL ============ */
function _buildPanel() {
  if (_panelEl) return;
  _panelEl = document.createElement('div');
  _panelEl.id = 'debugPanel';
  _panelEl.style.cssText = `
    position:fixed; inset:0; background:rgba(0,0,0,0.85); z-index:99999;
    display:none; flex-direction:column; font-family:SF Mono,Menlo,monospace;
    color:#e5e5ea; font-size:12px; backdrop-filter:blur(4px);
  `;
  _panelEl.innerHTML = `
    <div style="padding:10px 14px;background:#1c1c1e;border-bottom:1px solid #333;display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
      <span style="font-weight:700;color:#64d2ff">🔍 DEBUG PANEL</span>
      <button id="dbgClose" style="background:#48484a;color:#fff;border:none;padding:5px 12px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:12px">Đóng</button>
    </div>
    <div style="padding:8px 12px;background:#2c2c2e;display:grid;grid-template-columns:1fr 1fr;gap:6px;flex-shrink:0">
      <button data-dbg="imports" style="padding:8px;background:#007aff;color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:inherit;font-size:11px;font-weight:600">📦 Test imports</button>
      <button data-dbg="auth" style="padding:8px;background:#ff9500;color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:inherit;font-size:11px;font-weight:600">🔑 Test auth</button>
      <button data-dbg="network" style="padding:8px;background:#ff9500;color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:inherit;font-size:11px;font-weight:600">🌐 Test network</button>
      <button data-dbg="env" style="padding:8px;background:#48484a;color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:inherit;font-size:11px;font-weight:600">🌍 Env info</button>
      <button data-dbg="state" style="padding:8px;background:#48484a;color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:inherit;font-size:11px;font-weight:600">📋 State</button>
      <button data-dbg="run-all" style="padding:8px;background:#bf5af2;color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:inherit;font-size:11px;font-weight:600">▶️ Chạy tất cả</button>
      <button data-dbg="clear" style="padding:8px;background:#48484a;color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:inherit;font-size:11px;font-weight:600">🧹 Xoá log</button>
      <button data-dbg="copy" style="padding:8px;background:#ff3b30;color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:inherit;font-size:11px;font-weight:600">📋 Copy log</button>
      <button data-dbg="reload" style="padding:8px;background:#16a34a;color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:inherit;font-size:11px;font-weight:600;grid-column:1/-1">🔄 Tải lại trang</button>
    </div>
    <div id="dbgLog" style="flex:1;overflow-y:auto;padding:8px 12px;background:#000"></div>
  `;
  document.body.appendChild(_panelEl);
  _logEl = _panelEl.querySelector('#dbgLog');

  // Bind
  _panelEl.querySelector('#dbgClose').addEventListener('click', closeDebug);
  _panelEl.querySelectorAll('[data-dbg]').forEach(btn => {
    btn.addEventListener('click', () => _runAction(btn.dataset.dbg));
  });

  // Replay log đã có
  _logLines.forEach(line => _appendLogLine(line));
}

/* ============ SHOW/HIDE ============ */
export function openDebug() {
  _buildPanel();
  _panelEl.style.display = 'flex';
  _isOpen = true;
}

export function closeDebug() {
  if (_panelEl) _panelEl.style.display = 'none';
  _isOpen = false;
}

export function toggleDebug() {
  if (_isOpen) closeDebug(); else openDebug();
}

/* ============ ACTIONS ============ */
async function _runAction(action) {
  switch (action) {
    case 'imports': return testImports();
    case 'auth': return testAuth();
    case 'network': return testNetwork();
    case 'env': return envInfo();
    case 'state': return stateInfo();
    case 'run-all': return runAll();
    case 'clear': _logLines = []; if (_logEl) _logEl.innerHTML = ''; return;
    case 'copy': return copyLog();
    case 'reload': return location.reload();
  }
}

export async function testImports() {
  dbg('info', '=== TEST IMPORTS ===');
  const modules = [
    './supabase.js',
    './core.js',
    './phone.js',
    './employees.js',
    './buildings.js',
    './attendance.js',
    './excel.js',
    './export.js',
    './salary.js',
  ];

  for (const path of modules) {
    try {
      const mod = await import(path);
      const exports = Object.keys(mod).length;
      dbg('ok', `✅ ${path} — ${exports} exports`);
    } catch (err) {
      dbg('error', `❌ ${path} — ${err.message}`);
    }
  }

  // Test app.js riêng (không import lại — chỉ check tồn tại)
  try {
    const res = await fetch('./app.js', { method: 'HEAD' });
    dbg(res.ok ? 'ok' : 'error', `${res.ok ? '✅' : '❌'} ./app.js — HTTP ${res.status}`);
  } catch (err) {
    dbg('error', `❌ ./app.js — ${err.message}`);
  }
}

export async function testAuth() {
  dbg('info', '=== TEST AUTH ===');
  try {
    const { supabase } = await import('./supabase.js');
    dbg('ok', `✅ supabase client: ${supabase ? 'ready' : 'null'}`);
    dbg('info', `URL: ${supabase?.supabaseUrl || '?'}`);
    dbg('info', `Key: ${supabase?.supabaseKey ? supabase.supabaseKey.slice(0,20)+'...' : '?'}`);

    const t0 = performance.now();
    const { data, error } = await supabase.auth.getSession();
    const ms = Math.round(performance.now() - t0);
    if (error) {
      dbg('error', `❌ getSession: ${error.message} (${ms}ms)`);
    } else {
      dbg('ok', `✅ getSession OK (${ms}ms) — session: ${data?.session ? 'có' : 'không'}`);
    }
  } catch (err) {
    dbg('error', `❌ auth test crash: ${err.message}`);
  }
}

export async function testNetwork() {
  dbg('info', '=== TEST NETWORK ===');
  const endpoints = [
    ['Supabase REST', 'https://cjswxglxyyqrcfbyyjer.supabase.co/rest/v1/', { method: 'HEAD' }],
    ['Google Fonts', 'https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro', { method: 'HEAD' }],
    ['jsDelivr', 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm', { method: 'HEAD' }],
    ['html2canvas CDN', 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js', { method: 'HEAD' }],
  ];

  for (const [name, url, opts] of endpoints) {
    const t0 = performance.now();
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      clearTimeout(tid);
      const ms = Math.round(performance.now() - t0);
      dbg(res.ok || res.status === 401 ? 'ok' : 'warn',
        `${res.ok ? '✅' : '⚠️'} ${name} — HTTP ${res.status} (${ms}ms)`);
    } catch (err) {
      const ms = Math.round(performance.now() - t0);
      dbg('error', `❌ ${name} — ${err.message} (${ms}ms)`);
    }
  }
}

export async function envInfo() {
  dbg('info', '=== ENV ===');
  dbg('info', `protocol: ${location.protocol}`);
  dbg('info', `hostname: ${location.hostname || '(empty)'}`);
  dbg('info', `href: ${location.href.slice(0, 100)}`);
  dbg('info', `UA: ${navigator.userAgent.slice(0, 100)}`);
  dbg('info', `window.supabase SDK: ${window.__supabaseCreateClient ? '✅' : '❌'}`);
  dbg('info', `SUPABASE_URL: ${window.__supabaseUrl || '(chưa set)'}`);
  dbg('info', `fetch: ${typeof fetch}`);
  dbg('info', `TextDecoder: ${typeof TextDecoder}`);
  dbg('info', `ReadableStream: ${typeof ReadableStream}`);
}

export async function stateInfo() {
  dbg('info', '=== STATE ===');
  try {
    const { state } = await import('./core.js');
    dbg('info', `user: ${state.user?.id || 'null'}`);
    dbg('info', `isAdmin: ${state.isAdmin}`);
    dbg('info', `employees: ${state.employees.length}`);
    dbg('info', `selectedEmployeeId: ${state.selectedEmployeeId || 'null'}`);
    dbg('info', `attendance: ${state.attendance.length}`);
    dbg('info', `buildings: ${state.buildings.length}`);
    dbg('info', `floors: ${state.floors.length}`);
    dbg('info', `currentMonth: ${state.currentMonth.toISOString().slice(0, 7)}`);
  } catch (err) {
    dbg('error', `❌ state read fail: ${err.message}`);
  }
}

export async function runAll() {
  _logLines = [];
  if (_logEl) _logEl.innerHTML = '';
  await envInfo();
  await testImports();
  await testAuth();
  await testNetwork();
  await stateInfo();
  dbg('ok', '🏁 DONE');
}

async function copyLog() {
  const txt = _logLines.map(l => `[${l.time}] ${l.msg}`).join('\n');
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(txt);
    } else {
      const ta = document.createElement('textarea');
      ta.value = txt;
      ta.style.cssText = 'position:fixed;left:-9999px;';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    toast('📋 Đã copy ' + _logLines.length + ' dòng');
  } catch {
    toast('Không copy được');
  }
}

/* ============ AUTO INIT ============ */
export function initDebugModule() {
  // Bắt global errors
  window.addEventListener('error', (e) => {
    dbg('error', `💥 ${e.message || 'unknown'} @ ${e.filename || '?'}:${e.lineno || '?'}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    dbg('error', `💥 unhandled: ${r?.message || r || 'unknown'}`);
  });

  // Phím tắt Ctrl+Shift+D
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
      e.preventDefault();
      toggleDebug();
    }
  });

  dbg('ok', '🔍 Debug module ready (Ctrl+Shift+D để mở)');
}