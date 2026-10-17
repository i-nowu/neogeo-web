// neogeo-webemu frontend (PRIVATE). Runs Sim Gunma with the GB clean-room TEST BIOS.
(async () => {
  const qs = new URLSearchParams(location.search);
  const sys = qs.get('sys') === 'aes' ? 'aes' : 'mvs';
  document.getElementById('sys').value = sys;
  const SYS = sys === 'aes' ? 0 : 1, REGION = sys === 'aes' ? 1 /*JP*/ : 3 /*EU: sp-s2.sp1*/;
  const FPS = sys === 'aes' ? 59.599 : 59.1856;

  const AC = window.AudioContext || window.webkitAudioContext;
  let actx = null; try { actx = new AC({ latencyHint: 'interactive' }); } catch (e) { actx = null; }
  const rate = actx ? actx.sampleRate : 48000;

  const M = await NeoCore();
  const b64 = s => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  const put = u => { const p = M._ng_alloc(u.length); M.HEAPU8.set(u, p); return [p, u.length]; };
  if (!window.NEO_ROMS) { alert('roms.local.js がありません (tools/mkroms.py を実行)'); return; }
  M._ng_init(SYS, REGION, rate);
  if (!M._ng_load_bios(...put(b64(NEO_ROMS[sys === 'aes' ? 'bios_aes' : 'bios_mvs'])))) { alert('BIOS読込失敗'); return; }
  if (!M._ng_load_neo(...put(b64(NEO_ROMS.neo)))) { alert('ROM読込失敗'); return; }

  // ---- video ----
  const cv = document.getElementById('screen'), ctx = cv.getContext('2d');
  const img = ctx.createImageData(304, 224), out32 = new Uint32Array(img.data.buffer);
  function blit() {
    const p = M._ng_video() >> 2, pitch = M._ng_video_pitch(), H = M.HEAPU32;
    let o = 0;
    for (let y = 0; y < 224; y++) { let s = p + y * pitch;
      for (let x = 0; x < 304; x++) { const c = H[s++]; out32[o++] = 0xff000000 | ((c & 0xff) << 16) | (c & 0xff00) | ((c >> 16) & 0xff); } }
    ctx.putImageData(img, 0, 0);
  }
  const wrap = document.getElementById('screen-wrap');
  function layout() {
    const W = wrap.clientWidth, Hh = wrap.clientHeight;
    const AR = 4 / 3; // display aspect of the Neo Geo picture
    let w = Math.min(W, Hh * AR), h = w / AR;
    const n = Math.floor(h / 224);            // integer scale when it fits
    if (n >= 2 && n * 224 * AR <= W) { h = n * 224; w = h * AR; }
    cv.style.width = Math.floor(w) + 'px'; cv.style.height = Math.floor(h) + 'px';
  }
  new ResizeObserver(layout).observe(wrap); addEventListener('orientationchange', () => setTimeout(layout, 200)); layout();

  // ---- audio (starts only after a user gesture) ----
  const RB = new Int16Array(rate), RBN = RB.length; let rbw = 0, rbr = 0, muted = false;
  const fill = () => (rbw - rbr + RBN) % RBN;
  function pushAudio() {
    const n = M._ng_audio_count(); if (!actx || actx.state !== 'running') return;
    const p = M._ng_audio() >> 1, A = M.HEAP16;
    if (fill() + n > RBN * 0.5) return; // drop if too far ahead
    for (let i = 0; i < n; i++) { RB[rbw] = A[p + i]; rbw = (rbw + 1) % RBN; }
  }
  if (actx) {
    const sp = actx.createScriptProcessor(1024, 0, 2);
    sp.onaudioprocess = e => { const L = e.outputBuffer.getChannelData(0), R = e.outputBuffer.getChannelData(1);
      for (let i = 0; i < L.length; i++) { if (fill() >= 2 && !muted) { L[i] = RB[rbr] / 32768; R[i] = RB[(rbr + 1) % RBN] / 32768; rbr = (rbr + 2) % RBN; } else { L[i] = R[i] = 0; } } };
    sp.connect(actx.destination);
  }
  let started = false;
  const tap = document.getElementById('tap');
  function start() { if (actx && actx.state !== 'running') actx.resume(); started = true; tap.style.display = 'none'; }
  tap.addEventListener('pointerdown', start);
  addEventListener('keydown', () => { if (!started) start(); }, { once: false });

  // ---- input ----
  const P1 = { up: 1, down: 2, left: 4, right: 8, a: 16, b: 32, c: 64, d: 128 }, SY = { start: 1, select: 2, coin: 4 };
  const held = new Map(); // source -> key
  const keys = new Set();
  const KB = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyZ: 'a', KeyX: 'b', KeyA: 'c', KeyS: 'd', Enter: 'start', ShiftRight: 'select', Digit5: 'coin', KeyC: 'coin', Digit1: 'start' };
  addEventListener('keydown', e => { const k = KB[e.code]; if (k) { keys.add(k); e.preventDefault(); } });
  addEventListener('keyup', e => { const k = KB[e.code]; if (k) { keys.delete(k); e.preventDefault(); } });
  const pad = document.getElementById('pad');
  function hit(x, y) { const el = document.elementFromPoint(x, y); return el && el.dataset && el.dataset.k ? el : null; }
  function touchUpdate(e) {
    e.preventDefault(); if (!started) start();
    held.clear(); for (const t of e.touches) { const el = hit(t.clientX, t.clientY); if (el) held.set(t.identifier, el.dataset.k); }
    document.querySelectorAll('[data-k]').forEach(el => el.classList.toggle('on', [...held.values()].includes(el.dataset.k)));
  }
  ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(t => pad.addEventListener(t, touchUpdate, { passive: false }));
  // mouse fallback for the pad
  pad.addEventListener('mousedown', e => { const el = hit(e.clientX, e.clientY); if (el) { held.set('m', el.dataset.k); el.classList.add('on'); } });
  addEventListener('mouseup', () => { held.delete('m'); document.querySelectorAll('.on').forEach(el => el.classList.remove('on')); });
  function gamepadKeys(set) {
    const gp = navigator.getGamepads ? [...navigator.getGamepads()].find(g => g) : null; if (!gp) return;
    const b = i => gp.buttons[i] && gp.buttons[i].pressed;
    if (b(12) || gp.axes[1] < -0.5) set.add('up'); if (b(13) || gp.axes[1] > 0.5) set.add('down');
    if (b(14) || gp.axes[0] < -0.5) set.add('left'); if (b(15) || gp.axes[0] > 0.5) set.add('right');
    if (b(0)) set.add('a'); if (b(1)) set.add('b'); if (b(2)) set.add('c'); if (b(3)) set.add('d');
    if (b(9)) set.add('start'); if (b(8)) set.add('select'); if (b(4)) set.add('coin');
  }
  function readInput() {
    const s = new Set([...keys, ...held.values()]); gamepadKeys(s);
    let p = 0, y = 0; for (const k of s) { p |= P1[k] || 0; y |= SY[k] || 0; }
    if ((p & 3) === 3) p &= ~3; if ((p & 12) === 12) p &= ~12;
    if (AUTOTEST) { const f = totalFrames; if (f >= 400 && f < 410) y |= 4; if (f >= 600 && f < 606) y |= 1; }
    M._ng_input(p, y);
  }

  const AUTOTEST = qs.get('autotest') === '1'; let totalFrames = 0;
  // ---- UI ----
  document.getElementById('sys').onchange = e => { location.search = '?sys=' + e.target.value; };
  document.getElementById('btn-reset').onclick = () => M._ng_reset(0);
  const mb = document.getElementById('btn-mute'); mb.onclick = () => { muted = !muted; mb.textContent = muted ? '音:OFF' : '音:ON'; if (!started) start(); };
  document.getElementById('lic-text').textContent = window.NEO_LICENSES || '';
  document.getElementById('btn-lic').onclick = () => document.getElementById('lic').hidden = false;
  document.getElementById('lic-close').onclick = () => document.getElementById('lic').hidden = true;
  if (qs.get('pad') === '1') document.body.classList.add('showpad');

  // ---- main loop ----
  let acc = 0, last = performance.now(), frames = 0, fpsT = last;
  const fpsEl = document.getElementById('fps');
  function tick(now) {
    acc += Math.min(now - last, 100); last = now;
    const step = 1000 / FPS; let ran = 0;
    if (document.hidden) acc = 0;
    if (AUTOTEST) acc = Math.max(acc, step * 3);
    while (acc >= step && ran < 3) { readInput(); M._ng_frame(); totalFrames++; pushAudio(); acc -= step; ran++; frames++; }
    if (ran) blit();
    if (now - fpsT > 1000) { fpsEl.textContent = (frames * 1000 / (now - fpsT)).toFixed(1) + 'fps ' + sys.toUpperCase(); frames = 0; fpsT = now; }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  window.__neo = { M, readInput };
})();
