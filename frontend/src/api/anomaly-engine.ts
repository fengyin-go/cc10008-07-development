import type { AlertLevel } from '@/data/anomaly-types'

/**
 * 判定引擎：全部是纯函数，不碰存储。
 * 静默窗口、阈值比较、截面归属在这里各只有一个实现，
 * 检测、展示、复核都调用同一入口，避免"一处算抑制另一处算告警"。
 */

export const LEVEL_RANK: Record<AlertLevel, number> = { 提示: 1, 警告: 2, 严重: 3 }

const MINUTE_MS = 60_000

/** 本地时间 ISO（不带时区），与 seed、datetime-local 输入保持一致 */
export function toLocalISO(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function parseTime(iso: string): number {
  return new Date(iso).getTime()
}

export function nowISO(): string {
  return toLocalISO(Date.now())
}

/** 采样时间所属截面：[start, start + period)，按周期对齐，迟到样本也按采样时间算 */
export function sectionOf(sampledAt: string, periodMinutes: number): { start: string; end: string } {
  const periodMs = periodMinutes * MINUTE_MS
  const startMs = Math.floor(parseTime(sampledAt) / periodMs) * periodMs
  return { start: toLocalISO(startMs), end: toLocalISO(startMs + periodMs) }
}

/** HH:MM → 当日分钟数 */
function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** 采样时间的当日分钟数 */
function sampledMinutes(sampledAt: string): number {
  const d = new Date(parseTime(sampledAt))
  return d.getHours() * 60 + d.getMinutes()
}

/**
 * 静默窗口唯一判定入口：左闭右开 [start, end)。
 * - 采样时间恰好等于窗口开始 → 窗口内（抑制）
 * - 采样时间恰好等于窗口结束 → 窗口外（告警）
 * - 支持跨零点窗口（如 22:00–06:00）
 * 检测、批次、页面展示都必须走这个函数，保证同一样本在全系统判定一致。
 */
export function inSilenceWindow(sampledAt: string, silenceStart: string, silenceEnd: string): boolean {
  if (!silenceStart || !silenceEnd || silenceStart === silenceEnd) {
    return false
  }
  const start = minutesOfDay(silenceStart)
  const end = minutesOfDay(silenceEnd)
  const t = sampledMinutes(sampledAt)
  if (start < end) {
    return t >= start && t < end
  }
  // 跨零点：[start, 24:00) ∪ [00:00, end)
  return t >= start || t < end
}

/** 采样时间是否恰好落在静默窗口边界上（用于在判定依据里说明口径） */
export function onSilenceBoundary(
  sampledAt: string,
  silenceStart: string,
  silenceEnd: string,
): 'start' | 'end' | null {
  const hhmm = sampledAt.slice(11, 16)
  if (hhmm === silenceStart) return 'start'
  if (hhmm === silenceEnd) return 'end'
  return null
}

export interface JudgeResult {
  hit: boolean
  sigma: number
  /** 是否恰好等于阈值（浮点容差内） */
  onThreshold: boolean
}

/**
 * 阈值判定：|样本值 - 基线均值| / 标准差 ≥ 标准差倍数 判为异常。
 * 边界恰好等于阈值时按"达到阈值即异常"处理，判定依据里会写明。
 */
export function judgeValue(value: number, mean: number, stddev: number, sigmaMultiple: number): JudgeResult {
  const sigma = stddev === 0 ? (value === mean ? 0 : Number.POSITIVE_INFINITY) : Math.abs(value - mean) / stddev
  const onThreshold = Number.isFinite(sigma) && Math.abs(sigma - sigmaMultiple) < 1e-9
  return { hit: sigma >= sigmaMultiple, sigma, onThreshold }
}

/** 由一组观测值计算基线（均值 / 总体标准差） */
export function computeBaseline(values: number[]): { mean: number; stddev: number } {
  if (values.length === 0) {
    return { mean: 0, stddev: 0 }
  }
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
  return { mean: round2(mean), stddev: round2(Math.sqrt(variance)) }
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function formatSigma(sigma: number): string {
  return Number.isFinite(sigma) ? sigma.toFixed(2) : '∞'
}
