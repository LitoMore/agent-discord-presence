import {ipcPath} from './ipc-path.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {managementCommand} from '../dist/setup.js';
import {handleDesktopRequest,desktopSnapshot,integrationInstructions} from '../dist/desktop.js';
import {request} from '../dist/client.js';

test('Windows management commands execute with quoted Node, config and socket paths', {skip:process.platform!=='win32'}, async t=>{
  const dir=await mkdtemp(join(tmpdir(),"adp Windows ' quoted "));
  const before=Object.fromEntries(['ADP_CONFIG','AGENT_PRESENCE_SOCKET','ADP_NODE'].map(key=>[key,process.env[key]]));
  t.after(async()=>{for(const [key,value]of Object.entries(before)){if(value===undefined)delete process.env[key];else process.env[key]=value;}await rm(dir,{recursive:true,force:true});});
  const node=join(dir,"Node's runtime.exe");await copyFile(process.execPath,node);
  process.env.ADP_NODE=node;
  process.env.ADP_CONFIG=join(dir,"settings's config.json");
  process.env.AGENT_PRESENCE_SOCKET=`\\\\.\\pipe\\adp-windows-command-${process.pid}`;
  await writeFile(process.env.ADP_CONFIG,JSON.stringify({model:'Windows command fixture'}));
  const command=managementCommand()+' config show --agent pi';
  const result=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:10000});
  assert.equal(JSON.parse(result.stdout).model,'Windows command fixture');
  assert.equal(result.stderr,'');
  for(const agent of ['pi','opencode','deepseek-harness']){
    const response=await handleDesktopRequest({action:'integration',agent,path:agent==='deepseek-harness'?undefined:join(dir,agent+'.mjs')});
    assert.equal(response.ok,true,response.error);
    assert.ok(response.integration.summaryCommand.startsWith('$env:ADP_CONFIG = '));
    if(agent==='deepseek-harness')assert.ok(response.integration.content.startsWith('$env:ADP_CONFIG = '));
  }
});

test('desktop uses the real daemon for lifecycle, pinning, and scoped settings without replacing unrelated config',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'adp-desktop-'));
  const keys=['ADP_CONFIG','AGENT_PRESENCE_SOCKET','ADP_DESKTOP_DRY_RUN'];
  const before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  process.env.ADP_CONFIG=join(dir,'config.json');
  process.env.AGENT_PRESENCE_SOCKET=ipcPath(dir, 'service.sock');
  process.env.ADP_DESKTOP_DRY_RUN='1';
  t.after(async()=>{await handleDesktopRequest({action:'stop'});for(const key of keys){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];}await rm(dir,{recursive:true,force:true});});
  let result=await handleDesktopRequest({action:'snapshot'});
  assert.equal(result.ok,true);assert.equal(result.snapshot.status,null);
  result=await handleDesktopRequest({action:'save',scope:'global',patch:{customPrompt:'Keep this',presence:{name:'{agent} · {topic}',buttons:[{label:'Project',url:'https://example.com'}]}}});
  assert.equal(result.ok,true);
  result=await handleDesktopRequest({action:'save',scope:'codex',patch:{enabled:false}});
  assert.equal(result.snapshot.agentSettings.codex.enabled,false);
  assert.equal(result.snapshot.agentSettings.pi.enabled,true);
  assert.equal(result.snapshot.configuration.customPrompt,'Keep this');
  result=await handleDesktopRequest({action:'start'});
  assert.equal(result.ok,true);assert.equal(result.snapshot.status.discord,'dry-run');
  const pid=result.snapshot.status.pid;
  assert.equal((await handleDesktopRequest({action:'start'})).snapshot.status.pid,pid);
  await request({type:'event',event:{version:1,agent:'codex',sessionId:'desktop-test',state:'working',updatedAt:Date.now()}});
  result=await handleDesktopRequest({action:'pin',key:'codex:desktop-test'});
  assert.equal(result.snapshot.status.pinned,'codex:desktop-test');
  assert.equal(result.snapshot.status.sessions[0].agent,'codex');
  assert.equal(result.snapshot.status.activity.name,'Codex · Coding with Codex');
  assert.equal((await handleDesktopRequest({action:'pin',key:'unknown'})).ok,false);
  assert.equal((await handleDesktopRequest({action:'pin',key:null})).snapshot.status.pinned,null);
  result=await handleDesktopRequest({action:'reset',scope:'codex',keys:['enabled']});
  assert.equal(result.snapshot.agentSettings.codex.enabled,true);
  assert.equal(result.snapshot.configuration.customPrompt,'Keep this');
  assert.equal(result.snapshot.configuration.presence.buttons[0].label,'Project');
  result=await handleDesktopRequest({action:'save',scope:'codex',patch:{presence:{assets:{large_image:'https://example.com/custom.png'}}}});
  assert.equal(result.snapshot.agentSettings.codex.presence.assets.large_image,'https://example.com/custom.png');
  result=await handleDesktopRequest({action:'save',scope:'codex',patch:{presence:{assets:{}}},unset:['presence.assets.large_image']});
  assert.match(result.snapshot.agentSettings.codex.presence.assets.large_image,/codex-color\.png$/);
  assert.equal((await handleDesktopRequest({action:'save',scope:'global',patch:{},unset:['agents']})).ok,false);
  for(const bad of [null,{action:'shell',command:'echo nope'},{action:'save',scope:'bad',patch:{}},{action:'save',scope:'global',patch:{agents:{}}},{action:'save',scope:'global',patch:{presence:{name:''}}},{action:'reset',scope:'global',keys:['agents']}])assert.equal((await handleDesktopRequest(bad)).ok,false);
  const valid=await readFile(process.env.ADP_CONFIG,'utf8');
  await writeFile(process.env.ADP_CONFIG,'{invalid');
  assert.match((await desktopSnapshot()).configurationError,/JSON|property|position|Expected/i);
  assert.equal((await handleDesktopRequest({action:'save',scope:'global',patch:{enabled:false}})).ok,false);
  assert.equal(await readFile(process.env.ADP_CONFIG,'utf8'),'{invalid');
  await writeFile(process.env.ADP_CONFIG,valid);
  result=await handleDesktopRequest({action:'stop'});
  assert.equal(result.ok,true);assert.equal(result.snapshot.status,null);
  assert.equal((await handleDesktopRequest({action:'stop'})).ok,true);
});

