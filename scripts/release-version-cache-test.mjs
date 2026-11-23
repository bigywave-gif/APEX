import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const source=path.join(path.dirname(fileURLToPath(import.meta.url)),'apex-release-version.mjs'),root=fs.mkdtempSync(path.join(os.tmpdir(),'apex-version-cache-'));
try {
 for(const dir of ['scripts','core/runtime/schemas','runtime','skills','registry'])fs.mkdirSync(path.join(root,dir),{recursive:true});
 fs.copyFileSync(source,path.join(root,'scripts/apex-release-version.mjs'));fs.writeFileSync(path.join(root,'manifest.yaml'),'version: 4.44.1\n');fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({version:'4.44.1'}));fs.writeFileSync(path.join(root,'registry/capability-registry.json'),'{}');
 const run=arg=>{const r=spawnSync(process.execPath,[path.join(root,'scripts/apex-release-version.mjs'),arg],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout)};
 run('reset-baseline');const baseline=path.join(root,'registry/release-baseline.json'),value=JSON.parse(fs.readFileSync(baseline));value.files['scripts/__pycache__/generate-public-pdf.cpython-312.pyc']='old-cache-hash';fs.writeFileSync(baseline,JSON.stringify(value));
 let result=run('analyze');assert.equal(result.current,'4.44.1');assert.deepEqual(result.changed,[],'historic cache removal must not be a release change');
 fs.mkdirSync(path.join(root,'scripts/__pycache__'));fs.writeFileSync(path.join(root,'scripts/__pycache__/new.pyc'),'new cache');result=run('analyze');assert.deepEqual(result.changed,[],'new cache must not enter a release snapshot');
 fs.writeFileSync(path.join(root,'runtime/new-rule.md'),'real capability');result=run('analyze');assert.ok(result.changed.includes('runtime/new-rule.md'));assert.notEqual(result.level,'major');
 console.log(JSON.stringify({status:'passed',scope:'historical and current Python caches excluded from release classification'}));
}finally{fs.rmSync(root,{recursive:true,force:true})}
