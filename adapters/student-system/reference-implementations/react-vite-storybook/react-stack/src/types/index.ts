export interface Student {
  name: string;
  grade: string;
  version: string;
}

export interface Upload {
  id: string;
  title: string;
  subject: string;
  grade: string;
  gradeTerm: string;
  uploadType: string;
  materialKind: string;
  blankExam: boolean;
  imageNames: string[];
  files: FileItem[];
  skippedFiles: string[];
  recognizedContent: RecognizedContent;
  contentAnalysis: ContentAnalysis;
  ocrProviderId: string;
  ocrProviderName: string;
  ocrModelName: string;
  modelProviderId: string;
  modelProviderName: string;
  modelName: string;
  homeworkDate: string;
  createdAt: string;
}

export interface FileItem {
  name: string;
  size: number;
  type: string;
  category: string;
  content: string;
  signature: string;
}

export interface RecognizedContent {
  summary: string;
  contentAnalysis: string;
  structuredJson: Record<string, unknown> | null;
  intermediate?: Record<string, unknown> | null;
  workflowPlan?: Record<string, unknown> | null;
  workflowExecution?: Record<string, unknown> | null;
  workflowSummary?: Record<string, unknown> | null;
  pipelineStages?: PipelineStage[];
  finalAnalysisPayload?: FinalAnalysisPayload | null;
}

export interface ContentAnalysis {
  title: string;
  subject: string;
  grade: string;
  gradeTerm: string;
  summary: string;
  paperKind: string;
  knowledgePoints: KnowledgePoint[];
  questions: Question[];
  questionTypeStats?: QuestionTypeStat[];
  completionSummary?: {
    updatedAt?: string;
    completedCount?: number;
    failedCount?: number;
    skippedCount?: number;
    incompleteCount?: number;
    incompleteQuestionNumbers?: number[];
  };
  finalAnalysisPayload?: FinalAnalysisPayload | null;
}

export interface QuestionTypeStat {
  name: string;
  total: number;
  correct: number;
  wrong: number;
  unknown: number;
}

export interface KnowledgePoint {
  name: string;
  canonicalKnowledgeName?: string;
  topicHint?: string;
  definition: string;
  formula: string;
  rule?: string;
  mistakeCause: string;
  scenarioExplanation: string;
  stagedLearningMethod: string[];
  typicalExample: TypicalExample | null;
  errorBreakdown: string[];
  masteryAssessment: string;
  transferSuggestions: string[];
}

export interface TypicalExample {
  stem: string;
  knownConditions: string[];
  questionAsk: string;
  solutionSteps: string[];
  teachingSteps?: string[];
  steps?: string[];
  answer: string;
  explanation: string;
}

export interface Question {
  id?: string;
  qid?: string;
  uploadId?: string;
  number?: number;
  stem: string;
  type: string;
  questionType?: string;
  answerMode?: string;
  knowledge: string;
  knowledgeRefs?: KnowledgeRef[];
  canonicalKnowledgeName?: string;
  topicHint?: string;
  correct: boolean;
  studentAnswer: string;
  correctAnswer: string;
  explanation: string;
  cause: string;
  difficulty: string;
  definition: string;
  formula: string;
  rule?: string;
  markEvidence: string;
  solutionSteps: string[];
  teachingSteps?: string[];
  steps?: string[];
  optionAnalysis: OptionAnalysis[];
  options?: QuestionImageOption[];
  reviewContent: ReviewContent;
  conceptIds?: string[];
  rootCausePrimary?: string;
  rootCauseSecondary?: string[];
  causeType?: string;
  knownConditions?: string[];
  missedConditions?: string[];
  correctMethod?: string;
  correctFormula?: string;
  mistakeAtStep?: string;
  teacherExplanation?: string;
  fixSuggestion?: string;
  selfCheckPoints?: string[];
  diagramAssets?: DiagramAssets;
  judgement?: string;
  teacherJudgement?: string;
  teacherJudgment?: string;
  result?: string;
  analysisCompleteness?: AnalysisCompleteness;
  sourceImageUrl?: string;
  sourceImageCaption?: string;
  diagramDescription?: string;
  figureElements?: string[];
  knownConditionsFromDiagram?: string[];
  diagramSketchUrl?: string;
  diagramSketchCaption?: string;
  renderIntent?: Record<string, unknown>;
  reconstructionValidation?: Record<string, unknown>;
}

