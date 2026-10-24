const {execFileSync}=require('node:child_process');
const path=require('node:path');
const [serial,api,name,label]=process.argv.slice(2);
if(!['emulator-5554','AXCC6R3919012932'].includes(serial)||!['24','35'].includes(api))throw Error('Synthetic UI target required');
const box=node=>node?.bounds?.match(/\d+/g)?.map(Number);
for(let i=0;i<10;i++) {
  const snapshot=JSON.parse(execFileSync(process.execPath,[path.join(__dirname,'ui.cjs'),serial,api,`${name}-${i}`],{encoding:'utf8',windowsHide:true}));
  const target=snapshot.nodes.find(n=>n.label===label)||snapshot.nodes.find(n=>n.text===label);
  const b=box(target),header=box(snapshot.nodes.find(n=>n.text==='Ajustes'));
  const nav=box(snapshot.nodes.find(n=>n.label==='Inicio'));
  if(!header||!nav)throw Error('Settings header/navigation missing');
  const min=header[3]+170,max=nav[1]-170,mid=Math.floor((min+max)/2);
  const center=b?(b[1]+b[3])/2:Infinity;
  if(b&&b[3]>b[1]&&center>min&&center<max){console.log(JSON.stringify({label,aligned:true,snapshot:snapshot.name}));process.exit(0);}
  const delta=Number.isFinite(center)?Math.max(-350,Math.min(350,mid-center)):-350;
  execFileSync('adb',['-s',serial,'shell','input','swipe','540',String(mid),'540',String(Math.floor(mid+delta)),'900'],{windowsHide:true});
}
throw Error('Cannot align requested control clear of fixed header/navigation');
