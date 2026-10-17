// User-supplied ROM/BIOS loader. Files are processed only in this browser; nothing is uploaded.
window.UserRoms = (() => {
  const DB = 'neogeo-web-user', ST = 'files';
  const open = () => new Promise((ok, ng) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(ST); r.onsuccess = () => ok(r.result); r.onerror = () => ng(r.error); });
  const op = async (mode, fn) => { const db = await open(); return new Promise((ok, ng) => { const t = db.transaction(ST, mode); const q = fn(t.objectStore(ST)); t.oncomplete = () => { db.close(); ok(q && q.result); }; t.onerror = () => ng(t.error); }); };
  const get = k => op('readonly', s => s.get(k));
  const set = (k, v) => op('readwrite', s => s.put(v, k));
  const del = k => op('readwrite', s => s.delete(k));
  const clear = () => op('readwrite', s => s.clear());

  const isZip = u => u && u.length > 4 && u[0] === 0x50 && u[1] === 0x4b && u[2] === 3 && u[3] === 4;
  function entries(u) {
    const dv = new DataView(u.buffer, u.byteOffset, u.byteLength); let e = -1;
    for (let i = u.length - 22; i >= Math.max(0, u.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) return [];
    const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const out = [];
    for (let k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const meth = dv.getUint16(p + 10, true), csz = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
      out.push({ name: new TextDecoder().decode(u.subarray(p + 46, p + 46 + nl)), meth, csz, lo }); p += 46 + nl + xl + cl;
    }
    return out;
  }
  async function extract(u, en) {
    const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
    const s = en.lo + 30 + dv.getUint16(en.lo + 26, true) + dv.getUint16(en.lo + 28, true);
    const data = u.subarray(s, s + en.csz);
    if (en.meth === 0) return data.slice();
    if (en.meth !== 8) return null;
    const ds = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(ds).arrayBuffer());
  }
  const zipNames = async u => isZip(u) ? entries(u).map(e => e.name.split('/').pop().toLowerCase()) : [];
  async function extractNeo(u) { const e = entries(u).find(e => /\.neo$/i.test(e.name)); return e ? extract(u, e) : null; }

  // pending: one-shot hand-off across reload; cached: kept only if the player asked.
  async function take() {
    const p = await get('pending'); if (p) { await del('pending'); return p; }
    return (await get('cached')) || null;
  }
  const readFile = f => f.arrayBuffer().then(b => new Uint8Array(b));

  function initUI() {
    const $ = id => document.getElementById(id);
    let bios = null, game = null, gameName = '';
    const st = () => { $('u-bios-n').textContent = bios ? bios.name : '未選択'; $('u-game-n').textContent = game ? game.name : '未選択'; $('u-boot').disabled = !(bios && game); };
    const pick = (f) => { if (!f) return; if (/^(neogeo|aes|uni|bios)/i.test(f.name) || /bios/i.test(f.name)) bios = f; else game = f; st(); };
    $('btn-user').onclick = () => { $('user').hidden = false; refreshCache(); };
    $('u-close').onclick = () => { $('user').hidden = true; };
    $('u-bios').onchange = e => { bios = e.target.files[0] || bios; st(); };
    $('u-game').onchange = e => { game = e.target.files[0] || game; st(); };
    const dz = $('u-drop');
    ['dragenter', 'dragover'].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); dz.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); dz.classList.remove('over'); }));
    dz.addEventListener('drop', e => { for (const f of e.dataTransfer.files) pick(f); });
    $('u-boot').onclick = async () => {
      $('u-msg').textContent = '読み込み中…';
      const rec = { sys: $('u-sys').value, bios: await readFile(bios), game: await readFile(game), gameName: game.name.replace(/\.(neo|zip)$/i, '') };
      if (!isZip(rec.bios)) { $('u-msg').textContent = 'BIOSはZIP（neogeo.zip 形式）を選んでください。'; return; }
      const names = await zipNames(rec.bios);
      const need = rec.sys === 'uni' ? ['uni-bios_4_0.rom'] : rec.sys === 'aes' ? ['neo-po.bin', 'neo-epo.bin'] : ['sp-s2.sp1', 'sp-u2.sp1', 'japan-j3.bin', 'sp-45.sp1'];
      if (!need.some(n => names.includes(n))) { $('u-msg').textContent = 'このBIOS ZIPには選んだ種類（' + rec.sys.toUpperCase() + '）のBIOSが見つかりません。必要なファイル名: ' + need.join(' / '); return; }
      if (!isZip(rec.game) && !/\.neo$/i.test(game.name)) { $('u-msg').textContent = 'ゲームは .neo ファイル（または .neo を含むZIP）を選んでください。'; return; }
      await set('pending', rec);
      if ($('u-cache').checked) await set('cached', rec);
      location.search = '?src=user';
    };
    async function refreshCache() { const c = await get('cached'); $('u-cached').textContent = c ? '保存済み: ' + c.gameName + '（' + c.sys.toUpperCase() + '）' : '保存なし'; $('u-del').disabled = !c; $('u-run-cached').disabled = !c; }
    $('u-del').onclick = async () => { await clear(); refreshCache(); $('u-msg').textContent = 'この端末に保存したファイルを削除しました。'; };
    $('u-run-cached').onclick = () => { location.search = '?src=user'; };
    $('btn-builtin').onclick = () => { location.search = ''; };
    st();
  }
  return { take, zipNames, isZip, extractNeo, initUI, _set: set, _get: get, _clear: clear };
})();
