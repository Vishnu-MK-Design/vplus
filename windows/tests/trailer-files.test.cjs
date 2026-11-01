'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createTrailerFiles, MAX_BYTES } = require('../trailer-files.cjs');
const ORIGIN = 'https://com.vishnu.vidly.desktop';
const item = { key: 'movie-693134', kind: 'movie', id: '693134', title: 'Dune: Part Two' };

function fixture(t, { extension = '.mp4', contents, cancel = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vplus-trailer-test-'));
  t.after(() => {
    const checked = path.resolve(directory), allowedPrefix = path.resolve(os.tmpdir(), 'vplus-trailer-test-');
    assert.ok(checked.startsWith(allowedPrefix));
    fs.rmSync(checked, { recursive: true, force: true });
  });
  const bytes = contents || Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.from(Array.from({ length: 244 }, (_, i) => i % 256))]);
  const source = path.join(directory, 'original' + extension);
  fs.writeFileSync(source, bytes);
  const copies = path.join(directory, 'trailers');
  const calls = [];
  const dialog = { showOpenDialog: async (...args) => { calls.push(args); return { canceled: cancel, filePaths: cancel ? [] : [source] }; } };
  const module = createTrailerFiles({ directory: copies, dialog, origin: ORIGIN });
  return { directory, source, bytes, copies, calls, dialog, module };
}

test('imports a native-picked video as an owned copy, preserving its source', async t => {
  const f = fixture(t), before = fs.statSync(f.source);
  const trailer = await f.module.choose(item);
  assert.equal(trailer.type, 'video');
  assert.equal(trailer.backgroundAllowed, true);
  assert.equal(trailer.source, 'Local file');
  assert.match(trailer.url, /^https:\/\/com\.vishnu\.vidly\.desktop\/__trailers\/movie-693134-[a-f0-9]{32}\.mp4$/);
  assert.deepEqual(fs.readFileSync(f.source), f.bytes);
  assert.equal(fs.statSync(f.source).mtimeMs, before.mtimeMs);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0][0].properties, ['openFile']);
  assert.deepEqual(f.calls[0][0].filters[0].extensions, ['mp4', 'webm', 'm4v']);
  assert.deepEqual(f.module.lookup(item.key), trailer);
  const persisted = createTrailerFiles({ directory: f.copies, dialog: f.dialog, origin: ORIGIN });
  assert.deepEqual(persisted.lookup(item.key), trailer);
});

test('serves a complete imported video using a response stream', async t => {
  const f = fixture(t), trailer = await f.module.choose(item);
  const response = await f.module.handleRequest(new Request(trailer.url));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'video/mp4');
  assert.equal(response.headers.get('accept-ranges'), 'bytes');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(Number(response.headers.get('content-length')), f.bytes.length);
  assert.ok(response.body instanceof ReadableStream);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), f.bytes);
});

test('GET ranges support explicit, open-ended and suffix requests', async t => {
  const f = fixture(t), trailer = await f.module.choose(item);
  for (const [range, start, end] of [['bytes=8-14', 8, 14], ['bytes=250-', 250, 255], ['bytes=-7', 249, 255], ['bytes=250-900', 250, 255], ['bytes=-999999999999999999999', 0, 255]]) {
    const response = await f.module.handleRequest(new Request(trailer.url, { headers: { Range: range } }));
    assert.equal(response.status, 206, range);
    assert.equal(response.headers.get('content-range'), `bytes ${start}-${end}/${f.bytes.length}`);
    assert.equal(Number(response.headers.get('content-length')), end - start + 1);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), f.bytes.subarray(start, end + 1));
  }
});

test('HEAD returns range headers without reading a response body', async t => {
  const f = fixture(t), trailer = await f.module.choose(item);
  const response = await f.module.handleRequest(new Request(trailer.url, { method: 'HEAD', headers: { Range: 'bytes=10-19' } }));
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-length'), '10');
  assert.equal(response.body, null);
});

test('malformed, multiple and unsatisfiable ranges return 416', async t => {
  const f = fixture(t), trailer = await f.module.choose(item);
  for (const value of ['bytes=999-', 'bytes=99-20', 'bytes=-0', 'bytes=-', 'bytes=0-1,5-9', 'items=0-5', 'bytes=' + '1'.repeat(220) + '-']) {
    const response = await f.module.handleRequest(new Request(trailer.url, { headers: { Range: value } }));
    assert.equal(response.status, 416, value);
    assert.equal(response.headers.get('content-range'), 'bytes */' + f.bytes.length);
    assert.equal(response.body, null);
  }
});

