#!/usr/bin/env node
// Synthetic two-page site; real local Router actions and browser captures.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
import { assertSitewideNarrativeCoverage } from './scope-boundary.mjs';
const core=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const project=fs.mkdtempSync(path.join(os.tmpdir(),'apex-sitewide-browser-')),id='sitewide',session='sitewide-test',dir=path.join(project,'.apex/runs',id); let server;
const run=(script,args)=>spawnSync(process.execPath,[path.join(core,'scripts',script),...args],{encoding:'utf8',timeout:150000,maxBuffer:4*1024*1024});
const ok=(result,label)=>{if(result.status!==0)throw Error(`${label}: ${(result.stderr||result.stdout).slice(0,2000)}`);return JSON.parse(result.stdout)};
const route=args=>ok(run('apex-router.mjs',args),args[0]);
const put=(name,value)=>{const f=path.join(dir,name);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(value));return f};
const action=(script,args)=>{const a=route(['authorize',project,id,session,'collect_existing_baseline']);return ok(run('apex-action.mjs',['run',project,id,session,a.authorizationRef,'collect_existing_baseline',script,...args]),script)};
try {
  fs.writeFileSync(path.join(project,'index.html'),'<!doctype html><html lang="zh"><title>工作台</title><main><h1>工作台</h1><p>项目列表</p></main></html>');
  fs.writeFileSync(path.join(project,'settings.html'),'<!doctype html><html lang="zh"><title>设置</title><main><h1>设置</h1><p>通知选项</p><div style="width:2000px">超宽测试区域</div></main></html>');
  const code=`const http=require('http'),fs=require('fs'),path=require('path');http.createServer((req,res)=>{const file=req.url==='/settings'?'settings.html':'index.html';res.setHeader('content-type','text/html; charset=utf-8');res.end(fs.readFileSync(path.join(process.argv[1],file)))}).listen(0,'127.0.0.1',function(){console.log(this.address().port)});`;
  server=spawn(process.execPath,['-e',code,project],{stdio:['ignore','pipe','pipe']});
  const port=await new Promise((resolve,reject)=>{server.stdout.once('data',v=>resolve(Number(String(v).trim())));server.once('error',reject);server.once('exit',c=>reject(Error('fixture server exited: '+c)))});
  route(['intake',project,id,'existing','standard','interactive',session,'确认调用 APEX']);
  action('project-intake.mjs',['scan',dir,project]);
  const input=put('baseline-scope.json',{routes:['/','/settings'],codeEntrypoints:['index.html','settings.html']});
  action('existing-code-reference.mjs',['capture',dir,project,input]);
  const codeBaseline=JSON.parse(fs.readFileSync(path.join(dir,'code-reference.json')));
  assert.ok(['index.html','settings.html'].every(name=>codeBaseline.files.some(file=>file.path===name)));
  const spec=put('browser-spec.json',{screens:[{id:'workbench',route:'/',width:1440,height:900},{id:'settings',route:'/settings',width:1440,height:900}]});
  action('browser-capture.mjs',['capture',dir,`http://127.0.0.1:${port}/`,spec]);
  const capture=JSON.parse(fs.readFileSync(path.join(dir,'evidence/existing-browser-capture.json')));
  assert.equal(capture.evidence.length,2);
  for(const [id,title] of [['workbench','工作台'],['settings','设置']]){const item=capture.evidence.find(x=>x.id===id);assert.equal(item.status,'captured');assert.ok(item.screenshotSha256 && item.domSha256);assert.ok(fs.readFileSync(path.join(dir,item.domHtml),'utf8').includes(title));}
  // Fixture scope names are paired with the two observed DOM captures above;
  // this does not exercise the full change-scope freeze or delivery chain.
  const workbench=capture.evidence.find(item=>item.id==='workbench'),settings=capture.evidence.find(item=>item.id==='settings');
  assert.ok(workbench.layoutMetrics.documentScrollWidth <= workbench.layoutMetrics.documentClientWidth + 1,'normal page must not report document overflow');
  assert.ok(settings.layoutMetrics.documentScrollWidth > settings.layoutMetrics.documentClientWidth + 1,'real browser must observe deliberate horizontal overflow');
  const scope={mode:'sitewide',affected:{pages:['工作台','设置']}};
  const changes=[{scope:'工作台',currentIssue:'工作台信息层级不清',change:'突出项目列表',why:'帮助定位项目',resolvedOutcome:'项目入口清晰'}, {scope:'设置',currentIssue:'设置入口层级不清',change:'区分通知选项',why:'帮助找到设置',resolvedOutcome:'通知选项清晰'}];
  assertSitewideNarrativeCoverage({changes},scope);
  assert.throws(()=>assertSitewideNarrativeCoverage({changes:changes.slice(0,1)},scope),/affected pages: 设置/);
  assert.throws(()=>assertSitewideNarrativeCoverage({changes:[...changes,{...changes[0],pages:['不存在']} ]},scope),/frozen affected scope/);
  console.log(JSON.stringify({status:'passed',scope:'two real local browser captures and fixture page mapping; synthetic scope and narrative; not a complete sitewide delivery',screens:capture.evidence.length}));
} finally {if(server)server.kill('SIGTERM');fs.rmSync(project,{recursive:true,force:true})}
