import {
  LEVEL_RANK,
  formatSigma,
  inSilenceWindow,
  judgeValue,
  nowISO,
  onSilenceBoundary,
  parseTime,
  round2,
  sectionOf,
  toLocalISO,
} from '@/api/anomaly-engine'
import { loadAnomalyState, nextId, resetAnomalyState, saveAnomalyState } from '@/data/anomaly-store'
import type {
  AlertEvent,
  AlertLevel,
  AnomalyState,
  BaselineVersion,
  DetectionEvidence,
  DetectionRule,
  DetectionRun,
  MetricSample,
  NotifyBatch,
  RuleVersion,
  SilenceVerdict,
  StateLog,
} from '@/data/anomaly-types'
import type { ActionResult } from '@/data/types'

/**
 * 异常检测业务层：所有状态流转只允许在这里发生，页面组件不做业务判断。
 * 判定证据生成后不可变；后续动作（撤回、停用、级别变更、基线发布）只追加新记录。
 */

// ---------- 查询 ----------

export function listRules(): DetectionRule[] {
  return loadAnomalyState().rules
}

export function getRule(ruleId: string): DetectionRule | undefined {
  return loadAnomalyState().rules.find((rule) => rule.id === ruleId)
}

export function listSamples(): MetricSample[] {
  return [...loadAnomalyState().samples].sort((a, b) => a.sampledAt.localeCompare(b.sampledAt))
}

export function listRuns(): DetectionRun[] {
  return [...loadAnomalyState().runs].sort((a, b) => b.judgedAt.localeCompare(a.judgedAt))
}

export function listEvidences(): DetectionEvidence[] {
  return loadAnomalyState().evidences
}

export function evidencesOfRun(runId: string): DetectionEvidence[] {
  return loadAnomalyState().evidences.filter((item) => item.runId === runId)
}

export function listEvents(): AlertEvent[] {
  return [...loadAnomalyState().events].sort((a, b) => b.firstHitAt.localeCompare(a.firstHitAt))
}

