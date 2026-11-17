import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {handleDesktopRequest} from '../dist/desktop.js';
import {listAgents, listPlugins, installPlugin, changePlugin, getPlugin, pluginStatePath, pluginSetup} from '../dist/agent-plugins.js';
import {startDaemon} from '../dist/daemon.js';
import {request} from '../dist/client.js';
import {loadSettings, resolveSettings} from '../dist/settings.js';
import {generateSummary} from '../dist/generation.js';
import {planSetup, applySetup} from '../dist/setup.js';
import {planUninstall, uninstallIntegration} from '../dist/uninstall.js';
import {parseEvent} from '../dist/protocol.js';
import {pluginSummary} from '../dist/plugin-worker.js';
import {setTimeout as delay} from 'node:timers/promises';

async function fixture(t) {
  const dir=await mkdtemp(join(tmpdir(),'adp-plugins-'));
  const old={ADP_CONFIG:process.env.ADP_CONFIG,AGENT_PRESENCE_SOCKET:process.env.AGENT_PRESENCE_SOCKET};
  process.env.ADP_CONFIG=join(dir,'config.json');
  process.env.AGENT_PRESENCE_SOCKET=process.platform==='win32'?`\\\\.\\pipe\\adp-plugin-${dir.split(/[\\/]/).pop()}`:join(dir,'service.sock');
  t.after(async()=>{for(const [key,value] of Object.entries(old)){if(value===undefined)delete process.env[key];else process.env[key]=value;}await rm(dir,{recursive:true,force:true});});
  return dir;
}

test('fresh installs keep upstream Pi built in and require explicit installation for external Agents',async t=>{
  await fixture(t);
  assert.deepEqual(listPlugins(),[]);
  assert.deepEqual(listAgents().map(a=>a.id),['codex','claude-code','opencode','pi','deepseek-harness']);
  assert.throws(()=>parseEvent({version:1,agent:'uninstalled-agent',sessionId:'one',state:'idle',updatedAt:Date.now()}),/Unsupported/);
  assert.equal(parseEvent({version:1,agent:'pi',sessionId:'one',state:'idle',updatedAt:Date.now()}).agent,'pi');
  assert.equal(listAgents().find(a=>a.id==='pi').plugin,false);
  assert.equal((await handleDesktopRequest({action:'plugin-install-bundled',agent:'pi'})).ok,false);
  const pkg=JSON.parse(await readFile('package.json','utf8'));
  assert.deepEqual(pkg.pi.extensions,['./dist/adapters/pi.js']);
  const desktop=JSON.parse(await readFile('apps/desktop/mygo.json','utf8'));
  assert.equal(pkg.files.some(p=>p.includes('external-plugins')),false);
  assert.equal(desktop.resources.some(p=>p.includes('external-plugins')),false);
});

test('old Pi plugin records do not replace the built-in Agent or hide external plugins',async t=>{
  const dir=await fixture(t),source=join(dir,'orbit');await mkdir(source);
  await writeFile(join(source,'adp-plugin.json'),JSON.stringify({apiVersion:1,id:'orbit',name:'Orbit Agent',version:'1.0.0'}));
  await installPlugin(source);
  const catalog=JSON.parse(await readFile(pluginStatePath(),'utf8'));
  catalog.plugins.pi={path:'obsolete-pi-preview',enabled:false,installed:true};
  await writeFile(pluginStatePath(),JSON.stringify(catalog));
  assert.equal(listAgents().filter(a=>a.id==='pi').length,1);
  assert.equal(listAgents().find(a=>a.id==='pi').plugin,false);
  assert.deepEqual(listPlugins().map(a=>a.id),['orbit']);
  assert.equal(getPlugin('orbit').enabled,true);
  assert.equal(getPlugin('pi'),undefined);
  assert.equal((await handleDesktopRequest({action:'integration',agent:'pi'})).ok,true);
});

test('custom Agent IDs run end to end and stop publishing when disabled or removed',async t=>{
  const dir=await fixture(t);const source=join(dir,'orbit');await mkdir(source);
  await writeFile(join(source,'adp-plugin.json'),JSON.stringify({apiVersion:1,id:'orbit',name:'Orbit Agent',version:'1.0.0',summaryWorker:'summary.mjs',setup:{kind:'manual',instructions:'Load the Orbit adapter.'}}));
  await writeFile(join(source,'summary.mjs'),`let data='';for await(const c of process.stdin)data+=c;process.stdout.write(JSON.stringify({topic:'Orbit complete',subtitle:JSON.parse(data).model}));`);
  assert.equal((await handleDesktopRequest({action:'plugin-install',path:source})).ok,true);
  assert.equal((await handleDesktopRequest({action:'integration',agent:'orbit'})).integration.instructions,'Load the Orbit adapter.');
  await handleDesktopRequest({action:'save',scope:'orbit',patch:{model:'fixture-model',customPrompt:'Keep this'}});
  assert.equal((await generateSummary(resolveSettings(loadSettings(),'orbit'),'orbit','Done',AbortSignal.timeout(4000))).topic,'Orbit complete');
  const daemon=await startDaemon({dryRun:true,log(){}});t.after(()=>daemon.close());
  const event={version:1,agent:'orbit',sessionId:'one',state:'working',updatedAt:Date.now()};
  await request({type:'event',event});await request({type:'pin',key:'orbit:one'});
  assert.equal((await request({type:'status'})).sessions[0].label,'Orbit Agent');
  await changePlugin('orbit','disable');
  let status=await request({type:'status'});assert.deepEqual(status.sessions,[]);assert.equal(status.pinned,null);
  await assert.rejects(request({type:'event',event}),/Unsupported/);
  await changePlugin('orbit','enable');await request({type:'event',event:{...event,updatedAt:Date.now()}});
  await changePlugin('orbit','remove');assert.deepEqual((await request({type:'status'})).sessions,[]);
  assert.equal(loadSettings().agents.orbit.customPrompt,'Keep this');
  await installPlugin(source);assert.equal(getPlugin('orbit').enabled,true);
  await rm(source,{recursive:true});assert.equal(getPlugin('orbit').name,'Orbit Agent');
  const catalog=JSON.parse(await readFile(pluginStatePath(),'utf8'));
  await writeFile(join(catalog.plugins.orbit.path,'adp-plugin.json'),'{invalid');
  assert.ok(listPlugins()[0].error);assert.ok(listAgents().some(a=>a.id==='codex'));
});

