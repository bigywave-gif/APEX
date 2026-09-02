import { useEffect, useMemo, useState } from 'react'
import { useAppState } from '../store/AppContext'
import { Card, CardBody, CardHeader, Select, SelectItem, Chip, Progress, Button } from '@heroui/react'
import { CircleAlert, ClipboardCheck, Target } from 'lucide-react'
import { createAnalysisCompletionTask, generateQuestionDiagram, getAnalysisCompletionTask, responseState, retryAnalysisCompletionTask, stopAnalysisCompletionTask } from '../api'
import type { AnalysisCompletionTask, DiagramAssets, Question, QuestionImageOption } from '../types'
import { ScientificFormula } from '../components/ScientificFormula'

type Judgement = 'correct' | 'wrong' | 'unknown'
type QuestionKind = 'choice' | 'blank' | 'judgement' | 'calculation' | 'solution' | 'analysis'

function normalizeImageUrl(value?: string) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const uploadIndex = raw.indexOf('/upload/')
  if (uploadIndex >= 0) return raw.slice(uploadIndex)
  const previewIndex = raw.indexOf('/tmp/diagram-preview/')
  if (previewIndex >= 0) return `/diagram-preview/${raw.slice(previewIndex + '/tmp/diagram-preview/'.length)}`
  if (raw.startsWith('tmp/diagram-preview/')) return `/diagram-preview/${raw.slice('tmp/diagram-preview/'.length)}`
  const previewRouteIndex = raw.indexOf('/diagram-preview/')
  if (previewRouteIndex >= 0) return raw.slice(previewRouteIndex)
  const picIndex = raw.indexOf('/data/pic/')
  if (picIndex >= 0) return `/pic/${raw.slice(picIndex + '/data/pic/'.length)}`
  if (raw.startsWith('data/pic/')) return `/pic/${raw.slice('data/pic/'.length)}`
  const picRouteIndex = raw.indexOf('/pic/')
  if (picRouteIndex >= 0) return raw.slice(picRouteIndex)
  return raw
}

function questionJudgement(question: Question): Judgement {
  if (question.correct === true) return 'correct'
  if (question.correct === false) return 'wrong'
  const raw = String(
    question.judgement
      || question.teacherJudgement
      || question.teacherJudgment
      || question.result
      || '',
  ).trim().toLowerCase()
  if (['correct', 'right', '正确', '对', '答对'].includes(raw)) return 'correct'
  if (['wrong', 'incorrect', '错误', '错', '答错'].includes(raw)) return 'wrong'
  return 'unknown'
}

function questionNumber(question: Question, index: number) {
  return String(question.number || question.id || index + 1).replace(/^q/i, '')
}

function questionAnchorId(question: Question, index: number) {
  return `analysis-question-${questionNumber(question, index).replace(/[^\w-]+/g, '-') || index + 1}`
}

