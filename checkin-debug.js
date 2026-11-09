// checkin-debug.js — Panel debug chuyên GPS chấm công
// Mở bằng Ctrl+Shift+G
import { state } from './core.js';

let _panelEl = null;
let _logEl = null;
let _isOpen = false;
let _lines = [];
let _testing = false;

function _esc(s){return String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function _isIOS(){return /iPad|iPhone|iPod/.test(navigator.userAgent||'');}
function _isAndroid(){return /Android/.test(navigator.userAgent||'');}
function _isPWA(){
  if(window.matchMedia){
    try{
      if(window.matchMedia('(display-mode: standalone)').matches) return true;
      if(window.matchMedia('(display-mode: fullscreen)').matches) return true;
      if(window.matchMedia('(display-mode: minimal-ui)').matches) return true;
    }catch{}
  }
  if(navigator.standalone===true) return true;
  if(document.referrer && document.referrer.startsWith('android-app://')) return true;
  return false;
}
function _isInApp(){
  const ua=navigator.userAgent||'';
  return {
    zalo:/Zalo/i.test(ua),
    facebook:/FBAN|FBAV|FB_IAB|FBIOS/i.test(ua),
    messenger:/Messenger/i.test(ua),
    instagram:/Instagram/i.test(ua),
    line:/Line\//i.test(ua),
    twitter:/Twitter/i.test(ua),
    telegram:/Telegram/i.test(ua),
    wechat:/MicroMessenger/i.test(ua),
    coc_coc:/coc_coc_browser/i.test(ua),
  };
}

function _log(level, msg){
  const t=new Date();
  const time=`${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}:${String(t.getSeconds()).padStart(2,'0')}`;
  _lines.push({time,level,msg});
  const prefix={ok:'✅',error:'❌',warn:'⚠️',info:'ℹ️',hint:'👉'}[level]||'·';
  console.log('[GPS-DBG]',prefix,msg);
  if(_logEl)_appendLine({time,level,msg});
}
function _appendLine({time,level,msg}){
  if(!_logEl)return;
  const color={ok:'#32d74b',error:'#ff453a',warn:'#ffd60a',info:'#64d2ff',hint:'#bf5af2'}[level]||'#e5e5ea';
  const div=document.createElement('div');
  div.style.cssText='padding:5px 0;border-bottom:1px solid #2c2c2e;font-size:11.5px;line-height:1.5;display:flex;gap:6px;';
  div.innerHTML=`<span style="color:#8e8e93;flex-shrink:0;">${time}</span><span style="color:${color};word-break:break-word;flex:1;">${_esc(msg)}</span>`;
  _logEl.appendChild(div);
  _logEl.scrollTop=_logEl.scrollHeight;
}
function _clearLog(){_lines=[];if(_logEl)_logEl.innerHTML='';}

function _buildPanel(){
  if(_panelEl)return;
  _panelEl=document.createElement('div');
  _panelEl.id='checkinDebugPanel';
  _panelEl.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.94);z-index:99999;display:none;flex-direction:column;font-family:SF Mono,Menlo,Consolas,monospace;color:#e5e5ea;font-size:12px;backdrop-filter:blur(6px);';
  _panelEl.innerHTML=`
    <div style="padding:10px 14px;background:#1c1c1e;border-bottom:1px solid #333;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
      <span style="font-weight:700;color:#64d2ff;font-size:13px;">📍 GPS DEBUG — Chấm công</span>
      <button id="cdbgClose" type="button" style="background:#48484a;color:#fff;border:none;padding:5px 12px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:12px;">Đóng</button>
    </div>
    <div style="padding:8px 12px;background:#2c2c2e;display:grid;grid-template-columns:1fr 1fr;gap:6px;flex-shrink:0;">
      <button data-cdbg="run" style="grid-column:1/-1;padding:11px;background:#007aff;color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:700;">▶️ Chạy test GPS (đầy đủ)</button>
      <button data-cdbg="request" style="padding:9px;background:#30d158;color:#000;border:none;border-radius:6px;cursor:pointer;font-family:inherit;font-size:11px;font-weight:700;">🔓 Xin quyền lại</button>
      <button data-cdbg="watch" style="padding:9px;background:#ff9500;color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:inherit;font-size:11px;font-weight:600;">👁 Test watch (5s)</button>
      <button data-cdbg="distance" style="padding:9px;background:#bf5af2;color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:inherit;font-size:11px;font-weight:600;">📏 Khoảng cách</button>
      <button data-cdbg="env" style="padding:9px;background:#48484a;color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:inherit;font-size:11px;font-weight:600;">🌍 Env</button>
      <button data-cdbg="copy" style="padding:9px;background:#ff3b30;color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:inherit;font-size:11px;font-weight:600;">📋 Copy report</button>
      <button data-cdbg="clear" style="padding:9px;background:#48484a;color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:inherit;font-size:11px;font-weight:600;">🧹 Clear log</button>
    </div>
    <div style="padding:6px 14px;background:#000;border-bottom:1px solid #2c2c2e;font-size:10.5px;color:#8e8e93;flex-shrink:0;line-height:1.5;">
      💡 Test xong → bấm <b style="color:#ff3b30;">Copy report</b> gửi cho support nếu vẫn lỗi
    </div>
    <div id="cdbgLog" style="flex:1;overflow-y:auto;padding:10px 12px;background:#000;-webkit-overflow-scrolling:touch;"></div>
  `;
  document.body.appendChild(_panelEl);
  _logEl=_panelEl.querySelector('#cdbgLog');
  _panelEl.querySelector('#cdbgClose').addEventListener('click',closeCheckinDebug);
  _panelEl.querySelectorAll('[data-cdbg]').forEach(b=>b.addEventListener('click',()=>_runAction(b.dataset.cdbg)));
  _lines.forEach(_appendLine);
}

