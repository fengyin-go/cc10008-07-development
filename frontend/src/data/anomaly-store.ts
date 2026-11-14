import { ANOMALY_SEED } from './anomaly-seed'
import type { AnomalyState } from './anomaly-types'

// 异常检测领域数据独立持久化：与通用模块的 entries 存储分开，互不影响。
const STORAGE_KEY = 'interactive-analytics-lab:anomaly-domain'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): AnomalyState {
  const fallback = clone(ANOMALY_SEED)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    return JSON.parse(raw) as AnomalyState
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: AnomalyState | null = null

export function loadAnomalyState(): AnomalyState {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function saveAnomalyState(state: AnomalyState): void {
  cache = state
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }
}

export function resetAnomalyState(): AnomalyState {
  const fresh = clone(ANOMALY_SEED)
  saveAnomalyState(fresh)
  return fresh
}

/** 单调递增的 id 发生器：前缀 + 时间戳 + 序号，避免与 seed 冲突 */
let sequence = 0
export function nextId(prefix: string): string {
  sequence += 1
  return `${prefix}-${Date.now().toString(36)}-${sequence}`
}
