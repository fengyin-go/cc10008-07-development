import { useEffect, useState } from 'react'

import { nowISO, sectionOf } from '@/api/anomaly-engine'
import { ingestSample, listEvidences, listRules, listSamples } from '@/api/anomaly-service'
import type { DetectionRule, MetricSample } from '@/data/anomaly-types'
import type { ActionResult } from '@/data/types'

import { Badge, EmptyRow, toneOf } from './components'

type PanelProps = {
  token: number
  onDone: (result: ActionResult) => void
}

/** 样本在判定链路中的位置：待判定 / 已判定 / 迟到待留证 / 迟到已留证 */
function sampleStage(sample: MetricSample, judgedIds: Set<string>): string {
  const judged = judgedIds.has(sample.id)
  if (judged && sample.late) return '迟到已留证'
  if (judged) return '已判定'
  if (sample.late) return '迟到待留证'
  return '待判定'
}

export default function SamplePanel({ token, onDone }: PanelProps) {
  const [samples, setSamples] = useState<MetricSample[]>([])
  const [rules, setRules] = useState<DetectionRule[]>([])
  const [judgedIds, setJudgedIds] = useState<Set<string>>(new Set())
  const [form, setForm] = useState({ ruleId: '', value: '', sampledAt: '', frequencySeconds: '60' })

  useEffect(() => {
    const allRules = listRules()
    setRules(allRules)
    setSamples(listSamples())
    setJudgedIds(new Set(listEvidences().map((item) => item.sampleId)))
    setForm((prev) => ({
      ...prev,
      ruleId: prev.ruleId || allRules[0]?.id || '',
      sampledAt: prev.sampledAt || nowISO().slice(0, 16),
    }))
  }, [token])

  const ruleByMetricTarget = new Map(rules.map((rule) => [`${rule.metric}#${rule.target}`, rule]))

  function submit() {
    const result = ingestSample({
      ruleId: form.ruleId,
      value: Number(form.value),
      sampledAt: form.sampledAt,
      frequencySeconds: Number(form.frequencySeconds),
    })
    if (result.ok) {
      setForm((prev) => ({ ...prev, value: '' }))
    }
    onDone(result)
  }

  return (
    <div>
      <p className="panel-desc">
        样本按采样时间归属检测截面：采样时间晚于当前批次的进入下一截面，不回填上一告警；到达时截面已结算的样本标记为迟到，转入下一截面留证。
      </p>

      <div className="inline-form">
        <label>
          检测规则
          <select value={form.ruleId} onChange={(event) => setForm({ ...form, ruleId: event.target.value })}>
            {rules.map((rule) => (
              <option key={rule.id} value={rule.id}>
                {rule.code}（{rule.metric} / {rule.target}）
              </option>
            ))}
          </select>
        </label>
        <label>
          样本值
          <input type="number" value={form.value} onChange={(event) => setForm({ ...form, value: event.target.value })} />
        </label>
        <label>
          采样时间
          <input
            type="datetime-local"
            value={form.sampledAt}
            onChange={(event) => setForm({ ...form, sampledAt: event.target.value })}
          />
        </label>
        <label>
          采样频率（秒）
          <input
            type="number"
            value={form.frequencySeconds}
            onChange={(event) => setForm({ ...form, frequencySeconds: event.target.value })}
          />
        </label>
        <button className="btn primary" type="button" onClick={submit} disabled={!form.ruleId || form.value === ''}>
          接入样本
        </button>
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th>指标 / 目标</th>
            <th>样本值</th>
            <th>采样时间</th>
            <th>到达时间</th>
            <th>采样频率</th>
            <th>归属截面</th>
            <th>判定进度</th>
          </tr>
        </thead>
        <tbody>
          {samples.map((sample) => {
            const rule = ruleByMetricTarget.get(`${sample.metric}#${sample.target}`)
            const section = rule ? sectionOf(sample.sampledAt, rule.periodMinutes) : null
            const stage = sampleStage(sample, judgedIds)
            return (
              <tr key={sample.id}>
                <td>
                  {sample.metric} / {sample.target}
                </td>
                <td>{sample.value}</td>
                <td>{sample.sampledAt}</td>
                <td>{sample.arrivedAt}</td>
                <td>{sample.frequencySeconds}s</td>
                <td>{section ? `[${section.start.slice(11, 16)}, ${section.end.slice(11, 16)})` : '—'}</td>
                <td>
                  <Badge text={stage} tone={toneOf(stage)} />
                </td>
              </tr>
            )
          })}
          {samples.length === 0 && <EmptyRow colSpan={7}>暂无样本，先接入一条</EmptyRow>}
        </tbody>
      </table>
      <p className="muted-text">提示：迟到样本与晚于当前批次的样本都会进入下一截面，区别是迟到样本只留证、不重复生成告警。</p>
    </div>
  )
}
