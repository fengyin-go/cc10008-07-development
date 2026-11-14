import { Fragment, useEffect, useState } from 'react'

import { evidencesOfRun, listBatches, listEvents, listRules, listRuns } from '@/api/anomaly-service'
import type { AlertEvent, DetectionEvidence, DetectionRun, NotifyBatch } from '@/data/anomaly-types'

import { Badge, EmptyRow, toneOf } from './components'

/** 证据卡片：判定依据、基线快照、静默判定、关联事件与批次集中展示 */
export function EvidenceCard({
  evidence,
  event,
  batch,
}: {
  evidence: DetectionEvidence
  event: AlertEvent | null
  batch: NotifyBatch | null
}) {
  return (
    <div className="evidence-card">
      <div className="evidence-head">
        <strong>样本值 {evidence.sampleValue}</strong>
        <span className="muted-text">采样时间 {evidence.sampledAt}</span>
        <span className="muted-text">频率 {evidence.frequencySeconds}s</span>
        <Badge text={`偏差 ${evidence.deviationSigma}σ`} tone={evidence.verdict === '异常' ? 'bad' : 'muted'} />
        <Badge text={evidence.verdict} tone={toneOf(evidence.verdict)} />
        <Badge text={evidence.silence} tone={toneOf(evidence.silence)} />
        <Badge text={`级别 ${evidence.level}`} tone={toneOf(evidence.level)} />
        {evidence.channelMissing && <Badge text="缺少通知渠道" tone="warn" />}
      </div>
      <p className="evidence-reason">判定依据：{evidence.reason}</p>
      <div className="evidence-meta">
        <span>
          基线快照 v{evidence.baselineVersion}：均值 {evidence.baselineMean}，标准差 {evidence.baselineStddev}，阈值{' '}
          {evidence.sigmaMultiple}σ
        </span>
        <span>检测版本 v{evidence.ruleVersion}</span>
        <span>
          关联事件：{event ? `${event.id}（${event.status}）` : '—'}
          {batch ? `；通知批次：${batch.code}（${batch.status}）` : ''}
        </span>
      </div>
    </div>
  )
}

export default function RunPanel({ token }: { token: number }) {
  const [runs, setRuns] = useState<DetectionRun[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [ruleMap, setRuleMap] = useState(new Map<string, string>())
  const [eventMap, setEventMap] = useState(new Map<string, AlertEvent>())
  const [batchMap, setBatchMap] = useState(new Map<string, NotifyBatch>())

  useEffect(() => {
    setRuns(listRuns())
    setRuleMap(new Map(listRules().map((rule) => [rule.id, `${rule.code}（${rule.metric} / ${rule.target}）`])))
    setEventMap(new Map(listEvents().map((event) => [event.id, event])))
    setBatchMap(new Map(listBatches().map((batch) => [batch.id, batch])))
  }, [token])

  return (
    <div>
      <p className="panel-desc">
        每个检测批次对应一个判定截面，同规则同截面只判定一次。展开批次可复核每条证据的判定依据、基线快照与关联的通知批次；批次撤回后证据仍在原处。
      </p>
      <table className="data-table">
        <thead>
          <tr>
            <th>批次</th>
            <th>检测规则</th>
            <th>判定截面</th>
            <th>判定时间</th>
            <th>样本数</th>
            <th>命中数</th>
            <th>检测版本</th>
            <th>基线版本</th>
            <th>证据</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const evidences = expanded === run.id ? evidencesOfRun(run.id) : []
            return (
              <Fragment key={run.id}>
                <tr>
                  <td className="mono">{run.id}</td>
                  <td>{ruleMap.get(run.ruleId) ?? run.ruleId}</td>
                  <td>
                    [{run.sectionStart.slice(5, 16)}, {run.sectionEnd.slice(5, 16)})
                  </td>
                  <td>{run.judgedAt}</td>
                  <td>{run.sampleCount}</td>
                  <td>{run.hitCount > 0 ? <Badge text={`${run.hitCount} 条`} tone="bad" /> : '0'}</td>
                  <td>v{run.ruleVersion}</td>
                  <td>v{run.baselineVersion}</td>
                  <td>
                    <button
                      className="link"
                      type="button"
                      onClick={() => setExpanded((current) => (current === run.id ? null : run.id))}
                    >
                      {expanded === run.id ? '收起证据' : '查看证据'}
                    </button>
                  </td>
                </tr>
                {expanded === run.id && (
                  <tr>
                    <td colSpan={9} className="detail-block">
                      {evidences.map((evidence) => {
                        const event = evidence.eventId ? eventMap.get(evidence.eventId) ?? null : null
                        const batch = event?.batchId ? batchMap.get(event.batchId) ?? null : null
                        return <EvidenceCard key={evidence.id} evidence={evidence} event={event} batch={batch} />
                      })}
                      {evidences.length === 0 && <p className="muted-text">该批次没有证据记录</p>}
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
          {runs.length === 0 && <EmptyRow colSpan={9}>暂无检测批次，到「检测规则」对已启用规则执行检测</EmptyRow>}
        </tbody>
      </table>
    </div>
  )
}
