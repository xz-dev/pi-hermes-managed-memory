import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

// A real stock-Pi interactive runtime in a PTY, not the downstream installed CLI.
test("stock 0.99.2 interactive widget survives a foreground answer and reload", t => {
	if (process.platform !== "linux") { t.skip("PTY evidence is Linux-specific"); return; }
	const root = mkdtempSync("/var/tmp/hermes-tui-");
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const script = join(root, "runtime.mjs"), capture = join(root, "terminal.log");
	mkdirSync(join(root, "home"), { recursive: true });
	const coding = new URL("../node_modules/@earendil-works/pi-coding-agent/dist/index.js", import.meta.url).href;
	const ai = new URL("../node_modules/@earendil-works/pi-ai/dist/index.js", import.meta.url).href;
	const extension = new URL("../src/index.ts", import.meta.url).href;
	writeFileSync(script, `import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createAgentSessionServices,createAgentSessionFromServices,createAgentSessionRuntime,InteractiveMode,ModelRuntime,SessionManager,SettingsManager} from ${JSON.stringify(coding)};
import {fauxProvider,fauxAssistantMessage} from ${JSON.stringify(ai)};
import {createMemoryExtension} from ${JSON.stringify(extension)};
const root=${JSON.stringify(root)}, cwd=join(root,'project'); mkdirSync(cwd,{recursive:true});mkdirSync(join(root,'home'),{recursive:true});
const faux=fauxProvider({provider:'hermes-tui-fixture'});faux.setResponses([fauxAssistantMessage('first foreground'),fauxAssistantMessage('',{stopReason:'error',errorMessage:'fixture failure'}),fauxAssistantMessage('ordinary foreground answer')]);
writeFileSync(join(root,'auth.json'),JSON.stringify({'hermes-tui-fixture':{type:'api_key',key:'fixture-only'}}));
const runtime=await ModelRuntime.create({authPath:join(root,'auth.json'),modelsPath:join(root,'models.json'),allowModelNetwork:false});runtime.registerNativeProvider(faux.provider);
const settings=SettingsManager.inMemory({retry:{enabled:false,provider:{maxRetries:0}},compaction:{enabled:false},cacheWarming:'off'},{projectTrusted:false});
const extensionFactories=[pi=>{createMemoryExtension({projectRoot:cwd})(pi);pi.registerCommand('fixture-reload',{handler:async(_a,ctx)=>{await ctx.reload();}});pi.registerCommand('fixture-exit',{handler:async(_a,ctx)=>ctx.shutdown()});}];
const factory=async ({cwd,agentDir,sessionManager})=>{const services=await createAgentSessionServices({cwd,agentDir,settingsManager:settings,modelRuntime:runtime,resourceLoaderOptions:{noExtensions:true,noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true,appendSystemPrompt:[],extensionFactories}});const created=await createAgentSessionFromServices({services,sessionManager,model:faux.getModel(),noTools:'all'});return {...created,services,diagnostics:services.diagnostics};};
const host=await createAgentSessionRuntime(factory,{cwd,agentDir:root,sessionManager:SessionManager.create(cwd,join(root,'sessions'))});
await new InteractiveMode(host).run();
`);
	const python = `import os,pty,select,subprocess,time,json,re,struct,fcntl,termios
root=${JSON.stringify(root)}
os.makedirs(root+'/project',exist_ok=True)
master,slave=pty.openpty()
fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',40,160,0,0))
env=os.environ.copy();env.update(HOME=root+'/home',USERPROFILE=root+'/home',PI_CODING_AGENT_DIR=root,TERM='xterm-256color',NO_COLOR='1')
p=subprocess.Popen(['node','--experimental-strip-types',root+'/runtime.mjs'],stdin=slave,stdout=slave,stderr=slave,cwd=root+'/project',env=env,close_fds=True)
os.close(slave);data=b''
def drain(seconds):
 global data
 end=time.monotonic()+seconds
 while time.monotonic()<end:
  if select.select([master],[],[],min(.1,max(0,end-time.monotonic())))[0]:
   try:data+=os.read(master,65536)
   except OSError:break
def wait_for(marker,start=0):
 end=time.monotonic()+8
 while marker not in data[start:].decode('utf-8','replace'):
  if time.monotonic()>=end:raise RuntimeError('PTY did not reach '+marker)
  drain(.1)
try:
 wait_for('manual ready')
 steps=[('Ordinary user work.','first foreground'),('/hermes-review run','Latest: failed'),('Normal question.','ordinary foreground answer'),('/fixture-reload','Reloaded'),('/hermes-review status','Latest: failed')]
 for command,marker in steps:
  start=len(data);os.write(master,(command+'\\r').encode());wait_for(marker,start);drain(.15)
 os.write(master,b'/fixture-exit\\r');drain(.2)
 p.wait(timeout=5)
finally:
 if p.poll() is None:p.kill();p.wait()
 os.close(master)
 open(root+'/terminal.log','wb').write(data)
 print(json.dumps({'exit':p.returncode,'bytes':len(data)}))
`;
	const result = spawnSync("python3", ["-I", "-c", python], { cwd: root, env: { ...process.env, HOME: join(root, "home"), USERPROFILE: join(root, "home"), PI_CODING_AGENT_DIR: root }, encoding: "utf8", timeout: 25000 });
	assert.equal(result.status, 0, result.stderr);
	const raw = readFileSync(capture, "utf8");
	const text = raw.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "");
	assert.match(text, /ordinary foreground answer/);
	assert.match(text, /Reloaded/);
	const afterReload = text.slice(text.lastIndexOf("Reloaded"));
	assert.match(afterReload, /PAUSED/);
	assert.match(afterReload, /errors 1/);
	assert.match(afterReload, /failed/);
});