test('conditional range and cache validators retain correct status', async t => {
  const f = fixture(t), trailer = await f.module.choose(item);
  const head = await f.module.handleRequest(new Request(trailer.url, { method: 'HEAD' }));
  const etag = head.headers.get('etag');
  const cached = await f.module.handleRequest(new Request(trailer.url, { headers: { 'If-None-Match': etag } }));
  assert.equal(cached.status, 304);
  assert.equal(cached.body, null);
  const changed = await f.module.handleRequest(new Request(trailer.url, { headers: { Range: 'bytes=0-5', 'If-Range': '"stale"' } }));
  assert.equal(changed.status, 200);
  await changed.arrayBuffer();
  const current = await f.module.handleRequest(new Request(trailer.url, { headers: { Range: 'bytes=0-5', 'If-Range': etag } }));
  assert.equal(current.status, 206);
  await current.arrayBuffer();
});

test('only manifest-owned safe names at the application origin are served', async t => {
  const f = fixture(t), trailer = await f.module.choose(item);
  const guessed = 'movie-1-' + 'a'.repeat(32) + '.mp4';
  fs.writeFileSync(path.join(f.copies, guessed), f.bytes);
  for (const url of [ORIGIN + '/__trailers/manifest.json', ORIGIN + '/__trailers/' + guessed, ORIGIN + '/__trailers/..%2Foriginal.mp4', ORIGIN + '/__trailers/%2e%2e%5coriginal.mp4', ORIGIN + '/__trailers/%ZZ', ORIGIN + '/original.mp4', trailer.url.replace(ORIGIN, 'https://other.example')]) {
    const response = await f.module.handleRequest(new Request(url));
    assert.equal(response.status, 404, url);
  }
  const post = await f.module.handleRequest(new Request(trailer.url, { method: 'POST' }));
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
});

test('deleted or changed imports invalidate lookup and serving', async t => {
  const f = fixture(t), trailer = await f.module.choose(item), owned = path.join(f.copies, new URL(trailer.url).pathname.split('/').pop());
  fs.appendFileSync(owned, Buffer.from('changed'));
  assert.equal(f.module.lookup(item.key), null);
  assert.equal((await f.module.handleRequest(new Request(trailer.url))).status, 404);
  fs.unlinkSync(owned);
  assert.equal(f.module.lookup(item.key), null);
  assert.equal((await f.module.handleRequest(new Request(trailer.url))).status, 404);
});

test('cancel does not create imports or replace a previous selection', async t => {
  const f = fixture(t), first = await f.module.choose(item);
  f.dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  assert.equal(await f.module.choose(item), null);
  assert.deepEqual(f.module.lookup(item.key), first);
});

test('reimporting identical media reuses the stable owned file', async t => {
  const f = fixture(t), first = await f.module.choose(item);
  const owned = path.join(f.copies, new URL(first.url).pathname.split('/').pop());
  const before = fs.statSync(owned);
  const second = await f.module.choose(item);
  assert.deepEqual(second, first);
  assert.equal(fs.statSync(owned).mtimeMs, before.mtimeMs);
  assert.deepEqual(fs.readFileSync(owned), f.bytes);
  assert.equal(fs.readdirSync(f.copies).filter(name => name.endsWith('.mp4')).length, 1);
});

test('replacement imports revoke the previous owned URL and preserve originals', async t => {
  const f = fixture(t), first = await f.module.choose(item);
  const replacement = path.join(f.directory, 'replacement.mp4');
  const bytes = Buffer.from(f.bytes); bytes[bytes.length - 1] = 77;
  fs.writeFileSync(replacement, bytes);
  f.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [replacement] });
  const second = await f.module.choose(item);
  assert.notEqual(second.url, first.url);
  assert.equal((await f.module.handleRequest(new Request(first.url))).status, 404);
  const response = await f.module.handleRequest(new Request(second.url));
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  assert.deepEqual(fs.readFileSync(f.source), f.bytes);
  assert.deepEqual(fs.readFileSync(replacement), bytes);
});

test('bad keys cannot open the native chooser', async t => {
  const f = fixture(t);
  for (const key of ['../outside', 'movie-0', 'movie-1/../x', 'movie-9999999999999', 'other-1']) await assert.rejects(f.module.choose({ key }), /valid title/);
  assert.equal(f.calls.length, 0);
});