test('desktop returns installation-specific adapter instructions without changing agent files',async t=>{
  for(const agent of ['codex','claude-code','opencode','pi','deepseek-harness']){
    if(process.platform==='win32'&&['codex','claude-code'].includes(agent)){assert.throws(()=>integrationInstructions(agent),/On Windows/);continue;}
    const result=integrationInstructions(agent);
    assert.equal(result.agent,agent);assert.ok(result.content.length);
    assert.ok(result.prompt.includes(result.content));
    assert.match(result.prompt,/preserve existing settings, hooks, plugins, and extensions/);
    assert.match(result.prompt,/dist[\\/]+cli\.js/);
    assert.match(result.prompt,/USAGE\.md/);
    assert.match(result.prompt,/AGENT_PRESENCE_SOCKET/);
    assert.match(result.prompt,/Verify the service and Discord connection/);
    if(agent==='codex'||agent==='claude-code')assert.ok(JSON.parse(result.content).hooks);
    if(agent==='pi'||agent==='opencode')assert.match(result.content,/file:.*dist\/adapters/);
  }
  assert.throws(()=>integrationInstructions('unknown'));
});

test('desktop localizes setup prompts for every agent without changing integration code or paths',async t=>{
  for(const agent of ['codex','claude-code','opencode','pi','deepseek-harness']){
    if(process.platform==='win32'&&['codex','claude-code'].includes(agent))continue;
    const english=integrationInstructions(agent);
    assert.deepEqual(integrationInstructions(agent,'en'),english);
    const response=await handleDesktopRequest({action:'integration',agent,language:'zh-CN'});
    assert.equal(response.ok,true);
    const chinese=response.integration;
    assert.equal(chinese.path,english.path);
    assert.equal(chinese.content,english.content);
    assert.ok(chinese.prompt.includes(chinese.content));
    assert.ok(chinese.prompt.includes(chinese.instructions));
    if(chinese.path)assert.ok(chinese.prompt.includes(JSON.stringify(chinese.path)));
    assert.match(chinese.prompt,/请在这台电脑上为/);
    assert.match(chinese.prompt,/备份所有需要修改的文件，保留现有设置、钩子、插件和扩展，并避免重复集成/);
    assert.match(chinese.prompt,/验证服务和 Discord 连接，然后用中文总结/);
    assert.match(chinese.prompt,/start --background/);
    assert.match(chinese.prompt,/ADP_CONFIG 和 AGENT_PRESENCE_SOCKET/);
    assert.match(chinese.prompt,/Node\.js 22\+/);
    assert.match(chinese.prompt,/dist[\\/]+cli\.js/);
    assert.match(chinese.prompt,/USAGE\.md/);
    assert.notEqual(chinese.instructions,english.instructions);
    if(agent==='codex')assert.match(chinese.prompt,/Codex \/hooks/);
    if(agent==='deepseek-harness')assert.match(chinese.prompt,/将下方命令中的 web 替换为该名称/);
  }
});

test('stdio bridge reports malformed messages and continues serving subsequent requests',async()=>{
  const child=spawn(process.execPath,['dist/desktop-bridge.js'],{stdio:'pipe'});
  let output='';let errors='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>errors+=data);
  child.stdin.end('not json\n'+JSON.stringify({action:'integration',agent:'opencode'})+'\n');
  assert.equal(await new Promise(resolve=>child.on('exit',resolve)),0,errors);
  const messages=output.trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(messages.length,2);assert.equal(messages[0].ok,false);assert.equal(messages[1].integration.agent,'opencode');
});
