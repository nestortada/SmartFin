const fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const [serial,api,name,action='snapshot',target]=process.argv.slice(2);
if(!['emulator-5554','AXCC6R3919012932'].includes(serial)||!['24','35'].includes(api)||!/^[a-z0-9-]+$/.test(name)) throw Error('Explicit synthetic test target required');
const folder=path.resolve(__dirname,`../../docs/estabilizacion-fase5b3/ui/api${api}`);
fs.mkdirSync(folder,{recursive:true});
const adb=(args,buffer=false)=>execFileSync('adb',['-s',serial,...args],{encoding:buffer?undefined:'utf8',windowsHide:true,maxBuffer:8*1024*1024});
function readAdb(args,buffer=false) {
  for(let attempt=0;attempt<3;attempt++) {
    try {return adb(args,buffer);} catch(error) {if(attempt===2)throw error;}
  }
}
const foreground=readAdb(['shell','dumpsys','activity','activities']).split('\n').filter(l=>/mResumedActivity|topResumedActivity/.test(l)).join('\n');
if(!foreground.includes('com.smartfin.snapshot5b2.tests')) throw Error('Test app must be foreground before inspecting/interacting');
const remote='/sdcard/Android/data/com.smartfin.snapshot5b2.tests/files/ui.xml';
readAdb(['shell','uiautomator','dump',remote]);
const xml=readAdb(['shell','cat',remote]);
if(!xml.includes('</hierarchy>'))throw Error('Incomplete read-only UI hierarchy');
fs.writeFileSync(path.join(folder,name+'.xml'),xml);
fs.writeFileSync(path.join(folder,name+'.png'),readAdb(['exec-out','screencap','-p'],true));
const nodes=[...xml.matchAll(/<node\s+([^>]+)>?/g)].map(m=>Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(v=>[v[1],v[2]])));
if(action==='tap'||action==='double') {
  let found=nodes.filter(n=>(n.text===target||n['content-desc']===target)&&n.bounds!=='[0,0][0,0]');
  const clickable=found.filter(n=>n.clickable==='true');
  if(clickable.length) found=clickable;
  if(found.length!==1) throw Error(`Ambiguous/missing target: ${target} (${found.length})`);
  const b=found[0].bounds.match(/\d+/g).map(Number),x=Math.floor((b[0]+b[2])/2),y=Math.floor((b[1]+b[3])/2);
  if(b[2]<=b[0]||b[3]<=b[1]) throw Error('Target is clipped; inspect screenshot and bring it into view');
  adb(['shell','input','tap',String(x),String(y)]);
  if(action==='double') adb(['shell','input','tap',String(x),String(y)]);
} else if(action==='scroll'||action==='scrollSmall') {
  const bounds=nodes.map(n=>n.bounds?.match(/\d+/g)?.map(Number)).filter(Boolean);
  const width=Math.max(...bounds.map(b=>b[2])),height=Math.max(...bounds.map(b=>b[3]));
  const start=action==='scrollSmall'?0.65:0.8, end=action==='scrollSmall'?0.42:0.3;
  adb(['shell','input','swipe',String(Math.floor(width/2)),String(Math.floor(height*start)),String(Math.floor(width/2)),String(Math.floor(height*end)),'400']);
} else if(action!=='snapshot') throw Error('Unknown action');
console.log(JSON.stringify({serial,name,action,target,nodes:nodes.filter(n=>n.text||n['content-desc']).map(n=>({text:n.text,label:n['content-desc'],enabled:n.enabled,clickable:n.clickable,bounds:n.bounds}))}));
