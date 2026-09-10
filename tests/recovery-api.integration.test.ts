import{strict as assert}from'node:assert';
import{spawn,spawnSync}from'node:child_process';
import{mkdtempSync,rmSync}from'node:fs';
import{tmpdir}from'node:os';
import path from'node:path';
import{test}from'node:test';
import Database from'better-sqlite3';
import{buildSync}from'esbuild';
const root=process.cwd(),out=mkdtempSync(path.join(root,'build','recovery-api-')),serverFile=path.join(out,'server.mjs'),validate=path.join(out,'validate.mjs');
buildSync({entryPoints:[path.join(root,'server.ts')],outfile:serverFile,bundle:true,platform:'node',format:'esm',packages:'external'});
buildSync({entryPoints:[path.join(root,'scripts/db-validate-target.ts')],outfile:validate,bundle:true,platform:'node',format:'esm',packages:'external'});
process.once('exit',()=>{try{rmSync(out,{recursive:true,force:true})}catch{}});
test('backend restart preserves session and recovery API fails closed',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'recovery-api-')),file=path.join(dir,'fms.db'),port=3211,base=`http://127.0.0.1:${port}/api`;let server:ReturnType<typeof spawn>|undefined;
 const request=async(endpoint:string,options:RequestInit={},cookie?:string)=>{const response=await fetch(base+endpoint,{...options,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...(options.headers||{})}});return{response,body:await response.json().catch(()=>null)}};
 const start=async()=>{server=spawn(process.execPath,[serverFile],{env:{...process.env,FMS_DB_PATH:file,FMS_SKIP_SEEDING:'true',PORT:String(port),NODE_ENV:'production'},stdio:'pipe'});for(let i=0;i<100;i++){try{if((await fetch(base+'/status')).ok)return}catch{}await new Promise(r=>setTimeout(r,100))}throw new Error('Server did not start')};
 const stop=(signal:'SIGTERM'|'SIGINT')=>new Promise<number>(resolve=>{server!.once('exit',code=>resolve(code??0));server!.kill(signal)});
 try{
  assert.equal(spawnSync(process.execPath,[validate],{env:{...process.env,FMS_DB_PATH:file,FMS_SKIP_SEEDING:'true'}}).status,0);const db=new Database(file);db.prepare(`INSERT INTO station_settings(id,station_name,tax_pin,address,phone)VALUES('s','Station','P','A','0')`).run();db.close();
  await start();assert.equal((await request('/automation/recovery/status')).response.status,401);await request('/users',{method:'POST',body:JSON.stringify({name:'Root',email:'root@recovery.co',phone:'0700',pin:'1234'})});const login=await request('/auth/verify-pin',{method:'POST',body:JSON.stringify({identifier:'root@recovery.co',pin:'1234'})}),cookie=login.response.headers.get('set-cookie')!.split(';')[0];assert.equal(login.response.status,200);
  let health=await request('/automation/recovery/status',{},cookie);assert.equal(health.response.status,200);assert.equal(health.body.databaseStatus,'HEALTHY');assert.doesNotMatch(JSON.stringify(health.body),/password|credential|token|secret/i);assert.equal(await stop('SIGTERM'),0);await assert.rejects(()=>fetch(base+'/status'));await new Promise(resolve=>setTimeout(resolve,500));
  await start();assert.equal((await request('/auth/me',{},cookie)).response.status,200);health=await request('/automation/recovery/status',{},cookie);assert.equal(health.response.status,200);assert.equal(health.body.recoveryStatus,'COMPLETED');assert.equal(await stop('SIGINT'),0);
  const check=new Database(file,{readonly:true});assert.equal((check.prepare(`SELECT COUNT(*)c FROM auth_sessions`).get()as any).c,1);assert.equal(check.pragma('integrity_check',{simple:true}),'ok');assert.equal(check.pragma('foreign_key_check').length,0);check.close();
 }finally{if(server&&!server.killed)server.kill();try{rmSync(dir,{recursive:true,force:true})}catch{}}
});
