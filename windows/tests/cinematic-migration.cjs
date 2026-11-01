'use strict';

// Standalone Electron integration test. It seeds a real legacy Chromium origin
// in a fresh verification profile, then runs the actual application's migration
// and renderer. No migration implementation is copied into this harness.
const electron = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const assert = require('node:assert/strict');
const { APP_ORIGIN, APP_URL, LEGACY_KEYS } = require('../youtube-origin.cjs');
const { app, BrowserWindow } = electron;
const mainFile = path.resolve(__dirname, '../main.cjs');
const out = path.resolve(__dirname, '../../deliverables/cinematic-checks-0.5.0/migration');
fs.mkdirSync(out, { recursive: true });
const checks = [], runtimeErrors = [];
let seeded = false, showAttempts = 0, finished = false, profile;
const legacyUrl = 'vidly://app/__cinematic-migrate.html';
const fixtureSecret = 'fixture-secret-never-migrate';
const fixtureEncrypted = 'fixture-opaque-not-an-account-token';
const filters = { sort: 'newest', genre: '28', year: '2024', language: 'ta', country: 'IN', audioLanguage: '' };
const searchHistory = ['Interstellar', 'tt22084616'];
const oldValues = {
  'vidly.catalogueSource': 'streamflix',
  'vidly.catalogueFilters': JSON.stringify(filters),
  'vidly.searchHistory': JSON.stringify(searchHistory),
  'vidly.filterVersion': '"legacy-v1"',
  'vidly.preferences': JSON.stringify({ textSize: 90, defaultSource: 'vidly', audioLanguage: 'ta', density: 'compact', uiScale: 90, showContinue: false }),
  'vidly.playerSource': '"vidly"',
  'vidly.audioPreference': '"ta"',
  'vplus.playbackMigration': 'true',
  'vidly.tmdbToken': fixtureSecret,
  'arbitrary.secret': fixtureSecret,
  '__proto__': fixtureSecret
};
const savedTitle = { kind: 'movie', id: '157336', key: 'movie-157336', title: 'Interstellar', year: '2014' };
const historyTitle = { kind: 'tv', id: '100088', key: 'tv-100088', title: 'The Last of Us', year: '2023' };
const nativeHistory = { item: historyTitle, time: 321, duration: 3600, season: 2, episode: 3, audio: 'sub', provider: 'cinesrc' };
const nativePreferences = { textSize: 120, defaultSource: 'cinesrc', audioLanguage: 'fr', confirmExit: false, resumeByDefault: true };

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function safeProfile(value) {
  const absolute = path.resolve(value);
  const temporary = path.resolve(os.tmpdir()) + path.sep;
  return absolute.toLowerCase().startsWith(temporary.toLowerCase()) && /^VPlus-PC-044-/.test(path.basename(absolute));
}
function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  if (error) checks.push({ label: error.message, pass: false });
  const report = {
    actualHost: 'windows/main.cjs',
    actualRenderer: APP_URL,
    profileIsTemporary: !!profile && safeProfile(profile),
    profileName: profile ? path.basename(profile) : null,
    seedUsesRealLegacyStorage: seeded,
    visibleWindowAttempts: showAttempts,
    allWindowsHidden: BrowserWindow.getAllWindows().every(window => !window.isVisible()),
    checks,
    passed: checks.filter(c => c.pass).length,
    failed: checks.filter(c => !c.pass).length,
    runtimeErrors
  };
  fs.writeFileSync(path.join(out, 'verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, failed: report.failed, temporaryProfile: report.profileIsTemporary, allWindowsHidden: report.allWindowsHidden }));
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  app.exit(report.failed ? 1 : 0);
}
const deadline = setTimeout(() => finish(Error('Native migration verification timed out')), 60000);
process.on('uncaughtException', finish);
process.on('unhandledRejection', finish);

class HiddenVerificationWindow extends BrowserWindow {
  constructor(options) {
    super({ ...options, show: false });
    this.webContents.on('console-message', event => { if (event.level === 'error') runtimeErrors.push(event.message); });
  }
  show() { showAttempts++; return this; }
  showInactive() { showAttempts++; return this; }
  async loadURL(url, options) {
    const result = await super.loadURL(url, options);
    if (url === legacyUrl) {
      await this.webContents.executeJavaScript('localStorage.clear();for(const [key,value] of Object.entries(' + JSON.stringify(oldValues) + '))localStorage.setItem(key,value);void 0');
      const actual = await this.webContents.executeJavaScript('({origin:location.origin,source:localStorage.getItem("vidly.catalogueSource"),hasPrivateKey:localStorage.getItem("vidly.tmdbToken")!==null})');
      assert.equal(actual.origin, 'vidly://app');
      assert.equal(actual.source, 'streamflix');
      assert.equal(actual.hasPrivateKey, true);
      seeded = true;
    }
    return result;
  }
}
const controlledElectron = Object.create(electron);
Object.defineProperty(controlledElectron, 'BrowserWindow', { value: HiddenVerificationWindow });
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (parent?.filename === mainFile && request === 'electron') return controlledElectron;
  if (parent?.filename === mainFile && request === './tests/cinematic.cjs') return { run: runChecks };
  return originalLoad.call(this, request, parent, isMain);
};
for (const flag of ['--cinematic-test', '--fresh-profile']) if (!process.argv.includes(flag)) process.argv.push(flag);
require(mainFile);
profile = app.getPath('userData');
assert.ok(safeProfile(profile), 'Refusing to seed a non-temporary profile');
fs.writeFileSync(path.join(profile, 'library.json'), JSON.stringify({
  saved: [savedTitle], history: [nativeHistory], preferences: nativePreferences,
  encryptedToken: fixtureEncrypted, vplusPlaybackMigration: true,
  clientState: { 'vidly.filterVersion': '"native-v2"' }
}));