export function openCheckinDebug(){_buildPanel();_panelEl.style.display='flex';_isOpen=true;}
export function closeCheckinDebug(){if(_panelEl)_panelEl.style.display='none';_isOpen=false;}
export function toggleCheckinDebug(){_isOpen?closeCheckinDebug():openCheckinDebug();}

function _runAction(a){
  switch(a){
    case 'run':return runAllTests();
    case 'request':return testRequestPermission();
    case 'watch':return testWatchPosition();
    case 'distance':return testDistanceFromSchool();
    case 'env':return testEnv();
    case 'copy':return copyReport();
    case 'clear':return _clearLog();
  }
}

async function testEnv(){
  _log('info','=== ENV ===');
  _log('info',`URL: ${location.href}`);
  _log('info',`protocol: ${location.protocol} · secureContext: ${window.isSecureContext}`);
  _log('info',`iOS: ${_isIOS()} · Android: ${_isAndroid()}`);
  _log('info',`PWA Standalone: ${_isPWA()}`);
  const flags=_isInApp();
  const detected=Object.entries(flags).filter(([_,v])=>v).map(([k])=>k);
  _log('info',`In-app: ${detected.length?detected.join(', '):'không'}`);
  _log('info',`UA: ${navigator.userAgent}`);
  _log('info',`user: ${state.user?.email||'null'} · isAdmin: ${state.isAdmin}`);
  _log('info',`location: ${state.checkinLocation?`${state.checkinLocation.lat?.toFixed(6)},${state.checkinLocation.lng?.toFixed(6)} (r=${state.checkinLocation.radius_m}m)`:'null'}`);
  _log('info',`userPos: ${state.checkinUserPos?`${state.checkinUserPos.lat.toFixed(6)},${state.checkinUserPos.lng.toFixed(6)} ±${Math.round(state.checkinUserPos.accuracy)}m`:'null'}`);
  const err=state.checkinGpsError;
  _log('info',`gpsError: ${err?String(err).replace(/<[^>]+>/g,'').slice(0,120):'null'}`);
}

async function testSecureContext(){
  _log('info','=== 1. Secure Context ===');
  if(window.isSecureContext){_log('ok',`HTTPS OK (${location.protocol}//${location.hostname})`);return true;}
  _log('error',`KHÔNG an toàn — protocol=${location.protocol} · host=${location.hostname}`);
  _log('hint','Chrome Android CHẶN CỨNG GPS nếu không HTTPS.');
  return false;
}

