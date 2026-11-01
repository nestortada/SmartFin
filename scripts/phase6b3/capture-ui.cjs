'use strict';
// Evidence reader only: scoped XML dump, screenshot and synthetic report; no UI input or SQL.
const fs = require('node:fs'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const [serial, label] = process.argv.slice(2);
const api = {'emulator-5554': 24, AXCC6R3919012932: 35}[serial];
if (!api || process.argv.length !== 4 || !/^[a-z0-9-]{1,70}$/.test(label || '')) throw Error('Explicit test serial and label required');
const pkg = 'com.smartfin.snapshot5b2.tests';
const root = path.resolve(__dirname, '../..');
const folder = path.join(root, `docs/validacion-fase6b3-1/android/api${api}/ui`);
const run = (args, binary = false) => execFileSync('C:/Users/nesto/AppData/Local/Android/Sdk/platform-tools/adb.exe', ['-s', serial, ...args],
  {encoding: binary ? undefined : 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024});
const foreground = run(['shell', 'dumpsys', 'activity', 'activities']).split(/\r?\n/).filter(line => /mResumedActivity|topResumedActivity/.test(line)).join('\n');
if (!foreground.includes(pkg)) throw Error('Synthetic package must be foreground');
const remote = `/sdcard/Android/data/${pkg}/files/ui-6b3.xml`;
run(['shell', 'uiautomator', 'dump', remote]);
const xml = run(['shell', 'cat', remote]);
if (!xml.includes('</hierarchy>')) throw Error('Incomplete UI hierarchy');
fs.mkdirSync(folder, {recursive: true});
for (const ext of ['xml', 'png', 'json']) if (fs.existsSync(path.join(folder, label + '.' + ext))) throw Error('Evidence already exists');
fs.writeFileSync(path.join(folder, label + '.xml'), xml);
fs.writeFileSync(path.join(folder, label + '.png'), run(['exec-out', 'screencap', '-p'], true));
const texts = [...xml.matchAll(/text="([^"]*)"/g)].map(m => m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#160;|&nbsp;/g, '\u00a0')).filter(Boolean);
let syntheticReport;
try {syntheticReport = JSON.parse(run(['shell', 'cat', `/sdcard/Android/data/${pkg}/files/snapshot5b2-results/result.json`]));}
catch (error) {syntheticReport = {readError: String(error)};}
fs.writeFileSync(path.join(folder, label + '.json'), JSON.stringify({serial, api, label, foreground, texts, syntheticReport}, null, 2) + '\n');
console.log(JSON.stringify({serial, api, label, texts, screenshot: path.join(folder, label + '.png')}));
