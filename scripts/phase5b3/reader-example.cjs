const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'../../docs/estabilizacion-fase5b3');
const folder=path.join(root,'reader-example');
const fixed=['cuentas','categorias','subcategorias','tarjetas-credito','compras-cuotas','personas','gastos-compartidos','participaciones','reembolsos','abonos-compartidos','devoluciones-anticipos'].map(n=>n+'.csv');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
if(!fs.existsSync(folder)) {
  fs.mkdirSync(folder,{recursive:true});
  // Minimal READER fixture, not a restorable/full SmartFin database.
  const template=path.join(folder,'fixture.sqlite');
  const db=new DatabaseSync(template);
  db.exec("CREATE TABLE financial_data_revision(id INTEGER PRIMARY KEY,revision INTEGER); INSERT INTO financial_data_revision VALUES(1,33); CREATE TABLE transactions(id TEXT PRIMARY KEY,civil_date TEXT,date TEXT); INSERT INTO transactions VALUES('synthetic','2026-10-18','2026-10-18');");
  db.close();
  for(let i=1;i<=3;i++) {
    const id=`${String(i).repeat(8)}-${String(i).repeat(4)}-4${String(i).repeat(3)}-8${String(i).repeat(3)}-${String(i).repeat(12)}`;
    const entries=[];
    for(const logicalName of ['smartfin-backup.db',...fixed,'movimientos-2026.csv']) {
      const name=`smartfin-${id}--${logicalName}`;
      const bytes=logicalName.endsWith('.db')?fs.readFileSync(template):Buffer.from('\uFEFFid,descripcion\nsynthetic,"Ejemplo, con ""comillas"" y ñ"\n');
      entries.push({name,logicalName,bytes:bytes.length,sha256:sha(bytes)});
      if(!(i===2 && logicalName==='cuentas.csv')) fs.writeFileSync(path.join(folder,name),bytes);
    }
    if(i===3) {
      const file=path.join(folder,entries[1].name),data=fs.readFileSync(file);data[data.length-2]^=1;fs.writeFileSync(file,data);
    }
    const manifest={formatVersion:2,generationId:id,generatedAt:`2026-10-24T02:${i}0:00.000Z`,revision:33,financialRevision:33,
      encrypted:false,database:entries[0].name,files:entries.map(e=>e.name),csvFiles:entries.slice(1).map(e=>e.name),components:entries,
      state:'complete',validation:'provider-readback-sha256',cloudSync:'unconfirmed'};
    fs.writeFileSync(path.join(folder,`smartfin-generation-${id}.json`),JSON.stringify(manifest,null,2));
  }
  fs.unlinkSync(template); // Only the newly created, known synthetic template.
}
function verify(name) {
  const m=JSON.parse(fs.readFileSync(path.join(folder,name),'utf8'));
  const check=(yes,message)=>{if(!yes)throw Error(message);};
  const id=m.generationId;
  check(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id) && name===`smartfin-generation-${id}.json`,'identity');
  check(m.formatVersion===2 && m.state==='complete' && m.validation==='provider-readback-sha256' && m.encrypted===false && m.cloudSync==='unconfirmed','v2 state');
  check(Number.isSafeInteger(m.revision)&&m.revision>=0&&m.financialRevision===m.revision,'revision');
  check(new Date(m.generatedAt).toISOString()===m.generatedAt&&Date.parse(m.generatedAt)<=Date.now(),'timestamp');
  check(Array.isArray(m.components)&&m.components.length>=12,'inventory');
  const logical=new Set(), physical=new Set();
  for(const c of m.components) {
    check(c.logicalName==='smartfin-backup.db'||fixed.includes(c.logicalName)||/^movimientos-[0-9]{4}\.csv$/.test(c.logicalName),'logical name');
    check(c.name===`smartfin-${id}--${c.logicalName}`&&!logical.has(c.logicalName)&&!physical.has(c.name),'component identity');
    logical.add(c.logicalName);physical.add(c.name);
    check(Number.isSafeInteger(c.bytes)&&c.bytes>0&&/^[0-9a-f]{64}$/.test(c.sha256),'hash metadata');
    const bytes=fs.readFileSync(path.join(folder,c.name));
    check(bytes.length===c.bytes&&sha(bytes)===c.sha256,`size/hash mismatch: ${c.logicalName}`);
  }
  const same=(a,b)=>Array.isArray(a)&&a.length===b.length&&new Set(a).size===a.length&&a.every(v=>b.includes(v));
  check(['smartfin-backup.db',...fixed].every(n=>logical.has(n)),'missing required component');
  check(m.database===`smartfin-${id}--smartfin-backup.db`&&same(m.files,[...physical])&&same(m.csvFiles,[...physical].filter(n=>n!==m.database)),'references');
  const db=new DatabaseSync(path.join(folder,m.database),{readOnly:true});
  try {
    check(db.prepare('PRAGMA integrity_check').get().integrity_check==='ok','integrity');
    check(db.prepare('PRAGMA foreign_key_check').all().length===0,'FK');
    check(db.prepare('SELECT revision FROM financial_data_revision WHERE id=1').get().revision===m.revision,'SQLite revision');
    const years=db.prepare("SELECT DISTINCT substr(COALESCE(civil_date,date),1,4) AS year FROM transactions ORDER BY year").all().map(r=>`movimientos-${r.year}.csv`);
    check(same([...logical].filter(n=>n.startsWith('movimientos-')),years),'annual inventory');
  } finally {db.close();}
  return {id,generatedAt:m.generatedAt,bogota:new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Bogota',dateStyle:'short',timeStyle:'long'}).format(new Date(m.generatedAt)),componentsVerified:m.components.length};
}
const valid=[],rejected=[];
for(const name of fs.readdirSync(folder).filter(n=>/^smartfin-generation-.*\.json$/.test(n))) {
  try{valid.push(verify(name));}catch(error){rejected.push({name,reason:String(error)});}
}
valid.sort((a,b)=>b.generatedAt.localeCompare(a.generatedAt)||b.id.localeCompare(a.id));
if(valid.length!==1||rejected.length!==2||!valid[0].id.startsWith('11111111')) throw Error('Fixture selection failed');
const report={selected:valid[0],rejected,noHashCapability:'verificationUnavailable',cloudSync:'unconfirmed',datasetCurrency:'unknown',externalAnalystUpdated:false,
  limits:'Controlled minimal reader fixture; not a full app snapshot or a production reader certification. No clock anomaly in fixed example at execution time.'};
fs.writeFileSync(path.join(root,'reader-example-results.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
