// Phase 6B read-only UI reader (6A reader on 6B paths): after `run-android.ps1 -Campaign phase6b-ui-<probe> -KeepRunning`,
// dumps the synthetic test app hierarchy and keeps the visible COP texts rendered by the
// production MetricsGrid/NetWorthCard. Evidence under docs/precision-fase6a/android/api<N>/ui.
const fs = require('node:fs'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const [serial, api, scenario] = process.argv.slice(2);
if (!['emulator-5554', 'AXCC6R3919012932'].includes(serial) || !['24', '35'].includes(api) || !/^[A-Za-z0-9]+$/.test(scenario || ''))
  throw Error('Explicit synthetic test target required');
const pkg = 'com.smartfin.snapshot5b2.tests';
const folder = path.resolve(__dirname, `../../docs/auditoria-fase6b/android/api${api}/ui`);
fs.mkdirSync(folder, {recursive: true});
const adb = (args, buffer = false) => execFileSync('adb', ['-s', serial, ...args], {encoding: buffer ? undefined : 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024});
const foreground = adb(['shell', 'dumpsys', 'activity', 'activities']).split('\n').filter(l => /mResumedActivity|topResumedActivity/.test(l)).join('\n');
if (!foreground.includes(pkg)) throw Error('Synthetic test app must be foreground');
const remote = `/sdcard/Android/data/${pkg}/files/ui-6b.xml`;
adb(['shell', 'uiautomator', 'dump', remote]);
const xml = adb(['shell', 'cat', remote]);
if (!xml.includes('</hierarchy>')) throw Error('Incomplete UI hierarchy');
fs.writeFileSync(path.join(folder, `${scenario}.xml`), xml);
fs.writeFileSync(path.join(folder, `${scenario}.png`), adb(['exec-out', 'screencap', '-p'], true));
const texts = [...xml.matchAll(/text="([^"]*)"/g)].map(m => m[1].replace(/&#160;|&nbsp;/g, ' ')).filter(Boolean);
// Labels are matched case-insensitively: NetWorthCard renders its title uppercase.
// Internal values come from the campaign report pulled by run-android.ps1 (logcat tags differ by device).
const report = JSON.parse(fs.readFileSync(path.resolve(__dirname, `../../docs/auditoria-fase6b/android/api${api}/ui-${scenario}/result.json`), 'utf8'));
const evidence = report.cases.find(c => c.name === `ui-${scenario}`)?.evidence;
const internal = evidence && {scenario, next: evidence.next, display: evidence.nextDisplay};
const labels = ['Ingresos del mes', 'Gastos del mes', 'Ahorro neto', 'Deuda total', 'Saldo disponible', 'Patrimonio neto'];
const visible = Object.fromEntries(labels.map(label => [label, texts[texts.findIndex(t => t.toLowerCase() === label.toLowerCase()) + 1]]));
const normalize = value => String(value ?? '').replace(/\s/g, ' ');
const matches = internal && normalize(visible['Ingresos del mes']) === normalize(internal.display.monthlyIncome)
  && normalize(visible['Gastos del mes']) === normalize(internal.display.monthlyExpenses)
  && normalize(visible['Ahorro neto']) === normalize(internal.display.monthlySavings)
  && normalize(visible['Deuda total']) === normalize(internal.display.totalDebt)
  && normalize(visible['Saldo disponible']) === normalize(internal.display.availableBalance)
  && normalize(visible['Patrimonio neto']) === normalize(internal.display.netWorth);
const result = {serial, api, scenario, internal, visible, texts, visibleEqualsFormatted: !!matches};
fs.writeFileSync(path.join(folder, `${scenario}.json`), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
if (!matches) process.exitCode = 1;