export function listBatches(): NotifyBatch[] {
  return [...loadAnomalyState().batches].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function listLogs(): StateLog[] {
  return [...loadAnomalyState().logs].sort((a, b) => b.at.localeCompare(a.at))
}

export function baselinesOf(ruleId: string): BaselineVersion[] {
  return loadAnomalyState()
    .baselines.filter((item) => item.ruleId === ruleId)
    .sort((a, b) => b.version - a.version)
}

export function versionsOf(ruleId: string): RuleVersion[] {
  return loadAnomalyState()
    .ruleVersions.filter((item) => item.ruleId === ruleId)
    .sort((a, b) => b.version - a.version)
}

export function evidencesOfEvent(eventId: string): DetectionEvidence[] {
  return loadAnomalyState().evidences.filter((item) => item.eventId === eventId)
}

export function eventsOfBatch(batchId: string): AlertEvent[] {
  return loadAnomalyState().events.filter((item) => item.batchId === batchId)
}

export function anomalyStats(): { label: string; value: number }[] {
  const state = loadAnomalyState()
  return [
    { label: '检测规则', value: state.rules.length },
    { label: '已启用', value: state.rules.filter((rule) => rule.status === '已启用').length },
    { label: '待发送事件', value: state.events.filter((item) => item.status === '待发送').length },
    { label: '待裁定事件', value: state.events.filter((item) => item.status === '待裁定').length },
    { label: '检测批次', value: state.runs.length },
    { label: '判定证据', value: state.evidences.length },
  ]
}

// ---------- 内部工具 ----------

function ok(message: string): ActionResult {
  return { ok: true, message }
}

function fail(message: string): ActionResult {
  return { ok: false, message }
}

function pushLog(
  state: AnomalyState,
  objectType: StateLog['objectType'],
  objectId: string,
  from: string,
  to: string,
  note: string,
): void {
  state.logs.push({ id: nextId('log'), objectType, objectId, from, to, at: nowISO(), note })
}

function findRule(state: AnomalyState, ruleId: string): DetectionRule | undefined {
  return state.rules.find((rule) => rule.id === ruleId)
}

function latestBaseline(state: AnomalyState, ruleId: string): BaselineVersion | undefined {
  return state.baselines
    .filter((item) => item.ruleId === ruleId)
    .sort((a, b) => b.version - a.version)[0]
}

function nextBatchCode(state: AnomalyState): string {
  const day = nowISO().slice(0, 10).split('-').join('')
  const count = state.batches.filter((batch) => batch.code.includes(day)).length + 1
  return `NB-${day}-${String(count).padStart(4, '0')}`
}

// ---------- 规则生命周期 ----------

export function createRuleDraft(input: {
  metric: string
  target: string
  periodMinutes: number
  sigmaMultiple: number
  level: AlertLevel
  silenceStart: string
  silenceEnd: string
  silenceEscalateLevel: AlertLevel
  channels: string[]
}): ActionResult {
  if (!input.metric.trim() || !input.target.trim()) {
    return fail('监控指标和监控目标不能为空')
  }
  if (input.periodMinutes <= 0 || input.sigmaMultiple <= 0) {
    return fail('检测周期和标准差倍数必须为正数')
  }
  const state = loadAnomalyState()
  const code = `ANOM-${String(state.rules.length + 1).padStart(4, '0')}`
  const now = nowISO()
  const rule: DetectionRule = {
    id: nextId('rule'),
    code,
    metric: input.metric.trim(),
    target: input.target.trim(),
    periodMinutes: input.periodMinutes,
    sigmaMultiple: input.sigmaMultiple,
    level: input.level,
    silenceStart: input.silenceStart,
    silenceEnd: input.silenceEnd,
    silenceEscalateLevel: input.silenceEscalateLevel,
    channels: input.channels,
    status: '草稿',
    version: 1,
    targetDeleted: false,
    createdAt: now,
    updatedAt: now,
  }
  state.rules.push(rule)
  state.ruleVersions.push({
    id: nextId('rv'),
    ruleId: rule.id,
    version: 1,
    level: rule.level,
    sigmaMultiple: rule.sigmaMultiple,
    periodMinutes: rule.periodMinutes,
    reason: '初始版本',
    createdAt: now,
  })
  pushLog(state, '检测规则', rule.id, '—', '草稿', `登记检测规则 ${code}，保存为草稿`)
  saveAnomalyState(state)
  return ok(`检测规则 ${code} 已保存为草稿${rule.channels.length === 0 ? '（未配置通知渠道，可存草稿但不能启用）' : ''}`)
}

export function submitRule(ruleId: string): ActionResult {
  const state = loadAnomalyState()
  const rule = findRule(state, ruleId)
  if (!rule) return fail('检测规则不存在')
  if (rule.status !== '草稿') return fail(`当前状态为「${rule.status}」，只有草稿可以提交校验`)
  rule.status = '待校验'
  rule.updatedAt = nowISO()
  pushLog(state, '检测规则', rule.id, '草稿', '待校验', '提交校验')
  saveAnomalyState(state)
  return ok(`检测规则 ${rule.code} 已提交校验`)
}

export function enableRule(ruleId: string): ActionResult {
  const state = loadAnomalyState()
  const rule = findRule(state, ruleId)
  if (!rule) return fail('检测规则不存在')
  if (rule.status !== '待校验') return fail(`当前状态为「${rule.status}」，只有待校验可以启用`)
  if (rule.channels.length === 0) {
    return fail('未配置通知渠道的检测规则可以保存草稿，但不能启用；请先补配通知渠道')
  }
  if (rule.targetDeleted) {
    return fail('监控目标已删除，不能启用该规则')
  }
  rule.status = '已启用'
  rule.updatedAt = nowISO()
  pushLog(state, '检测规则', rule.id, '待校验', '已启用', '通知渠道已配置，启用检测')
  saveAnomalyState(state)
  return ok(`检测规则 ${rule.code} 已启用`)
}

export function pauseRule(ruleId: string): ActionResult {
  const state = loadAnomalyState()
  const rule = findRule(state, ruleId)
  if (!rule) return fail('检测规则不存在')
  if (rule.status !== '已启用') return fail(`当前状态为「${rule.status}」，只有已启用可以暂停`)
  rule.status = '已暂停'
  rule.updatedAt = nowISO()
  pushLog(state, '检测规则', rule.id, '已启用', '已暂停', '暂停检测，历史判定保留')
  saveAnomalyState(state)
  return ok(`检测规则 ${rule.code} 已暂停`)
}

export function resumeRule(ruleId: string): ActionResult {
  const state = loadAnomalyState()
  const rule = findRule(state, ruleId)
  if (!rule) return fail('检测规则不存在')
  if (rule.status !== '已暂停') return fail(`当前状态为「${rule.status}」，只有已暂停可以恢复`)
  rule.status = '待校验'
  rule.updatedAt = nowISO()
  pushLog(state, '检测规则', rule.id, '已暂停', '待校验', '暂停后恢复，回到待校验；历史判定保留，重新校验后可启用')
  saveAnomalyState(state)
  return ok(`检测规则 ${rule.code} 已恢复，回到待校验，历史判定保留`)
}

/** 停用规则：待发送事件一并撤回，检测证据保留 */
export function disableRule(ruleId: string): ActionResult {
  const state = loadAnomalyState()
  const rule = findRule(state, ruleId)
  if (!rule) return fail('检测规则不存在')
  if (rule.status === '已停用') return fail('检测规则已是已停用')
  const from = rule.status
  rule.status = '已停用'
  rule.updatedAt = nowISO()
  let withdrawn = 0
  for (const event of state.events) {
    if (event.ruleId === ruleId && event.status === '待发送') {
      event.status = '已撤回'
      withdrawn += 1
      pushLog(state, '告警事件', event.id, '待发送', '已撤回', `规则 ${rule.code} 停用，待发送事件撤回；检测证据保留`)
    }
  }
  for (const batch of state.batches) {
    if (batch.status !== '待发送') continue
    const batchEvents = state.events.filter((item) => item.batchId === batch.id)
    if (batchEvents.length > 0 && batchEvents.every((item) => item.status === '已撤回')) {
      batch.status = '已撤回'
      batch.withdrawnAt = nowISO()
      batch.withdrawReason = `规则 ${rule.code} 停用，批次一并撤回`
      pushLog(state, '通知批次', batch.id, '待发送', '已撤回', batch.withdrawReason)
    }
  }
  pushLog(state, '检测规则', rule.id, from, '已停用', withdrawn > 0 ? `停用检测，撤回 ${withdrawn} 个待发送事件` : '停用检测')
  saveAnomalyState(state)
  return ok(withdrawn > 0 ? `检测规则 ${rule.code} 已停用，${withdrawn} 个待发送事件已撤回，检测证据保留` : `检测规则 ${rule.code} 已停用`)
}

/** 监控目标删除：历史检测可复核，禁止创建新判定 */
export function deleteTarget(ruleId: string): ActionResult {
  const state = loadAnomalyState()
  const rule = findRule(state, ruleId)
  if (!rule) return fail('检测规则不存在')
  if (rule.targetDeleted) return fail('监控目标已经是删除状态')
  rule.targetDeleted = true
  rule.updatedAt = nowISO()
  pushLog(state, '检测规则', rule.id, '—', '目标已删除', `监控目标 ${rule.target} 已删除：历史检测可复核，禁止创建新判定`)
  saveAnomalyState(state)
  return ok(`监控目标 ${rule.target} 已标记删除，历史检测仍可复核`)
}

/** 变更告警级别：生成新的检测版本，历史命中样本仍记录原级别 */
export function changeLevel(ruleId: string, level: AlertLevel, reason: string): ActionResult {
  const state = loadAnomalyState()
  const rule = findRule(state, ruleId)
  if (!rule) return fail('检测规则不存在')
  if (rule.level === level) return fail(`告警级别已经是「${level}」，无需变更`)
  const from = rule.level
  rule.level = level
  rule.version += 1
  rule.updatedAt = nowISO()
  state.ruleVersions.push({
    id: nextId('rv'),
    ruleId: rule.id,
    version: rule.version,
    level: rule.level,
    sigmaMultiple: rule.sigmaMultiple,
    periodMinutes: rule.periodMinutes,
    reason: reason.trim() || `告警级别由「${from}」调整为「${level}」`,
    createdAt: nowISO(),
  })
  pushLog(state, '检测规则', rule.id, `级别 ${from}`, `级别 ${level}`, `生成检测版本 v${rule.version}，历史命中样本仍记录原级别`)
  saveAnomalyState(state)
  return ok(`告警级别已变更为「${level}」，生成检测版本 v${rule.version}，历史命中样本仍按原级别复核`)
}

/** 发布新基线：之后的判定用新口径，历史证据保持原判定口径 */
export function publishBaseline(ruleId: string, mean: number, stddev: number, sampleCount: number): ActionResult {
  const state = loadAnomalyState()
  const rule = findRule(state, ruleId)
  if (!rule) return fail('检测规则不存在')
  if (stddev < 0) return fail('标准差不能为负数')
  const version = latestBaseline(state, ruleId) ? latestBaseline(state, ruleId)!.version + 1 : 1
  const baseline: BaselineVersion = {
    id: nextId('bl'),
    ruleId,
    version,
    mean: round2(mean),
    stddev: round2(stddev),
    sampleCount,
    publishedAt: nowISO(),
  }
  state.baselines.push(baseline)
  pushLog(state, '基线', baseline.id, `v${version - 1 || '—'}`, `v${version}`, `规则 ${rule.code} 发布基线 v${version}：均值 ${baseline.mean}，标准差 ${baseline.stddev}；历史证据保持原判定口径`)
  saveAnomalyState(state)
  return ok(`基线 v${version} 已发布（均值 ${baseline.mean}，标准差 ${baseline.stddev}），历史证据仍按原口径复核`)
}

// ---------- 样本接入 ----------

export function ingestSample(input: {
  ruleId: string
  value: number
  sampledAt: string
  frequencySeconds: number
}): ActionResult {
  const state = loadAnomalyState()
  const rule = findRule(state, input.ruleId)
  if (!rule) return fail('检测规则不存在')
  if (!input.sampledAt) return fail('采样时间不能为空')
  if (input.frequencySeconds <= 0) return fail('采样频率必须为正数')
  const section = sectionOf(input.sampledAt, rule.periodMinutes)
  // 迟到判定：采样所属截面已结算 → 不回填历史告警，转入下一截面留证
  const late = state.runs.some((run) => run.ruleId === rule.id && run.sectionStart === section.start)
  const sample: MetricSample = {
    id: nextId('smp'),
    metric: rule.metric,
    target: rule.target,
    value: input.value,
    sampledAt: input.sampledAt,
    arrivedAt: nowISO(),
    frequencySeconds: input.frequencySeconds,
    late,
  }
  state.samples.push(sample)
  saveAnomalyState(state)
  if (late) {
    return ok(`样本已接入：采样时间 ${input.sampledAt} 属于已结算截面 [${section.start}, ${section.end})，标记为迟到样本，将转入下一截面留证，不回填历史告警`)
  }
  return ok(`样本已接入，归属截面 [${section.start}, ${section.end})`)
}

// ---------- 检测执行 ----------

/** 当前截面之前连续异常截面数（用于"连续两个周期都异常"的判定依据） */
function consecutiveAbnormalBefore(state: AnomalyState, ruleId: string, sectionStartMs: number, periodMs: number): number {
  let count = 0
  let cursor = sectionStartMs - periodMs
  for (;;) {
    const start = toLocalISO(cursor)
    const hit = state.evidences.some(
      (item) => item.ruleId === ruleId && item.sectionStart === start && item.verdict === '异常',
    )
    if (!hit) return count
    count += 1
    cursor -= periodMs
  }
}

function buildReason(parts: string[]): string {
  return parts.filter((part) => part !== '').join('；')
}

export function runDetection(ruleId: string): ActionResult {
  const state = loadAnomalyState()
  const rule = findRule(state, ruleId)
  if (!rule) return fail('检测规则不存在')
  if (rule.status !== '已启用') return fail(`检测规则当前状态为「${rule.status}」，只有已启用才能执行检测`)
  if (rule.targetDeleted) return fail('监控目标已删除：历史检测可复核，但不能创建新的判定')
  const baseline = latestBaseline(state, ruleId)
  if (!baseline) return fail('尚未发布基线，无法执行检测')

  const judgedSampleIds = new Set(state.evidences.map((item) => item.sampleId))
  const ruleSamples = state.samples.filter((item) => item.metric === rule.metric && item.target === rule.target)
  const pendingNormal = ruleSamples.filter((item) => !item.late && !judgedSampleIds.has(item.id))
  const pendingLate = ruleSamples.filter((item) => item.late && !judgedSampleIds.has(item.id))
  if (pendingNormal.length === 0 && pendingLate.length === 0) {
    return fail('没有待判定的样本')
  }

  // 本次判定的截面：正常样本中最早的未判定截面；采样时间晚于该截面的样本留待下一截面
  const periodMs = rule.periodMinutes * 60_000
  let sectionStartMs: number
  if (pendingNormal.length > 0) {
    sectionStartMs = Math.min(...pendingNormal.map((item) => parseTime(sectionOf(item.sampledAt, rule.periodMinutes).start)))
  } else {
    sectionStartMs = parseTime(sectionOf(pendingLate.map((item) => item.arrivedAt).sort()[0], rule.periodMinutes).start)
  }
  const sectionStart = toLocalISO(sectionStartMs)
  const sectionEnd = toLocalISO(sectionStartMs + periodMs)

  // 幂等：同规则同截面只判定一次，同一事件不会重复生成告警
  if (state.runs.some((run) => run.ruleId === ruleId && run.sectionStart === sectionStart)) {
    return fail(`截面 [${sectionStart}, ${sectionEnd}) 已判定过，同一事件不会重复生成告警`)
  }

  const inSection = pendingNormal.filter((item) => {
    const t = parseTime(item.sampledAt)
    return t >= sectionStartMs && t < sectionStartMs + periodMs
  })
  const deferred = pendingNormal.length - inSection.length
  const now = nowISO()
  const run: DetectionRun = {
    id: nextId('run'),
    ruleId,
    ruleVersion: rule.version,
    baselineVersion: baseline.version,
    sectionStart,
    sectionEnd,
    judgedAt: now,
    sampleCount: inSection.length + pendingLate.length,
    hitCount: 0,
  }

  const newEvidences: DetectionEvidence[] = []
  const streakBase = consecutiveAbnormalBefore(state, ruleId, sectionStartMs, periodMs)

  // 同一指标不同采样频率：先按各自频率分组判定，命中再合并到同一事件与通知批次
  const byFrequency = new Map<number, MetricSample[]>()
  for (const sample of inSection) {
    const group = byFrequency.get(sample.frequencySeconds) ?? []
    group.push(sample)
    byFrequency.set(sample.frequencySeconds, group)
  }

  for (const [frequency, samples] of [...byFrequency.entries()].sort((a, b) => a[0] - b[0])) {
    for (const sample of samples) {
      const { hit, sigma, onThreshold } = judgeValue(sample.value, baseline.mean, baseline.stddev, rule.sigmaMultiple)
      const parts: string[] = []
      if (!hit) {
        parts.push(
          `偏差 ${formatSigma(sigma)}σ 未达阈值 ${rule.sigmaMultiple}σ（基线 v${baseline.version}：均值 ${baseline.mean}，标准差 ${baseline.stddev}），判为正常`,
        )
      } else if (onThreshold) {
        parts.push(
          `偏差恰好等于阈值（${formatSigma(sigma)}σ = ${rule.sigmaMultiple}σ），按「达到阈值即判异常」口径判为异常（基线 v${baseline.version}：均值 ${baseline.mean}，标准差 ${baseline.stddev}）`,
        )
      } else {
        parts.push(
          `偏差 ${formatSigma(sigma)}σ 超过阈值 ${rule.sigmaMultiple}σ（基线 v${baseline.version}：均值 ${baseline.mean}，标准差 ${baseline.stddev}），判为异常`,
        )
      }
      parts.push(`按采样频率 ${frequency}s 分组判定`)

      let silence: SilenceVerdict = '窗口外'
      if (hit) {
        if (streakBase > 0) {
          parts.push(`上一截面同为异常，本截面为连续第 ${streakBase + 1} 个异常周期，各周期独立判定、分别留证`)
        }
        const inSilence = inSilenceWindow(sample.sampledAt, rule.silenceStart, rule.silenceEnd)
        const boundary = onSilenceBoundary(sample.sampledAt, rule.silenceStart, rule.silenceEnd)
        if (inSilence) {
          const needAdjudicate = LEVEL_RANK[rule.level] >= LEVEL_RANK[rule.silenceEscalateLevel]
          silence = needAdjudicate ? '窗口内待裁定' : '窗口内抑制'
          parts.push(
            needAdjudicate
              ? `采样时间落入静默窗口 [${rule.silenceStart}, ${rule.silenceEnd})，级别「${rule.level}」达到裁定级别「${rule.silenceEscalateLevel}」，单独裁定而非直接丢弃`
              : `采样时间落入静默窗口 [${rule.silenceStart}, ${rule.silenceEnd})，级别「${rule.level}」低于裁定级别「${rule.silenceEscalateLevel}」，窗口内抑制`,
          )
          if (boundary === 'start') {
            parts.push('采样时间恰好等于静默窗口开始，按 [开始, 结束) 口径判为窗口内')
          }
        } else {
          parts.push('采样时间在静默窗口外，正常告警')
          if (boundary === 'end') {
            parts.push('采样时间恰好等于静默窗口结束，按 [开始, 结束) 口径判为窗口外')
          }
        }
      }

      newEvidences.push({
        id: nextId('ev'),
        runId: run.id,
        ruleId,
        ruleVersion: rule.version,
        baselineVersion: baseline.version,
        baselineMean: baseline.mean,
        baselineStddev: baseline.stddev,
        sigmaMultiple: rule.sigmaMultiple,
        level: rule.level,
        sectionStart,
        sampleId: sample.id,
        sampleValue: sample.value,
        sampledAt: sample.sampledAt,
        frequencySeconds: frequency,
        deviationSigma: Number.isFinite(sigma) ? round2(sigma) : 999,
        verdict: hit ? '异常' : '正常',
        reason: buildReason(parts),
        silence,
        channelMissing: rule.channels.length === 0,
        eventId: null,
      })
    }
  }

  // 迟到样本：采样时间属于已结算截面，不回填历史告警，转入本截面留证，不重复生成告警事件
  for (const sample of pendingLate) {
    const { sigma } = judgeValue(sample.value, baseline.mean, baseline.stddev, rule.sigmaMultiple)
    const origin = sectionOf(sample.sampledAt, rule.periodMinutes)
    newEvidences.push({
      id: nextId('ev'),
      runId: run.id,
      ruleId,
      ruleVersion: rule.version,
      baselineVersion: baseline.version,
      baselineMean: baseline.mean,
      baselineStddev: baseline.stddev,
      sigmaMultiple: rule.sigmaMultiple,
      level: rule.level,
      sectionStart,
      sampleId: sample.id,
      sampleValue: sample.value,
      sampledAt: sample.sampledAt,
      frequencySeconds: sample.frequencySeconds,
      deviationSigma: Number.isFinite(sigma) ? round2(sigma) : 999,
      verdict: '迟到留证',
      reason: buildReason([
        `样本迟到：采样时间 ${sample.sampledAt} 属于已结算截面 [${origin.start}, ${origin.end})，到达时间 ${sample.arrivedAt} 晚于该截面判定时刻`,
        '不回填上一告警，转入本截面留证',
        `按当前基线 v${baseline.version} 偏差 ${formatSigma(sigma)}σ 仅记录，不重复生成告警事件`,
      ]),
      silence: '窗口外',
      channelMissing: rule.channels.length === 0,
      eventId: null,
    })
  }

  // 命中样本归集为告警事件：eventKey = 规则 + 截面起点，同一事件只生成一次告警
  const hitEvidences = newEvidences.filter((item) => item.verdict === '异常')
  let event: AlertEvent | null = null
  let batch: NotifyBatch | null = null
  if (hitEvidences.length > 0) {
    const eventKey = `${ruleId}#${sectionStart}`
    event = state.events.find((item) => item.eventKey === eventKey) ?? null
    if (!event) {
      const hasOutside = hitEvidences.some((item) => item.silence === '窗口外')
      const hasPending = hitEvidences.some((item) => item.silence === '窗口内待裁定')
      event = {
        id: nextId('evt'),
        eventKey,
        ruleId,
        level: rule.level,
        status: hasOutside ? '待发送' : hasPending ? '待裁定' : '已抑制',
        sectionStart,
        firstHitAt: now,
        batchId: null,
        adjudication: null,
      }
      state.events.push(event)
      pushLog(
        state,
        '告警事件',
        event.id,
        '—',
        event.status,
        event.status === '待发送'
          ? `截面 [${sectionStart}, ${sectionEnd}) 命中 ${hitEvidences.length} 条样本，生成告警事件`
          : event.status === '待裁定'
            ? '静默窗口内出现达到裁定级别的事件，转单独裁定'
            : '命中样本全部落入静默窗口，窗口内抑制',
      )
    }
    for (const evidence of hitEvidences) {
      evidence.eventId = event.id
    }
    // 待发送事件合并为一个通知批次（多频率命中合并通知）
    if (event.status === '待发送') {
      batch = {
        id: nextId('bat'),
        code: nextBatchCode(state),
        channels: [...rule.channels],
        eventIds: [event.id],
        status: '待发送',
        createdAt: now,
        sentAt: null,
        withdrawnAt: null,
        withdrawReason: null,
      }
      event.batchId = batch.id
      state.batches.push(batch)
      pushLog(state, '通知批次', batch.id, '—', '待发送', `命中样本合并为通知批次 ${batch.code}${rule.channels.length === 0 ? '；当前缺少通知渠道，发送前需补配' : ''}`)
    }
  }

  run.hitCount = hitEvidences.length
  state.runs.push(run)
  state.evidences.push(...newEvidences)
  saveAnomalyState(state)

  const summary = [
    `截面 [${sectionStart}, ${sectionEnd}) 判定完成：样本 ${inSection.length} 条，命中 ${hitEvidences.length} 条`,
    pendingLate.length > 0 ? `迟到留证 ${pendingLate.length} 条（不回填历史告警）` : '',
    deferred > 0 ? `${deferred} 条样本采样时间晚于本截面，留待下一截面` : '',
    event ? `事件状态「${event.status}」` : '未产生告警事件',
    batch ? `通知批次 ${batch.code} 待发送` : '',
  ]
  return ok(summary.filter((part) => part !== '').join('；'))
}

// ---------- 事件裁定与通知批次 ----------

/** 静默窗口内高级别事件的单独裁定：升级发送或维持抑制 */
export function adjudicateEvent(eventId: string, decision: '升级发送' | '维持抑制'): ActionResult {
  const state = loadAnomalyState()
  const event = state.events.find((item) => item.id === eventId)
  if (!event) return fail('告警事件不存在')
  if (event.status !== '待裁定') return fail(`事件当前状态为「${event.status}」，只有待裁定可以裁定`)
  const rule = findRule(state, event.ruleId)
  const now = nowISO()
  if (decision === '维持抑制') {
    event.status = '已抑制'
    event.adjudication = `操作员裁定：维持静默窗口抑制（${now}）`
    pushLog(state, '告警事件', event.id, '待裁定', '已抑制', '裁定结论：维持抑制，不发送通知')
    saveAnomalyState(state)
    return ok('已裁定维持抑制，事件不发送通知')
  }
  event.status = '待发送'
  event.adjudication = `操作员裁定：静默窗口内升级为告警（${now}）`
  const batch: NotifyBatch = {
    id: nextId('bat'),
    code: nextBatchCode(state),
    channels: rule ? [...rule.channels] : [],
    eventIds: [event.id],
    status: '待发送',
    createdAt: now,
    sentAt: null,
    withdrawnAt: null,
    withdrawReason: null,
  }
  event.batchId = batch.id
  state.batches.push(batch)
  pushLog(state, '告警事件', event.id, '待裁定', '待发送', '裁定结论：升级为告警，进入待发送队列')
  pushLog(state, '通知批次', batch.id, '—', '待发送', `裁定升级后生成通知批次 ${batch.code}`)
  saveAnomalyState(state)
  return ok(`已裁定升级为告警，生成通知批次 ${batch.code}`)
}

export function sendBatch(batchId: string): ActionResult {
  const state = loadAnomalyState()
  const batch = state.batches.find((item) => item.id === batchId)
  if (!batch) return fail('通知批次不存在')
  if (batch.status !== '待发送') return fail(`批次当前状态为「${batch.status}」，只有待发送可以发送`)
  if (batch.channels.length === 0) return fail('通知批次缺少通知渠道，无法发送；检测证据已保留并标出缺少的渠道')
  const now = nowISO()
  batch.status = '已发送'
  batch.sentAt = now
  for (const event of state.events) {
    if (event.batchId === batchId && event.status === '待发送') {
      event.status = '已发送'
      pushLog(state, '告警事件', event.id, '待发送', '已发送', `随通知批次 ${batch.code} 发送`)
    }
  }
  pushLog(state, '通知批次', batch.id, '待发送', '已发送', `批次 ${batch.code} 经渠道 ${batch.channels.join('、')} 发送`)
  saveAnomalyState(state)
  return ok(`通知批次 ${batch.code} 已发送`)
}

/** 撤回通知批次：检测证据、基线值、命中样本仍保留在原批次可查看，事件不重回待发送队列 */
export function withdrawBatch(batchId: string, reason: string): ActionResult {
  const state = loadAnomalyState()
  const batch = state.batches.find((item) => item.id === batchId)
  if (!batch) return fail('通知批次不存在')
  if (batch.status === '已撤回') return fail('批次已撤回，不能重复操作')
  const from = batch.status
  const note = reason.trim() || '操作员撤回'
  const now = nowISO()
  batch.status = '已撤回'
  batch.withdrawnAt = now
  batch.withdrawReason = note
  for (const event of state.events) {
    if (event.batchId === batchId && (event.status === '待发送' || event.status === '已发送')) {
      event.status = '已撤回'
      pushLog(state, '告警事件', event.id, from === '已发送' ? '已发送' : '待发送', '已撤回', `随通知批次 ${batch.code} 一并撤回；事件不重回待发送队列`)
    }
  }
  pushLog(state, '通知批次', batch.id, from, '已撤回', `${note}；检测证据保留，可在原批次查看`)
  saveAnomalyState(state)
  return ok(`通知批次 ${batch.code} 已撤回；检测证据、基线值、命中样本仍可在原批次查看，事件不会重新进入待发送队列`)
}

// ---------- 重置 ----------

export function resetAnomaly(): ActionResult {
  resetAnomalyState()
  return ok('异常检测演示数据已重置')
}
