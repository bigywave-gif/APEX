import type { AppState } from './types'

export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.error || '请求失败')
  }
  return response.json() as T
}

export function responseState(result: Record<string, unknown>): AppState {
  return (result?.state || result) as AppState
}

export async function loadState(page = 'home'): Promise<AppState> {
  return api<AppState>(`/api/state?page=${encodeURIComponent(page)}`)
}

export async function resetState(keepModels = true): Promise<AppState> {
  return api<AppState>('/api/reset', {
    method: 'POST',
    body: JSON.stringify({ keepModels }),
  })
}

export async function createAnalysisCompletionTask(uploadId: string, payload: Record<string, unknown>) {
  return api(`/api/uploads/${uploadId}/analysis-completions`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function getAnalysisCompletionTask(taskId: string) {
  return api(`/api/analysis-completions/${taskId}`)
}

export async function stopAnalysisCompletionTask(taskId: string) {
  return api(`/api/analysis-completions/${taskId}/stop`, {
    method: 'POST',
  })
}

export async function retryAnalysisCompletionTask(taskId: string) {
  return api(`/api/analysis-completions/${taskId}/retry`, {
    method: 'POST',
  })
}

export async function generateQuestionDiagram(questionId: string, payload: Record<string, unknown> = {}) {
  const optionKey = String(payload?.optionKey || '').trim()
  const query = optionKey ? `?optionKey=${encodeURIComponent(optionKey)}` : ''
  return api(`/api/question-diagrams/${encodeURIComponent(questionId)}/generate${query}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
