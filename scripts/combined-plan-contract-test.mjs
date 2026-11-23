import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto'; import { spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
const core=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'), router=path.join(core,'scripts/apex-router.mjs'), root=fs.mkdtempSync(path.join(os.tmpdir(),'apex-combined-positive-')), id='positive', session='positive-session', dir=path.join(root,'.apex/runs',id);
const invoke=(args)=>spawnSync(process.execPath,[router,...args],{encoding:'utf8',env:{...process.env,APEX_TEST_LEGACY_ROLE_CHAIN:args[0]==='intake'?'1':'0'}});
const ok=(result,label)=>{if(result.status!==0)throw Error(label+': '+(result.stderr||result.stdout));return JSON.parse(result.stdout)};
const put=(name,value)=>{const file=path.join(dir,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));};
const hash=name=>'sha256:'+crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,name))).digest('hex');
try {
 ok(invoke(['intake',root,id,'greenfield','standard','interactive',session,'确认调用 APEX']),'intake');
 const state=JSON.parse(fs.readFileSync(path.join(dir,'state.json')));state.roleChain.confirmationModel='two-confirmations';
 const intent={schemaVersion:'3.0',sourceRequest:'建立任务管理页面',trackRecommendation:'greenfield',goals:['完成任务'],successCriteria:['用户可完成任务'],knownFacts:['新建页面'],assumptions:[],openDecisions:[],designIntent:{formality:'professional',visualIntensity:'controlled',motionIntensity:'purposeful',informationDensity:'task',brandPosture:'clear'},acceptance:['完成任务可见反馈']};
 const delivery={schemaVersion:'3.0',capabilities:['frontend'],qualityBar:{usability:['完成任务'],accessibilityTarget:'WCAG-2.2-AA',performanceTarget:{lcpMs:2500,inpMs:200,cls:0.1},visualBaseline:['已确认 Demo']},verificationRequirements:['e2e']};
 const style={mode:'greenfield-standard',typography:{family:'system'},colors:{surface:'white'},spacing:{unit:'8px'},geometry:{radius:'4px'}};
 const strategy={schemaVersion:'3.0',sourceBindings:{codeReferenceHash:'none',pageSkeletonHash:'none',displayEvidenceHash:'none'},scene:'任务管理',primaryUsers:['用户'],userGoals:['管理任务'],informationArchitecture:[{priority:1,purpose:'任务',content:['任务列表']}],dataExpression:[{question:'任务数量',metric:'任务',comparison:'当前',encoding:'数字',interaction:'查看',rationale:'帮助识别'}],functionalPlan:[{task:'完成任务',component:'按钮',states:['完成'],events:['点击'],acceptance:['状态改变']}],visualDirection:{hierarchy:'清楚',density:'适中',composition:'有序',colorSemantics:'一致',typography:'可读'},designSystem:{tokens:['间距'],components:['按钮'],styleBaseline:style},responsive:{breakpoints:[320],reflowRules:['重排']},accessibility:{target:'AA',keyboard:['Tab'],semantics:['button']},motion:{purpose:['反馈'],bindings:[{task:'完成任务',event:'点击',stateTransition:{from:'待处理',to:'完成'},informationBenefit:'state-change',valueStatement:'明确提示任务已完成并减少用户疑虑'}],reducedMotion:'无动画'},antiPatterns:['空按钮','不可读','丢失状态']};
 put('intent-brief.json',intent);put('delivery-contract.json',delivery);put('experience-strategy.json',strategy);put('experience-quality-evidence.json',{schemaVersion:'3.0',strategyHash:hash('experience-strategy.json'),status:'passed',score:90,threshold:85,dimensions:Array.from({length:8},(_,i)=>({id:'d'+i,score:10,max:10,findings:[]})),criticalFailures:[],checkedAt:'2026-01-01T00:00:00Z'});
 const productSections=['需求方向与成功标准','用户、场景与核心任务','轨道判断与正式基线','产品范围、页面与功能边界','信息架构、数据、API 与权限','交付路径、技术约束与不包含项','质量门槛、验证与验收','已知事实、假设、待决项与风险'];
 const visualSections=['目标与范围','信息架构与布局','视觉 Token','组件与交互','图标、图表与素材','动效与可访问性','响应式与状态','真实来源与物化','候选比较与取舍','实施影响与验收'];
 const body=sections=>sections.map((title,i)=>`## ${i+1}. ${title}\n\n本节关于${title}，详细说明用户任务、设计决策、实际约束、交付边界和具体验收方式，保证每一个说明都可供用户审阅。`).join('\n\n')+'\n';
 put('gate1-presentation.md',body(productSections));
 const sources=Object.fromEntries([['intentBrief','intent-brief.json'],['deliveryContract','delivery-contract.json'],['experienceStrategy','experience-strategy.json']].map(([key,file])=>[key,{path:file,sha256:hash(file)}]));
 put('gate1-presentation-manifest.json',{status:'ready-for-user-confirmation',track:'greenfield',presentationSha256:hash('gate1-presentation.md'),sources});
 put('registrations/gate1.json',{schemaVersion:'3.0',type:'gate1-presentation-registration',runId:id,presentation:{sha256:hash('gate1-presentation.md')},manifest:{sha256:hash('gate1-presentation-manifest.json')}});
 const selections=['layout','component','style','font','content'].map(kind=>({id:kind,kind,visualNodes:['main'],sourceType:'native-web',sourceId:'web',resourceId:kind,version:'current',materialization:'native-web',...(kind==='content'?{parameters:{origin:'mock',fields:['task'],implementation:'render'}}:{parameters:{}})}));
 const responsive={contractId:'responsive',viewports:[{class:'mobile',minWidth:320,maxWidth:767,layoutMode:'single'},{class:'tablet',minWidth:768,maxWidth:1023,layoutMode:'two'},{class:'desktop',minWidth:1024,maxWidth:1920,layoutMode:'wide'}],reflowRules:['mobile reflow','tablet reflow','desktop reflow'],overflowPolicy:{noUnintendedHorizontalOverflow:true,exceptions:[]},typographyScale:'readable',mediaBehavior:'scale',acceptance:['mobile works','tablet works','desktop works']};
 const candidate=decision=>({sourceId:'web',resourceId:'pattern',version:'current',platformFit:'fit',visualFit:'fit',deliveryFit:'fit',decision});
 put('DESIGN.md','# 任务设计规范\n层级清晰，交互可达。\n');
 const visualPlan={schemaVersion:'3.0',deliveryNarrative:{mode:'greenfield-selection',selections:[{category:'layout',sourceSelectionIds:['layout'],selectionBasis:'任务优先'}]},layout:{informationArchitecture:['任务'],grid:'grid',responsive},visualSystem:{styleDirection:'清楚',colors:['白'],typography:'系统字体',effects:'无'},content:{hierarchy:['任务'],dataExpression:['任务数量'],states:['正常']},components:[{visualNode:'main'}],motion:[],dependencies:[],selectionAnalysis:{designCapabilities:['taste-skill','impeccable'],designContract:{path:'DESIGN.md',sha256:hash('DESIGN.md'),rules:['层级','间距','颜色','响应式']},aestheticAssessment:{coherenceChecks:['布局','字体','颜色','间距','状态'],qualityRationale:'任务清晰',rejectedPatterns:['杂乱','无效组件']},libraryComparisons:['layout','style','component'].map(category=>({category,candidates:[candidate('selected'),candidate('rejected')],decisionRationale:'适合当前任务'})),userNeedFit:[{need:'完成任务',selectedSourceIds:['layout'],rationale:'可见且清楚'}],alternatives:[{candidate:'复杂组件',decision:'不适用'}]},sourceSelections:selections,risks:[],status:'ready-for-user-confirmation'};
 put('visual-execution-plan.json',visualPlan);put('visual-plan-presentation.md',body(visualSections));
 put('visual-plan-presentation-manifest.json',{status:'ready-for-user-confirmation',visualExecutionPlan:'visual-execution-plan.json',visualExecutionPlanSha256:hash('visual-execution-plan.json'),presentation:'visual-plan-presentation.md',presentationSha256:hash('visual-plan-presentation.md')});
 Object.assign(state.artifacts,{intentBrief:'intent-brief.json',deliveryContract:'delivery-contract.json',experienceStrategy:'experience-strategy.json',experienceQualityEvidence:'experience-quality-evidence.json',gate1Presentation:'gate1-presentation.md',gate1PresentationManifest:'gate1-presentation-manifest.json',gate1PresentationRegistration:'registrations/gate1.json',visualExecutionPlan:'visual-execution-plan.json',visualPlanPresentation:'visual-plan-presentation.md',visualPlanPresentationManifest:'visual-plan-presentation-manifest.json'});fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify(state));
 const status=ok(invoke(['status',root,id,session]),'status'); if(status.userInteraction?.confirmation?.label!=='确认视觉改造方案')throw Error('combined visual confirmation not shown: '+JSON.stringify({action:status.nextRequiredAction,interaction:status.userInteraction}));

 const designFile=path.join(dir,'DESIGN.md'), designBytes=fs.readFileSync(designFile);
 fs.appendFileSync(designFile,'changed');
 const staleBefore=ok(invoke(['status',root,id,session]),'changed design before confirmation');
 if(staleBefore.userInteraction?.confirmation)throw Error('changed design contract must not be presented for confirmation');
 fs.writeFileSync(designFile,designBytes);
 const shown=status.userInteraction.confirmation.presentation.content;
 const beforeApproval=fs.readFileSync(path.join(dir,'state.json'));
 const ledgerFile=path.join(dir,'run-ledger.sqlite');
 const ledgerBefore=new DatabaseSync(ledgerFile);const beforeSnapshot=ledgerBefore.prepare('SELECT MAX(id) AS id FROM state_snapshots').get().id;ledgerBefore.close();
 const simulatePreCommitCrash=()=>{const ledger=new DatabaseSync(ledgerFile);try{ledger.prepare('DELETE FROM state_snapshots WHERE id > ?').run(beforeSnapshot);}finally{ledger.close();}fs.writeFileSync(path.join(dir,'state.json'),beforeApproval);};

 const approval=ok(invoke(['approve',root,id,session,'visual-plan','combined-positive','visual-execution-plan.json','visual-plan-presentation.md']),'approve');
 const receipt=JSON.parse(fs.readFileSync(path.join(dir,approval.receipt)));const expected='sha256:'+crypto.createHash('sha256').update(shown).digest('hex');
 if(receipt.presentation?.sha256!==expected||approval.gates.gate1!=='passed'||approval.nextRequiredAction!=='generate_visual')throw Error('combined approval did not bind content and enter Demo generation');
 fs.appendFileSync(designFile,'changed');
 const staleAfter=ok(invoke(['status',root,id,session]),'changed design after confirmation');
 if(staleAfter.nextRequiredAction!=='revoke_visual'||staleAfter.allowedActions.includes('generate_visual'))throw Error('changed design contract must invalidate the approved visual plan before Demo generation');
 fs.writeFileSync(designFile,designBytes);

 // A forged or changed rendered-body hash must block recovery.
 const approvalFile=path.join(dir,approval.receipt), originalReceipt=fs.readFileSync(approvalFile);
 simulatePreCommitCrash();
 const alteredReceipt=JSON.parse(originalReceipt);alteredReceipt.presentation.sha256='sha256:'+'0'.repeat(64);fs.writeFileSync(approvalFile,JSON.stringify(alteredReceipt));
 const badReceipt=ok(invoke(['status',root,id,session]),'tampered approval');
 if(badReceipt.gates.gate1==='passed'||badReceipt.terminalResponseContract?.allowedKinds?.[0]!=='blocking-report')throw Error('changed presentation hash must block approval recovery');
 fs.writeFileSync(approvalFile,originalReceipt);
 // Simulate interruption after the durable user receipt but before state commit.
 simulatePreCommitCrash();
 const recovered=ok(invoke(['status',root,id,session]),'recover approval');
 if(recovered.gates.gate1!=='passed'||recovered.nextRequiredAction!=='generate_visual'||recovered.userInteraction?.confirmation)throw Error('durable combined approval did not recover without re-prompting');
 simulatePreCommitCrash();
 fs.appendFileSync(path.join(dir,'visual-plan-presentation.md'),'\n变化后的内容\n');
 const stale=ok(invoke(['status',root,id,session]),'stale approval');
 if(stale.gates.gate1==='passed'||stale.nextRequiredAction!=='plan_visual'||stale.userInteraction?.confirmation)throw Error('a stale combined approval must not recover after presentation changes');
 console.log(JSON.stringify({status:'passed',checks:7,coverage:'real-product-and-visual-schema-validation-and-combined-approval-recovery; test-only-role-and-artifact-fixtures'}));
} finally {fs.rmSync(root,{recursive:true,force:true});}