function testGeolocationAPI(){
  _log('info','=== 2. Geolocation API ===');
  if(navigator.geolocation){_log('ok','navigator.geolocation có sẵn');return true;}
  _log('error','navigator.geolocation KHÔNG có');
  return false;
}

function testContext(){
  _log('info','=== 3. Context (tab/PWA/in-app) ===');
  const pwa=_isPWA();
  if(pwa){
    if(_isAndroid()){
      _log('info',`📱 PWA STANDALONE (Android) — đã cài qua Add to Home Screen`);
      _log('hint','⚠️ PWA Android cần quyền Location RIÊNG ở cấp Android');
      _log('hint','Cài đặt → Ứng dụng → [tên app "Chấm Công"] → Quyền → Vị trí → Cho phép');
    }else if(_isIOS()){
      _log('info',`📱 PWA STANDALONE (iOS) — đã cài qua Add to Home Screen`);
      _log('hint','Cài đặt iOS → Ứng dụng → [tên app] → Vị trí → Cho phép');
    }
    return true;
  }
  const flags=_isInApp();
  const detected=Object.entries(flags).filter(([_,v])=>v).map(([k])=>k);
  if(detected.length>0){
    _log('error',`Đang mở trong: ${detected.join(', ')}`);
    _log('hint','Bấm ⋮ → "Mở bằng trình duyệt" / "Mở bằng Chrome".');
    return false;
  }
  _log('ok','Chrome/Safari tab thường');
  return true;
}

async function testPermissionAPI(){
  _log('info','=== 4. Permissions API ===');
  if(!navigator.permissions||!navigator.permissions.query){_log('warn','Permissions API không hỗ trợ');return 'unknown';}
  try{
    const p=await navigator.permissions.query({name:'geolocation'});
    if(p.state==='granted')_log('ok','Permission: GRANTED ✅');
    else if(p.state==='prompt')_log('warn','Permission: PROMPT (chưa cấp)');
    else if(p.state==='denied'){
      _log('error','Permission: DENIED ❌ — đã bị chặn');
      if(_isAndroid()&&_isPWA()){
        _log('hint','PWA: Cài đặt Android → Ứng dụng → [tên app] → Quyền → Vị trí');
      }else if(_isAndroid()){
        _log('hint','Chrome tab: 🔒 thanh địa chỉ → Quyền → Vị trí → Cho phép');
        _log('hint','Hoặc: chrome://settings/content/location');
      }else if(_isIOS()){
        _log('hint','iOS: Cài đặt → [tên app/Safari] → Vị trí → Cho phép');
      }
    }else _log('warn',`Permission: ${p.state}`);
    return p.state;
  }catch(e){_log('error','Query permission lỗi: '+e.message);return 'unknown';}
}

function _getPositionWithTimeout(ms=15000){
  return new Promise(resolve=>{
    let done=false;
    const timer=setTimeout(()=>{if(done)return;done=true;resolve({ok:false,error:{code:3,message:'Timeout nội bộ '+ms+'ms'}});},ms);
    try{
      navigator.geolocation.getCurrentPosition(
        pos=>{if(done)return;done=true;clearTimeout(timer);resolve({ok:true,pos});},
        err=>{if(done)return;done=true;clearTimeout(timer);resolve({ok:false,error:err});},
        {enableHighAccuracy:true,timeout:ms,maximumAge:0}
      );
    }catch(e){
      if(done)return;done=true;clearTimeout(timer);
      resolve({ok:false,error:{code:-1,message:e.message}});
    }
  });
}

