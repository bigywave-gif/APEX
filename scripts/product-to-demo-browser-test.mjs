#!/usr/bin/env node
// Synthetic product inputs; all state transitions and role jobs are real.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { agentRuntimeStatus } from './run-ledger.mjs';
import { chatDemoContract as demoContract, demoFragment } from './interactive-demo-test-fixture.mjs';
import { verifyDemoInteractions } from './interactive-demo.mjs';
import { npmCacheRoot } from './apex-paths.mjs';
import crypto from 'node:crypto';
const core=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const router=path.join(core,'scripts/apex-router.mjs'), action=path.join(core,'scripts/apex-action.mjs');
const project=fs.mkdtempSync(path.join(os.tmpdir(),'apex-product-handoff-')), id='handoff', session='handoff-session', dir=path.join(project,'.apex/runs',id);
const run=(file,args)=>spawnSync(process.execPath,[file,...args],{encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024});
const ok=(r,label)=>{if(r.status!==0)throw Error(label+': '+(r.stderr||r.stdout));return JSON.parse(r.stdout)};
const route=args=>ok(run(router,args),args[0]);
const invoke=(kind,script,args)=>{const auth=route(['authorize',project,id,session,kind]);return ok(run(action,['run',project,id,session,auth.authorizationRef,kind,script,...args]),script+' '+args[0])};
const put=(name,value)=>{const file=path.join(dir,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));return file};
let runtimePid, formalServer;
try {
 route(['intake',project,id,'greenfield','standard','interactive',session,'确认调用 APEX']);
 const intent={schemaVersion:'3.0',sourceRequest:'建立任务管理页面',trackRecommendation:'greenfield',goals:['完成任务'],successCriteria:['用户可完成任务'],knownFacts:['新建页面'],assumptions:[],openDecisions:[],designIntent:{formality:'professional',visualIntensity:'controlled',motionIntensity:'purposeful',informationDensity:'task',brandPosture:'clear'},acceptance:['完成任务可见反馈']};
 const withApi=process.env.APEX_TEST_API_CONTRACT==='1';
 const delivery={schemaVersion:'3.0',capabilities:withApi?['frontend','api-contract']:['frontend'],qualityBar:{usability:['完成任务'],accessibilityTarget:'WCAG-2.2-AA',performanceTarget:{lcpMs:2500,inpMs:200,cls:0.1},visualBaseline:['已确认 Demo']},verificationRequirements:withApi?['e2e','contract']:['e2e']};
 const style={mode:'greenfield-standard',typography:{family:'system'},colors:{surface:'white'},spacing:{unit:'8px'},geometry:{radius:'4px'}};
 const strategy={schemaVersion:'3.0',sourceBindings:{codeReferenceHash:'none',pageSkeletonHash:'none',displayEvidenceHash:'none'},scene:'任务管理',primaryUsers:['用户'],userGoals:['管理任务'],informationArchitecture:[{priority:1,purpose:'任务',content:['任务列表']}],dataExpression:[{question:'任务数量',metric:'任务',comparison:'当前',encoding:'数字',interaction:'查看',rationale:'帮助识别'}],functionalPlan:[{task:'完成任务',component:'按钮',states:['完成'],events:['点击'],acceptance:['状态改变']}],visualDirection:{hierarchy:'清楚',density:'适中',composition:'有序',colorSemantics:'一致',typography:'可读'},designSystem:{tokens:['间距'],components:['按钮'],styleBaseline:style},responsive:{breakpoints:[320],reflowRules:['重排']},accessibility:{target:'AA',keyboard:['Tab'],semantics:['button']},motion:{purpose:['反馈'],bindings:[{task:'完成任务',event:'点击',stateTransition:{from:'待处理',to:'完成'},informationBenefit:'state-change',valueStatement:'明确提示任务已完成并减少用户疑虑'}],reducedMotion:'无动画'},antiPatterns:['空按钮','不可读','丢失状态']};
 strategy.informationArchitecture.push({priority:2,purpose:'历史',content:['已完成任务']});
 strategy.functionalPlan[0].states=['待处理','完成'];
 strategy.functionalPlan[0].task=demoContract.journeys[0].task; strategy.motion.bindings[0].task=demoContract.journeys[0].task;
 invoke('record_context','contract-recorder.mjs',['intent',dir,put('intent-input.json',intent)]);
 invoke('record_context','contract-recorder.mjs',['delivery',dir,put('delivery-input.json',delivery)]);
 if(withApi){put('request-schema.json',{type:'object'});put('response-schema.json',{type:'object',required:['ok'],properties:{ok:{const:true}}});put('not-found-schema.json',{type:'object',required:['error'],properties:{error:{const:'NOT_FOUND'}}});invoke('record_context','contract-recorder.mjs',['domain',dir,put('domain-input.json',{schemaVersion:'3.0',entities:[{name:'Task',fields:['id']}],rules:['Task has an id'],states:['active'],permissions:['read']})]);invoke('record_context','contract-recorder.mjs',['api',dir,put('api-input.json',{schemaVersion:'3.0',version:'v1',endpoints:[{method:'GET',path:'/api/status',requestSchema:'request-schema.json',responseSchema:'response-schema.json',responseSchemas:{'200':'response-schema.json','404':'not-found-schema.json'}}],errors:['NOT_FOUND'],authentication:['none']})]);}
 const quality=invoke('analyze_requirement','experience-evaluator.mjs',['evaluate',dir,put('strategy-input.json',strategy)]);
 assert.equal(quality.status,'passed');
 const budgetAuth=route(['authorize',project,id,session,'analyze_requirement']),budgetArgs=['run',project,id,session,budgetAuth.authorizationRef,'analyze_requirement','agent-runtime.mjs','run-budget',dir,'gate1','500000','50000','25000'];const budget=ok(run(action,budgetArgs),'configure run budget');assert.equal(budget.status,'configured');assert.equal(budget.recoveryReserve,25000);const replayBudget=run(action,budgetArgs);assert.notEqual(replayBudget.status,0);assert.match(replayBudget.stderr,/run budget replay requires a fresh Router authorization/);
 const selected=invoke('analyze_requirement','role-advisory.mjs',['select',dir,'gate1']);
 assert.ok(selected.selectedRoles.includes('product-manager'));
 const selection=JSON.parse(fs.readFileSync(path.join(dir,'advisories/gate1/selection.json')));
 for(const roleId of selection.selectedRoles){
  const job=agentRuntimeStatus(dir,selection.agentJobs[roleId]).jobs[0];
  const claim=invoke('analyze_requirement','agent-runtime.mjs',['claim',dir,job.jobId,'gate1']);
  const input={schemaVersion:'1.0',roleId,stage:'gate1',adapterVersion:'1.0.0',inputBindings:selection.inputBindings,
   findings:[{id:roleId+'-fact',classification:'fact',statement:'任务管理需要真实可操作的任务状态。',evidence:selection.inputBindings.map(x=>x.path)}],
   recommendations:[{id:roleId+'-decision',choice:'保持明确的任务范围。',rationale:'使用户可检查状态变化。',acceptance:['任务状态可见']}],
   execution:{inputTokens:2000,outputTokens:1000,usageSource:'estimated',model:'test-fixture',sessionId:job.payload.agentSessionId,skillBindings:job.payload.skillBindings,leaseToken:claim.leaseToken},status:'ready'};
  invoke('analyze_requirement','role-advisory.mjs',['record',dir,'gate1',put(roleId+'-input.json',input)]);
 }
 invoke('analyze_requirement','role-advisory.mjs',['summarize',dir,'gate1']);
 const titles=['需求方向与成功标准','用户、场景与核心任务','轨道判断与正式基线','产品范围、页面与功能边界','信息架构、数据、API 与权限','交付路径、技术约束与不包含项','质量门槛、验证与验收','已知事实、假设、待决项与风险'];
 const body=titles.map((title,i)=>`## ${i+1}. ${title}\n\n本节针对${title}明确任务管理页面的目标用户、功能边界、现有约束、状态变化和可验证的验收依据，确保交付内容可以供后续设计师逐项使用。`).join('\n\n')+'\n\n### 内部专业协作摘要\n'+fs.readFileSync(path.join(dir,'advisories/gate1/role-decision-summary.md'),'utf8');
 invoke('analyze_requirement','contract-recorder.mjs',['gate1-presentation',dir,put('gate1-input.md',body)]);
 const auth=route(['authorize',project,id,session,'analyze_requirement']);
 const registered=route(['register-gate1-presentation',project,id,session,auth.authorizationRef]);
 assert.equal(registered.gates.gate1,'pending');
 assert.equal(registered.nextRequiredAction,'plan_visual');
 assert.ok(registered.allowedActions.includes('plan_visual'));
 assert.equal(registered.userInteraction?.confirmation,null);
 assert.ok(fs.existsSync(path.join(dir,registered.receipt)));

 route(['revise',project,id,session,'visual-plan','visible','合成测试调整视觉方案的层级']);
 const visualSelection=invoke('plan_visual','role-advisory.mjs',['select',dir,'visual']);
 assert.ok(visualSelection.selectedRoles.includes('ui-designer'));
 const visual=JSON.parse(fs.readFileSync(path.join(dir,'advisories/visual/selection.json')));
 assert.ok(visual.inputBindings.some(item=>item.artifact==='visualRevision'),'visual role must bind the initial visual revision');
 for(const roleId of visual.selectedRoles){
  const job=agentRuntimeStatus(dir,visual.agentJobs[roleId]).jobs[0];
  const claim=invoke('plan_visual','agent-runtime.mjs',['claim',dir,job.jobId,'visual']);
  const execution={inputTokens:0,outputTokens:0,usageSource:'unknown',model:'test-fixture',sessionId:job.payload.agentSessionId,skillBindings:job.payload.skillBindings,leaseToken:claim.leaseToken};
  if(roleId==='ui-designer'){
   assert.ok(claim.requiredSkill?.content && claim.requiredSkill.sha256);
   execution.tasteSkillUsage={sha256:claim.requiredSkill.sha256,appliedRules:['Use task-specific hierarchy.'],notApplicableRules:['Avoid unrelated landing-page effects.']};
   execution.optionalSkillUsage=[];
   for(const name of (process.env.APEX_TEST_TASTE_ONLY === '1' ? [] : ['impeccable','google-design-md'])){
    const skill=claim.optionalSkills.find(item=>item.name===name); assert.ok(skill);
    const loaded=invoke('plan_visual','agent-runtime.mjs',['skill',dir,job.jobId,'visual',claim.leaseToken,name,skill.sha256]);
    assert.equal(loaded.skill.sha256,skill.sha256);
    execution.optionalSkillUsage.push({name,sha256:skill.sha256,decision:'applied',rationale:'The task requires a consistent and usable design.',appliedRules:['Apply the appropriate task and contract rules.']});
   }
  }
  const review={schemaVersion:'1.0',roleId,stage:'visual',adapterVersion:'1.0.0',inputBindings:visual.inputBindings,
   findings:[{id:roleId+'-fact',classification:'fact',statement:'The product task and its accepted scope guide the design.',evidence:visual.inputBindings.map(x=>x.path)}],
   recommendations:[{id:roleId+'-decision',choice:'Preserve clear task hierarchy.',rationale:'The page must communicate task completion.',acceptance:['The visual hierarchy follows the product task.']}],execution,status:'ready'};
  invoke('plan_visual','role-advisory.mjs',['record',dir,'visual',put('visual-'+roleId+'.json',review)]);
 }
 invoke('plan_visual','role-advisory.mjs',['summarize',dir,'visual']);
 const runDir=dir;
  const designText = '# Design contract\nPrioritize task hierarchy and clear feedback.\n';
  fs.writeFileSync(path.join(runDir, 'DESIGN.md'), designText);
  const designHash = `sha256:${(await import('node:crypto')).createHash('sha256').update(designText).digest('hex')}`;
  const kinds = ['layout', 'component', 'style', 'font', 'content'];
  const selections = kinds.map(kind => ({ id: kind, visualNodes: ['main'], kind, sourceType: 'native-web', sourceId: 'web', resourceId: kind, version: 'current', materialization: 'native-web', parameters: ['layout', 'style'].includes(kind) ? { pattern: kind, tokens: ['base'] } : kind === 'content' ? { origin: 'product', fields: ['task'], implementation: 'render task' } : {} }));
  const candidate = (kind, decision) => ({ sourceId: decision === 'selected' ? 'web' : 'alternative', resourceId: kind, version: 'current', platformFit: 'native', visualFit: 'clear', deliveryFit: 'compatible', decision });
  const responsive = { contractId: 'responsive', viewports: [{ class: 'mobile', minWidth: 320, maxWidth: 767, layoutMode: 'single' }, { class: 'tablet', minWidth: 768, maxWidth: 1023, layoutMode: 'two' }, { class: 'desktop', minWidth: 1024, maxWidth: 1920, layoutMode: 'wide' }], reflowRules: ['mobile', 'tablet', 'desktop'], overflowPolicy: { noUnintendedHorizontalOverflow: true, exceptions: [] }, typographyScale: 'readable', mediaBehavior: 'scale', acceptance: ['mobile', 'tablet', 'desktop'] };
  const benchmark = JSON.parse(fs.readFileSync(path.join(core, 'registry/industry-design-benchmarks.json'))).benchmarks[0];
  const plan = { schemaVersion: '3.0', deliveryNarrative: { mode: 'greenfield-selection', selections: [{ category: 'layout', sourceSelectionIds: ['layout'], selectionBasis: 'task hierarchy' }] }, layout: { informationArchitecture: ['task'], grid: 'single', responsive }, visualSystem: { styleDirection: 'clear', colors: ['white'], typography: 'system', effects: 'none' }, content: { hierarchy: ['task'], dataExpression: ['count'], states: ['default'] }, components: [{ visualNode: 'main' }], motion: [], dependencies: [], selectionAnalysis: { designCapabilities: process.env.APEX_TEST_TASTE_ONLY === '1' ? ['taste-skill'] : ['taste-skill', 'impeccable', 'google-design-md'], designContract: { path: 'DESIGN.md', sha256: designHash, rules: ['hierarchy', 'spacing', 'color', 'responsive'] }, aestheticAssessment: { qualityRationale: 'Clear hierarchy supports the task.', coherenceChecks: ['layout', 'color', 'type', 'space', 'state'], rejectedPatterns: ['noise', 'clutter'] }, libraryComparisons: ['layout', 'style', 'component', 'font'].map(kind => ({ category: kind, candidates: [candidate(kind, 'selected'), candidate(kind, 'rejected')], decisionRationale: 'native source supports the task' })), userNeedFit: [{ need: 'complete task', selectedSourceIds: ['layout'], rationale: 'clear layout' }], alternatives: [{ candidate: 'complex layout', decision: 'unnecessary' }], industryBenchmark: { id: benchmark.id, scores: benchmark.criteria.map(criterion => ({ criterion, score: 4, sourceSelectionIds: ['layout'], rationale: 'task aligned' })) } }, sourceSelections: selections, risks: [], status: 'ready-for-user-confirmation' };
  { const designer = JSON.parse(fs.readFileSync(path.join(runDir, 'advisories/visual/ui-designer.json'))); const rules = [{ skill: 'taste-skill', rules: designer.execution.tasteSkillUsage.appliedRules }, ...(designer.execution.optionalSkillUsage || []).filter(item => item.decision === 'applied').map(item => ({ skill: item.name, rules: item.appliedRules }))]; plan.selectionAnalysis.skillRuleDecisions = rules.flatMap(item => item.rules.map(rule => ({ skill: item.skill, rule, decision: 'Use task-oriented hierarchy in the selected layout.', rationale: 'The product task must remain clear and usable.', sourceSelectionIds: ['layout'] }))); }
  const planInput = path.join(runDir, 'visual-plan-input.json'); fs.writeFileSync(planInput, JSON.stringify(plan));
 const compiled=invoke('plan_visual','visual-execution-plan.mjs',['compile',dir,planInput]);
 assert.ok(fs.existsSync(compiled.visualExecutionPlan));
 const validation=run(path.join(core,'scripts/apex-validate.mjs'),['pre-confirmation',dir,'visual-plan']);
 if(validation.status!==0) throw Error('visual pre-confirmation: '+validation.stderr);
 const ready=route(['status',project,id,session]);
 assert.equal(ready.gates.gate1,'pending');
 assert.equal(ready.userInteraction?.confirmation?.label,'确认视觉改造方案',JSON.stringify({action:ready.nextRequiredAction,step:ready.executionDirective?.currentStep,interaction:ready.userInteraction}));
 const approval=route(['approve',project,id,session,'visual-plan','visual-confirmation','visual-execution-plan.json','visual-plan-presentation.md']);
 assert.equal(approval.gates.gate1,'passed');
 assert.equal(approval.nextRequiredAction,'generate_visual');

 const tokenHash=`sha256:${crypto.createHash('sha256').update('{}').digest('hex')}`;
 const fragment=demoFragment.replace('layout-a chart-b style-a font-a content-a','layout component style font content').replace('<div id="apex-chat-example"',`<div data-apex-node="main" data-apex-component="main" data-apex-component-kind="panel" data-apex-token-hash="${tokenHash}" id="apex-chat-example"`);
 const sourceInput={schemaVersion:'3.0',entrypoint:'index.html',interactionContract:{...demoContract,journeys:demoContract.journeys.filter(item=>item.id!=='input')},chatPreview:{fragment:'preview.html'},files:[{path:'preview.html',content:fragment}],sourceBindings:selections.map(item=>({sourceSelectionId:item.id,files:['preview.html']}))};
 const demoInput=put('demo-source-input.json',sourceInput);
 invoke('generate_visual','demo-source-compiler.mjs',['compile',dir,demoInput]);
 invoke('generate_visual','visual-sandbox-writer.mjs',['materialize',dir,path.join(dir,'demo-source-manifest.json')]);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'visual-sandbox-files.json'))).designHandoff.skillRuleDecisions, plan.selectionAnalysis.skillRuleDecisions, 'Demo must retain confirmed designer Skill decisions');
 invoke('generate_visual','visual-sandbox-runtime.mjs',['start',dir]);
 const runtime=JSON.parse(fs.readFileSync(path.join(dir,'visual-sandbox-runtime.json')));runtimePid=runtime.pid;
 const browserSpec=put('browser-spec.json',{requiredSourceSelectionIds:selections.map(x=>x.id),screens:[{id:'desktop',route:'/',width:1440,height:900},{id:'mobile',route:'/?view=reports',width:390,height:844}]});
 invoke('generate_visual','browser-capture.mjs',['capture',dir,runtime.url,browserSpec]);
 const capture=JSON.parse(fs.readFileSync(path.join(dir,'evidence/runtime-browser-capture.json')));
 verifyDemoInteractions(dir,capture,runtime.url);
 const gapStatus=route(['status',project,id,session]);
 assert.equal(gapStatus.executionDirective.currentStep.id,'repair-demo-control-coverage');
 assert.match(gapStatus.executionDirective.currentStep.details,/project-name/);
 assert.match(gapStatus.executionDirective.currentStep.details,/%3Fview%3Dreports/);
 assert.ok(!gapStatus.allowedActions.includes('register_runtime_demo'));
 const sharedControlReviews=['reset','projects-tab','settings-tab','project-name','increment'].map(id=>({key:`route:%2F%3Fview%3Dreports|id:${id}`,equivalentTo:`route:%2F|id:${id}`,rationale:'同一示例片段不读取查询参数且复用相同事件处理器'}));
 const correctedInput=put('demo-source-corrected.json',{...sourceInput,interactionContract:{...demoContract,sharedControlReviews}});
 invoke('generate_visual','demo-source-compiler.mjs',['compile',dir,correctedInput]);
 invoke('generate_visual','visual-sandbox-writer.mjs',['materialize',dir,path.join(dir,'demo-source-manifest.json')]);
 invoke('generate_visual','browser-capture.mjs',['capture',dir,runtime.url,browserSpec]);
 const correctedCoverage=verifyDemoInteractions(dir,JSON.parse(fs.readFileSync(path.join(dir,'evidence/runtime-browser-capture.json'))),runtime.url).controlCoverage;
 assert.equal(correctedCoverage.untestedControls.length,sharedControlReviews.length);
 const baselineInput=put('runtime-visual-baseline-input.json',{schemaVersion:'3.0',runtimeRoot:'visual-sandbox',referenceScreenId:'desktop',patterns:[]});
 invoke('generate_visual','runtime-visual-baseline.mjs',['compile',dir,project,baselineInput]);
 const baseline=JSON.parse(fs.readFileSync(path.join(dir,'runtime-visual-baseline.json')));
 const referenceInput=put('global-visual-input.json',{source:'gate1-visual',referenceImage:{path:path.join(dir,baseline.referenceImage.path),viewport:'desktop'},contentLock:{locale:'zh-CN',protectedText:['项目工作台']},layoutLock:{mode:'strict',protectedStructures:['main'],nodes:[{id:'root',marker:'main',kind:'main',order:1}]},analyticsLock:{charts:[]},designTokens:{},componentContracts:[{id:'root',marker:'main',kind:'panel'}]});
 invoke('generate_visual','visual-reference-compiler.mjs',['emit',dir,referenceInput]);
 const strategyHash=`sha256:${crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,'experience-strategy.json'))).digest('hex')}`;
 const demoCandidate={id:'approved-demo',image:baseline.referenceImage,informationArchitecture:'task',dataExpression:'task state',visualDirection:'confirmed task hierarchy',tradeoffs:['This is the approved single Demo.']};
 const candidateInput=put('candidate-input.json',{schemaVersion:'3.0',strategyHash,candidates:[demoCandidate],selectedCandidateId:demoCandidate.id,selectionRationale:'The user approved this single design direction before the Demo was generated.'});
 const mobile=baseline.screenCaptures.find(item=>item.id==='mobile').screenshot;
 const invalidCandidate={...demoCandidate,image:mobile};
 const invalidInput=put('candidate-invalid.json',{schemaVersion:'3.0',strategyHash,candidates:[invalidCandidate],selectedCandidateId:invalidCandidate.id,selectionRationale:'test mismatch'});
 const invalidAuth=route(['authorize',project,id,session,'generate_visual']);
 const rejected=run(action,['run',project,id,session,invalidAuth.authorizationRef,'generate_visual','experience-evaluator.mjs','candidates',dir,invalidInput]);
 assert.notEqual(rejected.status,0); assert.match(rejected.stderr,/must match the current confirmed-plan runtime Demo reference/);
 const externalImage=path.join(project,'external-candidate.png');
 fs.copyFileSync(path.join(dir,baseline.referenceImage.path),externalImage);
 fs.symlinkSync(externalImage,path.join(dir,'outside-candidate.png'));
 const escaped={...demoCandidate,id:'outside',image:{path:'outside-candidate.png',sha256:baseline.referenceImage.sha256}};
 const escapedInput=put('candidate-escape.json',{schemaVersion:'3.0',strategyHash,candidates:[demoCandidate,escaped],selectedCandidateId:demoCandidate.id,selectionRationale:'test escaped alternative'});
 const escapedAuth=route(['authorize',project,id,session,'generate_visual']);
 const escapeResult=run(action,['run',project,id,session,escapedAuth.authorizationRef,'generate_visual','experience-evaluator.mjs','candidates',dir,escapedInput]);
 assert.notEqual(escapeResult.status,0); assert.match(escapeResult.stderr,/outside the current run/);
 invoke('generate_visual','experience-evaluator.mjs',['candidates',dir,candidateInput]);
 const beforeRegister=route(['status',project,id,session]);
 assert.match(beforeRegister.executionDirective.currentStep.details,/请求明确确认/);
 const premature=run(router,['select-route',project,id,session,'direct-code','premature-direct','提前选择直接代码']);
 assert.notEqual(premature.status,0,'new model must not queue an early route before Demo registration');
 const beforeDemoState=JSON.parse(fs.readFileSync(path.join(dir,'state.json')));
 assert.ok(!beforeDemoState.pendingDeliveryRoute && !beforeDemoState.deliveryRoute,'early route preference must not set an execution route');
 const registerAuth=route(['authorize',project,id,session,'register_runtime_demo']);
 route(['register-runtime-demo',project,id,session,registerAuth.authorizationRef]);
 const presentAuth=route(['authorize',project,id,session,'present_runtime_demo']);
 const presented=route(['present-runtime-demo',project,id,session,presentAuth.authorizationRef,'demo-visible','chat-inline']);
 assert.equal(presented.nextRequiredDecision?.id,'demo-confirmation');
 for(const option of ['direct-code','stitch']){
  const unconfirmed=run(router,['select-route',project,id,session,option,`unconfirmed-${option}`,'提前选择路线']);
  assert.notEqual(unconfirmed.status,0,`${option} must not bypass Demo confirmation`);
  assert.match(unconfirmed.stderr,/explicitly confirmed/);
 }
 assert.equal(route(['status',project,id,session]).nextRequiredDecision?.id,'demo-confirmation');

 const confirmed=route(['confirm-demo',project,id,session,'demo-approved','确认交互式 Demo']);
 assert.equal(confirmed.nextRequiredDecision?.id,'delivery-route');
 if (process.env.APEX_TEST_STITCH_ROUTE === '1' || process.argv.includes('--stitch-route')) {
  const selected=route(['select-route',project,id,session,'stitch','stitch-route','用户选择 Stitch']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'state.json'))).deliveryRoute,'stitch');
  assert.equal(selected.nextRequiredAction,'sync_stitch');
  assert.equal(selected.executionDirective.currentStep.id,'create-stitch-candidate');
  const baselineFile=path.join(dir,'runtime-visual-baseline.json'), baselineBefore=crypto.createHash('sha256').update(fs.readFileSync(baselineFile)).digest('hex');
  const stitchSkills=invoke('sync_stitch','stitch-sync.mjs',['skills',dir,'list']);assert.match(stitchSkills.boundary,/confirmed Demo/);
  const stitchTaste=stitchSkills.skills.find(item=>item.name==='stitch-design-taste');
  if(stitchTaste){const loaded=invoke('sync_stitch','stitch-sync.mjs',['skills',dir,'load',stitchTaste.name,stitchTaste.sha256]);assert.equal(loaded.skill.sha256,stitchTaste.sha256);assert.ok(loaded.skill.content.length);}
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(baselineFile)).digest('hex'),baselineBefore,'optional skill loading must preserve the confirmed Demo baseline');
  const wrongImage=put('unapproved-stitch.png','not an approved Demo screenshot');
  const stitchInput=put('stitch-unapproved-input.json',{url:'https://stitch.withgoogle.com/',imagePath:wrongImage,prompt:'fixture',uploadTriggerRef:'upload',promptRef:'prompt',submitRef:'submit'});
  const stitchAuth=route(['authorize',project,id,session,'sync_stitch']);
  const deniedStitch=run(action,['run',project,id,session,stitchAuth.authorizationRef,'sync_stitch','stitch-ui-importer.mjs','import',dir,stitchInput]);
  assert.notEqual(deniedStitch.status,0);
  assert.match(deniedStitch.stderr+deniedStitch.stdout,/image must be an unchanged screenshot from the confirmed Demo baseline/);
  assert.equal(fs.existsSync(path.join(dir,'evidence/stitch-ui-import.json')),false,'an unrelated image must be rejected before browser interaction');
  const mockCache=path.join(project,'mock-cache'),mockLog=path.join(project,'mock-stitch-calls.jsonl');
  const mockCli=path.join(mockCache,'_npx/test/node_modules/@playwright/cli/playwright-cli.js');
  fs.mkdirSync(path.dirname(mockCli),{recursive:true});
  fs.writeFileSync(mockCli,"const fs=require('fs');const args=process.argv.slice(2);fs.appendFileSync(process.env.APEX_TEST_STITCH_LOG,JSON.stringify(args)+'\\n');if(args.includes('run-code')){console.log('### Result\\n'+JSON.stringify(JSON.stringify({top:'https://stitch.withgoogle.com/',frames:[]}))+'\\n### End');process.exit(0)}if(args.includes('click')&&args.includes('submit'))process.exit(1);console.log('fixture ok');");
  const skillUse=stitchTaste?{name:stitchTaste.name,sha256:stitchTaste.sha256,appliedRules:['Preserve the approved task hierarchy'],excludedRules:[{rule:'Unapproved visual changes',reason:'The confirmed Demo is authoritative'}],rationale:'Translate the confirmed design without changing it'}:null;
  const approvedInput=put('stitch-approved-input.json',{url:'https://stitch.withgoogle.com/',imagePath:path.join(dir,baseline.referenceImage.path),prompt:'fixture',...(skillUse?{skillUse}:{}),uploadTriggerRef:'upload',promptRef:'prompt',submitRef:'submit'});
  const approvedAuth=route(['authorize',project,id,session,'sync_stitch']);
  const approvedResult=spawnSync(process.execPath,[action,'run',project,id,session,approvedAuth.authorizationRef,'sync_stitch','stitch-ui-importer.mjs','import',dir,approvedInput],{encoding:'utf8',timeout:30000,env:{...process.env,npm_config_cache:mockCache,APEX_TEST_STITCH_LOG:mockLog}});
  assert.notEqual(approvedResult.status,0,'simulated uncertain submission must stop for recovery');
  const stitchEvidence=JSON.parse(fs.readFileSync(path.join(dir,'evidence/stitch-ui-import.json')));
  assert.equal(stitchEvidence.stage,'submission-uncertain');
  const calls=fs.readFileSync(mockLog,'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(calls.filter(args=>args[2]==='upload').length,1,'the confirmed Demo screenshot must reach the simulated upload');
  if(skillUse){const fill=calls.find(args=>args[2]==='fill');assert.ok(fill?.some(arg=>arg.includes('Preserve the approved task hierarchy')),'selected compatible rule must reach the simulated Stitch prompt');assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'stitch-job.json'))).skillAdaptation.sha256,skillUse.sha256);}
  console.log(JSON.stringify({status:'passed',coverage:'confirmed Demo to Stitch route; no remote submission'}));
 } else {
 const selectedRoute=route(['select-route',project,id,session,'direct-code','direct-route','用户选择直接代码']);
 assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'state.json'))).deliveryRoute,'direct-code');
 assert.equal(selectedRoute.nextRequiredAction,'compile_visual_bundle');

 const site={schemaVersion:'3.0',version:'1.0',hash:`sha256:${crypto.createHash('sha256').update(JSON.stringify(plan)).digest('hex')}`,product:{name:'Fixture task board'},shell:{},tokens:{},typography:{family:'system'},spacing:{},components:{main:'panel'},icons:{},tables:{},charts:{},motion:{},responsive:plan.layout.responsive,pageFamilies:{main:'task'},protectedFunctions:[],overrides:[]};
 invoke('compile_visual_bundle','contract-recorder.mjs',['site',dir,put('site-input.json',site)]);
 const beforeSource=route(['status',project,id,session]);
 assert.equal(beforeSource.executionDirective.currentStep.id,'freeze-visual-source-manifest');
 // Simulate an older Run that selected implementation roles before the
 // visual source existed; Router must repair rather than reuse those jobs.
 invoke('compile_visual_bundle','role-advisory.mjs',['select',dir,'implementation']);
 const oldSelection=JSON.parse(fs.readFileSync(path.join(dir,'advisories/implementation/selection.json')));
 assert.ok(!oldSelection.inputBindings.some(binding=>binding.artifact==='visualSourceManifest'));

 const reference=JSON.parse(fs.readFileSync(path.join(dir,'visual-reference.json')));
 const sources=plan.sourceSelections.map(item=>({...item,planSourceSelectionId:item.id}));
 const bindings=[{visualNode:'main',layoutSourceId:'layout',componentSourceId:'component',styleSourceId:'style',fontSourceId:'font',contentSourceId:'content',runtimeTarget:['index.html'],selector:'[data-apex-node="main"]',implementation:'Render the confirmed task prototype.'}];
 const sourceInput=put('visual-source-input.json',{schemaVersion:'3.0',visualReferenceHash:reference.referenceImage.sha256,designCapabilities:plan.selectionAnalysis.designCapabilities,sources,bindings});
 const incompleteInput=put('visual-source-incomplete.json',{schemaVersion:'3.0',visualReferenceHash:reference.referenceImage.sha256,designCapabilities:plan.selectionAnalysis.designCapabilities.length > 1 ? ['taste-skill'] : ['taste-skill','taste-skill'],sources,bindings});
 const incompleteAuth=route(['authorize',project,id,session,'compile_visual_bundle']);
 const incomplete=run(action,['run',project,id,session,incompleteAuth.authorizationRef,'compile_visual_bundle','visual-source.mjs','compile',dir,incompleteInput]);
 assert.notEqual(incomplete.status,0);assert.match(incomplete.stderr,/exactly preserve/);
 invoke('compile_visual_bundle','visual-source.mjs',['compile',dir,sourceInput]);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'visual-source-manifest.json'))).skillRuleDecisions, plan.selectionAnalysis.skillRuleDecisions, 'designer Skill decisions must survive visual-source handoff');
 const beforeDependencies=route(['status',project,id,session]);
 assert.equal(beforeDependencies.executionDirective.currentStep.id,'resolve-visual-dependencies');
 invoke('compile_visual_bundle','asset-resolver.mjs',['resolve',dir,put('asset-selection-input.json',{schemaVersion:'3.0',items:[]})]);
 const beforeDraft=route(['status',project,id,session]);
 assert.equal(beforeDraft.executionDirective.currentStep.id,'compile-visual-bundle-and-implementation-map');
 const component={visualNode:'main',stitchNode:'main',screenId:'desktop',runtimeTarget:['index.html'],designTokens:['base'],data:[],apiContracts:[],events:['add'],permissions:[],responsive:{contractId:responsive.contractId},testSelectors:['[data-testid=increment]'],acceptance:['The approved task interaction works.']};
 const spec={schemaVersion:'3.0',layout:{grid:'single'},components:[component,{...component,screenId:'mobile'}],content:{hierarchy:['task']},data:{},icons:[],tables:[],charts:[],diagrams:[],motion:[],interaction:[],responsive,acceptance:['The approved Demo is reproduced.']};
 invoke('compile_visual_bundle','bundle-compiler.mjs',['compile',dir,put('visual-spec-input.json',spec)]);

 const oldJobId=Object.values(oldSelection.agentJobs)[0];
 const oldClaim=invoke('compile_visual_bundle','agent-runtime.mjs',['claim',dir,oldJobId,'implementation']);
 const waitingRoles=route(['status',project,id,session]);
 assert.equal(waitingRoles.executionDirective.currentStep.id,'implementation-role-wait');
 assert.match(waitingRoles.executionDirective.currentStep.details,/agent-runtime\.mjs status/);
 assert.equal(waitingRoles.executionDirective.currentStep.execution.executor.script,'agent-runtime.mjs');
 assert.deepEqual(waitingRoles.executionDirective.currentStep.execution.requiredOutputs,[]);
 const statusAuth=route(['authorize',project,id,session,'compile_visual_bundle']);
 const statusArgs=['run',project,id,session,statusAuth.authorizationRef,'compile_visual_bundle','agent-runtime.mjs','status',dir];
 assert.equal(ok(run(action,statusArgs),'live status').jobs.find(job=>job.jobId===oldJobId).status,'running');
 const replay=run(action,statusArgs);
 assert.notEqual(replay.status,0); assert.match(replay.stderr,/fresh Router authorization/);
 invoke('compile_visual_bundle','agent-runtime.mjs',['fail',dir,oldJobId,'implementation','fixture task finished after inputs changed',oldClaim.leaseToken]);
 assert.equal(invoke('compile_visual_bundle','agent-runtime.mjs',['status',dir]).jobs.find(job=>job.jobId===oldJobId).status,'queued');
 const staleRoles=route(['status',project,id,session]);
 assert.equal(staleRoles.executionDirective.currentStep.id,'implementation-role-repair');
 const repaired=invoke('compile_visual_bundle','role-advisory.mjs',['repair',dir,'implementation']);
 assert.deepEqual(new Set(repaired.supersededJobs),new Set(Object.values(oldSelection.agentJobs)));
 for(const jobId of Object.values(oldSelection.agentJobs)) assert.equal(agentRuntimeStatus(dir,jobId).jobs[0].status,'cancelled');
 const beforeRoles=route(['status',project,id,session]);
 assert.equal(beforeRoles.executionDirective.currentStep.id,'implementation-role-select');
 invoke('compile_visual_bundle','role-advisory.mjs',['select',dir,'implementation']);
 let implementation=JSON.parse(fs.readFileSync(path.join(dir,'advisories/implementation/selection.json')));
 const legacyRole=implementation.selectedRoles[0];
 const ledger=new DatabaseSync(path.join(dir,'run-ledger.sqlite'));
 ledger.prepare('UPDATE agents SET stage = ? WHERE agent_id = ?').run('visual',legacyRole); ledger.close();
 assert.equal(route(['status',project,id,session]).executionDirective.currentStep.id,'implementation-role-repair');
 const legacyJob=implementation.agentJobs[legacyRole];
 invoke('compile_visual_bundle','role-advisory.mjs',['repair',dir,'implementation']);
 assert.equal(agentRuntimeStatus(dir,legacyJob).jobs[0].status,'cancelled');
 invoke('compile_visual_bundle','role-advisory.mjs',['select',dir,'implementation']);
 implementation=JSON.parse(fs.readFileSync(path.join(dir,'advisories/implementation/selection.json')));
 assert.ok(implementation.inputBindings.some(binding=>binding.artifact==='visualSourceManifest'&&binding.path==='visual-source-manifest.json'));
 assert.ok(implementation.inputBindings.some(binding=>binding.artifact==='dependencyLock'&&binding.path==='dependency-lock.json'));
 assert.ok(implementation.inputBindings.some(binding=>binding.artifact==='implementationMap'&&binding.path==='implementation-map.json'));
 assert.ok(implementation.inputBindings.some(binding=>binding.artifact==='visualBundle'&&binding.path==='visual-bundle.json'));
 for(const roleId of implementation.selectedRoles){
  const job=agentRuntimeStatus(dir,implementation.agentJobs[roleId]).jobs[0];
  const claim=invoke('compile_visual_bundle','agent-runtime.mjs',['claim',dir,job.jobId,'implementation']);
  const execution={inputTokens:0,outputTokens:0,usageSource:'unknown',model:'test-fixture',sessionId:job.payload.agentSessionId,skillBindings:job.payload.skillBindings,leaseToken:claim.leaseToken};
  const ponytail=roleId==='frontend-implementation-planner' && claim.optionalSkills?.find(item=>item.name==='ponytail');
  if(ponytail){invoke('compile_visual_bundle','agent-runtime.mjs',['skill',dir,job.jobId,'implementation',claim.leaseToken,ponytail.name,ponytail.sha256]);execution.optionalSkillUsage=[{name:ponytail.name,sha256:ponytail.sha256,decision:'applied',rationale:'The implementation should make the smallest complete change.',appliedRules:['Preserve required behavior and verification.']}];}
  const react=roleId==='frontend-implementation-planner' && claim.optionalSkills?.find(item=>item.name==='react');
  if(react){const loaded=invoke('compile_visual_bundle','agent-runtime.mjs',['skill',dir,job.jobId,'implementation',claim.leaseToken,react.name,react.sha256]);assert.equal(loaded.skill.sha256,react.sha256);execution.optionalSkillUsage ||= [];execution.optionalSkillUsage.push({name:react.name,sha256:react.sha256,decision:'not-applicable',rationale:'The test fixture uses native HTML rather than React.',appliedRules:[]});}

  const advisory={schemaVersion:'1.0',roleId,stage:'implementation',adapterVersion:'1.0.0',inputBindings:implementation.inputBindings,findings:[{id:roleId+'-fact',classification:'fact',statement:'The confirmed task and frozen source define the implementation boundary.',evidence:implementation.inputBindings.map(item=>item.path)}],recommendations:[{id:roleId+'-decision',choice:'Preserve the approved task and source.',rationale:'The code must match the verified Demo.',acceptance:['The task and source are retained.']}],execution,status:'ready'};
  invoke('compile_visual_bundle','role-advisory.mjs',['record',dir,'implementation',put('implementation-'+roleId+'.json',advisory)]);
 }
 invoke('compile_visual_bundle','role-advisory.mjs',['summarize',dir,'implementation']);
 const beforeBundle=route(['status',project,id,session]);
 assert.equal(beforeBundle.executionDirective.currentStep.id,'compile-implementation-confirmation-presentation');
 invoke('compile_visual_bundle','confirmation-presentation.mjs',['compile',dir,'implementation']);
 const gate2Ready=route(['status',project,id,session]);
 assert.equal(gate2Ready.nextRequiredAction,'open_gate2',JSON.stringify({action:gate2Ready.nextRequiredAction,step:gate2Ready.executionDirective?.currentStep}));
 const gate2Auth=route(['authorize',project,id,session,'open_gate2']);
 const opened=route(['transition',project,id,session,gate2Auth.authorizationRef,'open-gate2']);
 assert.equal(opened.gates.gate2,'passed');
 assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'state.json'))).locks.implementationAllowed,true);
 const lease=route(['lease',project,id,session,'15']);
 const implementationAuth=route(['authorize',project,id,session,'implement',lease.lease.leaseId]);
 const sourceManifest=JSON.parse(fs.readFileSync(path.join(dir,'visual-source-manifest.json')));
 const marker=sourceManifest.bindings.find(item=>item.visualNode==='main').sourceMarker;
 const sandboxHtml=fs.readFileSync(path.join(dir,'visual-sandbox/index.html'),'utf8');
 const formalHtml=sandboxHtml.replace('data-apex-node="main"',`data-apex-node="main" data-apex-source="${marker}"`).replace('id="increment"','id="increment" data-testid="increment"');
 assert.notEqual(formalHtml,sandboxHtml);
 fs.writeFileSync(path.join(project,'index.html'),formalHtml);
 put('page-delta.json',{schemaVersion:'3.0',page:'main',family:'task',mode:'incremental',inherits:{siteContractVersion:site.version,siteContractHash:site.hash},preserve:[],reorder:[],add:['task board'],remove:[],functionalChanges:[],overrides:[],affectedConsumers:[]});
 const interruptionReceipt=`registrations/implementation-${implementationAuth.authorizationToken.tokenId}.json`;
 const oldTimestamp='2026-01-02T03:04:05.000Z';
 const frozenReceipt={schemaVersion:'3.0',type:'implementation-registration',projectId:implementationAuth.authorizationToken.projectId,runId:id,sessionId:session,authorizationRef:implementationAuth.authorizationRef,leaseId:lease.lease.leaseId,pageDelta:{path:'page-delta.json',sha256:`sha256:${crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,'page-delta.json'))).digest('hex')}`},implementationMap:{path:'implementation-map.json',sha256:`sha256:${crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,'implementation-map.json'))).digest('hex')}`},files:[{path:'index.html',sha256:`sha256:${crypto.createHash('sha256').update(formalHtml).digest('hex')}`}],registeredAt:oldTimestamp};
 put(interruptionReceipt,frozenReceipt);
 const denied=run(router,['register-implementation',project,id,session,implementationAuth.authorizationRef,'wrong-lease','page-delta.json']);
 assert.notEqual(denied.status,0); assert.match(denied.stderr,/current project mutation lease/);
 const registeredImplementation=route(['register-implementation',project,id,session,implementationAuth.authorizationRef,lease.lease.leaseId,'page-delta.json']);
 const receipt=JSON.parse(fs.readFileSync(path.join(dir,registeredImplementation.receipt)));
 assert.equal(receipt.files[0].path,'index.html');
 assert.equal(receipt.registeredAt,oldTimestamp,'registration must recover the exact durable receipt after interruption');
 assert.equal(receipt.files[0].sha256,`sha256:${crypto.createHash('sha256').update(formalHtml).digest('hex')}`);
 assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'state.json'))).artifacts.pageDelta,'page-delta.json');
 assert.equal(registeredImplementation.nextRequiredAction,'verify');
 fs.appendFileSync(path.join(project,'index.html'),'\n<!-- changed after registration -->');
 const drift=route(['status',project,id,session]);
 assert.equal(drift.nextRequiredAction,'implement'); assert.ok(!drift.allowedActions.includes('verify'));
 const renewal=route(['authorize',project,id,session,'implement',lease.lease.leaseId]);
 const reregistered=route(['register-implementation',project,id,session,renewal.authorizationRef,lease.lease.leaseId,'page-delta.json']);
 assert.notEqual(reregistered.receipt,registeredImplementation.receipt);
 assert.equal(reregistered.nextRequiredAction,'verify');

 const serverCode=`const http=require('node:http'),fs=require('node:fs'),path=require('node:path');const root=process.argv[1];http.createServer((req,res)=>{if(req.url==='/api/status?view=alternate'){res.writeHead(404,{'content-type':'application/json'});res.end(JSON.stringify({error:'NOT_FOUND'}));return}if(req.url==='/api/status'){res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true}));return}res.setHeader('content-type','text/html; charset=utf-8');res.end(fs.readFileSync(path.join(root,'index.html')))}).listen(0,'127.0.0.1',function(){console.log('http://127.0.0.1:'+this.address().port+'/')});`;
 formalServer=spawn(process.execPath,['-e',serverCode,project],{stdio:['ignore','pipe','pipe']});
 const formalUrl=await new Promise((resolve,reject)=>{let text='';formalServer.stdout.on('data',chunk=>{text+=chunk;if(text.includes('\n'))resolve(text.trim())});formalServer.on('error',reject);formalServer.on('exit',code=>reject(new Error('formal server exited: '+code)));});
 const formalSpec=put('formal-browser-spec.json',{requiredSourceSelectionIds:selections.map(item=>item.id),formalJourneys:demoContract.journeys.filter(item=>item.kind!=='reset'),screens:[{id:'desktop',route:'/',width:1440,height:900},{id:'mobile',route:'/?view=reports',width:390,height:844}]});
 invoke('verify','browser-capture.mjs',['capture',dir,formalUrl,formalSpec]);
 const formalCapture=JSON.parse(fs.readFileSync(path.join(dir,'evidence/runtime-browser-capture.json')));
 assert.equal(formalCapture.status,'passed'); assert.equal(formalCapture.formalInteractions.status,'passed');
 assert.ok(formalCapture.evidence.every(item=>item.sourceBindings.every(binding=>binding.rendered)));
 const audited=invoke('verify','implementation-audit.mjs',['audit',dir,project]);
 assert.equal(audited.status,'passed');
 // Changing formal code after capture must retire the old capture and require
 // a fresh browser observation rather than silently reusing prior evidence.
 fs.appendFileSync(path.join(project,'index.html'),'\n<!-- second change -->');
 assert.equal(route(['status',project,id,session]).nextRequiredAction,'implement');
 const authAfterCapture=route(['authorize',project,id,session,'implement',lease.lease.leaseId]);
 const refreshed=route(['register-implementation',project,id,session,authAfterCapture.authorizationRef,lease.lease.leaseId,'page-delta.json']);
 assert.equal(refreshed.nextRequiredAction,'verify');
 assert.ok(!fs.existsSync(path.join(dir,'evidence/runtime-browser-capture.json')),'old formal capture must be archived');
 assert.equal(refreshed.executionDirective.currentStep.id,'capture-formal-runtime-source-provenance');
 invoke('verify','browser-capture.mjs',['capture',dir,formalUrl,formalSpec]);
 assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'evidence/runtime-browser-capture.json'))).status,'passed');
 const ranges=responsive.viewports.flatMap(viewport=>[viewport.minWidth,Math.floor((viewport.minWidth+viewport.maxWidth)/2),viewport.maxWidth].map(width=>({id:`${viewport.class}-${width}`,route:'/',width,height:900})));
 const rangeSpec=put('formal-range-spec.json',{requiredSourceSelectionIds:selections.map(item=>item.id),formalJourneys:demoContract.journeys.filter(item=>item.kind!=='reset'),screens:[{id:'desktop',route:'/',width:1440,height:900},{id:'mobile',route:'/?view=reports',width:390,height:844},...ranges]});
 invoke('verify','browser-capture.mjs',['capture',dir,formalUrl,rangeSpec]);
 const rangeCapture=JSON.parse(fs.readFileSync(path.join(dir,'evidence/runtime-browser-capture.json')));
 assert.equal(rangeCapture.status,'passed');
 assert.ok(ranges.every(expected=>rangeCapture.evidence.some(item=>item.id===expected.id && item.viewport===`${expected.width}x${expected.height}` && item.status==='captured')));






 // A malformed matrix must not be committed as a successful verification.
 const visualRef=JSON.parse(fs.readFileSync(path.join(dir,'visual-reference.json')));
 const screenshots=new Map(rangeCapture.evidence.map(item=>[item.id,item.screenshot]));
 const samples=responsive.viewports.flatMap(v=>[v.minWidth,Math.floor((v.minWidth+v.maxWidth)/2),v.maxWidth].map(width=>({class:v.class,width,screenshot:screenshots.get(`${v.class}-${width}`),checks:{noHorizontalOverflow:true,noOverlap:true,noClipping:true,textLegible:false,proportionsStable:true},result:'passed'})));
 const invalidMatrix={schemaVersion:'3.0',baseline:{kind:'effect-image',imageHash:visualRef.referenceImage.sha256},responsiveContractId:responsive.contractId,viewports:responsive.viewports.map(v=>({name:v.class,class:v.class,width:v.minWidth,height:900,screenshot:screenshots.get(`${v.class}-${v.minWidth}`),status:'passed'})),rangeChecks:samples,states:[{name:'default',applicable:true,result:'passed',screenshot:screenshots.get('desktop')},...['loading','empty','error','permission-denied'].map(name=>({name,applicable:false,result:'not-applicable',reason:'This deliberately invalid fixture checks schema rejection.'}))],interactions:rangeCapture.formalInteractions.journeys.map(j=>({id:j.id,result:'passed',evidence:j.evidence})),checkedAt:new Date().toISOString(),status:'passed'};
 const invalidMatrixInput=put('invalid-matrix-input.json',invalidMatrix),matrixAuth=route(['authorize',project,id,session,'verify']);
 const invalidResult=run(action,['run',project,id,session,matrixAuth.authorizationRef,'verify','stability-evidence.mjs','verify',dir,invalidMatrixInput]);
 assert.notEqual(invalidResult.status,0,'invalid matrix must fail');
 assert.match(invalidResult.stderr+invalidResult.stdout,/schema validation failed/);
 assert.equal(fs.existsSync(path.join(dir,'runtime-state-matrix.json')),false,'invalid matrix must not be committed');
 // Measure the synthetic formal page in a real browser; no quality score is inferred.
 const cli=fs.readdirSync(npmCacheRoot).map(name=>path.join(npmCacheRoot,name,'node_modules/@playwright/cli/playwright-cli.js')).find(file=>fs.existsSync(file));assert.ok(cli,'installed browser CLI required');
 const browserSession=`greenfield-measure-${path.basename(project)}`,callCli=args=>spawnSync(process.execPath,[cli,'--session',browserSession,...args],{cwd:dir,encoding:'utf8',timeout:90000,maxBuffer:4*1024*1024,env:{...process.env,PWTEST_DAEMON_SESSION_DIR:path.join(dir,'cache/greenfield-measure')}});
 let observations;
 try{const opened=callCli(['open',formalUrl]);if(opened.status!==0)throw Error(opened.stderr||opened.stdout);const code=`async (page) => {const widths=${JSON.stringify(ranges.map(x=>x.width))},results=[];for(const width of widths){await page.setViewportSize({width,height:900});results.push(await page.evaluate(width=>{const nodes=[...document.querySelectorAll('h1,button')].filter(n=>{const s=getComputedStyle(n),r=n.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0&&!n.closest('[hidden]')});const rects=nodes.map(n=>n.getBoundingClientRect());return {width,checks:{noHorizontalOverflow:document.documentElement.scrollWidth<=document.documentElement.clientWidth+1,noOverlap:!rects.some((a,i)=>rects.slice(i+1).some(b=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)),noClipping:rects.every(r=>r.left>=-1&&r.right<=innerWidth+1),textLegible:nodes.every(n=>parseFloat(getComputedStyle(n).fontSize)>=12),proportionsStable:nodes.every(n=>getComputedStyle(n).transform==='none')}}},width));}return JSON.stringify(results)}`;const result=callCli(['run-code',code]);if(result.status!==0)throw Error(result.stderr||result.stdout);const match=result.stdout.match(/### Result\s*\n([\s\S]*?)\n### /);if(!match)throw Error('browser measurement result missing');observations=JSON.parse(match[1]);if(typeof observations==='string')observations=JSON.parse(observations);}finally{callCli(['close']);}
 assert.equal(observations.length,ranges.length);for(const observation of observations)assert.ok(Object.values(observation.checks).every(Boolean),JSON.stringify(observation));
 const matrix={...invalidMatrix,rangeChecks:samples.map(item=>({...item,checks:observations.find(x=>x.width===item.width).checks})),states:[{name:'default',applicable:true,result:'passed',screenshot:screenshots.get('desktop')},...['loading','empty','error','permission-denied'].map(name=>({name,applicable:false,result:'not-applicable',reason:'合成的静态测试页面没有对应业务状态。'}))]};
 invoke('verify','stability-evidence.mjs',['verify',dir,put('greenfield-matrix-input.json',matrix)]);
 const screenReferenceInput=JSON.parse(fs.readFileSync(path.join(dir,'global-visual-input.json')));
 for(const screen of ['desktop','mobile']){const input={...screenReferenceInput,source:'runtime-visual-baseline',demoCapture:{kind:'screen',id:screen}};invoke('verify','visual-reference-compiler.mjs',['emit-screen',dir,put(`screen-reference-${screen}.json`,input)]);assert.equal(invoke('verify','strict-replica.mjs',['runtime',dir,screen]).status,'passed');}
 invoke('verify','project-intake.mjs',['scan',dir,project]);const verificationPlan=invoke('verify','verification-planner.mjs',['generate',dir]);
 if(withApi){const invalidSamples=put('invalid-api-samples.json',[{caseId:'first',method:'GET',path:'/api/status',request:{},responseStatus:200,response:{ok:true}},{caseId:'second',method:'GET',path:'/api/status',request:{},responseStatus:200,response:{ok:false}}]);const invalidAuth=route(['authorize',project,id,session,'verify']);const invalidResult=run(action,['run',project,id,session,invalidAuth.authorizationRef,'verify','contract-verifier.mjs','verify',dir,invalidSamples]);assert.notEqual(invalidResult.status,0,'an invalid second case must fail contract verification');assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'evidence/contract-verification.json'))).evidence[1].status,'failed');const manual=put('manual-api-samples.json',[{method:'GET',path:'/api/status',request:{},responseStatus:200,response:{ok:true}}]);invoke('verify','contract-verifier.mjs',['verify',dir,manual]);const manualAuth=route(['authorize',project,id,session,'verify']);const manualResult=run(action,['run',project,id,session,manualAuth.authorizationRef,'verify','verification-orchestrator.mjs','run',dir,verificationPlan.verificationPlan,project]);assert.notEqual(manualResult.status,0,'manual samples must not pass actual API verification');assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'verification-bundle.json'))).contract[0]?.status,'unverified');const cases=put('api-observation-cases.json',{cases:[{caseId:'default',method:'GET',path:'/api/status',route:'/api/status',request:{},expectedStatus:200},{caseId:'alternate',method:'GET',path:'/api/status',route:'/api/status?view=alternate',request:{},expectedStatus:404}]});const observed=invoke('verify','api-contract-capture.mjs',['capture',dir,cases]);invoke('verify','contract-verifier.mjs',['verify',dir,observed.samples]);}
 const verification=invoke('verify','verification-orchestrator.mjs',['run',dir,verificationPlan.verificationPlan,project]);assert.equal(verification.verificationStatus,'passed');assert.equal(verification.gate3,'pending');
 const verificationBundle=JSON.parse(fs.readFileSync(path.join(dir,'verification-bundle.json')));assert.equal(verificationBundle.verificationStatus,'passed');assert.equal(verificationBundle.gate3,'pending');if(withApi){assert.equal(verificationBundle.contract[0]?.status,'passed');assert.equal(verificationBundle.contract[0].evidence.evidence.length,2);}
 invoke('verify','implementation-audit.mjs',['audit',dir,project]);const capturePath='evidence/runtime-browser-capture.json',digest=name=>`sha256:${crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,name))).digest('hex')}`;
 const captureReceipt=fs.readdirSync(path.join(dir,'operations')).find(name=>{try{const r=JSON.parse(fs.readFileSync(path.join(dir,'operations',name)));return r.status==='succeeded'&&r.script==='browser-capture.mjs'&&r.outputFileHashes?.[capturePath]===digest(capturePath)}catch{return false}});assert.ok(captureReceipt);
 invoke('record_context','evidence-provenance.mjs',['seal',dir,put('greenfield-provenance-input.json',{entries:[{id:'formal-browser',kind:'browser',path:capturePath,operationReceipt:`operations/${captureReceipt}`,result:'passed'}]})]);
 const review={schemaVersion:'1.0',status:'ready',assessmentMode:'evidence-bound-review',visualPlanHash:digest('visual-execution-plan.json'),reviewer:{role:'design-reviewer',method:'criterion-by-criterion runtime evidence review'},observations:plan.selectionAnalysis.industryBenchmark.scores.map(x=>({criterion:x.criterion,score:4,result:'passed',sourceSelectionIds:x.sourceSelectionIds,evidenceIds:['formal-browser'],finding:'合成夹具模拟复核通过，仅用于工作流测试，不代表真实审美评价。'}))};invoke('verify','industry-benchmark.mjs',['verify',dir,put('greenfield-industry-input.json',review)]);
 route(['revise',project,id,session,'visual','non-baseline','合成测试补充：完成任务后保留明确反馈']);
 invoke('verify','role-advisory.mjs',['select',dir,'verify']);const verifyRoles=JSON.parse(fs.readFileSync(path.join(dir,'advisories/verify/selection.json'))),productReview=rangeCapture.formalInteractions.journeys.map(x=>({task:x.task,interactionId:x.id,evidence:x.evidence,expectedOutcome:`合成任务 ${x.task} 的状态变化`,observedOutcome:x.steps.map(step=>`${step.before} → ${step.after}`).join('；'),rationale:'合成夹具用于验证任务映射，不代表真实用户验收。',verdict:'passed'}));assert.ok(verifyRoles.inputBindings.some(item=>item.artifact==='requirementRevisions'&&item.path==='prompt-revisions.ndjson'));
 const revisionPath=path.join(dir,'prompt-revisions.ndjson'),originalRevisions=fs.readFileSync(revisionPath);fs.appendFileSync(revisionPath,`${JSON.stringify({checkpoint:'visual',impact:'non-baseline',reason:'合成测试的新调整'})}\n`);const staleRevision=route(['status',project,id,session]);assert.equal(staleRevision.executionDirective?.currentStep?.id,'verify-role-repair','changed revision input must repair the role selection');fs.writeFileSync(revisionPath,originalRevisions);

 const requirementReview=['successCriteria','acceptance'].flatMap(source=>intent[source].map((criterion,index)=>({source,index,criterion,verdict:'passed',productTasks:[],implementationTargets:[],evidenceIds:['formal-browser'],rationale:'合成测试仅模拟产品角色对证据的判断。',implementationRationale:'合成测试用浏览器证据验证工作流映射。'})));const revisions=fs.readFileSync(path.join(dir,'prompt-revisions.ndjson'),'utf8').trim().split('\n').map(line=>JSON.parse(line));const requestCoverage={verdict:'covered',rationale:'合成夹具模拟核对需求记录与产品方案的完整性。',unmappedRequirements:[],revisionReviews:revisions.map((item,index)=>({index,reason:item.reason,verdict:'addressed',rationale:'合成测试模拟对补充要求及页面证据的核对。',criterionRefs:['acceptance:0'],evidenceIds:['formal-browser']}))};
 for(const roleId of verifyRoles.selectedRoles){const job=agentRuntimeStatus(dir,verifyRoles.agentJobs[roleId]).jobs[0],claim=invoke('verify','agent-runtime.mjs',['claim',dir,job.jobId,'verify']);const advisory={schemaVersion:'1.0',roleId,stage:'verify',adapterVersion:'1.0.0',inputBindings:verifyRoles.inputBindings,findings:[{id:`${roleId}-test`,classification:'fact',statement:'合成夹具产生浏览器交互证据。',evidence:verifyRoles.inputBindings.map(x=>x.path)}],recommendations:[{id:`${roleId}-result`,choice:'继续合成交付链路测试。',rationale:'结果只用于测试。',acceptance:['合成任务有交互证据。']}],execution:{inputTokens:0,outputTokens:0,usageSource:'unknown',model:'test-fixture',sessionId:job.payload.agentSessionId,skillBindings:job.payload.skillBindings,leaseToken:claim.leaseToken},status:'ready',...(roleId==='product-manager'?{productReview,requirementReview,requestCoverage}:{})};if(roleId==='product-manager'){const failed=structuredClone(advisory);failed.requirementReview[0].verdict='unverified';const auth=route(['authorize',project,id,session,'verify']);const rejected=run(action,['run',project,id,session,auth.authorizationRef,'verify','role-advisory.mjs','record',dir,'verify',put('greenfield-unverified-requirement.json',failed)]);assert.notEqual(rejected.status,0);assert.match(rejected.stderr+rejected.stdout,/is unverified/);assert.equal(agentRuntimeStatus(dir,job.jobId).jobs[0].status,'running');}invoke('verify','role-advisory.mjs',['record',dir,'verify',put(`greenfield-role-${roleId}.json`,advisory)]);}
 invoke('verify','role-advisory.mjs',['summarize',dir,'verify']);const proofAuth=route(['authorize',project,id,session,'pass_proof']);route(['transition',project,id,session,proofAuth.authorizationRef,'pass-proof','evidence/implementation-audit.json']);const gate3Auth=route(['authorize',project,id,session,'open_gate3']);const complete=route(['transition',project,id,session,gate3Auth.authorizationRef,'open-gate3']);assert.equal(complete.gates.gate3,'passed');
 console.log(JSON.stringify({status:'passed',coverage:withApi?'synthetic product and roles, real local API observation and browser interactions, manual sample rejection, simulated-role Gate 3':'synthetic product and roles, actual taste load, visual and Demo confirmations, real browser interactions, direct-code implementation, responsive measurements, parity, provenance and simulated-role Gate 3',roles:selection.selectedRoles}));
 }
} finally { if(formalServer) formalServer.kill('SIGTERM'); if(runtimePid) { try { process.kill(runtimePid, 'SIGTERM'); } catch {} } if(process.env.APEX_KEEP_HANDOFF_FIXTURE==='1') console.error('fixture='+project); else fs.rmSync(project,{recursive:true,force:true}); }
