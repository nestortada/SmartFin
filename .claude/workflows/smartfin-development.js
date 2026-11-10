export const meta = {
  name: 'smartfin-development',
  description: 'SmartFin: audita (por defecto, sin escrituras) o implementa una tarea con exploración, un único escritor, revisores independientes y verificación proporcional al riesgo',
  whenToUse: 'Tareas de programación en SmartFin que necesitan varios agentes. Uso: /smartfin-development audit <tarea> o /smartfin-development implement <tarea con comportamiento esperado verificable>. Sin prefijo válido se ejecuta audit.',
  phases: [
    { title: 'Alcance', detail: 'modo, tarea y estado inicial' },
    { title: 'Exploración', detail: 'scout: rutas, símbolos, consumidores, pruebas' },
    { title: 'Análisis', detail: 'audit: riesgos y comprobaciones seguras, sin escrituras' },
    { title: 'Implementación', detail: 'un único escritor en el árbol de trabajo' },
    { title: 'Verificación rápida', detail: 'typecheck y Jest de las pruebas afectadas' },
    { title: 'Revisión', detail: 'revisores según reviewer-reminder.cjs y criterio semántico' },
    { title: 'Corrección', detail: 'una ronda: defectos confirmados dentro del alcance' },
    { title: 'Verificación final', detail: 'comandos secuenciales proporcionales al riesgo' },
    { title: 'Informe', detail: 'estado, evidencia y siguiente paso' },
  ],
}

// =====================================================================================================
// Orquestación únicamente. Las reglas viven en CLAUDE.md, AGENTS.md, .claude/skills/, .claude/agents/ y
// .claude/hooks/; los agentes las reciben automáticamente. Este script no lee ni escribe archivos: decide
// con resultados estructurados validados. Determinista: sin reloj ni aleatoriedad (las marcas de tiempo las
// obtienen los agentes), para que una reanudación repita las mismas llamadas agent().
// =====================================================================================================

const SEVERITY_RANK = { critical: 3, high: 2, medium: 1, low: 0 }
const SEVERITIES = ['critical', 'high', 'medium', 'low']
const REVIEWER_NAMES = ['financial-reviewer', 'android-native-reviewer', 'security-privacy-reviewer']
const SKILLS = ['smartfin-financial-domain', 'smartfin-sqlite-architecture', 'react-native-best-practices',
  'smartfin-security-privacy', 'smartfin-testing-qa', 'smartfin-phase-delivery']
const CHANGE_TYPES = ['mechanical', 'rn_ui', 'financial_domain', 'sqlite_persistence', 'android_native', 'security_privacy', 'mixed']
const TYPE_SKILLS = {
  mechanical: [],
  rn_ui: ['react-native-best-practices'],
  financial_domain: ['smartfin-financial-domain'],
  sqlite_persistence: ['smartfin-sqlite-architecture'],
  android_native: [],
  security_privacy: ['smartfin-security-privacy'],
  mixed: [],
}