test('a third-party package supplies its own command and translations without host-specific core code',async t=>{
  const dir=await fixture(t),source=join(dir,'custom');await mkdir(source);
  await writeFile(join(source,'adp-plugin.json'),JSON.stringify({apiVersion:1,id:'custom',name:'Custom',version:'1.0.0',
    setup:{kind:'manual',instructions:'Load Custom.',command:['custom installer','install',"literal'$value;",'{pluginRoot}']},
    integration:{kind:'policy',removalInstructions:'Remove Custom through its host.',events:[
      {id:'session/start',capability:'presence',description:'Initialize Custom.',required:true,requires:[]},
      {id:'reply/end',capability:'summary',description:'Collect Custom replies.',required:false,requires:['session/start']},
    ]},locales:{'zh-CN':{'Load Custom.':'加载 Custom。','Remove Custom through its host.':'通过宿主移除 Custom。'}}}));
  await installPlugin(source);
  const setup=pluginSetup('custom','zh-CN');
  assert.equal(setup.instructions,'加载 Custom。');
  assert.equal(pluginSetup('custom','fr').instructions,'Load Custom.');
  assert.equal(setup.content,process.platform==='win32'
    ? `& 'custom installer' install 'literal''$value;' '${getPlugin('custom').root}'`
    : `'custom installer' install 'literal'\\''$value;' '${getPlugin('custom').root}'`);
  const response=await handleDesktopRequest({action:'snapshot'});
  assert.equal(response.snapshot.agents.find(a=>a.id==='custom').locales['zh-CN']['Load Custom.'],'加载 Custom。');
  const plan=await planSetup('custom');
  assert.equal((await applySetup('custom',{},plan.revision)).changed,true);
  await writeFile(plan.path,JSON.stringify({...JSON.parse(await readFile(plan.path,'utf8')),unrelated:'keep'}));
  const removal=await planUninstall('custom',undefined,['reply/end']);
  assert.equal((await uninstallIntegration('custom',undefined,removal.revision,['reply/end'])).removed,true);
  assert.deepEqual(JSON.parse(await readFile(plan.path,'utf8')),{events:['session/start'],unrelated:'keep'});
  const fullRemoval=await planUninstall('custom');
  assert.equal(fullRemoval.noteAgent,true);
  assert.equal(fullRemoval.note,'Remove Custom through its host.');
});

test('invalid manifests and escaping files are rejected without executing code or registering an Agent',async t=>{
  const dir=await fixture(t);const source=join(dir,'bad');await mkdir(source);await writeFile(join(dir,'outside.mjs'),'throw new Error("must not execute")');
  for(const extra of [{apiVersion:2},{id:'codex'},{id:'pi'},{id:'__proto__'},{extension:'../outside.mjs'},
    {locales:[]},{locales:{'zh-CN':{'message':42}}},{locales:{'invalid_locale':{}}},
    {setup:{kind:'manual',instructions:'',command:['host','{unknown}']}},
    {setup:{kind:'manual',instructions:'',command:['host','bad\nargument']}},
    {setup:{kind:'manual',instructions:'',command:'host install'}}]){
    await writeFile(join(source,'adp-plugin.json'),JSON.stringify({apiVersion:1,id:'example',name:'Example',version:'1.0.0',...extra}));
    await assert.rejects(installPlugin(source));
  }
  assert.deepEqual(listPlugins(),[]);
});

test('cancelling a plugin summary terminates its worker and descendants',async t=>{
  const dir=await fixture(t),source=join(dir,'cancel');await mkdir(source);
  await writeFile(join(source,'adp-plugin.json'),JSON.stringify({apiVersion:1,id:'cancel-test',name:'Cancellation test',version:'1.0.0',summaryWorker:'worker.mjs'}));
  await writeFile(join(source,'worker.mjs'),`import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';let data='';for await(const c of process.stdin)data+=c;const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});writeFileSync(JSON.parse(data).pidFile,JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000);`);
  await installPlugin(source);
  const pidFile=join(dir,'pids.json'),controller=new AbortController();t.after(()=>controller.abort());
  const pending=pluginSummary('cancel-test',{pidFile},controller.signal),rejected=assert.rejects(pending);
  let pids;
  for(let i=0;i<100;i++){try{pids=JSON.parse(await readFile(pidFile,'utf8'));break;}catch{await delay(20);}}
  assert.ok(pids,'summary worker failed to start');controller.abort();await rejected;
  const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
  for(let i=0;i<100&&pids.some(alive);i++)await delay(20);
  assert.equal(pids.some(alive),false,'summary cancellation left a running child');
});
