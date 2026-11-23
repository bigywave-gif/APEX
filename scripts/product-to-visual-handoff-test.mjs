#!/usr/bin/env node
// Synthetic product inputs; all state transitions and role jobs are real.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
import { agentRuntimeStatus } from './run-ledger.mjs';
const core=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const router=path.join(core,'scripts/apex-router.mjs'), action=path.join(core,'scripts/apex-action.mjs');
const project=fs.mkdtempSync(path.join(os.tmpdir(),'apex-product-handoff-')), id='handoff', session='handoff-session', dir=path.join(project,'.apex/runs',id);
const run=(file,args)=>spawnSync(process.execPath,[file,...args],{encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024});
const ok=(r,label)=>{if(r.status!==0)throw Error(label+': '+(r.stderr||r.stdout));return JSON.parse(r.stdout)};
const route=args=>ok(run(router,args),args[0]);
const invoke=(kind,script,args)=>{const auth=route(['authorize',project,id,session,kind]);return ok(run(action,['run',project,id,session,auth.authorizationRef,kind,script,...args]),script+' '+args[0])};
const put=(name,value)=>{const file=path.join(dir,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));return file};
try {
 route(['intake',project,id,'greenfield','standard','interactive',session,'确认调用 APEX']);
 const intent={schemaVersion:'3.0',sourceRequest:'建立任务管理页面',trackRecommendation:'greenfield',goals:['完成任务'],successCriteria:['用户可完成任务'],knownFacts:['新建页面'],assumptions:[],openDecisions:[],designIntent:{formality:'professional',visualIntensity:'controlled',motionIntensity:'purposeful',informationDensity:'task',brandPosture:'clear'},acceptance:['完成任务可见反馈']};
 const delivery={schemaVersion:'3.0',capabilities:['frontend'],qualityBar:{usability:['完成任务'],accessibilityTarget:'WCAG-2.2-AA',performanceTarget:{lcpMs:2500,inpMs:200,cls:0.1},visualBaseline:['已确认 Demo']},verificationRequirements:['e2e']};
 const style={mode:'greenfield-standard',typography:{family:'system'},colors:{surface:'white'},spacing:{unit:'8px'},geometry:{radius:'4px'}};
 const strategy={schemaVersion:'3.0',sourceBindings:{codeReferenceHash:'none',pageSkeletonHash:'none',displayEvidenceHash:'none'},scene:'任务管理',primaryUsers:['用户'],userGoals:['管理任务'],informationArchitecture:[{priority:1,purpose:'任务',content:['任务列表']}],dataExpression:[{question:'任务数量',metric:'任务',comparison:'当前',encoding:'数字',interaction:'查看',rationale:'帮助识别'}],functionalPlan:[{task:'完成任务',component:'按钮',states:['完成'],events:['点击'],acceptance:['状态改变']}],visualDirection:{hierarchy:'清楚',density:'适中',composition:'有序',colorSemantics:'一致',typography:'可读'},designSystem:{tokens:['间距'],components:['按钮'],styleBaseline:style},responsive:{breakpoints:[320],reflowRules:['重排']},accessibility:{target:'AA',keyboard:['Tab'],semantics:['button']},motion:{purpose:['反馈'],bindings:[{task:'完成任务',event:'点击',stateTransition:{from:'待处理',to:'完成'},informationBenefit:'state-change',valueStatement:'明确提示任务已完成并减少用户疑虑'}],reducedMotion:'无动画'},antiPatterns:['空按钮','不可读','丢失状态']};
 strategy.informationArchitecture.push({priority:2,purpose:'历史',content:['已完成任务']});
 strategy.functionalPlan[0].states=['待处理','完成'];
 invoke('record_context','contract-recorder.mjs',['intent',dir,put('intent-input.json',intent)]);
 invoke('record_context','contract-recorder.mjs',['delivery',dir,put('delivery-input.json',delivery)]);
 const quality=invoke('analyze_requirement','experience-evaluator.mjs',['evaluate',dir,put('strategy-input.json',strategy)]);
 assert.equal(quality.status,'passed');
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

 const visualSelection=invoke('plan_visual','role-advisory.mjs',['select',dir,'visual']);
 assert.ok(visualSelection.selectedRoles.includes('ui-designer'));
 const visual=JSON.parse(fs.readFileSync(path.join(dir,'advisories/visual/selection.json')));
 for(const roleId of visual.selectedRoles){
  const job=agentRuntimeStatus(dir,visual.agentJobs[roleId]).jobs[0];
  const claim=invoke('plan_visual','agent-runtime.mjs',['claim',dir,job.jobId,'visual']);
  const execution={inputTokens:0,outputTokens:0,usageSource:'unknown',model:'test-fixture',sessionId:job.payload.agentSessionId,skillBindings:job.payload.skillBindings,leaseToken:claim.leaseToken};
  if(roleId==='ui-designer'){
   assert.ok(claim.requiredSkill?.content && claim.requiredSkill.sha256);
   execution.tasteSkillUsage={sha256:claim.requiredSkill.sha256,appliedRules:['Use task-specific hierarchy.'],notApplicableRules:['Avoid unrelated landing-page effects.']};
   execution.optionalSkillUsage=[];
   for(const name of ['impeccable','google-design-md']){
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
  const plan = { schemaVersion: '3.0', deliveryNarrative: { mode: 'greenfield-selection', selections: [{ category: 'layout', sourceSelectionIds: ['layout'], selectionBasis: 'task hierarchy' }] }, layout: { informationArchitecture: ['task'], grid: 'single', responsive }, visualSystem: { styleDirection: 'clear', colors: ['white'], typography: 'system', effects: 'none' }, content: { hierarchy: ['task'], dataExpression: ['count'], states: ['default'] }, components: [{ visualNode: 'main' }], motion: [], dependencies: [], selectionAnalysis: { designCapabilities: ['taste-skill', 'impeccable', 'google-design-md'], designContract: { path: 'DESIGN.md', sha256: designHash, rules: ['hierarchy', 'spacing', 'color', 'responsive'] }, aestheticAssessment: { qualityRationale: 'Clear hierarchy supports the task.', coherenceChecks: ['layout', 'color', 'type', 'space', 'state'], rejectedPatterns: ['noise', 'clutter'] }, libraryComparisons: ['layout', 'style', 'component', 'font'].map(kind => ({ category: kind, candidates: [candidate(kind, 'selected'), candidate(kind, 'rejected')], decisionRationale: 'native source supports the task' })), userNeedFit: [{ need: 'complete task', selectedSourceIds: ['layout'], rationale: 'clear layout' }], alternatives: [{ candidate: 'complex layout', decision: 'unnecessary' }], industryBenchmark: { id: benchmark.id, scores: benchmark.criteria.map(criterion => ({ criterion, score: 4, sourceSelectionIds: ['layout'], rationale: 'task aligned' })) } }, sourceSelections: selections, risks: [], status: 'ready-for-user-confirmation' };
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
 const visualSummary=path.join(dir,'advisories/visual/role-decision-summary.md');
 fs.appendFileSync(visualSummary,'changed after confirmation');
 const stale=route(['status',project,id,session]);
 assert.ok(!stale.allowedActions.includes('generate_visual'),'a changed approved design role summary must prevent Demo generation');

 console.log(JSON.stringify({status:'passed',coverage:'controlled product and visual role jobs, actual taste load, visual compilation and combined approval; synthetic content and user confirmation',roles:selection.selectedRoles}));
} finally { if(process.env.APEX_KEEP_HANDOFF_FIXTURE==='1') console.error('fixture='+project); else fs.rmSync(project,{recursive:true,force:true}); }
