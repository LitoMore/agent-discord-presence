import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {handleDesktopRequest,desktopSnapshot,integrationInstructions} from '../dist/desktop.js';
import {request} from '../dist/client.js';

test('desktop uses the real daemon for lifecycle, pinning, and scoped settings without replacing unrelated config',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'adp-desktop-'));
  const keys=['ADP_CONFIG','AGENT_PRESENCE_SOCKET','ADP_DESKTOP_DRY_RUN'];
  const before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  process.env.ADP_CONFIG=join(dir,'config.json');
  process.env.AGENT_PRESENCE_SOCKET=join(dir,'service.sock');
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

test('desktop returns installation-specific adapter instructions without changing agent files',()=>{
  for(const agent of ['codex','claude-code','opencode','pi','deepseek-harness']){
    const result=integrationInstructions(agent);
    assert.equal(result.agent,agent);assert.ok(result.content.length);
    assert.ok(result.prompt.includes(result.content));
    assert.match(result.prompt,/preserve existing settings, hooks, plugins, and extensions/);
    assert.match(result.prompt,/dist[\/]cli\.js/);
    assert.match(result.prompt,/USAGE\.md/);
    assert.match(result.prompt,/AGENT_PRESENCE_SOCKET/);
    assert.match(result.prompt,/Verify the service and Discord connection/);
    if(agent==='codex'||agent==='claude-code')assert.ok(JSON.parse(result.content).hooks);
    if(agent==='pi'||agent==='opencode')assert.match(result.content,/file:.*dist\/adapters/);
  }
  assert.throws(()=>integrationInstructions('unknown'));
});

test('stdio bridge reports malformed messages and continues serving subsequent requests',async()=>{
  const child=spawn(process.execPath,['dist/desktop-bridge.js'],{stdio:'pipe'});
  let output='';let errors='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>errors+=data);
  child.stdin.end('not json\n'+JSON.stringify({action:'integration',agent:'codex'})+'\n');
  assert.equal(await new Promise(resolve=>child.on('exit',resolve)),0,errors);
  const messages=output.trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(messages.length,2);assert.equal(messages[0].ok,false);assert.equal(messages[1].integration.agent,'codex');
});