async function testGetCurrentPosition(){
  _log('info','=== 5. getCurrentPosition (timeout 15s) ===');
  const t0=performance.now();
  const r=await _getPositionWithTimeout(15000);
  const ms=Math.round(performance.now()-t0);
  if(r.ok){
    const c=r.pos.coords;
    _log('ok',`THÀNH CÔNG (${ms}ms) · lat=${c.latitude.toFixed(6)} · lng=${c.longitude.toFixed(6)} · ±${Math.round(c.accuracy)}m`);
    return r;
  }
  const code=r.error?.code;
  _log('error',`THẤT BẠI (${ms}ms) · code=${code} · ${r.error?.message||''}`);
  if(code===1){
    _log('hint','code 1 = PERMISSION_DENIED');
    if(_isAndroid()&&_isPWA()){
      _log('hint','PWA Android: Cài đặt → Ứng dụng → [tên app] → Quyền → Vị trí → Cho phép');
      _log('hint','Sau khi bật → TẮT HẲN app (vuốt khỏi recents) → mở lại');
    }else if(_isAndroid()){
      _log('hint','① Bấm 🔒 thanh địa chỉ → Quyền → Vị trí → Cho phép');
      _log('hint','② chrome://settings/content/location → xoá domain khỏi Block');
      _log('hint','③ Cài đặt máy → Ứng dụng → Chrome → Quyền → Vị trí');
      _log('hint','④ Bật "Vị trí chính xác" trong Cài đặt máy');
    }else if(_isIOS()){
      _log('hint','aA → Cài đặt trang web → Vị trí / hoặc Cài đặt iOS → Safari → Vị trí');
    }
  }else if(code===2){
    _log('hint','code 2 = POSITION_UNAVAILABLE — GPS tắt / không tín hiệu');
  }else if(code===3){
    _log('hint','code 3 = TIMEOUT — trong nhà / GPS chưa fix. Ra ngoài trời + bật WiFi.');
  }
  return r;
}

async function testWatchPosition(){
  _log('info','=== 6. watchPosition (5s) ===');
  if(!navigator.geolocation){_log('error','Không có geolocation');return;}
  let got=0;let _wid=null;
  await new Promise(resolve=>{
    const timer=setTimeout(()=>{if(_wid!=null){try{navigator.geolocation.clearWatch(_wid)}catch{}}resolve();},5000);
    try{
      _wid=navigator.geolocation.watchPosition(
        pos=>{
          got++;
          const c=pos.coords;
          _log('ok',`callback #${got} · lat=${c.latitude.toFixed(6)} · lng=${c.longitude.toFixed(6)} · ±${Math.round(c.accuracy)}m`);
          if(got>=1){clearTimeout(timer);try{navigator.geolocation.clearWatch(_wid)}catch{}resolve();}
        },
        err=>{_log('error',`watch err · code=${err.code} · ${err.message||''}`);clearTimeout(timer);try{navigator.geolocation.clearWatch(_wid)}catch{}resolve();},
        {enableHighAccuracy:true,timeout:10000,maximumAge:5000}
      );
    }catch(e){_log('error','watchPosition throw: '+e.message);clearTimeout(timer);resolve();}
  });
  if(got===0)_log('warn','Không có callback nào trong 5s — nghi GPS chưa được cấp quyền');
}

async function testDistanceFromSchool(){
  _log('info','=== 7. Khoảng cách tới điểm chấm ===');
  if(!state.checkinLocation){_log('warn','Chưa có state.checkinLocation — vào tab Chấm công trước');return;}
  if(!state.checkinUserPos){_log('warn','Chưa có state.checkinUserPos — chạy "Test GPS" trước');return;}
  const loc=state.checkinLocation,pos=state.checkinUserPos;
  const R=6371000,toRad=x=>x*Math.PI/180;
  const dLat=toRad(pos.lat-loc.lat),dLng=toRad(pos.lng-loc.lng);
  const a=Math.sin(dLat/2)**2+Math.cos(toRad(loc.lat))*Math.cos(toRad(pos.lat))*Math.sin(dLng/2)**2;
  const dist=R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
  _log('info',`Điểm chấm: ${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)} · bán kính ${loc.radius_m}m`);
  _log('info',`Vị trí bạn: ${pos.lat.toFixed(6)}, ${pos.lng.toFixed(6)} · ±${Math.round(pos.accuracy)}m`);
  if(dist<=loc.radius_m)_log('ok',`Cách ${Math.round(dist)}m — TRONG vùng ✅`);
  else _log('error',`Cách ${Math.round(dist)}m — NGOÀI vùng (còn thiếu ${Math.round(dist-loc.radius_m)}m) ❌`);
}