// --- Selección mínima de revisores --------------------------------------------------------------------
// FUENTE: .claude/hooks/reviewer-reminder.cjs (constantes REVIEWERS e IGNORED). Réplica literal de sus
// patrones y de su exclusión de __tests__/, .md y .test.ts(x). Si cambian allí, actualizar aquí en el mismo
// cambio: una divergencia haría que el workflow omita un revisor que el hook Stop exige.
const baseName = file => file.split('/').pop()
const REVIEWER_RULES = [
  {
    name: 'financial-reviewer',
    why: 'casos de uso, repositorios, SQL o migraciones',
    test: file => /^src\/database\//.test(file) || /^src\/modules\/[^/]+\/(?:useCases|repositories|database)\//.test(file),
  },
  {
    name: 'android-native-reviewer',
    why: 'código Android, servicios de plataforma o coordinación SQLite',
    test: file => /^android\//.test(file) || /^src\/native\//.test(file) || /^src\/services\//.test(file) ||
      /^src\/modules\/[^/]+\/services\//.test(file) || file === 'src/database/databaseCoordination.ts',
  },
  {
    name: 'security-privacy-reviewer',
    why: 'respaldo, restauración, exportación, autenticación, permisos o servicios externos',
    test: file => /^src\/modules\/security\//.test(file) || /AndroidManifest\.xml$/.test(file) || /^src\/services\//.test(file) ||
      (/^(?:src|android)\//.test(file) && /backup|snapshot|restor|security|csv|drive|gemini|publication|deletion/i.test(baseName(file))),
  },
]
const IGNORED = file => /(?:^|\/)__tests__\//.test(file) || /\.(?:md|test\.tsx?)$/.test(file)

// --- Decisiones del propietario (CLAUDE.md/AGENTS.md y sección de autonomía del encargo) --------------
const OWNER_DECISIONS = {
  schema: 'cambios de esquema o migraciones',
  accounting_rules: 'cambios de reglas contables',
  sqlite_driver: 'cambios del driver SQLite',
  android_permissions: 'permisos Android',
  dependencies: 'dependencias nuevas',
  external_comms: 'comunicaciones externas (red, telemetría, servicios de terceros)',
  device_campaign: 'campañas en dispositivo o emulador',
  real_data: 'acceso a bases o respaldos reales',
  external_publication: 'publicación externa (commit, push, PR, publicación)',
  agent_config: 'modificar hooks, guards, settings.json, AGENTS.md, CLAUDE.md o workflows',
  new_phase: 'iniciar otra fase',
}
const DECISION_KEYS = Object.keys(OWNER_DECISIONS)
// Rutas que, si cambian, exigen la autorización correspondiente aunque el clasificador no la haya pedido.
const PATH_DECISIONS = [
  { key: 'schema', test: f => f === 'src/database/migrations.ts' || f === 'src/database/sqliteSchema.ts' || /migration/i.test(baseName(f)) },
  { key: 'sqlite_driver', test: f => f === 'scripts/patchReactNativeSqliteStorage.js' || /^android\/.*sqlite/i.test(f) },
  { key: 'android_permissions', test: f => /AndroidManifest\.xml$/.test(f) },
  { key: 'dependencies', test: f => /^(?:package\.json|package-lock\.json|\.nvmrc)$/.test(f) || /^android\/(?:.*\/)?build\.gradle(?:\.kts)?$/.test(f) },
  { key: 'agent_config', test: f => /^\.claude\/(?:hooks|workflows)\//.test(f) || /^\.claude\/settings(?:\.local)?\.json$/.test(f) ||
      f === 'AGENTS.md' || f === 'CLAUDE.md' || /^\.codex\//.test(f) || f === '.github/workflows/ci.yml' },
]

// Restricciones declaradas en .claude/agents/mechanical.md (zona permitida).
const MECHANICAL_ALLOWED = f => /^src\/modules\/[^/]+\/(?:ui|hooks)\//.test(f) || /^src\/shared\/components\//.test(f)

const SAFE_PATH = /^[A-Za-z0-9_@.][A-Za-z0-9_@./-]*$/
const safePath = p => typeof p === 'string' && SAFE_PATH.test(p) && !p.split('/').includes('..')
const isStableTest = p => safePath(p) && /^__tests__\/.*\.test\.tsx?$/.test(p) && !/^__tests__\/reproductions\//.test(p)
const isReproTest = p => safePath(p) && /^__tests__\/reproductions\/.*\.repro\.tsx?$/.test(p)
const MAX_TARGETED_TESTS = 25
const SUITE_SHARDS = 3

// Revisión del script: aparece en el informe para comprobar qué copia se ejecutó (por nombre o por ruta).
const WORKFLOW_REVISION = '2026-11-08.5'

// Evidencia de Jest: __tests__/setup/redirectEvidenceWrites.js redirige a artifacts/jest-evidence toda escritura
// dirigida a docs/, sobrescribiendo evidencia que el usuario puede querer conservar. El workflow ejecuta Jest con
// SMARTFIN_EVIDENCE_DIR apuntando a un subdirectorio propio (ignorado por Git): la evidencia preexistente de
// artifacts/ queda fuera del alcance de las pruebas y cualquier cambio en ella se trata como inesperado.
// Verificado el 2026-11-08: una prueba de reproducción escribió en este directorio y artifacts/jest-evidence
// conservó rutas y hashes. Valor literal y relativo a la raíz: bashCommandClamp rechaza $VAR (sustitución).
const EVIDENCE_DIR = 'artifacts/smartfin-development-evidence'
const EVIDENCE_ENV = `SMARTFIN_EVIDENCE_DIR=${EVIDENCE_DIR}`
const inEvidenceDir = p => p === EVIDENCE_DIR || p.startsWith(EVIDENCE_DIR + '/')

// Inventario verificable del árbol de trabajo. «git status --porcelain=v2» da HEAD, rama, cambios staged
// (XY[0] y hash del índice hI) y unstaged (XY[1]), sin seguimiento («?») e ignorados («!», contraídos: con
// --ignored=matching no recorre node_modules ni otros directorios ignorados); «git hash-object» (sin -w: no
// escribe objetos) da el hash del contenido en disco de cada archivo modificado o sin seguimiento. La evidencia
// de artifacts/ (ignorada) se inventaría aparte, limitando ls-files a esa ruta. El script empareja hashes y
// rutas y compara inventarios; no confía en que el agente diga «coincide».
const INVENTORY_CMD = {
  status: 'git status --porcelain=v2 --branch --untracked-files=all --ignored=matching',
  artifactsList: 'git ls-files --others --ignored --exclude-standard -- artifacts',
  artifactsHashes: 'git ls-files --others --ignored --exclude-standard -- artifacts | git hash-object --stdin-paths',
}
const INVENTORY_STEPS = [
  'Inventario del árbol (ya estás en la raíz del worktree: no antepongas cd ni otros prefijos y no modifiques nada):',
  `  a) Ejecuta exactamente «${INVENTORY_CMD.status}» y copia su salida literal en «statusV2».`,
  '  b) Recorre esa salida en orden y toma la ruta de cada línea «?» y de cada línea «1» o «2» cuya segunda letra de XY no sea «.» ni «D» (en «2», la ruta anterior al tabulador). Si hay alguna, ejecuta UNA vez «git hash-object -- <rutas en ese mismo orden>» (nunca con -w) y copia su salida literal en «hashOutput»; si no hay rutas, deja «hashOutput» vacío.',
  `  c) Ejecuta exactamente «${INVENTORY_CMD.artifactsList}» y copia su salida literal en «artifactsList» (vacío si no hay salida).`,
  `  d) Si «artifactsList» no está vacío, ejecuta exactamente «${INVENTORY_CMD.artifactsHashes}» y copia su salida literal en «artifactsHashes»; si está vacío, deja «artifactsHashes» vacío.`,
  '  Ejecuta cada comando una sola vez. No resumas, reordenes ni omitas líneas: el workflow verifica el inventario por su cuenta.',
].join('\n')
// Entradas «!» que pueden aparecer o desaparecer durante las pruebas: solo artifacts/ (directorio de evidencia).
const TOLERATED_IGNORED = p => /^artifacts(?:\/|$)/.test(p)

// Restricciones reales de herramientas por agente (opciones de agent() verificadas en Claude Code 2.1.316):
// disallowedTools quita herramientas del agente y bashCommandClamp limita Bash a formas de comando fijas
// (cada tramo de una tubería debe coincidir; rechaza sustituciones, cd y prefijos no listados). Los hooks y los
// permisos de la sesión siguen aplicándose además de esto.
const EXTERNAL_TOOLS = ['mcp__*', 'Artifact', 'ArtifactComments', 'ArtifactData', 'WebFetch', 'WebSearch', 'SendUserFile',
  'SendMessage', 'PushNotification', 'RemoteTrigger', 'CronCreate', 'CronDelete', 'EnterWorktree', 'ExitWorktree', 'DesignSync']
const READONLY_DENY = [...EXTERNAL_TOOLS, 'Edit', 'Write', 'NotebookEdit', 'PowerShell', 'Skill', 'Monitor', 'TaskStop', 'ToolSearch']
const INVENTORY_CLAMP = [`Bash(${INVENTORY_CMD.status})`, 'Bash(git hash-object -- *)', `Bash(${INVENTORY_CMD.artifactsList})`, 'Bash(git hash-object --stdin-paths)']
const TZ_CMD = 'node -p "Intl.DateTimeFormat().resolvedOptions().timeZone"'
// Analista del audit (revisor usado como auditor): lectura, typecheck y Jest de archivos concretos con evidencia
// redirigida. Sin git diff/log/show (admiten --output=<archivo>) ni node -e/-p arbitrarios.
const AUDIT_CLAMP = ['Bash(pwd)', 'Bash(git status *)', 'Bash(git ls-files *)', 'Bash(npm run typecheck)', 'Bash(npx tsc --noEmit)',
  `Bash(${EVIDENCE_ENV} npm test -- --runInBand __tests__/*)`]
// Presupuesto mínimo de tokens de salida antes de cada etapa (solo si el usuario fijó un presupuesto «+Nk»).
const STAGE_RESERVE = { inventory: 4000, scout: 10000, classifier: 10000, analyst: 40000, implementer: 60000, verify: 12000, review: 30000 }

// =====================================================================================================
// Esquemas
// =====================================================================================================
const str = { type: 'string' }
const strArr = { type: 'array', items: { type: 'string' } }
const INVENTORY = { type: 'object', properties: { statusV2: str, hashOutput: str, artifactsList: str, artifactsHashes: str },
  required: ['statusV2', 'hashOutput', 'artifactsList', 'artifactsHashes'] }
const FINDING = {
  type: 'object',
  properties: {
    severity: { type: 'string', enum: SEVERITIES },
    location: { type: 'string', description: 'ruta:línea' },
    title: str,
    evidence: str,
    kind: { type: 'string', enum: ['confirmed', 'potential'] },
    inScope: { type: 'boolean', description: 'el defecto está en archivos o comportamiento del alcance de la tarea' },
    recommendedTest: str,
    suggestedFix: str,
  },
  required: ['severity', 'location', 'title', 'evidence', 'kind', 'inScope', 'recommendedTest'],
}
const EXPLORATION_SCHEMA = {
  type: 'object',
  properties: {
    paths: { type: 'array', items: { type: 'object', properties: { path: str, line: { type: 'integer' }, role: str }, required: ['path', 'role'] } },
    symbols: { type: 'array', items: { type: 'object', properties: { name: str, location: str, kind: str }, required: ['name', 'location'] } },
    consumers: { type: 'array', items: { type: 'object', properties: { symbol: str, location: str }, required: ['symbol', 'location'] } },
    tests: { ...strArr, description: 'rutas de archivos de prueba relacionados (__tests__/...)' },
    dependencies: strArr,
    discrepancies: strArr,
    notFound: strArr,
  },
  required: ['paths', 'symbols', 'consumers', 'tests', 'dependencies', 'discrepancies'],
}
const CMD_RESULT = {
  type: 'object',
  properties: {
    command: str,
    outcome: { type: 'string', enum: ['passed', 'failed', 'not_run', 'error'] },
    exitCode: { type: 'integer' },
    reason: { type: 'string', description: 'obligatorio si outcome es not_run o error (permiso denegado, timeout, herramienta ausente)' },
    summary: { type: 'string', description: 'conteos reales (aprobadas/fallidas/omitidas) y primeras líneas de cada fallo' },
  },
  required: ['command', 'outcome', 'summary'],
}
const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    timezone: { type: 'object', properties: { resolved: str, tzEnv: str, shell: str }, required: ['resolved', 'tzEnv'] },
    before: INVENTORY,
    results: { type: 'array', items: CMD_RESULT },
    after: INVENTORY,
  },
  required: ['timezone', 'before', 'results', 'after'],
}
const AUDIT_SCHEMA = {
  type: 'object',
  properties: {
    dataFlow: { type: 'string', description: 'cómo fluye la información entre los archivos del alcance, con ruta:línea' },
    testsFound: { type: 'array', items: { type: 'object', properties: { path: str, covers: str }, required: ['path', 'covers'] } },
    risks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          area: { type: 'string', enum: ['financial', 'sqlite', 'android', 'security', 'performance', 'ui', 'testing', 'other'] },
          severity: { type: 'string', enum: SEVERITIES },
          kind: { type: 'string', enum: ['confirmed', 'potential'] },
          location: str, evidence: str, recommendedTest: str,
        },
        required: ['area', 'severity', 'kind', 'location', 'evidence', 'recommendedTest'],
      },
    },
    checks: { type: 'array', items: CMD_RESULT },
    skillsConsulted: strArr,
    reviewersRecommended: { type: 'array', items: { type: 'object', properties: { name: { type: 'string', enum: REVIEWER_NAMES }, reason: str }, required: ['name', 'reason'] } },
    nextSteps: strArr,
  },
  required: ['dataFlow', 'testsFound', 'risks', 'checks', 'skillsConsulted', 'nextSteps'],
}
const INVENTORY_SCHEMA = { type: 'object', properties: { inventory: INVENTORY }, required: ['inventory'] }
const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: {
    changeType: { type: 'string', enum: CHANGE_TYPES },
    areas: { type: 'array', items: { type: 'string', enum: CHANGE_TYPES.filter(t => t !== 'mixed') } },
    skills: { type: 'array', items: { type: 'string', enum: SKILLS } },
    scopeFiles: { ...strArr, description: 'archivos de producción y de prueba que se espera modificar o crear' },
    expectedBehavior: str,
    expectedBehaviorVerifiable: { type: 'boolean', description: 'true solo si la tarea define un comportamiento comprobable con una prueba o comando concreto' },
    verificationPlan: str,
    requiredDecisions: { type: 'array', items: { type: 'string', enum: DECISION_KEYS } },
    authorizations: {
      type: 'array',
      items: { type: 'object', properties: { key: { type: 'string', enum: DECISION_KEYS }, quote: { type: 'string', description: 'cita literal de la tarea que autoriza expresamente la decisión' } }, required: ['key', 'quote'] },
    },
    extraReviewers: { type: 'array', items: { type: 'object', properties: { name: { type: 'string', enum: REVIEWER_NAMES }, reason: str }, required: ['name', 'reason'] } },
    notes: str,
  },
  required: ['changeType', 'areas', 'skills', 'scopeFiles', 'expectedBehavior', 'expectedBehaviorVerifiable', 'verificationPlan',
    'requiredDecisions', 'authorizations', 'extraReviewers'],
}
const IMPLEMENT_SCHEMA = {
  type: 'object',
  properties: {
    preflight: { type: 'object', properties: { matchesExpected: { type: 'boolean' }, observed: INVENTORY }, required: ['matchesExpected', 'observed'] },
    end: { ...INVENTORY, description: 'inventario tomado al terminar tus escrituras (o igual al preflight si no escribiste)' },
    status: { type: 'string', enum: ['done', 'blocked', 'failed'] },
    reason: str,
    baselineBehavior: { type: 'string', description: 'comportamiento inicial y pruebas que lo fijaban, identificado antes de editar' },
    filesChanged: strArr,
    testsAffected: { ...strArr, description: 'archivos de prueba que ejercitan el cambio (nuevos o existentes)' },
    testsModified: { type: 'array', items: { type: 'object', properties: { path: str, why: str }, required: ['path', 'why'] } },
    skillsConsulted: strArr,
    decisionsNeeded: { type: 'array', items: { type: 'string', enum: DECISION_KEYS } },
    notes: str,
  },
  required: ['preflight', 'end', 'status', 'reason', 'baselineBehavior', 'filesChanged', 'testsAffected', 'testsModified', 'skillsConsulted', 'decisionsNeeded'],
}
const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['approved', 'approved_with_conditions', 'rejected'] },
    findings: { type: 'array', items: FINDING },
    commandsRun: { type: 'array', items: { type: 'object', properties: { command: str, result: str }, required: ['command', 'result'] } },
    pendingDeviceChecks: strArr,
    recommendOtherReviewers: { type: 'array', items: { type: 'string', enum: REVIEWER_NAMES } },
  },
  required: ['verdict', 'findings', 'commandsRun'],
}

// =====================================================================================================
// Utilidades deterministas
// =====================================================================================================
const nl = text => String(text == null ? '' : text).replace(/\r\n/g, '\n').replace(/\s+$/g, '')
const uniq = list => [...new Set(list)]
const unquote = p => p.replace(/^"(.*)"$/, '$1').replaceAll('\\', '/')

