'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const MAX_BYTES = 512 * 1024 * 1024;
const MAX_ENTRIES = 200;
const MAX_MANIFEST_BYTES = 512 * 1024;
const KEY = /^(?:movie|tv|anime)-[1-9][0-9]{0,11}$/;
const OWN_NAME = /^(?:movie|tv|anime)-[1-9][0-9]{0,11}-[a-f0-9]{32}\.(?:mp4|webm|m4v)$/;
const TYPES = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm' };

function rangeFor(value, size) {
  if (!value) return { start: 0, end: size - 1, status: 200 };
  if (value.length > 200) return null;
  const match = /^bytes=([0-9]*)-([0-9]*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return null;
  const total = BigInt(size);
  let start, end;
  if (!match[1]) {
    const suffix = BigInt(match[2]);
    if (suffix === 0n) return null;
    start = suffix >= total ? 0n : total - suffix;
    end = total - 1n;
  } else {
    start = BigInt(match[1]);
    end = match[2] ? BigInt(match[2]) : total - 1n;
    if (start >= total || end < start) return null;
    if (end >= total) end = total - 1n;
  }
  return { start: Number(start), end: Number(end), status: 206 };
}

function signatureMatches(header, extension) {
  if (extension === '.webm') return header.length >= 4 && header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  return header.length >= 12 && header.toString('ascii', 4, 8) === 'ftyp';
}

function createTrailerFiles({ directory, dialog, parent = () => undefined, origin }) {
  if (!path.isAbsolute(directory || '')) throw Error('A local trailer directory is required.');
  const ownOrigin = new URL(origin);
  if (ownOrigin.protocol !== 'https:' || ownOrigin.username || ownOrigin.password || ownOrigin.port) throw Error('A secure application origin is required.');
  const appOrigin = ownOrigin.origin;
  fs.mkdirSync(directory, { recursive: true });
  const root = fs.realpathSync(directory);
  const manifestFile = path.join(root, 'manifest.json');
  let records = new Map();
  let choosing = null;

  function ownPath(name) {
    if (!OWN_NAME.test(String(name)) || path.basename(name) !== name) return null;
    const file = path.resolve(root, name);
    return path.dirname(file) === root ? file : null;
  }

  function validRecord(entry) {
    return entry && KEY.test(entry.key || '') && ownPath(entry.filename) &&
      /^[a-f0-9]{64}$/.test(entry.sha256 || '') &&
      entry.filename.startsWith(entry.key + '-' + entry.sha256.slice(0, 32) + '.') &&
      Number.isSafeInteger(entry.bytes) && entry.bytes >= 12 && entry.bytes <= MAX_BYTES &&
      Number.isFinite(entry.mtimeMs) && Number.isFinite(entry.importedAt);
  }

  try {
    const stat = fs.lstatSync(manifestFile);
    if (stat.isFile() && !stat.isSymbolicLink() && stat.size <= MAX_MANIFEST_BYTES) {
      const saved = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      if (saved.version === 1 && Array.isArray(saved.entries)) {
        for (const entry of saved.entries.filter(validRecord).sort((a, b) => b.importedAt - a.importedAt).slice(0, MAX_ENTRIES)) {
          if (!records.has(entry.key)) records.set(entry.key, entry);
        }
      }
    }
  } catch {}

  function fileStat(entry) {
    const file = ownPath(entry?.filename);
    if (!file || !validRecord(entry)) return null;
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== entry.bytes || stat.mtimeMs !== entry.mtimeMs) return null;
      if (fs.realpathSync(file) !== file) return null;
      return { file, stat };
    } catch { return null; }
  }

  function lookup(key) {
    if (!KEY.test(String(key || ''))) return null;
    const entry = records.get(key);
    if (!fileStat(entry)) return null;
    return {
      type: 'video',
      url: appOrigin + '/__trailers/' + entry.filename,
      title: 'Local trailer',
      backgroundAllowed: true,
      source: 'Local file'
    };
  }

  async function writeManifest(next) {
    const temporary = path.join(root, '.manifest-' + crypto.randomBytes(12).toString('hex') + '.tmp');
    try {
      await fs.promises.writeFile(temporary, JSON.stringify({ version: 1, entries: [...next.values()] }), { flag: 'wx', mode: 0o600 });
      await fs.promises.rename(temporary, manifestFile);
    } catch (error) {
      await fs.promises.unlink(temporary).catch(() => {});
      throw error;
    }
  }

  async function importFile(key, selected) {
    const extension = path.extname(selected).toLowerCase();
    if (!TYPES[extension]) throw Error('Choose an MP4, M4V or WebM trailer video.');
    let sourceStat;
    try { sourceStat = await fs.promises.lstat(selected); }
    catch { throw Error('The selected video is no longer available.'); }
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw Error('Choose a regular video file.');
    if (sourceStat.size < 12) throw Error('The selected video is empty or invalid.');
    if (sourceStat.size > MAX_BYTES) throw Error('Choose a trailer no larger than 512 MB.');
    const temporary = path.join(root, '.import-' + crypto.randomBytes(12).toString('hex') + '.tmp');
    let bytes = 0;
    let header = Buffer.alloc(0);
    const hash = crypto.createHash('sha256');
    let filename, destination;
    try {
      const inspect = new Transform({ transform(chunk, _encoding, done) {
        bytes += chunk.length;
        if (bytes > MAX_BYTES) return done(Error('Choose a trailer no larger than 512 MB.'));
        hash.update(chunk);
        if (header.length < 32) header = Buffer.concat([header, chunk.subarray(0, 32 - header.length)]);
        done(null, chunk);
      } });
      await pipeline(fs.createReadStream(selected), inspect, fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
      if (bytes !== sourceStat.size) throw Error('The video changed while importing. Please choose it again.');
      if (!signatureMatches(header, extension)) throw Error('The selected file is not a supported trailer video.');
      const afterSource = await fs.promises.lstat(selected);
      if (!afterSource.isFile() || afterSource.isSymbolicLink() || afterSource.size !== sourceStat.size || afterSource.mtimeMs !== sourceStat.mtimeMs) throw Error('The video changed while importing. Please choose it again.');
      const sha256 = hash.digest('hex');
      filename = key + '-' + sha256.slice(0, 32) + extension;
      destination = ownPath(filename);
      // A repeated import reuses its still-valid immutable copy. This preserves
      // that copy if writing the replacement manifest subsequently fails.
      const existing = records.get(key);
      const sameImport = existing?.filename === filename && fileStat(existing);
      // Rename replaces the directory entry, never follows a target symlink.
      // The chosen source file is read only, including an already imported copy.
      if (sameImport || path.resolve(selected) === destination) await fs.promises.unlink(temporary);
      else await fs.promises.rename(temporary, destination);
      const stat = await fs.promises.lstat(destination);
      const entry = { key, filename, sha256, bytes, mtimeMs: stat.mtimeMs, importedAt: Date.now() };
      const next = new Map([[key, entry], ...[...records].filter(([k]) => k !== key)].slice(0, MAX_ENTRIES));
      await writeManifest(next);
      const previous = records;
      records = next;
      const retained = new Set([...next.values()].map(v => v.filename));
      for (const old of previous.values()) {
        if (!retained.has(old.filename)) {
          const expired = ownPath(old.filename);
          if (expired && expired !== path.resolve(selected)) await fs.promises.unlink(expired).catch(() => {});
        }
      }
      return lookup(key);
    } catch (error) {
      await fs.promises.unlink(temporary).catch(() => {});
      if (filename && destination && ![...records.values()].some(e => e.filename === filename) && destination !== path.resolve(selected)) await fs.promises.unlink(destination).catch(() => {});
      if (/^(Choose|The selected|The video changed)/.test(error.message || '')) throw error;
      throw Error('The selected video could not be imported. Check free disk space and try again.');
    }
  }

  async function choose(item) {
    const key = item?.key;
    if (!KEY.test(String(key || ''))) throw Error('Choose a valid title before adding a trailer.');
    if (choosing) {
      if (choosing.key === key) return choosing.promise;
      throw Error('A trailer is already being selected. Finish that selection first.');
    }
    if (typeof dialog?.showOpenDialog !== 'function') throw Error('The file chooser is unavailable.');
    const promise = (async () => {
      const options = { title: 'Use a local trailer', buttonLabel: 'Use trailer', properties: ['openFile'], filters: [{ name: 'Trailer videos', extensions: ['mp4', 'webm', 'm4v'] }] };
      const owner = parent();
      const result = await (owner ? dialog.showOpenDialog(owner, options) : dialog.showOpenDialog(options));
      if (result.canceled) return null;
      if (!Array.isArray(result.filePaths) || result.filePaths.length !== 1 || !path.isAbsolute(result.filePaths[0])) throw Error('Choose one local trailer video.');
      return importFile(key, result.filePaths[0]);
    })();
    choosing = { key, promise };
    try { return await promise; }
    finally { if (choosing?.promise === promise) choosing = null; }
  }

  async function handleRequest(request) {
    const method = request.method || 'GET';
    if (method !== 'GET' && method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    let name;
    try {
      const url = new URL(request.url);
      if (url.origin !== appOrigin || !url.pathname.startsWith('/__trailers/')) return new Response('Not found', { status: 404 });
      name = decodeURIComponent(url.pathname.slice('/__trailers/'.length));
    } catch { return new Response('Not found', { status: 404 }); }
    const entry = [...records.values()].find(value => value.filename === name);
    const owned = fileStat(entry);
    if (!owned) return new Response('Not found', { status: 404 });
    const etag = '"vplus-' + entry.sha256 + '"';
    const headers = new Headers({
      'Content-Type': TYPES[path.extname(entry.filename)],
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      ETag: etag,
      'Last-Modified': owned.stat.mtime.toUTCString()
    });
    if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
    let range = request.headers.get('range');
    const ifRange = request.headers.get('if-range');
    if (range && ifRange && ifRange !== etag && (!Number.isFinite(Date.parse(ifRange)) || Date.parse(ifRange) < Math.floor(owned.stat.mtimeMs / 1000) * 1000)) range = null;
    const bounds = rangeFor(range, entry.bytes);
    if (!bounds) {
      headers.set('Content-Range', 'bytes */' + entry.bytes);
      return new Response(null, { status: 416, headers });
    }
    headers.set('Content-Length', String(bounds.end - bounds.start + 1));
    if (bounds.status === 206) headers.set('Content-Range', `bytes ${bounds.start}-${bounds.end}/${entry.bytes}`);
    if (method === 'HEAD') return new Response(null, { status: bounds.status, headers });
    let file;
    try {
      file = await fs.promises.open(owned.file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      const actual = await file.stat();
      if (!actual.isFile() || actual.size !== entry.bytes || actual.mtimeMs !== entry.mtimeMs) { await file.close(); return new Response('Not found', { status: 404 }); }
      if (request.signal?.aborted) { await file.close(); return new Response(null, { status: 499 }); }
      const stream = file.createReadStream({ start: bounds.start, end: bounds.end, autoClose: true });
      const abort = () => stream.destroy();
      request.signal?.addEventListener('abort', abort, { once: true });
      stream.once('close', () => request.signal?.removeEventListener('abort', abort));
      return new Response(Readable.toWeb(stream), { status: bounds.status, headers });
    } catch {
      await file?.close().catch(() => {});
      return new Response('Not found', { status: 404 });
    }
  }

  return { choose, lookup, handleRequest };
}

module.exports = { createTrailerFiles, MAX_BYTES, MAX_ENTRIES };