export interface AnalysisCompletenessIssue {
  code: string;
  label: string;
  field: string;
  severity: string;
  missingOptions?: string[];
}

export interface AnalysisCompleteness {
  complete: boolean;
  kind: string;
  issues: AnalysisCompletenessIssue[];
  summary: string;
  checkedAt: string;
}

export interface AnalysisCompletionTaskQuestionRef {
  questionId?: string;
  number?: number;
  stem?: string;
  stemKey?: string;
  reason?: string;
  issues?: AnalysisCompletenessIssue[];
}

export interface AnalysisCompletionTask {
  id: string;
  uploadId: string;
  mode: string;
  onlyIncomplete: boolean;
  status: string;
  phase: string;
  retryable: boolean;
  error: string;
  progress: {
    total: number;
    completed: number;
    succeeded: number;
    failed: number;
    skipped: number;
    message: string;
    updatedAt: string;
  } | null;
  model: {
    providerId?: string;
    providerName?: string;
    modelName?: string;
  } | null;
  issues: Array<Record<string, unknown>>;
  completedQuestions: Array<Record<string, unknown>>;
  failedQuestions: AnalysisCompletionTaskQuestionRef[];
  questionRefs: AnalysisCompletionTaskQuestionRef[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface KnowledgeRef {
  rawName: string;
  canonicalName: string;
  role: "direct" | "required" | "material_focus";
  evidence: string;
  confidence: number;
  topicHint?: string;
}

export interface QuestionImageOption {
  key: string;
  type: string;
  questionRelation?: string;
  option?: string;
  content?: string;
  sceneSpec?: OptionGraphSceneSpec;
  bindingMeta?: QuestionImageOptionBindingMeta;
  diagramSketchUrl?: string;
  assetPlan?: QuestionImageOptionAssetPlan;
  originalCropUrl?: string;
  displayCropUrl?: string;
  aiGeneratedUrl?: string;
  aiGeneratedCaption?: string;
  sources?: Record<string, {
    kind?: string;
    url?: string;
    label?: string;
    providerId?: string;
    providerName?: string;
    model?: string;
    revisedPrompt?: string;
    generatedAt?: string;
  }>;
  bbox?: Record<string, number>;
  integrity?: {
    complete?: boolean;
    containsExtraText?: boolean;
    cleaned?: boolean;
  };
  validation?: Record<string, unknown>;
}

export interface OptionGraphSceneSpec {
  schema: string;
  option: string;
  coordinateSystem?: {
    hasXAxis?: boolean;
    hasYAxis?: boolean;
    hasOriginLabel?: boolean;
  };
  shape?: {
    family?: string;
    branchCount?: number;
    closedLoop?: boolean;
    opensLeftRight?: boolean;
    selfIntersection?: boolean;
    turningPoints?: number;
  };
  visualTraits?: string[];
  functionJudgementHint?: {
    verticalLineTest?: "pass" | "fail" | "unknown";
    reason?: string;
  };
}

export interface QuestionImageOptionBindingMeta {
  anchorKey: string;
  bindingMethod?: string;
  confidence?: number;
  letterBox?: Record<string, number>;
  graphBox?: Record<string, number>;
  displayBox?: Record<string, number>;
}

export interface QuestionImageOptionAssetPlan {
  generator?: string;
  outputStrategy?: string;
  promptProfile?: string;
  promptText?: string;
  transparentBackground?: boolean;
}

export interface OptionAnalysis {
  option: string;
  content: string;
  isCorrect: boolean;
  analysis: string;
}

export interface ReviewContent {
  scenarioExplanation: string;
  stagedLearningMethod: string[];
  typicalExample: TypicalExample | null;
  errorBreakdown: string[];
  masteryAssessment: string;
  transferSuggestions: string[];
}

export interface Paper {
  id: string;
  uploadId: string;
  title: string;
  subject: string;
  mode: string;
  totalScore: number;
  score: number;
  questionIds: string[];
  homeworkDate: string;
  createdAt: string;
}

export interface Mistake {
  id: string;
  questionId: string;
  uploadId: string;
  subject: string;
  knowledge: string;
  stem: string;
  type: string;
  studentAnswer: string;
  correctAnswer: string;
  explanation: string;
  cause: string;
  difficulty: string;
  definition: string;
  formula: string;
  solutionSteps: string[];
  optionAnalysis: OptionAnalysis[];
  correct: boolean;
  createdAt: string;
  analysis: MistakeAnalysis;
}

export interface MistakeAnalysis {
  causeAnalysis: string;
  definition: string;
  formula: string;
  improvement: string;
  teacherExplanation?: string;
  knownConditions?: string[];
  missedConditions?: string[];
  correctMethod?: string;
  correctFormula?: string;
  mistakeAtStep?: string;
  fixSuggestion?: string;
  selfCheckPoints?: string[];
  diagramAssets?: DiagramAssets;
}

export interface PipelineStage {
  key: string;
  label: string;
  executionType: string;
  required: boolean;
  order: number;
}

export interface DiagramAssets {
  qid: string;
  sourceCropUrl: string;
  standardizedUrl: string;
  transparentUrl: string;
  aiGeneratedUrl?: string;
  caption: string;
  sceneSpec?: OptionGraphSceneSpec;
  bindingMeta?: QuestionImageOptionBindingMeta;
  renderIntent?: Record<string, unknown>;
  validation?: Record<string, unknown>;
  options?: QuestionImageOption[];
  preferredSource?: string;
  sources?: Record<string, {
    kind?: string;
    url?: string;
    label?: string;
    providerId?: string;
    providerName?: string;
    model?: string;
    revisedPrompt?: string;
    generatedAt?: string;
  }>;
}

export interface RootCauseDiagnostic {
  qid: string;
  rootCausePrimary: string;
  rootCauseSecondary: string[];
  causeType: string;
  knownConditions: string[];
  missedConditions: string[];
  correctMethod: string;
  correctFormula: string;
  mistakeAtStep: string;
  teachingFocus: string[];
  teacherExplanation: string;
  fixSuggestion: string;
}

export interface TaxonomyMeta {
  taxonomyVersion?: string;
  chapterKey?: string;
  chapterTitle?: string;
  displayTitle?: string;
  sortOrder?: number;
}

export interface Concept extends TaxonomyMeta {
  conceptId: string;
  canonicalName: string;
  aliases: string[];
  subject: string;
  chapter: string;
  sourceQids: string[];
}

export interface FinalAnalysisPayload {
  schema: string;
  generatedAt: string;
  pipelineStages: PipelineStage[];
  subject: string;
  uploadId: string;
  paperId: string;
  questions: Array<Record<string, unknown>>;
  diagramAssets: DiagramAssets[];
  knowledgeHits: Array<Record<string, unknown>>;
  concepts: Concept[];
  questionConceptRelations: Array<Record<string, unknown>>;
  rootCauseDiagnostics: RootCauseDiagnostic[];
  teachingUnits: Array<Record<string, unknown>>;
  practiceUnits: Array<Record<string, unknown>>;
  workflowSummary?: Record<string, unknown> | null;
  consistencyReport?: Record<string, unknown>;
}

export interface Practice extends TaxonomyMeta {
  id: string;
  subject: string;
  knowledge: string;
  practiceMode: string;
  status: string;
  accuracy: number;
  questions: PracticeQuestion[];
  results: PracticeResult[];
  feedback: string;
  modelProviderId: string;
  modelProviderName: string;
  modelName: string;
  createdAt: string;
  completedAt: string;
  practiceSummary: PracticeSummary | null;
}

export interface PracticeQuestion {
  id: string;
  stem: string;
  type: string;
  knowledge: string;
  correctAnswer: string;
  explanation: string;
  difficulty: string;
  options: OptionAnalysis[];
}

export interface PracticeResult {
  questionId: string;
  correct: boolean;
  answer: string;
  feedback: string;
}

export interface PracticeSummary {
  title: string;
  knowledge: string;
  total: number;
  wrongCount: number;
  accuracy: number;
}

export interface Report {
  id: string;
  type: string;
  subject: string;
  gradeTerm: string;
  uploadType: string;
  materialTitle: string;
  accuracy: number;
  recommendation: string;
  highlights: string[];
  practiceSummary: PracticeSummary | null;
  modelProvider: string;
  modelName: string;
  createdAt: string;
}

export interface ReviewPack extends TaxonomyMeta {
  id: string;
  subject: string;
  knowledge: string;
  gradeTerm: string;
  mastery: string;
  accuracy: number;
  definitions: ReviewDefinition[];
  scenarioExplanation: string;
  stagedLearningMethod: string[];
  typicalExample: TypicalExample | null;
  errorBreakdown: string[];
  masteryAssessment: string;
  transferSuggestions: string[];
}

export interface ReviewDefinition {
  concept: string;
  definition: string;
  formula: string;
  quickMemory: string;
  example: string;
}

export interface ModelProvider {
  id: string;
  name: string;
  endpoint: string;
  apiKey: string;
  notes: string;
  websiteUrl: string;
  latency: number;
  models: {
    primary: string;
    fast: string;
    balanced: string;
    advanced: string;
    image: string;
    custom: string;
  };
  applications: string[];
  active: boolean;
  disabled: boolean;
}

export interface AgentProvider {
  id: string;
  name: string;
  client: string;
  command: string;
  model: string;
  deployment: string;
  localKind: string;
  notes: string;
  applications: string[];
  active: boolean;
  disabled: boolean;
}

export interface ModelManagement {
  applications: string[];
  activeByApplication: Record<string, string | null>;
  activeAgentByApplication: Record<string, string | null>;
  routeByApplication: Record<string, string>;
  providers: ModelProvider[];
  agents: AgentProvider[];
}

export interface AppState {
  student: Student;
  uploads: Upload[];
  papers: Paper[];
  questions: Question[];
  mistakes: Mistake[];
  weaknesses: Weakness[];
  reviewMaterials: ReviewMaterial[];
  reviewPacks: ReviewPack[];
  practices: Practice[];
  reports: Report[];
  modelManagement: ModelManagement;
  analysisCompletionTasks?: AnalysisCompletionTask[];
}

export interface DiagramPreviewDemo {
  schema: string;
  phases: string[];
  question: {
    questionId: string;
    number: number;
    type: string;
    stem: string;
    questionBbox?: Record<string, number>;
    options: QuestionImageOption[];
    previewUrl?: string;
  };
}

export interface Weakness extends TaxonomyMeta {
  id: string;
  subject: string;
  knowledge: string;
  gradeTerm: string;
  status: string;
  accuracy: number;
  questionCount: number;
  wrongCount: number;
  modelDefinition: string;
  modelFormula: string;
  modelScenarioExplanation: string;
  modelStagedLearningMethod: string[];
  modelTypicalExample: TypicalExample | null;
  modelErrorBreakdown: string[];
  modelMasteryAssessment: string;
  modelTransferSuggestions: string[];
}

export interface ReviewMaterial extends TaxonomyMeta {
  id: string;
  subject: string;
  knowledge: string;
  gradeTerm: string;
  definitions: ReviewDefinition[];
  scenarioExplanation: string;
  stagedLearningMethod: string[];
  typicalExample: TypicalExample | null;
  errorBreakdown: string[];
  masteryAssessment: string;
  transferSuggestions: string[];
}

export interface GrowthProfile {
  reports: Report[];
  subject: string;
  knowledge: string;
  stage: string;
  averageAccuracy: number;
  knowledgeItems: ReviewPack[];
  practices: Practice[];
  questions: Question[];
  statusCounts: Record<string, number>;
  portrait: string;
  weakItems: Weakness[];
  trendDelta: number;
}

export interface TimeFilter {
  preset: string;
  singleDate: string;
  startDate: string;
  endDate: string;
  multiDates: string;
}