test('unsupported or disguised files are rejected without touching the source', async t => {
  const f = fixture(t, { extension: '.mp4', contents: Buffer.from('this is JSON rather than a video file') });
  await assert.rejects(f.module.choose(item), /not a supported trailer/);
  assert.deepEqual(fs.readFileSync(f.source), f.bytes);
  assert.equal(fs.readdirSync(f.copies).length, 0);
  assert.equal(f.module.lookup(item.key), null);
});

test('unsupported extension and oversized file fail before copying', async t => {
  const f = fixture(t, { extension: '.txt' });
  await assert.rejects(f.module.choose(item), /MP4, M4V or WebM/);
  const huge = path.join(f.directory, 'huge.mp4');
  fs.writeFileSync(huge, Buffer.alloc(12));
  fs.truncateSync(huge, MAX_BYTES + 1);
  f.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [huge] });
  await assert.rejects(f.module.choose(item), /512 MB/);
  assert.equal(fs.readdirSync(f.copies).length, 0);
});

test('native chooser does not accept multiple or relative paths', async t => {
  const f = fixture(t);
  for (const filePaths of [[f.source, f.source], ['relative.mp4']]) {
    f.dialog.showOpenDialog = async () => ({ canceled: false, filePaths });
    await assert.rejects(f.module.choose(item), /one local trailer/);
  }
});

test('WebM and M4V retain correct content types', async t => {
  for (const extension of ['.webm', '.m4v']) {
    const contents = extension === '.webm' ? Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(32)]) : undefined;
    const f = fixture(t, { extension, contents }), trailer = await f.module.choose(item);
    const response = await f.module.handleRequest(new Request(trailer.url, { method: 'HEAD' }));
    assert.equal(response.headers.get('content-type'), extension === '.webm' ? 'video/webm' : 'video/mp4');
  }
});

test('tampered manifests cannot grant ownership to arbitrary paths', async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.copies, 'manifest.json'), JSON.stringify({ version: 1, entries: [{ key: item.key, filename: '../original.mp4', sha256: 'a'.repeat(64), bytes: f.bytes.length, importedAt: Date.now(), mtimeMs: fs.statSync(f.source).mtimeMs }] }));
  const restored = createTrailerFiles({ directory: f.copies, dialog: f.dialog, origin: ORIGIN });
  assert.equal(restored.lookup(item.key), null);
  assert.equal((await restored.handleRequest(new Request(ORIGIN + '/__trailers/manifest.json'))).status, 404);
});

test('an imported filename replaced by a symbolic link is not served', async t => {
  const f = fixture(t), trailer = await f.module.choose(item), owned = path.join(f.copies, new URL(trailer.url).pathname.split('/').pop());
  fs.unlinkSync(owned);
  try { fs.symlinkSync(f.source, owned, 'file'); }
  catch (error) { if (error.code === 'EPERM') return t.skip('File symlink creation is unavailable on this Windows account.'); throw error; }
  assert.equal(f.module.lookup(item.key), null);
  assert.equal((await f.module.handleRequest(new Request(trailer.url))).status, 404);
});

test('same-title chooser requests coalesce and different titles cannot replace the active request', async t => {
  const f = fixture(t);
  let resolve;
  f.dialog.showOpenDialog = () => new Promise(r => { resolve = r; });
  const first = f.module.choose(item), duplicate = f.module.choose(item);
  await assert.rejects(f.module.choose({ ...item, key: 'movie-1' }), /already being selected/);
  resolve({ canceled: true, filePaths: [] });
  assert.equal(await first, null);
  assert.equal(await duplicate, null);
});

test('manifest stays bounded to 200 records and rejects stale outside records', async t => {
  const f = fixture(t), entries = [];
  for (let i = 1; i <= 205; i++) entries.push({ key: 'movie-' + i, filename: 'movie-' + i + '-' + 'b'.repeat(32) + '.mp4', sha256: 'b'.repeat(64), bytes: 256, importedAt: i, mtimeMs: 0 });
  fs.writeFileSync(path.join(f.copies, 'manifest.json'), JSON.stringify({ version: 1, entries }));
  const restored = createTrailerFiles({ directory: f.copies, dialog: f.dialog, origin: ORIGIN });
  await restored.choose(item);
  const manifest = JSON.parse(fs.readFileSync(path.join(f.copies, 'manifest.json'), 'utf8'));
  assert.equal(manifest.entries.length, 200);
  assert.equal(manifest.entries[0].key, item.key);
  assert.equal(manifest.entries.some(e => e.key === 'movie-1'), false);
  assert.equal(manifest.entries.every(e => !e.filename.includes('/') && !e.filename.includes('\\')), true);
});