function splitKnowledge(value?: string) {
  return String(value || '')
    .split(/[、,，;；/|]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function uploadDisplayTitle(upload: { displayTitle?: string; title?: string; uploadType?: string }) {
  return upload.displayTitle || upload.title || upload.uploadType || '学习材料'
}

function buildGradingSummary(questions: Question[]) {
  const items = questions.map((question, index) => ({
    question,
    number: questionNumber(question, index),
    anchorId: questionAnchorId(question, index),
    status: questionJudgement(question),
  }))
  const correctCount = items.filter((item) => item.status === 'correct').length
  const wrongCount = items.filter((item) => item.status === 'wrong').length
  const unknownCount = items.filter((item) => item.status === 'unknown').length
  const gradedCount = correctCount + wrongCount
  const accuracy = gradedCount ? Math.round((correctCount / gradedCount) * 100) : null
  const knowledgeMap = new Map<string, { name: string; total: number; correct: number; wrong: number; unknown: number; wrongNumbers: string[] }>()
  const questionTypeMap = new Map<string, { name: string; total: number; correct: number; wrong: number; unknown: number; wrongNumbers: string[] }>()

  items.forEach((item) => {
    const names = splitKnowledge(item.question.knowledge || item.question.canonicalKnowledgeName)
    ;(names.length ? names : ['未归类知识点']).forEach((name) => {
      const current = knowledgeMap.get(name) || {
        name,
        total: 0,
        correct: 0,
        wrong: 0,
        unknown: 0,
        wrongNumbers: [],
      }
      current.total += 1
      current[item.status] += 1
      if (item.status === 'wrong') current.wrongNumbers.push(item.number)
      knowledgeMap.set(name, current)
    })
    const typeName = questionKindMeta(item.question).label
    const typeCurrent = questionTypeMap.get(typeName) || {
      name: typeName,
      total: 0,
      correct: 0,
      wrong: 0,
      unknown: 0,
      wrongNumbers: [],
    }
    typeCurrent.total += 1
    typeCurrent[item.status] += 1
    if (item.status === 'wrong') typeCurrent.wrongNumbers.push(item.number)
    questionTypeMap.set(typeName, typeCurrent)
  })

  let headline = '本次判卷尚待确认'
  if (accuracy !== null && wrongCount === 0) headline = '本次作答全部正确，基础掌握稳定'
  else if (accuracy !== null && accuracy >= 80) headline = '整体掌握较好，重点订正少量失分题'
  else if (accuracy !== null && accuracy >= 60) headline = '基础已有掌握，需要针对错题补强'
  else if (accuracy !== null) headline = '失分较集中，建议安排专项讲评与复测'

  return {
    items,
    correctCount,
    wrongCount,
    unknownCount,
    gradedCount,
    accuracy,
    headline,
    knowledgeStats: Array.from(knowledgeMap.values()).sort((a, b) => b.wrong - a.wrong || b.total - a.total),
    questionTypeStats: Array.from(questionTypeMap.values()).sort((a, b) => b.total - a.total || b.wrong - a.wrong),
  }
}

function selectKnowledgeDiagnosisStats(stats: Array<{ name: string; total: number; correct: number; wrong: number; unknown: number; wrongNumbers: string[] }>, limit = 8) {
  const list = (Array.isArray(stats) ? stats : []).filter((item) => item && Number(item.total || 0) > 0)
  if (!list.length) return []
  const weak = list
    .filter((item) => Number(item.wrong || 0) > 0)
    .sort((a, b) => b.wrong - a.wrong || b.total - a.total || b.correct - a.correct || a.name.localeCompare(b.name, 'zh'))
  const solid = list
    .filter((item) => Number(item.wrong || 0) === 0 && Number(item.correct || 0) > 0)
    .sort((a, b) => b.correct - a.correct || b.total - a.total || a.name.localeCompare(b.name, 'zh'))
  const pending = list
    .filter((item) => Number(item.wrong || 0) === 0 && Number(item.correct || 0) === 0)
    .sort((a, b) => b.unknown - a.unknown || b.total - a.total || a.name.localeCompare(b.name, 'zh'))
  const visible: typeof list = []
  weak.slice(0, Math.min(limit, 4)).forEach((item) => visible.push(item))
  ;[...solid, ...pending].forEach((item) => {
    if (visible.length >= limit) return
    if (visible.some((entry) => entry.name === item.name)) return
    visible.push(item)
  })
  if (visible.length < limit) {
    weak.forEach((item) => {
      if (visible.length >= limit) return
      if (visible.some((entry) => entry.name === item.name)) return
      visible.push(item)
    })
  }
  return visible.slice(0, limit)
}

function resolveQuestionOptionAiImageUrl(option?: QuestionImageOption) {
  return normalizeImageUrl(option?.aiGeneratedUrl || option?.sources?.aiGenerated?.url || '')
}

function questionOptionDiagramGenerationKey(question: Question, option?: QuestionImageOption) {
  const questionId = resolveQuestionRuntimeId(question)
  const optionKey = String(option?.key || option?.option || '').trim().toUpperCase()
  return [questionId, optionKey].filter(Boolean).join('|')
}

function questionOptionDiagramSelectionKey(question: Question, option?: QuestionImageOption) {
  return questionOptionDiagramGenerationKey(question, option)
}

function preserveOptionAiState(currentOptions: QuestionImageOption[] = [], nextOptions: QuestionImageOption[] = []) {
  const currentByKey = new Map(
    (Array.isArray(currentOptions) ? currentOptions : [])
      .map((item) => [String(item?.key || item?.option || '').trim().toUpperCase(), item] as const)
      .filter(([key]) => key),
  )
  return (Array.isArray(nextOptions) ? nextOptions : []).map((item) => {
    const key = String(item?.key || item?.option || '').trim().toUpperCase()
    const current = currentByKey.get(key)
    if (!current) return item
    const nextAiUrl = String(item?.aiGeneratedUrl || item?.sources?.aiGenerated?.url || '').trim()
    const currentAiUrl = String(current?.aiGeneratedUrl || current?.sources?.aiGenerated?.url || '').trim()
    if (nextAiUrl || !currentAiUrl) return item
    return {
      ...item,
      aiGeneratedUrl: current.aiGeneratedUrl,
      aiGeneratedCaption: current.aiGeneratedCaption || current?.sources?.aiGenerated?.label || item?.aiGeneratedCaption || '',
      sources: current?.sources?.aiGenerated
        ? {
            ...(item?.sources || {}),
            aiGenerated: current.sources.aiGenerated,
          }
        : item?.sources,
    }
  })
}

function mergeAppStateDiagramOptionAi(currentState: AppState | null, nextState: AppState | null) {
  if (!currentState || !nextState) return nextState
  const currentUploads = Array.isArray(currentState.uploads) ? currentState.uploads : []
  const nextUploads = Array.isArray(nextState.uploads) ? nextState.uploads : []
  const mergedUploads = nextUploads.map((upload) => {
    const currentUpload = currentUploads.find((item) => item.id === upload.id)
    const nextQuestions = Array.isArray(upload?.contentAnalysis?.questions) ? upload.contentAnalysis.questions : []
    if (!currentUpload || !nextQuestions.length) return upload
    const currentQuestions = Array.isArray(currentUpload?.contentAnalysis?.questions) ? currentUpload.contentAnalysis.questions : []
    const mergedQuestions = nextQuestions.map((question) => {
      const currentQuestion = currentQuestions.find((item) => String(item?.id || item?.qid || '').trim() === String(question?.id || question?.qid || '').trim())
      if (!currentQuestion) return question
      const mergedQuestionOptions = preserveOptionAiState(currentQuestion.options || [], question.options || [])
      const currentDiagramOptions = Array.isArray(currentQuestion?.diagramAssets?.options) ? currentQuestion.diagramAssets.options : []
      const nextDiagramOptions = Array.isArray(question?.diagramAssets?.options) ? question.diagramAssets.options : []
      return {
        ...question,
        options: mergedQuestionOptions,
        diagramAssets: question?.diagramAssets && typeof question.diagramAssets === 'object'
          ? {
              ...question.diagramAssets,
              options: preserveOptionAiState(currentDiagramOptions as QuestionImageOption[], nextDiagramOptions as QuestionImageOption[]),
            }
          : question.diagramAssets,
      }
    })
    return {
      ...upload,
      contentAnalysis: upload?.contentAnalysis
        ? {
            ...upload.contentAnalysis,
            questions: mergedQuestions,
          }
        : upload.contentAnalysis,
    }
  })
  return {
    ...nextState,
    uploads: mergedUploads,
  }
}

function QuestionImageOptions({
  question,
  onGenerate,
  generatingKeys,
  sourceSelections,
  onSelectSource,
}: {
  question: Question;
  onGenerate: (question: Question, option: QuestionImageOption) => Promise<void>;
  generatingKeys: Record<string, boolean>;
  sourceSelections: Record<string, string>;
  onSelectSource: (selectionKey: string, sourceKey: string) => void;
}) {
  const options = Array.isArray(question?.options) ? question.options : []
  const imageOptions = options
    .map((item) => ({
      key: String(item?.key || '').trim(),
      src: normalizeImageUrl(item?.displayCropUrl || item?.originalCropUrl),
      aiSrc: resolveQuestionOptionAiImageUrl(item),
      option: item,
      selectionKey: questionOptionDiagramSelectionKey(question, item),
    }))
    .filter((item) => item.key && item.src)

  if (!imageOptions.length) return null

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="mb-3 text-sm font-semibold text-blue-800">图形选项参考</p>
      <div className="grid grid-cols-2 gap-3">
        {imageOptions.map((item) => (
          <article key={item.key} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-blue-50 text-sm font-semibold text-blue-600">
                {item.key}
              </span>
              <Button
                size="sm"
                variant="flat"
                color="primary"
                onPress={() => onGenerate(question, item.option)}
                isDisabled={Boolean(generatingKeys[questionOptionDiagramGenerationKey(question, item.option)])}
              >
                {generatingKeys[questionOptionDiagramGenerationKey(question, item.option)] ? '生成中...' : '生成AI图'}
              </Button>
            </div>
            {(() => {
              const sources = [
                { key: 'original', label: '原图', url: item.src, alt: `选项 ${item.key}` },
                ...(item.aiSrc ? [{ key: 'aiGenerated', label: 'AI图', url: item.aiSrc, alt: `选项 ${item.key} AI图` }] : []),
              ]
              const selectedKey = sourceSelections[item.selectionKey] || sources[0].key
              const activeSource = sources.find((source) => source.key === selectedKey) || sources[0]
              return (
                <>
                  <div className="mb-2 flex flex-wrap gap-2">
                    {sources.map((source) => (
                      <button
                        key={`${item.selectionKey}-${source.key}`}
                        type="button"
                        onClick={() => onSelectSource(item.selectionKey, source.key)}
                        className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${activeSource.key === source.key ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:text-blue-700'}`}
                      >
                        {source.label}
                      </button>
                    ))}
                  </div>
                  <img src={activeSource.url} alt={activeSource.alt} loading="lazy" className="block w-full rounded-lg bg-white" />
                </>
              )
            })()}
          </article>
        ))}
      </div>
    </div>
  )
}

function hasQuestionImageOptions(options?: QuestionImageOption[]) {
  return (Array.isArray(options) ? options : []).some((item) => {
    const src = normalizeImageUrl(item?.displayCropUrl || item?.originalCropUrl)
    return Boolean(String(item?.key || '').trim() && src)
  })
}

function resolveQuestionRuntimeId(question: Question) {
  return String(question.id || question.qid || '').trim()
}

function questionDiagramSelectionKey(question: Question, scope = 'analysis-react') {
  const uploadId = String(question.uploadId || '').trim()
  const questionId = resolveQuestionRuntimeId(question)
  const number = String(question.number || '').trim()
  const stemKey = String(question.stem || '').replace(/\s+/g, '').slice(0, 80)
  return [scope, uploadId, questionId || number, stemKey].filter(Boolean).join('|')
}

function normalizeQuestionDiagramAssets(question: Question) {
  const rawAssets = question.diagramAssets && typeof question.diagramAssets === 'object' ? question.diagramAssets as DiagramAssets : {} as DiagramAssets
  const rawSources = rawAssets.sources && typeof rawAssets.sources === 'object' ? rawAssets.sources : {}
  const cropUrl = normalizeImageUrl(rawAssets.sourceCropUrl || rawSources.crop?.url || question.sourceImageUrl || '')
  const standardUrl = normalizeImageUrl(rawAssets.standardizedUrl || rawSources.standard?.url || question.diagramSketchUrl || '')
  const aiUrl = normalizeImageUrl(rawAssets.aiGeneratedUrl || rawSources.aiGenerated?.url || '')
  const rawSourcesList = [
    cropUrl ? {
      key: 'crop',
      label: String(rawSources.crop?.label || question.sourceImageCaption || '剪裁图').trim() || '剪裁图',
      url: cropUrl,
    } : null,
    standardUrl ? {
      key: 'standard',
      label: String(rawSources.standard?.label || question.diagramSketchCaption || '讲解示意图').trim() || '讲解示意图',
      url: standardUrl,
    } : null,
    aiUrl ? {
      key: 'aiGenerated',
      label: String(rawSources.aiGenerated?.label || 'AI图').trim() || 'AI图',
      url: aiUrl,
      meta: rawSources.aiGenerated || {},
    } : null,
  ].filter(Boolean) as Array<{ key: string; label: string; url: string; meta?: Record<string, unknown> }>
  const seenUrls = new Set<string>()
  const sources = rawSourcesList.filter((item) => {
    const normalizedUrl = String(item.url || '').trim()
    if (!normalizedUrl || seenUrls.has(normalizedUrl)) return false
    seenUrls.add(normalizedUrl)
    return true
  })
  return {
    preferred: String(rawAssets.preferredSource || '').trim(),
    sources,
  }
}

function hasQuestionDiagramEvidence(question: Question) {
  const assets = normalizeQuestionDiagramAssets(question)
  if (assets.sources.length > 0) return true
  if (String(question.sourceImageUrl || '').trim()) return true
  if (String(question.diagramSketchUrl || '').trim()) return true
  if (String(question.diagramDescription || '').trim()) return true
  if (Array.isArray(question.knownConditions) && question.knownConditions.length > 0) return true
  return false
}

function shouldSuppressQuestionDiagramPreview(question: Question) {
  const scenario = String(
    question.diagramScenario
    || String((question.renderIntent as { diagramScenario?: string; graphType?: string } | undefined)?.diagramScenario || '')
    || String((question.renderIntent as { diagramScenario?: string; graphType?: string } | undefined)?.graphType || '')
  ).trim()
  return scenario === 'option_graph' && hasQuestionImageOptions(question.options)
}

function getAnswerDisplay(question: Question) {
  const studentAnswer = String(question.studentAnswer || '').trim()
  if (studentAnswer) {
    return {
      label: '学生答案',
      value: studentAnswer,
    }
  }
  const evidence = `${question.markEvidence || ''} ${question.teacherJudgement || question.teacherJudgment || ''}`.trim()
  const shouldShowReferenceAnswer = Boolean(question.correctAnswer)
    && /未识别\/未作答|无学生作答|标准解答|答案版|参考答案|标准答案|无法确认/.test(evidence)
  if (shouldShowReferenceAnswer) {
    return {
      label: '参考答案',
      value: String(question.correctAnswer || '').trim(),
    }
  }
  return {
    label: '学生答案',
    value: '未识别/未作答',
  }
}

function normalizeTextChoices(question: Question) {
  const rawOptions = Array.isArray(question.options) ? (question.options as unknown[]) : []
  return rawOptions
    .map((item, index) => {
      const fallbackKey = String.fromCharCode(65 + index)
      if (typeof item === 'string') {
        const text = item.trim()
        const match = text.match(/^([A-Z])[\.\u3001\uff0e、]\s*(.+)$/i)
        return {
          key: (match?.[1] || fallbackKey).toUpperCase(),
          content: match?.[2] || text,
        }
      }
      if (!item || typeof item !== 'object') return null
      const option = item as Record<string, unknown>
      const key = String(option.key || option.option || option.label || fallbackKey).trim()
      const content = String(option.content || option.text || option.value || option.title || '').trim()
      const hasImage = Boolean(option.displayCropUrl || option.originalCropUrl)
      return {
        key,
        content: content || (hasImage ? '图示选项' : ''),
      }
    })
    .filter((item): item is { key: string; content: string } => Boolean(item?.key))
}

function escapeRegExpClient(value: string) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function stripInlineChoiceOptionsFromStem(question: Question, choices: Array<{ key: string; content: string }>) {
  const text = String(question.stem || '').trim()
  if (!text || choices.length < 2) return text
  const meaningfulChoices = choices
    .map((choice) => ({
      key: String(choice.key || '').trim().toUpperCase(),
      content: String(choice.content || '').trim(),
    }))
    .filter((choice) => choice.key && choice.content && choice.content !== '图示选项')
  if (meaningfulChoices.length < 2) return text
  const [first, second] = meaningfulChoices
  const firstPattern = new RegExp(`\\s${escapeRegExpClient(first.key)}[\\.．、:：\\)）]?\\s*${escapeRegExpClient(first.content)}`)
  const secondPattern = new RegExp(`\\s${escapeRegExpClient(second.key)}[\\.．、:：\\)）]?\\s*${escapeRegExpClient(second.content)}`)
  const firstMatch = firstPattern.exec(text)
  const secondMatch = secondPattern.exec(text)
  if (!firstMatch || !secondMatch || typeof firstMatch.index !== 'number' || typeof secondMatch.index !== 'number') return text
  if (secondMatch.index <= firstMatch.index) return text
  return text.slice(0, firstMatch.index).trim() || text
}

function inferQuestionKind(question: Question): QuestionKind {
  const type = String(question.questionType || question.type || question.answerMode || '').toLowerCase()
  const choices = normalizeTextChoices(question)
  if (choices.length || /选择|choice|single|multiple|option/.test(type)) return 'choice'
  if (/填空|blank|fill/.test(type)) return 'blank'
  if (/判断|判定|正误|对错|是否正确|judg|true|false/.test(type)) return 'judgement'
  if (/计算|求值|化简|解方程|配平|运算|calculation|calculate|compute/.test(type)) return 'calculation'
  if (/解答|证明|应用|综合|简答|问答|论述|推导|solve|proof|essay|open/.test(type)) return 'solution'
  return 'analysis'
}

function questionKindMeta(question: Question) {
  const kind = inferQuestionKind(question)
  if (kind === 'choice') return { kind, label: '选择题', resolutionTitle: '选择题解析', processTitle: '选项判断全过程' }
  if (kind === 'blank') return { kind, label: '填空题', resolutionTitle: '填空题解析', processTitle: '答案依据与校验' }
  if (kind === 'judgement') return { kind, label: '判断题', resolutionTitle: '判断题解析', processTitle: '正误判断与依据' }
  if (kind === 'calculation') return { kind, label: '计算题', resolutionTitle: '计算过程', processTitle: '公式代入与运算校验' }
  if (kind === 'solution') return { kind, label: '解答题', resolutionTitle: '解答过程', processTitle: '步骤推导与依据' }
  return { kind, label: '材料题', resolutionTitle: '解析', processTitle: '分析过程' }
}

function hasConcreteSolutionSteps(steps: string[]) {
  const genericPatterns = [
    /^审题[:：]/,
    /^回顾定义与公式[:：]/,
    /^分步演算[:：]/,
    /^结果核查[:：]/,
    /^先围绕.+整理已知条件/,
    /^按公式或模板逐步推导/,
  ]
  return steps.length >= 2 && steps.some((step) => !genericPatterns.some((pattern) => pattern.test(step)))
}

function buildSolutionSteps(question: Question) {
  const sourceSteps = [
    ...(Array.isArray(question.teachingSteps) ? question.teachingSteps : []),
    ...(Array.isArray(question.steps) ? question.steps : []),
    ...(Array.isArray(question.solutionSteps) ? question.solutionSteps : []),
  ].map((step) => String(step || '').trim()).filter(Boolean)
  const seen = new Set<string>()
  const concrete = hasConcreteSolutionSteps(sourceSteps)
  const steps = concrete ? sourceSteps.filter((step) => {
    if (seen.has(step)) return false
    seen.add(step)
    return true
  }) : []
  const correctAnswer = String(question.correctAnswer || '').trim()
  const hasFinalAnswer = steps.some((step) => /(?:最终答案|所以|因此|故|答[:：]|得到|得出)/.test(step) && (!correctAnswer || step.includes(correctAnswer)))
  if (concrete && correctAnswer && !hasFinalAnswer) steps.push(`由以上计算或推理可得，最终答案为：${correctAnswer}`)
  return { complete: concrete, steps }
}

function isGenericAnalysisText(value?: string) {
  const text = String(value || '').trim()
  if (!text) return false
  return [
    /^先围绕[“"].+?[”"]整理题目条件，再按对应定义、公式和步骤逐步推导/,
    /^先围绕.+整理题目条件，再按对应定义、公式和步骤逐步推导/,
    /^本题主要考查.+需要结合题干条件逐步分析$/,
    /^根据题干信息，按相关知识点进行判断即可$/,
  ].some((pattern) => pattern.test(text))
}

function normalizedOptionAnalyses(question: Question) {
  const analyses = Array.isArray(question.optionAnalysis) ? question.optionAnalysis : []
  if (analyses.length) {
    const choices = normalizeTextChoices(question)
    const contentByKey = new Map(choices.map((item) => [item.key.toUpperCase(), item.content]))
    const analysisByKey = new Map(analyses.map((item) => [String(item.option || '').toUpperCase(), item]))
    if (choices.length) {
      return choices.map((choice) => {
        const item = analysisByKey.get(choice.key.toUpperCase())
        return {
          option: String(item?.option || choice.key),
          content: String(item?.content || choice.content || ''),
          isCorrect: item?.isCorrect,
          analysis: String(item?.analysis || ''),
          missing: !item,
        }
      }).filter((item) => item.analysis)
    }
    return analyses.map((item) => ({
      option: String(item.option || '选项'),
      content: String(item.content || contentByKey.get(String(item.option || '').toUpperCase()) || ''),
      isCorrect: item.isCorrect,
      analysis: String(item.analysis || ''),
      missing: false,
    })).filter((item) => item.analysis)
  }
  return []
}

function stepDependency(question: Question, step: string) {
  const dependencies = [
    question.canonicalKnowledgeName,
    question.knowledge,
    question.correctFormula || question.formula || question.rule,
    question.correctMethod,
    question.definition,
  ].map((item) => String(item || '').trim()).filter(Boolean)
  const unique = Array.from(new Set(dependencies))
  if (!unique.length) return ''
  const matched = unique.filter((item) => step.includes(item)).slice(0, 2)
  return (matched.length ? matched : unique.slice(0, 2)).join('；')
}

export default function AnalysisPage() {
  const { appState, setAppState, refreshState } = useAppState()
  const [selectedUploadId, setSelectedUploadId] = useState('')
  const [taskByUploadId, setTaskByUploadId] = useState<Record<string, AnalysisCompletionTask>>({})
  const [actionError, setActionError] = useState('')
  const [diagramActionError, setDiagramActionError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [diagramSourceSelections, setDiagramSourceSelections] = useState<Record<string, string>>({})
  const [generatingDiagramKeys, setGeneratingDiagramKeys] = useState<Record<string, boolean>>({})
  const [generatingOptionDiagramKeys, setGeneratingOptionDiagramKeys] = useState<Record<string, boolean>>({})
  const uploads = appState?.uploads || []
  const selectedUpload = uploads.find((upload) => upload.id === selectedUploadId) || uploads[0]
  const analysis = selectedUpload?.contentAnalysis
  const questions = analysis?.questions || []
  const knowledgePoints = analysis?.knowledgePoints || []
  const grading = useMemo(() => buildGradingSummary(questions), [questions])
  const judgementGroups = useMemo(() => [
    { key: 'correct' as Judgement, label: '答对', empty: '暂无答对题', color: 'success' as const, className: 'border-emerald-200 bg-emerald-50/60 text-emerald-700' },
    { key: 'wrong' as Judgement, label: '答错', empty: '暂无答错题', color: 'danger' as const, className: 'border-red-200 bg-red-50/60 text-red-700' },
    { key: 'unknown' as Judgement, label: '待定', empty: '暂无待定题', color: 'warning' as const, className: 'border-amber-200 bg-amber-50/60 text-amber-700' },
  ].map((group) => ({
    ...group,
    items: grading.items.filter((item) => item.status === group.key),
  })), [grading.items])
  const wrongNumbers = grading.items.filter((item) => item.status === 'wrong').map((item) => item.number)
  const topWeakKnowledge = grading.knowledgeStats.filter((item) => item.wrong > 0).slice(0, 2).map((item) => item.name)
  const selectedTask = selectedUpload ? taskByUploadId[selectedUpload.id] : undefined
  const incompleteQuestions = questions
    .map((question, index) => ({ question, index }))
    .filter(({ question }) => question.analysisCompleteness?.complete === false)
  const incompleteCount = Number(analysis?.completionSummary?.incompleteCount ?? incompleteQuestions.length)

  useEffect(() => {
    const tasks = Array.isArray(appState?.analysisCompletionTasks) ? appState.analysisCompletionTasks : []
    const nextByUploadId: Record<string, AnalysisCompletionTask> = {}
    tasks.forEach((task) => {
      if (!task?.uploadId) return
      const current = nextByUploadId[task.uploadId]
      if (!current || new Date(task.updatedAt || 0).getTime() >= new Date(current.updatedAt || 0).getTime()) {
        nextByUploadId[task.uploadId] = task
      }
    })
    setTaskByUploadId(nextByUploadId)
  }, [appState?.analysisCompletionTasks])

  useEffect(() => {
    if (!selectedTask || !['queued', 'running', 'stopping'].includes(selectedTask.status)) return
    const timer = window.setInterval(async () => {
      try {
        const result = await getAnalysisCompletionTask(selectedTask.id) as { task: AnalysisCompletionTask }
        const nextTask = result?.task
        if (!nextTask) return
        setTaskByUploadId((current) => ({ ...current, [nextTask.uploadId]: nextTask }))
        if (!['queued', 'running', 'stopping'].includes(nextTask.status)) {
          window.clearInterval(timer)
          await refreshState()
        }
      } catch (error) {
        console.error(error)
      }
    }, 1200)
    return () => window.clearInterval(timer)
  }, [refreshState, selectedTask])

  const scrollToQuestion = (anchorId: string) => {
    const target = document.getElementById(anchorId) as HTMLDetailsElement | null
    if (!target) return
    if (target.tagName === 'DETAILS') target.open = true
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const runCompletion = async (payload: Record<string, unknown>) => {
    if (!selectedUpload) return
    setSubmitting(true)
    setActionError('')
    try {
      const result = await createAnalysisCompletionTask(selectedUpload.id, payload) as { task: AnalysisCompletionTask }
      if (result?.task) {
        setTaskByUploadId((current) => ({ ...current, [selectedUpload.id]: result.task }))
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '启动补全任务失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleBatchCompletion = async () => {
    await runCompletion({ onlyIncomplete: true })
  }

  const handleSingleCompletion = async (question: Question, index: number) => {
    await runCompletion({
      onlyIncomplete: false,
      questionRefs: [{
        questionId: question.id,
        number: Number(question.number || index + 1),
        stem: question.stem,
      }],
    })
  }

  const handleStopTask = async () => {
    if (!selectedTask) return
    try {
      const result = await stopAnalysisCompletionTask(selectedTask.id) as { task: AnalysisCompletionTask }
      if (result?.task) {
        setTaskByUploadId((current) => ({ ...current, [result.task.uploadId]: result.task }))
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '停止任务失败')
    }
  }

  const handleRetryTask = async () => {
    if (!selectedTask) return
    try {
      const result = await retryAnalysisCompletionTask(selectedTask.id) as { task: AnalysisCompletionTask }
      if (result?.task) {
        setTaskByUploadId((current) => ({ ...current, [result.task.uploadId]: result.task }))
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '重试任务失败')
    }
  }

  const handleDiagramGenerate = async (question: Question) => {
    const questionId = resolveQuestionRuntimeId(question)
    const selectionKey = questionDiagramSelectionKey(question)
    if (!questionId) return
    setDiagramActionError('')
    setGeneratingDiagramKeys((current) => ({ ...current, [selectionKey]: true }))
    try {
      const result = await generateQuestionDiagram(questionId) as Record<string, unknown>
      const nextState = responseState(result)
      setAppState((current) => mergeAppStateDiagramOptionAi(current, nextState))
      setDiagramSourceSelections((current) => ({ ...current, [selectionKey]: 'aiGenerated' }))
    } catch (error) {
      setDiagramActionError(error instanceof Error ? error.message : 'AI 图生成失败')
    } finally {
      setGeneratingDiagramKeys((current) => {
        const next = { ...current }
        delete next[selectionKey]
        return next
      })
    }
  }

  const handleOptionDiagramGenerate = async (question: Question, option: QuestionImageOption) => {
    const questionId = resolveQuestionRuntimeId(question)
    const optionKey = String(option?.key || option?.option || '').trim().toUpperCase()
    const generationKey = questionOptionDiagramGenerationKey(question, option)
    if (!questionId || !optionKey) return
    setDiagramActionError('')
    setGeneratingOptionDiagramKeys((current) => ({ ...current, [generationKey]: true }))
    try {
      const result = await generateQuestionDiagram(questionId, { optionKey }) as Record<string, unknown>
      const nextState = responseState(result)
      setAppState((current) => mergeAppStateDiagramOptionAi(current, nextState))
      setDiagramSourceSelections((current) => ({ ...current, [generationKey]: 'aiGenerated' }))
    } catch (error) {
      setDiagramActionError(error instanceof Error ? error.message : `选项${optionKey} AI 图生成失败`)
    } finally {
      setGeneratingOptionDiagramKeys((current) => {
        const next = { ...current }
        delete next[generationKey]
        return next
      })
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-col items-start gap-1">
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-600">教师判卷与教学分析</p>
          <h2 className="text-xl font-semibold">分析报告</h2>
        </CardHeader>
        <CardBody>
          {uploads.length === 0 ? (
            <p className="py-8 text-center text-slate-500">暂无分析报告。请先在“作业诊断”页面上传材料。</p>
          ) : (
            <Select
              label="选择材料"
              selectedKeys={selectedUpload ? [selectedUpload.id] : []}
              onSelectionChange={(keys) => setSelectedUploadId(Array.from(keys)[0] as string)}
            >
              {uploads.map((upload) => (
                <SelectItem key={upload.id}>{uploadDisplayTitle(upload)}</SelectItem>
              ))}
            </Select>
          )}
        </CardBody>
      </Card>

      {selectedUpload && (
        <>
          <Card className="border border-blue-100 bg-gradient-to-br from-blue-50 to-white">
            <CardBody className="gap-5 p-6">
              <div className="flex flex-wrap items-start justify-between gap-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-blue-600">老师阅卷总览</p>
                  <h3 className="mt-2 text-2xl font-semibold text-slate-900">{grading.headline}</h3>
                </div>
                <div className="min-w-28 rounded-2xl bg-white p-4 text-center shadow-sm">
                  <strong className="block text-3xl text-blue-700">{grading.accuracy === null ? '--' : `${grading.accuracy}%`}</strong>
                  <span className="text-xs font-medium text-slate-500">答题正确率</span>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ['判定题数', `${grading.gradedCount} / ${questions.length}`],
                  ['答对', `${grading.correctCount} 题`],
                  ['答错', `${grading.wrongCount} 题`],
                  ['待确认', `${grading.unknownCount} 题`],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-xs text-slate-500">{label}</p>
                    <strong className="mt-1 block text-xl text-slate-900">{value}</strong>
                  </div>
                ))}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">分析完整度补全</p>
                    <p className="mt-1 text-sm text-slate-600">
                      当前检测到 <strong>{incompleteCount}</strong> 道不完整题，缺失项会写回分析报告、知识巩固、历史错题和题库。
                    </p>
                    {actionError ? (
                      <p className="mt-2 text-sm text-red-600">{actionError}</p>
                    ) : null}
                    {diagramActionError ? (
                      <p className="mt-2 text-sm text-red-600">{diagramActionError}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      color="primary"
                      onPress={handleBatchCompletion}
                      isDisabled={!selectedUpload || incompleteCount === 0 || submitting || ['queued', 'running', 'stopping'].includes(selectedTask?.status || '')}
                    >
                      批量补全不完整题
                    </Button>
                    {selectedTask && ['queued', 'running', 'stopping'].includes(selectedTask.status) ? (
                      <Button variant="flat" color="danger" onPress={handleStopTask}>
                        停止任务
                      </Button>
                    ) : null}
                    {selectedTask && ['failed', 'partial_success', 'stopped'].includes(selectedTask.status) ? (
                      <Button variant="flat" color="warning" onPress={handleRetryTask}>
                        重试失败项
                      </Button>
                    ) : null}
                  </div>
                </div>
                {selectedTask ? (
                  <div className="mt-4 rounded-xl bg-slate-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-700">当前任务：{selectedTask.mode === 'single' ? '单题补全' : '批量补全'}</p>
                        <p className="text-xs text-slate-500">
                          状态：{selectedTask.status} · {selectedTask.progress?.message || '等待中'}
                        </p>
                      </div>
                      <Chip size="sm" variant="flat" color={selectedTask.status === 'success' ? 'success' : selectedTask.status === 'partial_success' ? 'warning' : selectedTask.status === 'failed' ? 'danger' : 'primary'}>
                        {selectedTask.progress?.succeeded || 0} 成功 / {selectedTask.progress?.failed || 0} 失败 / {selectedTask.progress?.skipped || 0} 跳过
                      </Chip>
                    </div>
                    <Progress
                      className="mt-3"
                      value={selectedTask.progress?.total ? Math.round(((selectedTask.progress.completed || 0) / selectedTask.progress.total) * 100) : 0}
                      color={selectedTask.status === 'failed' ? 'danger' : selectedTask.status === 'success' ? 'success' : 'primary'}
                      aria-label="补全任务进度"
                    />
                    {selectedTask.error ? (
                      <p className="mt-2 text-xs text-red-600">{selectedTask.error}</p>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="border-t border-blue-100 pt-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-700">逐题结论</span>
                  <span className="text-xs text-slate-500">按状态分组，点击题号可跳转到对应题目</span>
                </div>
                <div className="mt-3 grid gap-3 lg:grid-cols-3">
                  {judgementGroups.map((group) => (
                    <section key={group.key} className={`rounded-2xl border p-4 ${group.className}`}>
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <strong>{group.label}</strong>
                        <span className="rounded-full bg-white/70 px-2 py-1 text-xs font-semibold">{group.items.length} 题</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {group.items.length ? group.items.map((item) => (
                          <button
                            key={`${group.key}-${item.number}`}
                            type="button"
                            onClick={() => scrollToQuestion(item.anchorId)}
                            className="min-h-8 min-w-10 rounded-full border border-current/20 bg-white/85 px-3 text-xs font-semibold transition hover:-translate-y-0.5 hover:shadow"
                          >
                            {item.number}
                          </button>
                        )) : (
                          <span className="text-xs opacity-70">{group.empty}</span>
                        )}
                      </div>
                    </section>
                  ))}
                </div>
              </div>

              {grading.questionTypeStats.length > 0 && (
                <div className="border-t border-blue-100 pt-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-700">题型分布</span>
                    <span className="text-xs text-slate-500">区分选择、填空、判断、计算、解答等类别</span>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    {grading.questionTypeStats.map((item) => (
                      <section key={item.name} className="rounded-xl border border-slate-200 bg-white p-4">
                        <div className="flex items-center justify-between gap-2">
                          <strong className="text-sm text-slate-800">{item.name}</strong>
                          <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">{item.total} 题</span>
                        </div>
                        <p className="mt-2 text-xs text-slate-500">
                          对 {item.correct} · 错 {item.wrong} · 待定 {item.unknown}
                        </p>
                        {item.wrongNumbers.length > 0 && (
                          <p className="mt-1 text-xs text-red-600">失分题：{item.wrongNumbers.join('、')}</p>
                        )}
                      </section>
                    ))}
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader className="gap-3">
                <ClipboardCheck className="text-blue-600" size={21} />
                <h3 className="text-lg font-semibold">本次结论</h3>
              </CardHeader>
              <CardBody>
                <p className="text-sm leading-7 text-slate-700">
                  {analysis?.summary || '暂无整体分析结论。'}
                </p>
              </CardBody>
            </Card>

            <Card className="border border-amber-200 bg-amber-50/50">
              <CardHeader className="gap-3">
                <Target className="text-amber-600" size={21} />
                <h3 className="text-lg font-semibold">建议处理顺序</h3>
              </CardHeader>
              <CardBody className="gap-4">
                <p className="text-sm leading-7 text-slate-700">
                  {wrongNumbers.length
                    ? `先讲评第 ${wrongNumbers.join('、')} 题${topWeakKnowledge.length ? `，重点回到“${topWeakKnowledge.join('、')}”` : ''}；订正后安排同类型短测。`
                    : '保持当前节奏，选取一道同类变式进行迁移检查。'}
                </p>
                <div className="flex flex-wrap gap-2 text-xs font-medium text-amber-800">
                  {['1. 核对判卷证据', '2. 讲清错误步骤', '3. 订正并复测'].map((step) => (
                    <span key={step} className="rounded-lg bg-white px-3 py-2">{step}</span>
                  ))}
                </div>
              </CardBody>
            </Card>
          </div>

          {grading.knowledgeStats.length > 0 && (
            <Card>
              <CardHeader className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold">知识点掌握诊断</h3>
                  <p className="text-xs text-slate-500">按失分优先排序</p>
                </div>
              </CardHeader>
              <CardBody className="gap-3">
                {selectKnowledgeDiagnosisStats(grading.knowledgeStats, 8).map((point) => {
                  const mastery = point.total ? Math.round((point.correct / point.total) * 100) : 0
                  return (
                    <div key={point.name} className="grid items-center gap-3 rounded-xl border border-slate-200 p-4 md:grid-cols-[1fr_180px_auto]">
                      <div>
                        <p className="font-medium text-slate-800">{point.name}</p>
                        <p className="text-xs text-slate-500">
                          {point.wrongNumbers.length ? `失分题：${point.wrongNumbers.join('、')}` : `涉及 ${point.total} 题`}
                        </p>
                      </div>
                      <Progress value={mastery} size="sm" color={point.wrong ? 'danger' : 'success'} aria-label={`${point.name}掌握度`} />
                      <Chip size="sm" color={point.wrong ? 'danger' : point.unknown ? 'warning' : 'success'} variant="flat">
                        {point.wrong ? (mastery >= 60 ? '需巩固' : '重点讲评') : point.unknown ? '待确认' : '已掌握'}
                      </Chip>
                    </div>
                  )
                })}
              </CardBody>
            </Card>
          )}

          {questions.length > 0 && (
            <Card>
              <CardHeader className="flex-col items-start gap-1">
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">判卷复核</p>
                <h3 className="text-lg font-semibold">逐题诊断</h3>
              </CardHeader>
              <CardBody className="gap-3">
                {questions.map((question, index) => {
                  const status = questionJudgement(question)
                  const answerDisplay = getAnswerDisplay(question)
                  const textChoices = normalizeTextChoices(question)
                  const showTextChoices = textChoices.length > 0 && !hasQuestionImageOptions(question.options)
                  const diagramAssets = normalizeQuestionDiagramAssets(question)
                  const diagramSelectionKey = questionDiagramSelectionKey(question)
                  const hasDiagramEvidence = hasQuestionDiagramEvidence(question)
                  const selectedDiagramSourceKey = diagramSourceSelections[diagramSelectionKey]
                    || diagramAssets.preferred
                    || (diagramAssets.sources.some((item) => item.key === 'standard') ? 'standard' : diagramAssets.sources[0]?.key || '')
                  const activeDiagramSource = diagramAssets.sources.find((item) => item.key === selectedDiagramSourceKey) || diagramAssets.sources[0]
                  const diagramMetaLabel = String(((activeDiagramSource?.meta as { providerName?: string } | undefined)?.providerName) || '').trim()
                  const canGenerateDiagram = hasDiagramEvidence
                    && Boolean(resolveQuestionRuntimeId(question))
                    && !hasQuestionImageOptions(question.options)
                  const isGeneratingDiagram = Boolean(generatingDiagramKeys[diagramSelectionKey])
                  const solution = buildSolutionSteps(question)
                  const optionAnalyses = normalizedOptionAnalyses(question)
                  const explanationText = isGenericAnalysisText(question.explanation) ? '' : question.explanation
                  const meta = questionKindMeta(question)
                  const completeness = question.analysisCompleteness
                  return (
                    <details
                      id={questionAnchorId(question, index)}
                      key={question.id || index}
                      open={status === 'wrong'}
                      className={`overflow-hidden rounded-xl border bg-white ${status === 'correct' ? 'border-emerald-200' : status === 'wrong' ? 'border-red-200' : 'border-amber-200'}`}
                    >
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-slate-50 px-4 py-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-blue-50 font-semibold text-blue-700">
                            {questionNumber(question, index)}
                          </span>
                          <span className="min-w-0">
                            <strong className="block truncate text-sm">{question.knowledge || '未识别知识点'}</strong>
                            <small className="text-slate-500">{meta.label} · {question.difficulty || '未标注难度'}</small>
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {completeness?.complete === false ? (
                            <Chip size="sm" color="warning" variant="flat">
                              待补全
                            </Chip>
                          ) : null}
                          <Chip size="sm" color={status === 'correct' ? 'success' : status === 'wrong' ? 'danger' : 'warning'} variant="flat">
                            {status === 'correct' ? '正确' : status === 'wrong' ? '错误' : '待确认'}
                          </Chip>
                        </div>
                      </summary>
                      <div className="space-y-4 p-4">
                        {completeness?.complete === false ? (
                          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                            <div>
                              <p className="text-sm font-semibold text-amber-900">本题分析不完整</p>
                              <p className="mt-1 text-sm text-amber-800">
                                {completeness.issues.map((item) => item.label).join('、')}
                              </p>
                            </div>
                            <Button
                              size="sm"
                              color="warning"
                              variant="flat"
                              onPress={() => handleSingleCompletion(question, index)}
                              isDisabled={submitting || ['queued', 'running', 'stopping'].includes(selectedTask?.status || '')}
                            >
                              智能补全本题
                            </Button>
                          </div>
                        ) : null}
                        <div>
                          <p className="text-xs font-semibold text-slate-500">题干与选项</p>
                          <p className="mt-1 text-sm leading-6 text-slate-700">{stripInlineChoiceOptionsFromStem(question, textChoices)}</p>
                          {showTextChoices ? (
                            <div className="mt-3 grid gap-2">
                              {textChoices.map((choice) => (
                                <article key={choice.key} className="grid grid-cols-[32px_1fr] items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                                  <strong className="grid h-7 w-7 place-items-center rounded-full bg-blue-50 text-sm text-blue-700">{choice.key}</strong>
                                  <span className="text-sm leading-6 text-slate-700">{choice.content || '暂无选项内容'}</span>
                                </article>
                              ))}
                            </div>
                          ) : !hasQuestionImageOptions(question.options) ? (
                            <p className="mt-2 text-xs text-slate-500">本题未识别到文字选项。</p>
                          ) : null}
                        </div>
                        <QuestionImageOptions
                          question={question}
                          onGenerate={handleOptionDiagramGenerate}
                          generatingKeys={generatingOptionDiagramKeys}
                          sourceSelections={diagramSourceSelections}
                          onSelectSource={(selectionKey, sourceKey) => setDiagramSourceSelections((current) => ({ ...current, [selectionKey]: sourceKey }))}
                        />
                        {(!shouldSuppressQuestionDiagramPreview(question) && hasDiagramEvidence && (diagramAssets.sources.length > 0 || canGenerateDiagram)) && (
                          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="text-xs font-semibold text-slate-500">原题图参考</p>
                                <p className="mt-1 text-sm text-slate-700">可在剪裁图、讲解示意图和 AI 图之间切换。</p>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                {diagramAssets.sources.map((item) => (
                                  <button
                                    key={`${diagramSelectionKey}-${item.key}`}
                                    type="button"
                                    onClick={() => setDiagramSourceSelections((current) => ({ ...current, [diagramSelectionKey]: item.key }))}
                                    className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${selectedDiagramSourceKey === item.key ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:text-blue-700'}`}
                                  >
                                    {item.label}
                                  </button>
                                ))}
                                <Button
                                  size="sm"
                                  variant="flat"
                                  color="primary"
                                  onPress={() => handleDiagramGenerate(question)}
                                  isDisabled={isGeneratingDiagram || !canGenerateDiagram}
                                >
                                  {isGeneratingDiagram ? '生成中...' : '生成AI图'}
                                </Button>
                              </div>
                            </div>
                            {activeDiagramSource?.url ? (
                              <figure className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
                                <img src={activeDiagramSource.url} alt={activeDiagramSource.label} loading="lazy" className="block max-h-[420px] w-full object-contain" />
                                <figcaption className="border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
                                  {activeDiagramSource.label}
                                  {diagramMetaLabel ? ` · ${diagramMetaLabel}` : ''}
                                </figcaption>
                              </figure>
                            ) : (
                              <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-sm text-slate-500">
                                当前题目还没有可展示的题图来源，但可以继续尝试生成 AI 图。
                              </div>
                            )}
                          </div>
                        )}
                        <div className="grid gap-3 rounded-xl bg-slate-50 p-4 md:grid-cols-3">
                          <p className="text-sm"><strong>{answerDisplay.label}：</strong>{answerDisplay.value}</p>
                          <p className="text-sm"><strong>正确答案：</strong>{question.correctAnswer || '暂无'}</p>
                          <p className="text-sm"><strong>判定依据：</strong>{question.markEvidence || '暂无批改依据'}</p>
                        </div>
                        {question.cause && (
                          <div className="flex gap-2 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
                            <CircleAlert size={18} className="shrink-0" />
                            <p><strong>错因：</strong>{question.cause}</p>
                          </div>
                        )}
                        <div className={`space-y-4 rounded-xl border bg-blue-50/40 p-4 ${meta.kind === 'choice' ? 'border-violet-200' : meta.kind === 'blank' ? 'border-emerald-200' : meta.kind === 'judgement' ? 'border-cyan-200' : meta.kind === 'calculation' ? 'border-orange-200' : meta.kind === 'solution' ? 'border-amber-200' : 'border-blue-100'}`}>
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <h4 className="font-semibold text-blue-800">{meta.resolutionTitle}</h4>
                              <p className="mt-1 text-xs text-slate-500">{meta.label} · {meta.processTitle}</p>
                            </div>
                            {question.correctAnswer && (
                              <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-blue-700">
                                正确答案：{question.correctAnswer}
                              </span>
                            )}
                          </div>
                          {explanationText && (
                            <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700">
                              <strong className="mb-1 block text-slate-700">解析要点</strong>
                              <p>{explanationText}</p>
                            </div>
                          )}
                          {meta.kind !== 'choice' && solution.steps.length ? (
                            <div className="rounded-xl border border-blue-100 bg-white p-4">
                              <p className="mb-3 text-sm font-semibold text-slate-700">
                                {solution.complete ? '正确答案解题步骤' : '解题步骤待补全'}
                              </p>
                              {!solution.complete && (
                                <p className="mb-3 rounded-lg border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                                  当前题目缺少可核验的完整解题步骤，已保留现有解析与答案信息，不能视为完整解法。
                                </p>
                              )}
                              <ol className="grid gap-2">
                                {solution.steps.map((step, stepIndex) => (
                                  <li key={`${stepIndex}-${step}`} className="grid grid-cols-[28px_1fr] gap-3 text-sm leading-6 text-slate-700">
                                    <span className="grid h-7 w-7 place-items-center rounded-lg bg-blue-700 text-xs font-semibold text-white">{stepIndex + 1}</span>
                                    <span>
                                      <span className="block">{step}</span>
                                      {stepDependency(question, step) && (
                                        <small className="mt-1 block text-xs text-slate-500">
                                          依据：<ScientificFormula value={stepDependency(question, step)} displayMode={false} className="inline" />
                                        </small>
                                      )}
                                    </span>
                                  </li>
                                ))}
                              </ol>
                            </div>
                          ) : meta.kind !== 'choice' ? (
                            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                              当前题目没有返回正确答案的解答步骤；请重新分析或人工补录后再作为讲评过程使用。
                            </div>
                          ) : null}
                          {meta.kind === 'choice' && optionAnalyses.length ? (
                            <div>
                              <p className="mb-2 text-sm font-semibold text-slate-700">每个选项分析</p>
                              <div className="grid gap-2">
                                {optionAnalyses.map((item) => (
                                  <article
                                    key={`${item.option}-${item.content}`}
                                    className={`rounded-xl border p-3 text-sm leading-6 ${item.missing ? 'border-amber-200 bg-amber-50' : item.isCorrect ? 'border-emerald-200 bg-emerald-50' : 'border-red-100 bg-red-50/50'}`}
                                  >
                                    <strong>{item.option}{item.isCorrect === true ? ' · 正确' : item.isCorrect === false ? ' · 排除' : ''}</strong>
                                    {item.content && <p>{item.content}</p>}
                                    {item.analysis && <p>{item.analysis}</p>}
                                  </article>
                                ))}
                              </div>
                            </div>
                          ) : meta.kind === 'choice' ? (
                            <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">本题识别为选择题，但缺少可展示的选项分析；请重新分析或人工补录后再用于讲评。</p>
                          ) : (
                            null
                          )}
                        </div>
                      </div>
                    </details>
                  )
                })}
              </CardBody>
            </Card>
          )}

          {knowledgePoints.length > 0 && (
            <Card>
              <CardBody>
                <details>
                  <summary className="cursor-pointer font-semibold text-slate-800">
                    知识点备课资料（{knowledgePoints.length}）
                  </summary>
                  <div className="mt-4 grid gap-3">
                    {knowledgePoints.map((point, index) => (
                      <article key={`${point.name}-${index}`} className="rounded-xl border border-slate-200 p-4">
                        <h4 className="font-medium">{point.name}</h4>
                        {point.definition && <p className="mt-2 text-sm text-slate-600"><strong>定义：</strong>{point.definition}</p>}
                        {point.formula && <ScientificFormula value={point.formula} className="mt-2 rounded-lg bg-slate-50 p-3 text-sm" />}
                        {!point.formula && point.rule && <p className="mt-2 text-sm text-slate-700"><strong>规则：</strong>{point.rule}</p>}
                        {point.mistakeCause && <p className="mt-2 text-sm text-amber-700"><strong>易错点：</strong>{point.mistakeCause}</p>}
                      </article>
                    ))}
                  </div>
                </details>
              </CardBody>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
