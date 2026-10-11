const fs = require('node:fs');
const path = require('node:path');
const repository = path.resolve(__dirname, '../..');
const root = path.join(repository, 'docs/performance/transactions-phase31');
const android = JSON.parse(fs.readFileSync(path.join(root, 'android/summary.json')));
const scroll = JSON.parse(fs.readFileSync(path.join(root, 'scroll/summary.json')));
const number = (x, digits=2) => x.toFixed(digits).replace('.', ',');
const row = (size,version) => android.summary.find(r=>r.size===size&&r.version===version);
const pair = (size, getter) => ['before','after'].map(v=>number(getter(row(size,v)))).join(' / ');
const sizes = [1000,10000,100000];
let source = fs.readFileSync(path.join(root, '../transactions-phase31.md'), 'utf8');
const insert = (key, content) => {
  const pattern = new RegExp(`<!-- ${key} -->|<!-- ${key}_START -->[\\s\\S]*?<!-- ${key}_END -->`);
  if (!pattern.test(source)) throw new Error('Report marker missing: '+key);
  source = source.replace(pattern, `<!-- ${key}_START -->\n${content}\n<!-- ${key}_END -->`);
};
insert('ANDROID_METRICS', `Se validaron **${android.samples} muestras**, ${android.warmups} calentamientos y **${android.functionalComparisons} comparaciones funcionales exactas**. [Resumen validado](transactions-phase31/android/summary.json), [proveniencia](transactions-phase31/android/provenance.json).

| Movimientos | Inicial 3 / 3.1 (ms) | Combinados | Positiva | Negativa | Extensión negativa |
|---:|---:|---:|---:|---:|---:|
${sizes.map(size=>`| ${size.toLocaleString('es-CO')} | ${pair(size,r=>r.initialDataMs.median)} | ${['combinedFilters','oldSearch','absentSearch','absentExtension'].map(name=>pair(size,r=>r.interactions[name].medianMs)).join(' | ')} |`).join('\n')}

Medianas de interacción hasta datos y dos RAF. En 100.000, la negativa mejora un ${number((1-row(100000,'after').interactions.absentSearch.medianMs/row(100000,'before').interactions.absentSearch.medianMs)*100,1)}%, la positiva un ${number((1-row(100000,'after').interactions.oldSearch.medianMs/row(100000,'before').interactions.oldSearch.medianMs)*100,1)}% y los combinados un ${number((1-row(100000,'after').interactions.combinedFilters.medianMs/row(100000,'before').interactions.combinedFilters.medianMs)*100,1)}%. En 1.000 la mejora de combinados es pequeña. No hay mejora uniforme: el reset de 10.000 pasa de ${pair(10000,r=>r.interactions.reset.medianMs)} ms, aunque su SQL baja de ${pair(10000,r=>r.interactions.reset.medianSqlMs)} ms. Las mediciones incluyen variación de programación/renderizado.

| Movimientos | Tras dos RAF iniciales 3 / 3.1 (ms) | Filas iniciales | Movimientos iniciales | Pico PSS del protocolo 3 / 3.1 (MiB) | Nueve páginas 3 / 3.1 (ms) |
|---:|---:|---:|---:|---:|---:|
${sizes.map(size=>`| ${size.toLocaleString('es-CO')} | ${pair(size,r=>r.initialPaintMs.median)} | 103 / 103 | 50 / 50 | ${pair(size,r=>r.pssPeakSampledKb.median/1024)} | ${pair(size,r=>r.ninePagesMs.median)} |`).join('\n')}

Las 103 filas incluyen 51 movimientos con anticipación, meses, cuentas, categorías y comprobaciones. Ambas versiones terminan las nueve páginas con 500 movimientos. El pico PSS muestreado cada 100 ms abarca el proceso entero y todo el protocolo; en 100.000 **aumenta** de ${pair(100000,r=>r.pssPeakSampledKb.median/1024)} MiB. PSS final: ${pair(100000,r=>r.pssEndKb.median/1024)} MiB. No se oculta ni atribuye esa diferencia a una causa no perfilada. El desplazamiento separado tiene PSS prácticamente equivalente y el delta de heap Node inicial sigue alrededor de 226 KiB, con 50 objetos financieros; no se añadió retención del historial. Falta una medición controlada de heap/GC Android para interpretar el aumento del pico.`);
const b=row(100000,'before').interactions, a=row(100000,'after').interactions;
insert('STAGE_METRICS', `En la negativa de 100.000, SQL baja de ${number(b.absentSearch.medianSqlMs)} a ${number(a.absentSearch.medianSqlMs)} ms; construcción nativa de filas, de ${number(b.absentSearch.medianNativeEncodingMs,3)} a ${number(a.absentSearch.medianNativeEncodingMs,3)} ms; await acumulado, de ${number(b.absentSearch.medianAwaitMs)} a ${number(a.absentSearch.medianAwaitMs)} ms. Devuelve tres/dos filas de metadatos y cero movimientos. Esto confirma que el cambio principal reduce SQL, sin trasladar un recorrido completo a JS. La extensión reutilizada consume ${number(a.absentExtension.medianSqlMs,3)} ms SQL y solo dos lecturas de revisión, pero su interacción completa aún tarda ${number(a.absentExtension.medianMs)} ms.

En combinados de 100.000, SQL baja de ${number(b.combinedFilters.medianSqlMs)} a ${number(a.combinedFilters.medianSqlMs)} ms y await de ${number(b.combinedFilters.medianAwaitMs)} a ${number(a.combinedFilters.medianAwaitMs)} ms. Mapeo, predicado, append y agrupación suman menos de 1 ms mediano por interacción. RAF p95 durante la negativa: ${number(b.absentSearch.rafGapP95Ms)} / ${number(a.absentSearch.rafGapP95Ms)} ms; una consulta lenta en el hilo nativo no equivale a bloquear JS todo ese tiempo.

Durante nueve páginas secuenciales aparecen RAF p95 de ${pair(100000,r=>r.pageRafGapMs.p95)} ms y máximos de ${pair(100000,r=>r.pageRafGapMs.max)} ms. Es una carga programática rápida hasta 500, distinta del protocolo de gestos. Persisten esperas ajenas a las pequeñas etapas síncronas cronometradas. Atribuirlas por completo a React o al puente requiere un perfil de commits/CPU; no se presenta esa inferencia como una causa demostrada.`);
insert('SCROLL_METRICS', `[Resumen](transactions-phase31/scroll/summary.json). Se inspeccionó visualmente el screenshot final de 100.000 posterior; tarjetas, cabecera y barra flotante conservan el diseño.

| Movimientos | Filas retenidas/únicas 3 / 3.1 | RAF p95 (ms) | RAF máximo (ms) | Frame nativo p95 (ms) |
|---:|---:|---:|---:|---:|
${sizes.map(size=>{const old=scroll.samples.find(r=>r.size===size&&r.version==='scrollBefore');const next=scroll.samples.find(r=>r.size===size&&r.version==='scroll');return `| ${size.toLocaleString('es-CO')} | ${old.retained}/${old.unique} / ${next.retained}/${next.unique} | ${number(old.rafP95Ms)} / ${number(next.rafP95Ms)} | ${number(old.rafMaxMs)} / ${number(next.rafMaxMs)} | ${number(old.nativeFrameP95Ms)} / ${number(next.nativeFrameP95Ms)} |`;}).join('\n')}

En 100.000 el mapeo, append y agrupación de las páginas físicas suman unos 2 ms por versión; los gaps máximos siguen cerca de 430 ms. No hay evidencia de mejora de desplazamiento por este refinamiento. Pico PSS de esa prueba: ${number(scroll.samples.find(r=>r.size===100000&&r.version==='scrollBefore').pssPeakKb/1024)} / ${number(scroll.samples.find(r=>r.size===100000&&r.version==='scroll').pssPeakKb/1024)} MiB.`);
insert('QUALITY_METRICS', `Jest: **194 pruebas aprobadas, 27 suites aprobadas**, tres benchmarks opcionales omitidos en la ejecución normal; el benchmark de refinamiento se ejecutó aparte y aprobó. TypeScript estricto, ESLint y diff check aprobados. [Logs](transactions-phase31/jest.log), [verificación final](transactions-phase31/final-verification.json). Las 72 comparaciones Android son exactas en resultados completos, orden y objetos financieros. La pantalla, hook y repositorio público conservan sus hashes de fase 3; package/lock y esquema permanecen intactos.`);
fs.writeFileSync(path.join(root, '../transactions-phase31.md'), source);