async function runChecks({ main, store, storePath }) {
  Module._load = originalLoad;
  const js = source => main.webContents.executeJavaScript(source);
  const until = async source => {
    const started = Date.now();
    while (Date.now() - started < 20000) {
      if (await js(source).catch(() => false)) return;
      await wait(70);
    }
    throw Error('Renderer migration did not reach its expected state');
  };
  async function check(label, value) {
    try {
      const result = typeof value === 'string' ? await js(value) : await value();
      assert.ok(result, label);
      checks.push({ label, pass: true });
    } catch (error) { checks.push({ label, pass: false, detail: error.message }); }
  }
  try {
    await until('!!window.CinemaApp?.ready&&CinemaApp.state().saved.some(t=>t.key==="movie-157336")');
    await check('Actual migration read a seeded real vidly://app storage partition', () => seeded);
    await check('Only a dedicated temporary verification profile was seeded', () => safeProfile(profile) && app.getPath('userData') === profile && storePath() === path.join(profile, 'library.json'));
    await check('Native verification windows remain hidden without focus or input', () => showAttempts === 0 && BrowserWindow.getAllWindows().every(window => !window.isVisible()));
    await check('Actual renderer is loaded at the new secure application origin', 'location.origin===' + JSON.stringify(APP_ORIGIN));
    await check('Host marks legacy origin migration complete', () => store.desktopOriginMigration === true);
    await check('Host imports all eight allowed old-origin keys', () => LEGACY_KEYS.every(key => typeof store.clientState[key] === 'string'));
    await check('Host client state contains no unapproved keys', () => Object.keys(store.clientState).every(key => LEGACY_KEYS.includes(key)));
    await check('Plain-string catalogue source survives actual origin migration', 'localStorage.getItem("vidly.catalogueSource")==="streamflix"&&CinemaApp.state().catalogue==="streamflix"');
    await check('Country and language filters survive actual origin migration', 'CinemaApp.state().filters.country==="IN"&&CinemaApp.state().filters.language==="ta"&&JSON.parse(localStorage.getItem("vidly.catalogueFilters")).country==="IN"');
    await check('Search history survives actual origin migration', 'JSON.stringify(CinemaApp.state().searchHistory)===' + JSON.stringify(JSON.stringify(searchHistory)));
    await check('Existing native client state takes precedence over old-origin values', () => store.clientState['vidly.filterVersion'] === '"native-v2"');
    await check('Unknown credential and arbitrary keys are absent from the new origin', 'localStorage.getItem("vidly.tmdbToken")===null&&localStorage.getItem("arbitrary.secret")===null');
    await check('Fixture credentials are not exposed in renderer storage or application state', '![...Array(localStorage.length)].map((_,i)=>localStorage.getItem(localStorage.key(i))).some(v=>v.includes(' + JSON.stringify(fixtureEncrypted) + ')||v.includes(' + JSON.stringify(fixtureSecret) + '))&&!JSON.stringify(CinemaApp.state()).includes(' + JSON.stringify(fixtureEncrypted) + ')');
    await check('Existing opaque native credential storage is preserved', () => store.encryptedToken === fixtureEncrypted);
    await check('Saved titles are preserved in native storage and the actual renderer', async () => {
      assert.deepEqual(store.saved, [savedTitle]);
      return js('CinemaApp.state().saved.length===1&&CinemaApp.state().saved[0].key==="movie-157336"');
    });
    await check('Native playback history retains exact progress and episode identity', async () => {
      assert.deepEqual(store.history, [nativeHistory]);
      return js('CinemaApp.state().history[0].time===321&&CinemaApp.state().history[0].season===2&&CinemaApp.state().history[0].episode===3');
    });
    await check('Native preference values win conflicting legacy preferences', () => Object.entries(nativePreferences).every(([key, value]) => store.preferences[key] === value));
    await check('Native preference precedence also reaches the renderer', 'CinemaApp.state().prefs.textSize===120&&CinemaApp.state().prefs.defaultSource==="cinesrc"&&CinemaApp.state().prefs.audioLanguage==="fr"');
    await check('Legacy-only valid preferences are retained when native fields are absent', () => store.preferences.density === 'compact' && store.preferences.uiScale === 90 && store.preferences.showContinue === false);
    await check('New-origin one-time migration marker is stored', 'JSON.parse(localStorage.getItem("vplus.cinematicMigrationV1"))===true');

    // Missing keys are intentional: they reproduce the case where a cleared
    // new-origin setting used to be re-imported from the historical snapshot.
    await js('localStorage.removeItem("vidly.searchHistory");localStorage.removeItem("vidly.catalogueFilters");localStorage.setItem("vidly.catalogueSource","cinemeta");void 0');
    const loaded = new Promise(resolve => main.webContents.once('did-finish-load', resolve));
    main.webContents.reload();
    await loaded;
    await until('!!window.CinemaApp?.ready&&CinemaApp.state().saved.length===1');
    await check('Actual renderer reload keeps the new-origin migration marker', 'JSON.parse(localStorage.getItem("vplus.cinematicMigrationV1"))===true');
    await check('Cleared search history is not resurrected by host hello after reload', 'localStorage.getItem("vidly.searchHistory")===null&&CinemaApp.state().searchHistory.length===0');
    await check('Cleared filters are not resurrected from the old origin', 'localStorage.getItem("vidly.catalogueFilters")===null&&CinemaApp.state().filters.country===""&&CinemaApp.state().filters.language===""');
    await check('A newly selected catalogue is not overwritten by legacy catalogue choice', 'localStorage.getItem("vidly.catalogueSource")==="cinemeta"&&CinemaApp.state().catalogue==="cinemeta"');
    await check('Native preferences and saved progress remain intact after reload', 'CinemaApp.state().prefs.textSize===120&&CinemaApp.state().saved[0].key==="movie-157336"&&CinemaApp.state().history[0].time===321');

    const probe = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    await probe.loadURL(legacyUrl);
    const legacyUntouched = await probe.webContents.executeJavaScript('localStorage.getItem("vidly.catalogueSource")==="streamflix"&&localStorage.getItem("vidly.tmdbToken")===' + JSON.stringify(fixtureSecret));
    probe.destroy();
    await check('Legacy storage remains unchanged and isolated after migration', () => legacyUntouched);
    await wait(250);
    const disk = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
    await check('Actual host saved the migration marker and preserved native library on disk', () => disk.desktopOriginMigration === true && disk.saved[0].key === savedTitle.key && disk.history[0].time === 321 && disk.preferences.textSize === 120);
    await check('Native profile persisted no canary secret in migrated client state', () => !JSON.stringify(disk.clientState).includes(fixtureSecret) && !JSON.stringify(disk.clientState).includes(fixtureEncrypted));
    await check('Verification never displayed or focused a native window', () => showAttempts === 0 && BrowserWindow.getAllWindows().every(window => !window.isVisible()));
    await electron.session.defaultSession.flushStorageData();
    finish();
  } catch (error) { finish(error); }
}
