/**
 * 异常检测领域模型。
 * 设计原则：判定证据（evidence）一旦生成就不可变，基线值、告警级别、判定口径
 * 都以快照形式留在证据里，后续基线升级、级别变更、通知撤回都不影响历史复核。
 */

export type AlertLevel = '提示' | '警告' | '严重'

/** 检测规则生命周期：草稿 → 待校验 → 已启用 ⇄ 已暂停（恢复回到待校验）→ 已停用 */
export type RuleStatus = '草稿' | '待校验' | '已启用' | '已暂停' | '已停用'

/** 判定结论：迟到样本只留证不告警，与正常/异常区分 */
export type Verdict = '正常' | '异常' | '迟到留证'

/** 静默窗口判定结果，由引擎唯一入口给出，全系统口径一致 */
export type SilenceVerdict = '窗口外' | '窗口内抑制' | '窗口内待裁定'

/** 告警事件状态：已撤回是终态，不会重新回到待发送 */
export type EventStatus = '待发送' | '已发送' | '已撤回' | '已抑制' | '待裁定'

export type BatchStatus = '待发送' | '已发送' | '已撤回'

export interface DetectionRule {
  id: string
  code: string
  metric: string
  target: string
  periodMinutes: number
  sigmaMultiple: number
  level: AlertLevel
  /** 每日静默窗口，HH:MM；判定口径为 [start, end) 左闭右开，支持跨零点 */
  silenceStart: string
  silenceEnd: string
  /** 静默窗口内达到该级别的事件不直接丢弃，转单独裁定 */
  silenceEscalateLevel: AlertLevel
  /** 通知渠道，可为空：空渠道允许保存草稿但不允许启用 */
  channels: string[]
  status: RuleStatus
  /** 检测版本：告警级别等判定口径变更时 +1，历史命中样本仍记录原级别 */
  version: number
  /** 监控目标被删除后：历史检测可复核，禁止创建新判定 */
  targetDeleted: boolean
  createdAt: string
  updatedAt: string
}

/** 检测版本快照：每次判定口径（级别/倍数/周期）变更留痕 */
export interface RuleVersion {
  id: string
  ruleId: string
  version: number
  level: AlertLevel
  sigmaMultiple: number
  periodMinutes: number
  reason: string
  createdAt: string
}

/** 基线版本：新基线发布后，历史证据仍保持原判定口径 */
export interface BaselineVersion {
  id: string
  ruleId: string
  version: number
  mean: number
  stddev: number
  sampleCount: number
  publishedAt: string
}

export interface MetricSample {
  id: string
  metric: string
  target: string
  value: number
  /** 采样时间：决定样本归属哪个检测截面，晚于当前批次的进入下一截面 */
  sampledAt: string
  /** 到达时间：晚于其采样所属截面的判定时刻即为迟到样本 */
  arrivedAt: string
  /** 采样频率（秒）：同一指标不同频率先按各自周期分组判定，再合并通知 */
  frequencySeconds: number
  /** 迟到标记：到达时其采样所属截面已结算，不回填历史告警 */
  late: boolean
}

/** 检测批次：一次判定截面 [sectionStart, sectionEnd)，同规则同截面幂等 */
export interface DetectionRun {
  id: string
  ruleId: string
  ruleVersion: number
  baselineVersion: number
  sectionStart: string
  sectionEnd: string
  judgedAt: string
  sampleCount: number
  hitCount: number
}

/** 检测证据：每条样本一条，不可变，解释"为什么告警/为什么没告警" */
export interface DetectionEvidence {
  id: string
  runId: string
  ruleId: string
  ruleVersion: number
  baselineVersion: number
  /** 判定时刻的基线快照：新基线发布后历史证据仍按此口径复核 */
  baselineMean: number
  baselineStddev: number
  sigmaMultiple: number
  /** 判定时刻的告警级别快照：级别变更后历史命中样本仍记录原级别 */
  level: AlertLevel
  sectionStart: string
  sampleId: string
  sampleValue: number
  sampledAt: string
  frequencySeconds: number
  deviationSigma: number
  verdict: Verdict
  /** 判定依据：边界等于阈值、迟到、连续异常等情形分别说明 */
  reason: string
  silence: SilenceVerdict
  /** 判定时刻规则缺少通知渠道的标记 */
  channelMissing: boolean
  eventId: string | null
}

/** 告警事件：按 eventKey 去重，同一事件重复出现只生成一次告警 */
export interface AlertEvent {
  id: string
  /** 去重键：规则 + 截面起点 */
  eventKey: string
  ruleId: string
  level: AlertLevel
  status: EventStatus
  sectionStart: string
  firstHitAt: string
  batchId: string | null
  /** 静默窗口内高级别事件的裁定结论 */
  adjudication: string | null
}

/** 通知批次：撤回后检测证据仍保留，可在原批次查看 */
export interface NotifyBatch {
  id: string
  code: string
  channels: string[]
  eventIds: string[]
  status: BatchStatus
  createdAt: string
  sentAt: string | null
  withdrawnAt: string | null
  withdrawReason: string | null
}

/** 状态变更日志：生命周期推进、撤回、裁定全部留痕 */
export interface StateLog {
  id: string
  objectType: '检测规则' | '告警事件' | '通知批次' | '基线'
  objectId: string
  from: string
  to: string
  at: string
  note: string
}

export interface AnomalyState {
  rules: DetectionRule[]
  ruleVersions: RuleVersion[]
  baselines: BaselineVersion[]
  samples: MetricSample[]
  runs: DetectionRun[]
  evidences: DetectionEvidence[]
  events: AlertEvent[]
  batches: NotifyBatch[]
  logs: StateLog[]
}