// Inventario → { ok, head, branch, entries: Map(ruta → firma), ignored: [rutas] }. Cada firma reúne XY (staged
// y unstaged), modos, hash de HEAD, hash del índice y, si el archivo cambió en disco o no tiene seguimiento, el
// hash de su contenido. Un inventario incompleto (sin --branch, hashes que no cuadran) es inválido: estado incierto.
function parseInventory(inv) {
  if (!inv || typeof inv.statusV2 !== 'string' || typeof inv.hashOutput !== 'string') return { ok: false, error: 'inventario ausente' }
  const entries = new Map()
  const ignored = []
  const toHash = []
  let head = null
  let branch = null
  for (const line of nl(inv.statusV2).split('\n')) {
    if (!line.trim()) continue
    if (line.startsWith('# branch.oid ')) { head = line.slice(13).trim(); continue }
    if (line.startsWith('# branch.head ')) { branch = line.slice(14).trim(); continue }
    if (line.startsWith('#')) continue
    const kind = line[0]
    if (kind === '?') { const p = unquote(line.slice(2)); entries.set(p, { xy: '??', sig: '??' }); toHash.push(p); continue }
    if (kind === '!') { ignored.push(unquote(line.slice(2))); continue }
    const fields = line.split(' ')
    const fixed = kind === '1' ? 8 : kind === '2' ? 9 : kind === 'u' ? 10 : -1
    if (fixed < 0 || fields.length <= fixed) return { ok: false, error: 'línea de status no reconocida: ' + line.slice(0, 80) }
    const rest = fields.slice(fixed).join(' ').split('\t')
    const p = unquote(rest[0])
    const xy = fields[1]
    entries.set(p, { xy, sig: [...fields.slice(1, fixed), rest[1] || ''].join(' ') })
    if (kind !== 'u' && xy[1] !== '.' && xy[1] !== 'D') toHash.push(p)
  }
  if (!head) return { ok: false, error: 'falta «# branch.oid» (¿se omitió --branch?)' }
  const isHash = h => /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(h)
  const hashes = nl(inv.hashOutput).split('\n').map(s => s.trim()).filter(Boolean)
  if (hashes.length !== toHash.length) return { ok: false, error: `se esperaban ${toHash.length} hashes de contenido y llegaron ${hashes.length}` }
  if (!hashes.every(isHash)) return { ok: false, error: 'hashOutput contiene líneas que no son hashes' }
  toHash.forEach((p, i) => { entries.get(p).sig += ' wt=' + hashes[i] })
  // Manifiesto de artifacts/: ruta → hash de contenido (evidencia preexistente protegida).
  if (typeof inv.artifactsList !== 'string' || typeof inv.artifactsHashes !== 'string') return { ok: false, error: 'falta el manifiesto de artifacts/' }
  const artPaths = nl(inv.artifactsList).split('\n').map(s => s.trim()).filter(Boolean).map(unquote)
  const artHashes = nl(inv.artifactsHashes).split('\n').map(s => s.trim()).filter(Boolean)
  if (artPaths.length !== artHashes.length) return { ok: false, error: `artifacts/: ${artPaths.length} rutas y ${artHashes.length} hashes` }
  if (!artHashes.every(isHash)) return { ok: false, error: 'artifactsHashes contiene líneas que no son hashes' }
  if (artPaths.some(p => !/^artifacts\//.test(p))) return { ok: false, error: 'artifactsList contiene rutas fuera de artifacts/' }
  const artifacts = new Map(artPaths.map((p, i) => [p, artHashes[i]]))
  return { ok: true, head, branch, entries, ignored, artifacts }
}
const inventoryProblem = inv => { const p = parseInventory(inv); return p.ok ? null : p.error }

// Diferencias entre dos inventarios válidos: rutas cuya firma cambió (incluye contenido de archivos sin
// seguimiento preexistentes), creadas, eliminadas, cambios de HEAD/rama y rutas ignoradas añadidas o retiradas.
function diffInventory(a, b) {
  const pa = parseInventory(a)
  const pb = parseInventory(b)
  if (!pa.ok || !pb.ok) return { ok: false, error: pa.error || pb.error }
  const changed = uniq([...pa.entries.keys(), ...pb.entries.keys()])
    .filter(p => (pa.entries.get(p) || {}).sig !== (pb.entries.get(p) || {}).sig).sort()
  const xyIn = (parsed, p) => (parsed.entries.get(p) || { xy: '..' }).xy
  const artChanged = uniq([...pa.artifacts.keys(), ...pb.artifacts.keys()]).filter(p => pa.artifacts.get(p) !== pb.artifacts.get(p)).sort()
  return {
    ok: true,
    headChanged: pa.head !== pb.head || pa.branch !== pb.branch,
    changed,
    created: changed.filter(p => !pa.entries.has(p) && (xyIn(pb, p) === '??' || xyIn(pb, p).includes('A'))),
    deleted: changed.filter(p => xyIn(pb, p).includes('D') && !xyIn(pa, p).includes('D')),
    ignoredAdded: pb.ignored.filter(p => !pa.ignored.includes(p)),
    ignoredRemoved: pa.ignored.filter(p => !pb.ignored.includes(p)),
    // Evidencia preexistente (o cualquier archivo de artifacts/ fuera del directorio propio del workflow):
    // creada, modificada o borrada. Nunca se tolera.
    artifactsChanged: artChanged.filter(p => !inEvidenceDir(p)),
    // Evidencia escrita por las pruebas del workflow en su directorio propio: solo se tolera en etapas de pruebas.
    evidenceChanged: artChanged.filter(inEvidenceDir),
  }
}
// Igualdad estricta en los límites de etapa. Solo se tolera la salida de pruebas del propio workflow: archivos
// dentro de EVIDENCE_DIR y la aparición de la entrada «! artifacts/». También entre etapas: una verificación
// interrumpida (por ejemplo, la CLI detiene el run) deja evidencia allí, y sin esta tolerancia la reanudación
// se bloqueaba como si fuera un cambio concurrente (demostrado en la validación real del run wf_a64f49f7-170).
// La evidencia preexistente de artifacts/, el árbol versionado, HEAD y otras rutas ignoradas nunca se toleran.
function sameInventory(a, b) {
  const d = diffInventory(a, b)
  return d.ok && !d.headChanged && d.changed.length === 0 && d.artifactsChanged.length === 0 &&
    [...d.ignoredAdded, ...d.ignoredRemoved].every(TOLERATED_IGNORED)
}
function describeDiff(a, b) {
  const d = diffInventory(a, b)
  if (!d.ok) return `inventario inválido: ${d.error}`
  const parts = []
  if (d.headChanged) parts.push('HEAD o rama cambiaron')
  if (d.changed.length) parts.push(`rutas: ${d.changed.join(', ')}`)
  if (d.artifactsChanged.length) parts.push(`evidencia de artifacts/ modificada: ${d.artifactsChanged.join(', ')}`)
  if (d.evidenceChanged.length) parts.push(`evidencia del workflow: ${d.evidenceChanged.length} archivos en ${EVIDENCE_DIR}`)
  const ign = [...d.ignoredAdded, ...d.ignoredRemoved]
  if (ign.length) parts.push(`ignoradas: ${ign.join(', ')}`)
  return parts.join('; ') || 'sin diferencias'
}
const changedBetween = (a, b) => { const d = diffInventory(a, b); return d.ok ? d.changed : null }

function requiredReviewers(files) {
  return REVIEWER_RULES
    .map(rule => ({ name: rule.name, why: rule.why, files: files.filter(f => !IGNORED(f) && rule.test(f)) }))
    .filter(r => r.files.length)
}
// Analista del audit con restricción efectiva por frontmatter (verificado 2026-11-08): Plan y Explore NO sirven
// (sin Edit/Write, pero con Bash, PowerShell y herramientas MCP que escriben). Solo scout (Read/Grep/Glob) y los
// tres revisores (Read/Grep/Glob/Bash, sin Edit/Write ni MCP) limitan herramientas. Se usa el revisor del área del
// alcance como auditor de solo lectura (no como revisión de un diff); sin área, scout. Bash sigue pudiendo
// escribir: lo cubren el guard y los inventarios independientes antes y después.
function auditAnalyst(scopeFiles) {
  const matches = requiredReviewers(scopeFiles).map(r => r.name)
  const pick = ['financial-reviewer', 'security-privacy-reviewer', 'android-native-reviewer'].find(n => matches.includes(n))
  return pick
    ? { agentType: pick, why: `el alcance incluye rutas de su área (${REVIEWER_RULES.find(r => r.name === pick).why}); sin Edit/Write ni MCP` }
    : { agentType: 'scout', why: 'ninguna ruta del alcance pertenece a un revisor; scout es el único agente sin Bash (análisis limitado, sin comprobaciones ejecutables)' }
}
function decisionsForPaths(files) {
  return uniq(PATH_DECISIONS.filter(d => files.some(d.test)).map(d => d.key))
}
// Una autorización solo vale si su cita aparece literalmente en la tarea y no es una negación.
function validAuthorizations(list, taskText) {
  const ok = new Set()
  for (const a of list || []) {
    const quote = typeof a.quote === 'string' ? a.quote.trim() : ''
    if (!DECISION_KEYS.includes(a.key) || quote.length < 8) continue
    if (!taskText.includes(quote)) continue
    if (/\b(?:no|sin|nunca|jamás|prohib\w*)\b/i.test(quote)) continue
    ok.add(a.key)
  }
  return ok
}

function parseInput(raw) {
  let text = ''
  let modeHint = null
  if (typeof raw === 'string') text = raw
  else if (Array.isArray(raw)) text = raw.map(x => String(x)).join(' ')
  else if (raw && typeof raw === 'object') {
    if (raw.mode === 'audit' || raw.mode === 'implement') modeHint = raw.mode
    text = typeof raw.task === 'string' ? raw.task : typeof raw.text === 'string' ? raw.text : ''
  }
  text = text.trim()
  // El modo solo se toma de un prefijo exacto en minúsculas; «implement» nunca se infiere del lenguaje natural.
  const match = /^(audit|implement)(?:\s+|$)/.exec(text)
  if (match) return { mode: match[1], task: text.slice(match[0].length).trim(), explicit: true }
  if (modeHint) return { mode: modeHint, task: text, explicit: true }
  return { mode: 'audit', task: text, explicit: false }
}

const hasBudget = typeof budget !== 'undefined' && budget !== null && typeof budget.total === 'number'
const affordable = reserve => !hasBudget || budget.remaining() > reserve

// =====================================================================================================
// Estado del informe
// =====================================================================================================
const input = parseInput(args)
const report = {
  workflow: 'smartfin-development',
  revision: WORKFLOW_REVISION,
  mode: input.mode,
  modeSource: input.explicit ? 'prefijo explícito en args' : 'predeterminado (args sin prefijo audit/implement)',
  task: input.task,
  status: null,
  reason: '',
  scope: { files: [], tests: [], classification: null, areas: [] },
  filesModified: [],
  agentsUsed: [],
  skillsConsulted: [],
  reviewers: [],
  findings: { fixed: [], pending: [], potential: [], contradictions: [] },
  commands: [],
  notRun: [],
  residualRisks: [],
  timezone: null,
  environments: 'Node/Jest con mocks y comandos estáticos; ningún dispositivo ni emulador; SQLite real solo si una prueba concreta lo indica en su resumen',
  efficiencyNote: null,
  stopHook: null,
  nextStep: '',
  events: [],
}
const note = text => { report.events.push(text); log(text) }

// Tokens: el runtime solo expone budget.spent() (tokens de salida acumulados del turno, compartidos entre agentes
// concurrentes); se registra la diferencia como aproximación y se marca si hubo agentes en paralelo. El costo en
// dinero y los tokens de entrada no son visibles desde el script: los da la herramienta Workflow al terminar.
const canMeter = typeof budget !== 'undefined' && budget !== null && typeof budget.spent === 'function'
let inFlight = 0

async function run(prompt, opts, validate, stage) {
  const entry = { label: opts.label, phase: opts.phase, agentType: opts.agentType || 'workflow (predeterminado)',
    model: opts.agentType ? 'frontmatter del agente' : (opts.model || 'modelo de la sesión'),
    restrictions: [opts.disallowedTools ? `sin ${opts.disallowedTools.length} herramientas` : null, opts.bashCommandClamp ? `Bash limitado a ${opts.bashCommandClamp.length} formas` : null].filter(Boolean).join('; ') || 'ninguna adicional',
    outcome: 'ok' }
  report.agentsUsed.push(entry)
  if (stage && STAGE_RESERVE[stage] && !affordable(STAGE_RESERVE[stage])) {
    entry.outcome = `no lanzado: presupuesto insuficiente para la etapa ${stage}`
    note(`Agente ${opts.label} no lanzado: quedan menos de ${STAGE_RESERVE[stage]} tokens de salida del presupuesto`)
    return null
  }
  const before = canMeter ? budget.spent() : null
  const concurrent = inFlight > 0
  inFlight++
  let value
  try {
    value = await agent(prompt, opts)
  } catch (error) {
    inFlight--
    entry.outcome = 'error: ' + String((error && error.message) || error).slice(0, 300)
    note(`Agente ${opts.label} falló: ${entry.outcome}`)
    return null
  }
  inFlight--
  if (canMeter) entry.outputTokens = { approx: budget.spent() - before, sharedWithConcurrentAgents: concurrent || inFlight > 0 }
  if (value === null || value === undefined) {
    entry.outcome = 'null (omitido o error terminal)'
    note(`Agente ${opts.label} devolvió null; no cuenta como aprobación`)
    return null
  }
  const problem = validate ? validate(value) : null
  if (problem) {
    entry.outcome = 'resultado inválido: ' + problem
    note(`Agente ${opts.label}: resultado incompleto o inválido (${problem})`)
    return null
  }
  return value
}

function recordCommands(stage, commands, result) {
  for (let i = 0; i < commands.length; i++) {
    const spec = commands[i]
    const got = result && Array.isArray(result.results) ? result.results[i] : null
    const matches = got && nl(got.command).replace(/\s+/g, ' ') === spec.cmd.replace(/\s+/g, ' ')
    const outcome = matches ? got.outcome : 'not_run'
    const row = {
      stage, command: spec.cmd, mandatory: spec.mandatory, environment: spec.env, outcome,
      exitCode: matches && typeof got.exitCode === 'number' ? got.exitCode : null,
      summary: matches ? got.summary : '',
      reason: matches ? (got.reason || '') : (result ? 'el verificador no informó este comando en orden' : 'el verificador no devolvió resultado válido'),
    }
    report.commands.push(row)
    if (outcome === 'not_run' || outcome === 'error') report.notRun.push(`${spec.cmd} (${stage}): ${row.reason || 'sin motivo'}`)
  }
  if (result && result.timezone) report.timezone = result.timezone
  return report.commands.filter(c => c.stage === stage)
}

// Zona horaria (verificado en Windows el 2026-11-08): en el Bash del entorno (Git Bash) la variable TZ no llega
// a Node ni con prefijo «TZ=… cmd», ni con export ni con env; en PowerShell «$env:TZ='America/Bogota'; cmd» sí.
// Los verificadores no tienen PowerShell (escaparía al clamp de Bash): si la zona no es America/Bogota, los
// comandos de Jest se marcan not_run y el informe queda con condiciones; la máquina de desarrollo ya usa Bogotá.
const TZ_STEP = [
  `Zona horaria: ejecuta exactamente «${TZ_CMD}» y anota el resultado en timezone.resolved, «(sin definir)» en timezone.tzEnv y «Bash» en timezone.shell.`,
  '  Si la zona es America/Bogota, sigue. Si no lo es, no ejecutes los comandos de Jest (contienen «npm test» o «test:reproductions»): márcalos not_run con motivo «zona horaria distinta de America/Bogota» y ejecuta solo los demás.',
].join('\n')

function verifyPrompt(stage, commands) {
  return [
    `Eres el verificador del workflow smartfin-development (etapa: ${stage}). No editas archivos, no haces commit, stash, checkout ni restore, no tocas dispositivos ni bases o respaldos reales. Tu Bash solo admite los comandos de este mensaje, escritos exactamente así y sin prefijos (ni cd).`,
    `1. ${INVENTORY_STEPS}`,
    '   Devuelve ese inventario en «before».',
    `2. ${TZ_STEP}`,
    '3. Ejecuta UNO POR UNO, en este orden, sin paralelismo ni en segundo plano, exactamente estos comandos (el prefijo SMARTFIN_EVIDENCE_DIR forma parte del comando: no lo quites):',
    ...commands.map((c, i) => `   ${i + 1}. ${c.cmd}`),
    '   Usa el timeout máximo de la herramienta (600000 ms). Si un comando agota el tiempo, se deniega su permiso o no puede ejecutarse, márcalo not_run o error con el motivo; no lo sustituyas por otro comando ni uses otra herramienta para evadir la denegación.',
    '   outcome=passed solo con código de salida 0 y, en Jest, sin suites fallidas. Una prueba omitida (skipped/todo) nunca cuenta como aprobada: indícalo en el resumen con los conteos reales.',
    '4. Devuelve en «results» un elemento por comando, en el mismo orden, con «command» copiado literalmente de la lista.',
    '5. Repite el inventario del paso 1 y devuélvelo en «after».',
  ].join('\n')
}
const verifierOpts = (stage, commands) => ({
  label: `verify:${stage}`, phase: stage === 'final' ? 'Verificación final' : 'Verificación rápida', schema: VERIFY_SCHEMA, model: 'haiku',
  disallowedTools: READONLY_DENY,
  bashCommandClamp: uniq([...INVENTORY_CLAMP, `Bash(${TZ_CMD})`, ...commands.map(c => `Bash(${c.cmd})`)]),
})
const validVerify = v => (!Array.isArray(v.results) ? 'faltan results'
  : inventoryProblem(v.before) ? 'before: ' + inventoryProblem(v.before)
  : inventoryProblem(v.after) ? 'after: ' + inventoryProblem(v.after) : null)

// Verificación con límites de etapa: «before» debe coincidir con el inventario esperado (nada cambió desde la
// etapa anterior) y «after» solo puede añadir evidencia ignorada bajo artifacts/ (las pruebas no dejan archivos).
async function verify(stage, commands, expected) {
  const result = await run(verifyPrompt(stage, commands), verifierOpts(stage, commands), validVerify, 'verify')
  const rows = recordCommands(stage, commands, result)
  const failed = rows.filter(r => r.outcome === 'failed' || (r.mandatory && r.outcome === 'error'))
  const notRun = rows.filter(r => r.outcome === 'not_run' || r.outcome === 'error')
  const concurrent = result && expected && !sameInventory(expected, result.before) ? describeDiff(expected, result.before) : null
  const leftovers = result && !sameInventory(result.before, result.after) ? describeDiff(result.before, result.after) : null
  if (leftovers) report.commands.push({ stage, command: 'inventario antes/después de las pruebas', mandatory: true, environment: 'git', outcome: 'failed', exitCode: null, summary: leftovers, reason: '' })
  return { result, rows, failed, notRun, concurrent, leftovers, ok: !!result && !failed.length && !notRun.length && !concurrent && !leftovers }
}

const inventoryPrompt = purpose => [
  `Tarea única del workflow smartfin-development: tomar un inventario del árbol de trabajo (${purpose}). No edites, no crees ni borres archivos y no ejecutes nada más; tu Bash solo admite los comandos del inventario.`,
  INVENTORY_STEPS,
].join('\n')
async function takeInventory(label, phaseTitle, purpose) {
  const result = await run(inventoryPrompt(purpose), { label, phase: phaseTitle, schema: INVENTORY_SCHEMA, model: 'haiku',
    disallowedTools: READONLY_DENY, bashCommandClamp: INVENTORY_CLAMP }, v => inventoryProblem(v.inventory), 'inventory')
  return result ? result.inventory : null
}

const jestCommand = tests => `${EVIDENCE_ENV} npm test -- --runInBand ${tests.join(' ')}`
function quickCommands(tests) {
  const cmds = [{ cmd: 'npm run typecheck', mandatory: true, env: 'static' }]
  if (tests.length) cmds.push({ cmd: jestCommand(tests), mandatory: true, env: 'node-mocks' })
  return cmds
}

function finish(status, reason, nextStep) {
  report.status = status
  report.reason = reason
  report.nextStep = nextStep
  report.summary = renderSummary()
  return report
}

function renderSummary() {
  const r = report
  const lines = []
  lines.push(`## smartfin-development (revisión ${r.revision}) — ${r.status}`)
  lines.push(`Modo: ${r.mode} (${r.modeSource}). Tarea: ${r.task || '(vacía)'}`)
  lines.push(`Motivo: ${r.reason}`)
  if (r.scope.classification) lines.push(`Clasificación: ${r.scope.classification}${r.scope.areas.length ? ' [' + r.scope.areas.join(', ') + ']' : ''}`)
  lines.push(`Alcance: ${r.scope.files.length ? r.scope.files.join(', ') : '(sin archivos)'}`)
  lines.push(`Archivos modificados: ${r.filesModified.length ? r.filesModified.join(', ') : 'ninguno'}`)
  lines.push(`Agentes: ${r.agentsUsed.map(a => `${a.label} [${a.agentType}; ${a.restrictions}; ${a.outcome}${a.outputTokens ? `; ~${a.outputTokens.approx} tokens de salida${a.outputTokens.sharedWithConcurrentAgents ? ' (compartido con agentes en paralelo)' : ''}` : ''}]`).join('; ') || 'ninguno'}`)
  lines.push(`Skills consultadas: ${r.skillsConsulted.length ? r.skillsConsulted.join(', ') : 'ninguna'}`)
  lines.push(`Revisores: ${r.reviewers.length ? r.reviewers.map(v => `${v.name} (${v.reason}; ${v.executed ? v.verdict : 'NO ejecutado'})`).join('; ') : 'ninguno requerido'}`)
  lines.push(`Hallazgos corregidos: ${r.findings.fixed.length}; pendientes confirmados: ${r.findings.pending.length}; riesgos potenciales: ${r.findings.potential.length}; contradicciones: ${r.findings.contradictions.length}`)
  for (const f of r.findings.pending) lines.push(`  - [${f.severity}] ${f.location} ${f.title} (${f.reviewers.join(', ')})`)
  lines.push('Comandos:')
  for (const c of r.commands) lines.push(`  - ${c.outcome.toUpperCase()} ${c.command} [${c.stage}; ${c.environment}${c.mandatory ? '; obligatorio' : ''}]${c.reason ? ' — ' + c.reason : ''}`)
  if (!r.commands.length) lines.push('  (ninguno)')
  if (r.timezone) lines.push(`Zona horaria de Jest: ${r.timezone.resolved} (TZ=${r.timezone.tzEnv})`)
  if (r.notRun.length) lines.push(`No ejecutado: ${r.notRun.join('; ')}`)
  if (r.residualRisks.length) lines.push(`Riesgos residuales: ${r.residualRisks.join('; ')}`)
  if (r.efficiencyNote) lines.push(`Eficiencia: ${r.efficiencyNote}`)
  if (r.stopHook) lines.push(`Hook Stop: ${r.stopHook.message}`)
  lines.push(`Siguiente paso: ${r.nextStep}`)
  return lines.join('\n')
}

function explorationPrompt(task, mode) {
  return [
    `Tarea de SmartFin (modo ${mode}): ${task}`,
    'Localiza el código relevante y devuélvelo estructurado: rutas con su papel (path relativo con «/», línea si aplica), símbolos afectados con ruta:línea, consumidores directos, pruebas relacionadas en __tests__/ (rutas exactas), dependencias (módulos e imports relevantes) y discrepancias entre docs/ y el código. Lo que busques y no exista va en notFound. No inventes rutas.',
  ].join('\n')
}
// Una entrada malformada (por ejemplo, texto explicativo tras la ruta) no invalida toda la exploración: el
// resultado solo se rechaza si no queda ninguna ruta válida; las entradas descartadas se registran en el informe.
const validExploration = v => v.paths.some(p => safePath(p.path)) ? null : 'ninguna ruta válida en paths'
function cleanExploration(v) {
  if (!v) return v
  const dropped = [...v.paths.map(p => p.path), ...v.tests].filter(p => !safePath(p))
  if (dropped.length) note(`Exploración: se descartan ${dropped.length} rutas no válidas: ${dropped.slice(0, 5).join('; ')}`)
  return { ...v, paths: v.paths.filter(p => safePath(p.path)), tests: v.tests.filter(safePath) }
}

// =====================================================================================================
// Modo audit (predeterminado, sin escrituras)
// =====================================================================================================
async function audit() {
  phase('Exploración')
  const [inventoryBefore, exploration] = await parallel([
    () => takeInventory('inventory:audit-before', 'Exploración', 'inicio de la auditoría'),
    () => run(explorationPrompt(input.task, 'audit'), { label: 'scout:audit', phase: 'Exploración', agentType: 'scout', schema: EXPLORATION_SCHEMA }, validExploration, 'scout').then(cleanExploration),
  ])
  if (!inventoryBefore) return finish('failed', 'No se obtuvo un inventario inicial válido del árbol; sin él no se puede garantizar que la auditoría no escriba.', 'Relanzar el workflow.')
  if (exploration) {
    report.scope.files = uniq(exploration.paths.map(p => p.path))
    report.scope.tests = uniq(exploration.tests)
  } else {
    note('Sin resultado válido de scout: el analista explorará por sí mismo')
  }

  phase('Análisis')
  const analyst = auditAnalyst(report.scope.files)
  report.auditAnalyst = analyst
  note(`Analista de solo lectura: ${analyst.agentType} (${analyst.why})`)
  const analysis = await run([
    `Auditoría de SmartFin en modo solo lectura. Tarea: ${input.task}`,
    analyst.agentType === 'scout' ? '' : 'Esta invocación NO es una revisión de un diff: el workflow te usa como auditor de solo lectura del código existente. No hay cambios que revisar; audita los archivos del alcance y no emitas veredicto sobre un diff.',
    exploration ? `Exploración previa (scout, validada): ${JSON.stringify(exploration)}` : 'No hay exploración previa: localiza tú los archivos, consumidores y pruebas.',
    '1. Analiza el flujo de datos con evidencia ruta:línea, las pruebas existentes y los riesgos financieros, SQLite, Android, seguridad y rendimiento que apliquen. Consulta solo las skills de .claude/skills/ que el alcance requiera y lístalas en skillsConsulted. Distingue riesgo confirmado (visible en el código o reproducido) de potencial.',
    analyst.agentType === 'scout'
      ? '2. No tienes shell: deja «checks» vacío.'
      : `2. Comprobaciones seguras y proporcionadas, si aportan evidencia. Tu Bash solo admite estas formas, escritas exactamente así y sin prefijos (ni cd): «${EVIDENCE_ENV} npm test -- --runInBand __tests__/<archivo>…» (Jest de archivos concretos del alcance; el prefijo redirige su evidencia fuera de la evidencia preexistente), «npm run typecheck», «npx tsc --noEmit», «git status …», «git ls-files …» y «pwd». La configuración de Jest (__tests__/setup/redirectEvidenceWrites.js) desvía a ese directorio toda escritura de fs dirigida a docs/, también la de pruebas que escriben «docs/…» directamente, y el workflow comprueba después que ni docs/ ni la evidencia preexistente cambiaron: no descartes una prueba del alcance solo porque escriba evidencia. No ejecutes la suite completa, test:reproductions ni campañas Android. Si un comando se bloquea, regístralo como not_run y sigue.`,
    '3. Prohibido: editar, crear o borrar archivos; git add/commit/stash/checkout/restore/reset; abrir bases o respaldos reales; red. El workflow compara inventarios del árbol (incluida la evidencia de artifacts/) antes y después y bloquea el resultado ante cualquier cambio.',
    '4. Recomienda revisores solo si un cambio futuro en este alcance los exigiría (no los invoques).',
  ].filter(Boolean).join('\n'), {
    label: `analyst:audit:${analyst.agentType}`, phase: 'Análisis', agentType: analyst.agentType, schema: AUDIT_SCHEMA,
    // scout no tiene Bash (un clamp sobre un agente sin Bash hace que el runtime rechace el spawn).
    ...(analyst.agentType === 'scout' ? {} : { disallowedTools: READONLY_DENY, bashCommandClamp: AUDIT_CLAMP }),
  }, null, 'analyst')
  const inventoryAfter = await takeInventory('inventory:audit-after', 'Análisis', 'final de la auditoría')

  phase('Informe')
  if (!inventoryAfter) return finish('blocked', 'No se obtuvo el inventario final: no se puede afirmar que el árbol quedó intacto.', 'Comprobar git status manualmente.')
  const auditDiff = diffInventory(inventoryBefore, inventoryAfter)
  report.inventory = { head: parseInventory(inventoryBefore).head, comparison: describeDiff(inventoryBefore, inventoryAfter) }
  report.gitUnchanged = sameInventory(inventoryBefore, inventoryAfter)
  report.toleratedArtifacts = auditDiff.ok ? { ignoredEntries: auditDiff.ignoredAdded.filter(TOLERATED_IGNORED), evidenceFilesInWorkflowDir: auditDiff.evidenceChanged.length } : null
  if (!report.gitUnchanged) {
    report.filesModified = auditDiff.ok ? auditDiff.changed : []
    return finish('blocked', `El árbol de trabajo cambió durante una auditoría de solo lectura (por el workflow o por otro proceso): ${describeDiff(inventoryBefore, inventoryAfter)}.`,
      'Revisar esos cambios antes de continuar; no se revierte nada automáticamente.')
  }
  if (!analysis) return finish('failed', 'El análisis no produjo un resultado válido; un null nunca equivale a aprobación.', 'Relanzar el workflow en modo audit o auditar en una sesión normal.')

  report.skillsConsulted = uniq(analysis.skillsConsulted)
  for (const c of analysis.checks) {
    report.commands.push({ stage: 'audit', command: c.command, mandatory: false, environment: /jest|npm test/.test(c.command) ? 'node-mocks' : 'static',
      outcome: c.outcome, exitCode: typeof c.exitCode === 'number' ? c.exitCode : null, summary: c.summary, reason: c.reason || '' })
    if (c.outcome === 'not_run' || c.outcome === 'error') report.notRun.push(`${c.command}: ${c.reason || 'sin motivo'}`)
  }
  report.findings.potential = analysis.risks.filter(r => r.kind === 'potential')
  report.findings.pending = analysis.risks.filter(r => r.kind === 'confirmed').map(r => ({ ...r, title: r.evidence.slice(0, 120), reviewers: ['analyst:audit'] }))
  report.audit = { dataFlow: analysis.dataFlow, testsFound: analysis.testsFound, risks: analysis.risks,
    reviewersRecommended: analysis.reviewersRecommended || [], nextSteps: analysis.nextSteps, exploration }
  if (!analysis.testsFound.length && !report.scope.tests.length) report.residualRisks.push('no se identificaron pruebas existentes para el alcance')
  if (report.scope.files.length <= 1) report.efficiencyNote = 'El alcance es de un archivo: una sesión normal habría sido más eficiente que el workflow.'
  report.stopHook = { message: 'audit no modifica archivos (inventarios antes/después idénticos); el recordatorio de revisores no aplica a esta ejecución.' }
  const status = report.notRun.length || analysis.checks.some(c => c.outcome === 'failed') ? 'approved_with_conditions' : 'approved'
  return finish(status, status === 'approved'
    ? 'Auditoría completada sin escrituras; «approved» se refiere a la auditoría, no al código auditado.'
    : 'Auditoría completada sin escrituras, con comprobaciones fallidas o no ejecutadas (ver comandos).',
  analysis.nextSteps[0] || 'Decidir si alguno de los riesgos justifica una tarea /smartfin-development implement con comportamiento esperado verificable.')
}

// =====================================================================================================
// Modo implement
// =====================================================================================================
async function implement() {
  // ---------------------------------------------------------------- Fase 1: exploración y clasificación
  phase('Exploración')
  // La línea base la toma un agente independiente antes de cualquier otra etapa: cualquier escritura posterior
  // de scout, del clasificador o de otro proceso aparecerá en el preflight del escritor.
  const [baseline, exploration] = await parallel([
    () => takeInventory('inventory:baseline', 'Exploración', 'línea base antes de implementar'),
    () => run(explorationPrompt(input.task, 'implement'), { label: 'scout:implement', phase: 'Exploración', agentType: 'scout', schema: EXPLORATION_SCHEMA }, validExploration, 'scout').then(cleanExploration),
  ])
  if (!baseline) return finish('failed', 'No se obtuvo un inventario base válido; sin él no se puede proteger el trabajo existente.', 'Relanzar el workflow.')
  if (!exploration) note('Sin exploración válida de scout; el clasificador localizará el alcance')

  const classification = await run([
    `Clasifica, sin editar nada, esta tarea de implementación en SmartFin: ${input.task}`,
    exploration ? `Exploración (scout, validada): ${JSON.stringify(exploration)}` : 'No hay exploración previa: localiza tú el alcance con Read/Grep/Glob.',
    `- changeType: ${CHANGE_TYPES.join(' | ')} («mixed» si combina áreas; lista las áreas en «areas»).`,
    '- skills: solo las necesarias para este cambio (no todas).',
    '- scopeFiles: archivos de producción y de prueba que se espera modificar o crear (rutas relativas con «/»).',
    '- expectedBehavior y expectedBehaviorVerifiable: true solo si la tarea define un comportamiento que una prueba o comando concreto puede comprobar.',
    `- requiredDecisions: decisiones del propietario que el cambio implicaría: ${DECISION_KEYS.map(k => `${k} (${OWNER_DECISIONS[k]})`).join('; ')}.`,
    '- authorizations: para cada decisión que la TAREA autorice expresamente, la cita literal exacta de la tarea. No infieras autorizaciones.',
    '- extraReviewers: revisores que el riesgo semántico justifica aunque las rutas no lo exijan, con motivo.',
  ].join('\n'), { label: 'classifier', phase: 'Exploración', schema: CLASSIFY_SCHEMA, disallowedTools: [...READONLY_DENY, 'Bash'] },
  v => (!v.scopeFiles.length ? 'scopeFiles vacío' : v.scopeFiles.some(f => !safePath(f)) ? 'scopeFiles con rutas no válidas' : null), 'classifier')

  if (!classification) return finish('failed', 'La clasificación no produjo un resultado válido.', 'Relanzar el workflow o acotar la tarea.')

  const scopeFiles = uniq(classification.scopeFiles)
  report.scope.files = scopeFiles
  report.scope.classification = classification.changeType
  report.scope.areas = classification.areas
  const skills = uniq([...(TYPE_SKILLS[classification.changeType] || []), ...classification.areas.flatMap(a => TYPE_SKILLS[a] || []),
    ...classification.skills.filter(s => SKILLS.includes(s))])
  const tests0 = uniq([...(exploration ? exploration.tests : []), ...scopeFiles]).filter(p => isStableTest(p) || isReproTest(p))
  report.scope.tests = tests0

  phase('Alcance')
  const authorized = validAuthorizations(classification.authorizations, input.task)
  const neededBefore = uniq([...classification.requiredDecisions, ...decisionsForPaths(scopeFiles)])
  const missingBefore = neededBefore.filter(k => !authorized.has(k))
  report.decisions = { needed: neededBefore, authorized: [...authorized] }
  if (missingBefore.length)
    return finish('blocked', `Requiere decisiones del propietario no autorizadas en la tarea: ${missingBefore.map(k => OWNER_DECISIONS[k]).join('; ')}.`,
      'Relanzar con la autorización expresa en el texto de la tarea, o acotar el cambio para que no la necesite.')
  if (!classification.expectedBehaviorVerifiable)
    return finish('blocked', 'La tarea no define un comportamiento esperado verificable; no se modifica producción.',
      'Relanzar indicando el comportamiento esperado y cómo comprobarlo (prueba o comando concreto).')
  const dirty = parseInventory(baseline).entries
  const foreign = scopeFiles.filter(f => dirty.has(f))
  if (foreign.length)
    return finish('blocked', `Hay cambios ajenos en archivos del alcance: ${foreign.join(', ')}.`,
      'Confirmar, apartar o descartar esos cambios manualmente y relanzar; el workflow no los toca.')

  // ---------------------------------------------------------------- Fase 2: implementación (un único escritor)
  phase('Implementación')
  const mechanical = classification.changeType === 'mechanical' && scopeFiles.filter(f => !IGNORED(f)).every(MECHANICAL_ALLOWED)
  // El escritor conserva Edit/Write/Bash (y PowerShell si es el predeterminado) pero sin herramientas externas.
  const writer = { disallowedTools: EXTERNAL_TOOLS, ...(mechanical ? { agentType: 'mechanical' } : {}) }
  report.writer = mechanical ? 'mechanical (dentro de sus restricciones declaradas)' : 'workflow (predeterminado, modelo de la sesión)'

  const implementerPrompt = (expected, body) => [
    'Eres el ÚNICO agente que escribe en este workflow. Trabajas en el árbol de trabajo actual.',
    `PRIMER PASO OBLIGATORIO, antes de cualquier edición. ${INVENTORY_STEPS}`,
    'Devuélvelo en preflight.observed y compáralo con este inventario esperado (límite de la etapa anterior):',
    `statusV2 esperado:\n${nl(expected.statusV2) || '(vacío)'}\nhashOutput esperado:\n${nl(expected.hashOutput) || '(vacío)'}`,
    'Si difiere en cualquier línea o hash (cambios de una ejecución anterior que se está reanudando, de otro proceso o del usuario), NO edites nada: devuelve preflight.matchesExpected=false, status=blocked y «end» igual al inventario observado. El workflow repite la comparación por su cuenta.',
    body,
    'Reglas: no modifiques pruebas para ocultar errores (si cambias una prueba, explica por qué en testsModified); preserva los cambios del usuario; reutiliza componentes y repositorios existentes; no añadas dependencias; no toques archivos fuera de este alcance salvo pruebas que ejerciten el cambio. Si necesitas salir del alcance, una decisión del propietario o se te deniega un permiso, detente con status=blocked, decisionsNeeded y el motivo; no uses otra herramienta para evadir una denegación.',
    `No hagas commit, stash, checkout, restore, reset ni cambies de rama. No ejecutes la suite completa de Jest ni test:reproductions (la verificación del workflow las ejecuta); puedes ejecutar typecheck y Jest de archivos concretos, siempre con el prefijo «${EVIDENCE_ENV}» para no tocar la evidencia preexistente de artifacts/. No toques dispositivos ni bases o respaldos reales.`,
    'ÚLTIMO PASO: lista en filesChanged TODAS las rutas que creaste, modificaste o borraste, repite el inventario y devuélvelo en «end».',
  ].join('\n')
  const validImpl = v => inventoryProblem(v.preflight.observed) ? 'preflight: ' + inventoryProblem(v.preflight.observed)
    : inventoryProblem(v.end) ? 'end: ' + inventoryProblem(v.end) : null

  // Etapa de escritura con límites verificados por el script, no por la declaración del agente:
  //  - el preflight observado debe coincidir con el inventario esperado: en una reanudación tras una escritura
  //    parcial, o con cambios concurrentes, no coincide y el resultado es blocked;
  //  - todo lo que cambió entre preflight y «end» debe estar declarado en filesChanged (o es concurrente);
  //  - el inventario «end» se convierte en el esperado de la etapa siguiente.
  async function writeStage(label, phaseTitle, expected, body) {
    const impl = await run(implementerPrompt(expected, body), { label, phase: phaseTitle, schema: IMPLEMENT_SCHEMA, ...writer }, validImpl, 'implementer')
    if (!impl) return { error: ['failed', `El escritor (${label}) no devolvió un resultado válido; el estado del árbol es incierto.`, 'Inspeccionar git status/diff manualmente; una reanudación se bloqueará si el árbol difiere del último inventario esperado.'] }
    report.skillsConsulted = uniq([...report.skillsConsulted, ...impl.skillsConsulted])
    const preflightOk = sameInventory(expected, impl.preflight.observed)
    const wrote = changedBetween(impl.preflight.observed, impl.end) || []
    if (!preflightOk) {
      const warn = wrote.length ? ` El escritor modificó igualmente: ${wrote.join(', ')}.` : ' No escribió.'
      return { impl, error: ['blocked', `El árbol no coincidía con el inventario esperado antes de ${label} (reanudación tras escritura parcial, ejecución previa u otro proceso): ${describeDiff(expected, impl.preflight.observed)}.${warn}`, 'Revisar git status y diff, resolver manualmente y relanzar desde cero; no reanudar.'] }
    }
    if (!impl.preflight.matchesExpected && !wrote.length)
      return { impl, error: ['blocked', `El escritor (${label}) declaró que el árbol no coincidía y no escribió.`, 'Revisar el estado del árbol y relanzar.'] }
    const undeclared = wrote.filter(p => !impl.filesChanged.includes(p))
    if (undeclared.length)
      return { impl, error: ['blocked', `Cambios no declarados por el escritor durante ${label} (posible modificación concurrente): ${undeclared.join(', ')}.`, 'Revisar esos archivos manualmente; el workflow no los revierte.'] }
    if (impl.status !== 'done')
      return { impl, error: [impl.status === 'blocked' ? 'blocked' : 'failed', `Escritor (${label}): ${impl.reason}${impl.decisionsNeeded.length ? ' — decisiones: ' + impl.decisionsNeeded.map(k => OWNER_DECISIONS[k]).join('; ') : ''}`, 'Revisar el motivo y, si procede, relanzar con la autorización o el alcance corregido.'] }
    return { impl, end: impl.end }
  }
  const stop = err => finish(err[0], err[1], err[2])

  const stage1 = await writeStage('implementer', 'Implementación', baseline, [
    `Tarea: ${input.task}`,
    `Comportamiento esperado: ${classification.expectedBehavior}`,
    `Plan de verificación: ${classification.verificationPlan}`,
    `Alcance (archivos): ${scopeFiles.join(', ')}`,
    `Pruebas relacionadas: ${tests0.join(', ') || '(ninguna identificada; crea o amplía la prueba que fije el comportamiento)'}`,
    `Tipo de cambio: ${classification.changeType}. Antes de editar lee estas skills: ${skills.length ? skills.map(s => `.claude/skills/${s}/SKILL.md`).join(', ') : '(ninguna)'}.`,
    exploration ? `Exploración: ${JSON.stringify({ symbols: exploration.symbols, consumers: exploration.consumers, discrepancies: exploration.discrepancies })}` : '',
    'Antes de editar, identifica el comportamiento inicial y las pruebas que lo fijan (baselineBehavior).',
  ].join('\n'))
  if (stage1.error) return stop(stage1.error)
  const impl = stage1.impl
  report.implementation = { baselineBehavior: impl.baselineBehavior, testsModified: impl.testsModified, notes: impl.notes || '' }

  // Comprueba una verificación en su límite de etapa: entrada igual a lo esperado (sin cambios concurrentes),
  // salida sin archivos nuevos de las pruebas. Devuelve un error de parada o null.
  const boundaryError = (v, what) => {
    if (!v.result) return ['failed', `La ${what} no produjo un resultado válido.`, 'Ejecutar manualmente los comandos de esa verificación.']
    if (v.concurrent) return ['blocked', `El árbol cambió entre etapas antes de la ${what} (otro proceso o agente): ${v.concurrent}.`, 'Revisar esos cambios manualmente y relanzar desde cero.']
    if (v.leftovers) return ['failed', `Las pruebas de la ${what} dejaron archivos o cambios inesperados: ${v.leftovers}.`, 'Localizar la prueba que escribe fuera de artifacts/ y corregirla; no se borra nada automáticamente.']
    return null
  }

  // ---------------------------------------------------------------- Fase 3: verificación rápida
  phase('Verificación rápida')
  let tests = uniq([...tests0, ...impl.testsAffected]).filter(isStableTest)
  if (tests.length > MAX_TARGETED_TESTS) {
    note(`${tests.length} pruebas afectadas: la verificación rápida usa las primeras ${MAX_TARGETED_TESTS}; la final ejecutará la suite completa`)
    tests = tests.slice(0, MAX_TARGETED_TESTS)
  }
  if (!tests.length) report.residualRisks.push('no hay pruebas Jest afectadas identificadas para el cambio')
  let quick = await verify('rápida', quickCommands(tests), stage1.end)
  let err = boundaryError(quick, 'verificación rápida')
  if (err) return stop(err)
  let current = quick.result.after
  let declared = [...impl.filesChanged]

  if (quick.failed.length) {
    note('La verificación rápida falló: el implementador corrige una vez')
    const retry = await writeStage('implementer:fix-verify', 'Verificación rápida', current, [
      `Tarea original: ${input.task}`,
      'Corrige SOLO lo necesario para que pasen estos comandos, sin debilitar pruebas:',
      ...quick.failed.map(f => `- ${f.command}: ${f.summary}`),
    ].join('\n'))
    if (retry.error) return stop(retry.error)
    declared = uniq([...declared, ...retry.impl.filesChanged])
    tests = uniq([...tests, ...retry.impl.testsAffected]).filter(isStableTest).slice(0, MAX_TARGETED_TESTS)
    quick = await verify('rápida-2', quickCommands(tests), retry.end)
    err = boundaryError(quick, 'segunda verificación rápida')
    if (err) return stop(err)
    if (quick.failed.length)
      return finish('failed', 'Typecheck o las pruebas afectadas siguen fallando tras una corrección.', 'Revisar los fallos registrados en commands; no se lanzaron revisores.')
    current = quick.result.after
  }

  // ---------------------------------------------------------------- Fase 4: revisión independiente
  phase('Revisión')
  let changed = changedBetween(baseline, current)
  const outside = changed.filter(f => !scopeFiles.includes(f) && !/(?:^|\/)__tests__\//.test(f))
  const neededAfter = decisionsForPaths(changed).filter(k => !authorized.has(k))
  report.filesModified = changed
  const notMine = changed.filter(f => !declared.includes(f))
  if (notMine.length)
    return finish('blocked', `El diff contiene cambios que ningún escritor declaró (posible modificación concurrente): ${notMine.join(', ')}.`, 'Revisar esos archivos manualmente; el workflow no los revierte.')
  if (neededAfter.length)
    return finish('blocked', `El diff toca áreas que requieren autorización del propietario: ${neededAfter.map(k => OWNER_DECISIONS[k]).join('; ')}.`, 'Revisar y deshacer manualmente esos archivos o relanzar con autorización expresa.')
  if (outside.length)
    return finish('blocked', `El implementador modificó archivos fuera del alcance: ${outside.join(', ')}.`, 'Revisar esos cambios manualmente; el workflow no los revierte.')

  const required = requiredReviewers(changed)
  const selected = required.map(r => ({ name: r.name, reason: `obligatorio por rutas (reviewer-reminder.cjs: ${r.why}): ${r.files.join(', ')}`, mandatory: true, files: r.files }))
  for (const extra of classification.extraReviewers) {
    if (selected.some(s => s.name === extra.name)) continue
    if (!affordable(60000)) { note(`Presupuesto insuficiente: se omite el revisor semántico opcional ${extra.name}`); report.residualRisks.push(`revisor semántico ${extra.name} omitido por presupuesto`); continue }
    selected.push({ name: extra.name, reason: `criterio semántico del clasificador: ${extra.reason}`, mandatory: false, files: changed })
  }

  const reviewPrompt = (sel, extra) => [
    `Revisión independiente solicitada por el workflow smartfin-development. Tarea implementada: ${input.task}`,
    `Motivo de tu selección: ${sel.reason}`,
    `Archivos cambiados por el workflow (incluye archivos nuevos sin seguimiento; revísalos aunque git diff no los muestre): ${changed.join(', ')}`,
    'Alcance de la tarea: ' + scopeFiles.join(', '),
    extra || '',
    `Restricciones de este workflow: no edites archivos; NO ejecutes la suite completa de Jest ni test:reproductions (la verificación final las ejecuta en secuencia y otros revisores trabajan en paralelo); puedes ejecutar typecheck o Jest de archivos concretos para confirmar un hallazgo, siempre con el prefijo «${EVIDENCE_ENV}» (la evidencia preexistente de artifacts/ no debe cambiar). No toques dispositivos.`,
    'Devuelve cada hallazgo con severidad, ruta:línea, evidencia, si es confirmado o riesgo potencial, si está dentro del alcance y la prueba recomendada.',
  ].join('\n')

  const runReviews = (list, extraFor) => parallel(list.map(sel => () =>
    run(reviewPrompt(sel, extraFor ? extraFor(sel) : ''), { label: `review:${sel.name}`, phase: 'Revisión', agentType: sel.name, schema: REVIEW_SCHEMA }, null, 'review')
      .then(value => ({ sel, value }))))

  const reviewSnapshot = current
  const reviewResults = selected.length ? await runReviews(selected) : []
  if (!selected.length) note('Ningún revisor requerido por rutas ni por criterio semántico')
  const byReviewer = new Map()
  for (const item of reviewResults.filter(Boolean)) {
    byReviewer.set(item.sel.name, item.value)
    report.reviewers.push({ name: item.sel.name, reason: item.sel.reason, mandatory: item.sel.mandatory, executed: !!item.value,
      verdict: item.value ? item.value.verdict : null, files: item.sel.files, reviewedSnapshot: reviewSnapshot })
  }
  for (const sel of selected) if (!report.reviewers.some(r => r.name === sel.name))
    report.reviewers.push({ name: sel.name, reason: sel.reason, mandatory: sel.mandatory, executed: false, verdict: null, files: sel.files })

  const consolidate = () => {
    const groups = new Map()
    for (const [name, value] of byReviewer) {
      if (!value) continue
      for (const f of value.findings) {
        const key = f.location.replace(/\s+/g, '').toLowerCase()
        const g = groups.get(key) || { ...f, reviewers: [], kinds: new Set(), severities: new Set() }
        g.reviewers.push(name); g.kinds.add(f.kind); g.severities.add(f.severity)
        if (SEVERITY_RANK[f.severity] > SEVERITY_RANK[g.severity]) g.severity = f.severity
        if (f.kind === 'confirmed') g.kind = 'confirmed'
        if (f.inScope) g.inScope = true
        groups.set(key, g)
      }
    }
    const list = [...groups.values()]
    const contradictions = list.filter(g => g.kinds.size > 1 || g.severities.size > 1)
      .map(g => ({ location: g.location, reviewers: g.reviewers, kinds: [...g.kinds], severities: [...g.severities] }))
    for (const [name, value] of byReviewer) {
      if (value && value.verdict === 'rejected' && !value.findings.some(f => f.kind === 'confirmed' && SEVERITY_RANK[f.severity] >= 2))
        contradictions.push({ location: '(veredicto)', reviewers: [name], kinds: ['rejected sin hallazgos críticos/altos confirmados'], severities: [] })
    }
    return { list: list.map(({ kinds, severities, ...rest }) => rest), contradictions }
  }
  let merged = consolidate()

  // ---------------------------------------------------------------- Fase 5: corrección controlada (una ronda)
  phase('Corrección')
  const fixable = merged.list.filter(f => f.kind === 'confirmed' && f.inScope)
  let fixedOk = false
  if (fixable.length && affordable(80000)) {
    // El preflight se compara con el inventario anterior a la revisión: detecta escrituras de los revisores o
    // de otro proceso durante la revisión.
    const fixStage = await writeStage('implementer:fix-review', 'Corrección', current, [
      `Tarea original: ${input.task}`,
      'Revisores independientes confirmaron estos defectos dentro del alcance. Corrige lo mínimo para cada uno, sin cambios especulativos, y ejecuta las pruebas afectadas concretas:',
      ...fixable.map(f => `- [${f.severity}] ${f.location}: ${f.title}. Evidencia: ${f.evidence}. Prueba recomendada: ${f.recommendedTest}`),
    ].join('\n'))
    if (fixStage.error) {
      // Integridad comprometida (sin resultado, árbol inesperado o escrituras de una corrección no terminada): parar.
      // Si el escritor se detuvo sin escribir, los hallazgos quedan pendientes y deciden el estado más abajo.
      const f = fixStage.impl
      const integrity = !f || !sameInventory(current, f.preflight.observed) || (changedBetween(f.preflight.observed, f.end) || []).length > 0
      if (integrity) return stop(fixStage.error)
      note(`La ronda de corrección no se completó sin escribir (${fixStage.error[1]}); los hallazgos quedan pendientes`)
    } else {
      const fix = fixStage.impl
      declared = uniq([...declared, ...fix.filesChanged])
      tests = uniq([...tests, ...fix.testsAffected]).filter(isStableTest).slice(0, MAX_TARGETED_TESTS)
      const quick3 = await verify('corrección', quickCommands(tests), fixStage.end)
      err = boundaryError(quick3, 'verificación tras la corrección')
      if (err) return stop(err)
      if (quick3.failed.length)
        return finish('failed', 'Las pruebas afectadas fallan después de la corrección de hallazgos.', 'Revisar los fallos registrados; no hay más rondas automáticas.')
      current = quick3.result.after
      const delta = changedBetween(reviewSnapshot, current) || []
      changed = changedBetween(baseline, current) || []
      report.filesModified = changed
      const stillOk = decisionsForPaths(changed).filter(k => !authorized.has(k))
      const out2 = changed.filter(f => !scopeFiles.includes(f) && !/(?:^|\/)__tests__\//.test(f))
      const notMine2 = changed.filter(f => !declared.includes(f))
      if (stillOk.length || out2.length || notMine2.length)
        return finish('blocked', `La corrección salió del alcance, tocó áreas no autorizadas o dejó cambios no declarados: ${[...out2, ...notMine2, ...stillOk.map(k => OWNER_DECISIONS[k])].join(', ')}.`, 'Revisar el diff manualmente.')
      // Solo vuelven los revisores de las áreas corregidas, más los que exija el delta por rutas.
      const again = uniq([...fixable.flatMap(f => f.reviewers), ...requiredReviewers(delta).map(r => r.name)])
      const reSel = again.map(name => {
        const prev = selected.find(s => s.name === name)
        const rule = requiredReviewers(changed).find(r => r.name === name)
        return { name, reason: (prev ? prev.reason : `obligatorio por rutas tras la corrección: ${rule ? rule.files.join(', ') : ''}`) + ' — re-revisión tras corrección', mandatory: !!rule || (prev && prev.mandatory), files: rule ? rule.files : changed }
      })
      const reResults = await runReviews(reSel, sel => `Re-revisión tras una ronda de corrección. Archivos tocados por la corrección: ${delta.join(', ') || '(ninguno)'}. Hallazgos previos a verificar: ${JSON.stringify(fixable.filter(f => f.reviewers.includes(sel.name)).map(f => ({ location: f.location, title: f.title })))}`)
      for (const item of reResults.filter(Boolean)) {
        byReviewer.set(item.sel.name, item.value)
        const row = report.reviewers.find(r => r.name === item.sel.name)
        const entry = { name: item.sel.name, reason: item.sel.reason, mandatory: item.sel.mandatory, executed: !!item.value, verdict: item.value ? item.value.verdict : null, files: item.sel.files, reviewedSnapshot: current }
        if (row) Object.assign(row, entry, { rounds: 2 }); else report.reviewers.push(entry)
      }
      merged = consolidate()
      const keyOf = f => f.location.replace(/\s+/g, '').toLowerCase()
      const remaining = new Set(merged.list.filter(f => f.kind === 'confirmed').map(keyOf))
      report.findings.fixed = fixable.filter(f => !remaining.has(keyOf(f)))
      fixedOk = true
    }
  } else if (fixable.length) {
    note('Presupuesto insuficiente para la ronda de corrección; los hallazgos quedan pendientes')
    report.residualRisks.push('ronda de corrección omitida por presupuesto')
  }
  report.findings.contradictions = merged.contradictions
  report.findings.pending = merged.list.filter(f => f.kind === 'confirmed')
  report.findings.potential = merged.list.filter(f => f.kind === 'potential')
  const blocking = report.findings.pending.filter(f => SEVERITY_RANK[f.severity] >= 2)
  if (blocking.length)
    return finish('blocked', `Persisten ${blocking.length} hallazgos críticos o altos confirmados${fixedOk ? ' tras la ronda de corrección' : ''}.`,
      'Resolver manualmente los hallazgos pendientes (ver findings.pending) y volver a invocar a sus revisores.')

  // ---------------------------------------------------------------- Fase 6: verificación final (secuencial)
  phase('Verificación final')
  const domain = ['financial_domain', 'sqlite_persistence', 'android_native', 'security_privacy', 'mixed'].includes(classification.changeType) ||
    classification.areas.some(a => a !== 'mechanical' && a !== 'rn_ui')
  const significant = domain || changed.filter(f => !IGNORED(f)).length > 5 || required.length > 0
  const persistence = changed.some(f => /^src\/database\//.test(f) || /^src\/modules\/[^/]+\/(?:repositories|database)\//.test(f) ||
    f === 'scripts/patchReactNativeSqliteStorage.js' || /^android\/.*sqlite/i.test(f))
  const skillsTouched = changed.some(f => /^\.(?:claude|agents)\/skills\//.test(f))
  const hooksTouched = changed.some(f => /^\.claude\/hooks\//.test(f))
  const reproTests = uniq([...tests0, ...changed]).filter(isReproTest)
  const finalCmds = [
    { cmd: 'npm run typecheck', mandatory: true, env: 'static' },
    { cmd: 'npm run lint', mandatory: true, env: 'static' },
    { cmd: 'git diff --check', mandatory: true, env: 'git' },
  ]
  if (significant) {
    // La suite estable tardó 552 s en una sola llamada (2026-11-08), al borde del límite de 600 s por comando:
    // se divide con --shard de Jest 29 (misma cobertura, mismo orden secuencial, sin paralelismo entre suites).
    for (let i = 1; i <= SUITE_SHARDS; i++)
      finalCmds.push({ cmd: `${EVIDENCE_ENV} npm test -- --ci --runInBand --shard=${i}/${SUITE_SHARDS}`, mandatory: true, env: 'node-mocks' })
    finalCmds.push({ cmd: `${EVIDENCE_ENV} npm run test:reproductions -- --ci --runInBand`, mandatory: true, env: 'node-mocks' })
  } else {
    if (tests.length) finalCmds.push({ cmd: jestCommand(tests), mandatory: true, env: 'node-mocks' })
    if (reproTests.length) finalCmds.push({ cmd: `${EVIDENCE_ENV} npm run test:reproductions -- --ci --runInBand ${reproTests.join(' ')}`, mandatory: true, env: 'node-mocks' })
  }
  if (persistence) finalCmds.push({ cmd: `${EVIDENCE_ENV} npm test -- --ci --runInBand __tests__/sqliteAndroidRecoveryPatch.test.ts`, mandatory: true, env: 'node' })
  // «skills:check» existe en main desde c179e6e (PR #2); en ramas anteriores el verificador lo informará como error.
  if (skillsTouched) finalCmds.push({ cmd: 'npm run skills:check', mandatory: true, env: 'node' })
  if (hooksTouched) finalCmds.push({ cmd: 'node --test .claude/hooks/__tests__/dangerous-command-guard.test.cjs .claude/hooks/__tests__/reviewer-reminder.test.cjs', mandatory: true, env: 'node' })
  if (!significant) report.notRun.push('suite Jest completa y test:reproductions completas: no exigidas por el riesgo (cambio no significativo ni de dominio)')

  // La entrada debe coincidir con el último inventario esperado (detecta escrituras de revisores o de otro proceso).
  const final = await verify('final', finalCmds, current)
  err = boundaryError(final, 'verificación final')
  if (err) return stop(err)
  report.commands.push({ stage: 'final', command: 'inventario antes/después de las pruebas', mandatory: true, environment: 'git', outcome: 'passed', exitCode: 0, summary: `sin archivos nuevos ni cambios; evidencia preexistente de artifacts/ intacta (solo cambió ${EVIDENCE_DIR})`, reason: '' })
  report.filesModified = changedBetween(baseline, final.result.after) || []
  const finalDiff = diffInventory(baseline, final.result.after)
  report.inventory = { created: finalDiff.ok ? finalDiff.created : [], deleted: finalDiff.ok ? finalDiff.deleted : [],
    baselineHead: parseInventory(baseline).head, finalHead: parseInventory(final.result.after).head }

  // ---------------------------------------------------------------- Fase 7: informe
  phase('Informe')
  const reviewersMissing = report.reviewers.filter(r => !r.executed)
  report.stopHook = {
    message: report.reviewers.length
      ? `Revisores ya ejecutados por el workflow sobre el diff final: ${report.reviewers.filter(r => r.executed).map(r => r.name).join(', ') || 'ninguno'}${reviewersMissing.length ? '; NO ejecutados: ' + reviewersMissing.map(r => r.name).join(', ') : ''}. No relanzarlos si el árbol sigue coincidiendo con «finalInventory».`
      : 'Ninguna ruta del diff exige revisor según reviewer-reminder.cjs.',
    finalInventory: final.result.after,
  }
  if (report.filesModified.filter(f => !IGNORED(f)).length <= 1 && report.reviewers.length === 0)
    report.efficiencyNote = 'Cambio de un archivo sin revisores: una sesión normal habría sido más eficiente que el workflow.'
  for (const f of report.findings.potential) report.residualRisks.push(`[potencial ${f.severity}] ${f.location}: ${f.title}`)
  report.residualRisks.push('comportamiento en dispositivo (Kotlin, permisos, proveedor real, API 24 frente a 34+) no validado: el workflow no ejecuta campañas Android')

  if (final.failed.length) return finish('failed', `Verificaciones obligatorias fallidas: ${final.failed.map(f => f.command).join('; ')}.`, 'Corregir los fallos y repetir la verificación final.')
  const conditions = []
  if (final.notRun.length) conditions.push('verificaciones no ejecutadas')
  if (reviewersMissing.some(r => !r.mandatory)) conditions.push('revisores semánticos sin resultado (un null no aprueba)')
  if (report.findings.pending.length) conditions.push('hallazgos medios o bajos confirmados pendientes')
  if (report.findings.contradictions.length) conditions.push('hallazgos contradictorios entre revisores')
  if (!tests.length) conditions.push('sin pruebas Jest afectadas')
  if (report.timezone && !/America\/Bogota/.test(`${report.timezone.resolved} ${report.timezone.tzEnv}`)) conditions.push('Jest no confirmó la zona America/Bogota')
  if (reviewersMissing.some(r => r.mandatory))
    return finish('blocked', 'Un revisor obligatorio no produjo resultado; un null nunca equivale a aprobación.', 'Invocar manualmente los revisores faltantes sobre el diff actual.')
  if (conditions.length) return finish('approved_with_conditions', `Implementación verificada con condiciones: ${conditions.join('; ')}.`, 'Atender las condiciones listadas antes de confirmar el cambio (el workflow no hace commit).')
  return finish('approved', 'Implementación verificada: verificaciones obligatorias en verde y sin hallazgos confirmados pendientes.', 'Revisar el diff y confirmar el cambio manualmente (el workflow no hace commit, push ni PR).')
}

// =====================================================================================================
phase('Alcance')
log(`Modo ${input.mode} (${report.modeSource})`)
if (!input.task) return finish('blocked', 'No se recibió descripción de la tarea.', 'Invocar /smartfin-development audit <tarea> o /smartfin-development implement <tarea>.')
if (hasBudget) log(`Presupuesto: ${budget.total} tokens, quedan ${budget.remaining()}`)
return input.mode === 'implement' ? await implement() : await audit()