async function testRequestPermission(){
  _log('info','=== Xin quyền lại (getCurrentPosition) ===');
  const r=await _getPositionWithTimeout(20000);
  if(r.ok){
    _log('ok',`Đã được cấp quyền · lat=${r.pos.coords.latitude.toFixed(6)} · lng=${r.pos.coords.longitude.toFixed(6)}`);
  }else{
    _log('error',`Vẫn fail · code=${r.error?.code} · ${r.error?.message||''}`);
    await testPermissionAPI();
  }
}

async function runAllTests(){
  if(_testing){_log('warn','Đang chạy test khác...');return;}
  _testing=true;_clearLog();
  _log('info',`=== BẮT ĐẦU · ${new Date().toLocaleString('vi-VN')} ===`);
  try{
    await testEnv();
    const secure=await testSecureContext();
    const hasAPI=testGeolocationAPI();
    const ctxOk=testContext();
    const perm=await testPermissionAPI();
    if(!secure||!hasAPI||!ctxOk){
      _log('error','❌ DỪNG — lỗi ở bước cơ bản, sửa trước khi test tiếp');
    }else{
      if(perm==='denied')_log('warn','Permission DENIED — bấm "Xin quyền lại" để thử mở popup');
      await testGetCurrentPosition();
      await testWatchPosition();
      await testDistanceFromSchool();
    }
    _log('ok','🏁 DONE');
  }catch(e){_log('error','Crash: '+(e.message||e));}
  finally{_testing=false;}
}

function _generateReport(){
  const L=[];
  L.push('=== GPS DEBUG REPORT ===');
  L.push('Time: '+new Date().toISOString());
  L.push('URL: '+location.href);
  L.push('UA: '+navigator.userAgent);
  L.push('secureContext: '+window.isSecureContext);
  L.push('iOS: '+_isIOS()+' · Android: '+_isAndroid());
  L.push('PWAStandalone: '+_isPWA());
  const flags=_isInApp();
  const detected=Object.entries(flags).filter(([_,v])=>v).map(([k])=>k);
  L.push('InApp: '+(detected.join(',')||'no'));
  L.push('location: '+(state.checkinLocation?`${state.checkinLocation.lat},${state.checkinLocation.lng} r=${state.checkinLocation.radius_m}`:'null'));
  L.push('userPos: '+(state.checkinUserPos?`${state.checkinUserPos.lat},${state.checkinUserPos.lng} ±${state.checkinUserPos.accuracy}`:'null'));
  L.push('appVersion: '+(window.__APP_VERSION||'?'));
  L.push('---');
  for(const l of _lines)L.push(`[${l.time}] [${l.level}] ${l.msg}`);
  return L.join('\n');
}

async function copyReport(){
  const txt=_generateReport();
  try{
    if(navigator.clipboard&&window.isSecureContext){
      await navigator.clipboard.writeText(txt);
    }else{
      const ta=document.createElement('textarea');
      ta.value=txt;ta.style.cssText='position:fixed;left:-9999px;';
      document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);
    }
    _log('ok','📋 Đã copy report ('+txt.length+' ký tự) — paste vào chat để gửi support');
  }catch(e){_log('error','Copy thất bại: '+e.message);console.log(txt);}
}

export function initCheckinDebug(){
  window.__checkinDebug={open:openCheckinDebug,close:closeCheckinDebug,toggle:toggleCheckinDebug,run:runAllTests,testEnv,copyReport};
  window.addEventListener('keydown',e=>{
    if(e.ctrlKey&&e.shiftKey&&(e.key==='G'||e.key==='g')){e.preventDefault();toggleCheckinDebug();}
  });
  console.log('%c[GPS-DBG] ready — Ctrl+Shift+G để mở panel GPS','color:#64d2ff;font-weight:bold;font-size:13px');
}