import { useEffect, useState } from 'react'

import { adjudicateEvent, listBatches, listEvents, listRules } from '@/api/anomaly-service'
import type { AlertEvent } from '@/data/anomaly-types'
import type { ActionResult } from '@/data/types'

import { Badge, EmptyRow, toneOf } from './components'

type PanelProps = {
  token: number
  onDone: (result: ActionResult) => void
}

export default function EventPanel({ token, onDone }: PanelProps) {
  const [events, setEvents] = useState<AlertEvent[]>([])
  const [ruleMap, setRuleMap] = useState(new Map<string, string>())
  const [batchMap, setBatchMap] = useState(new Map<string, string>())

  useEffect(() => {
    setEvents(listEvents())
    setRuleMap(new Map(listRules().map((rule) => [rule.id, rule.code])))
    setBatchMap(new Map(listBatches().map((batch) => [batch.id, `${batch.code}（${batch.status}）`])))
  }, [token])

  return (
    <div>
      <p className="panel-desc">
        告警事件按「规则 + 截面」去重，同一事件重复出现只生成一次告警；已撤回是终态，不会重新进入待发送队列。静默窗口内达到裁定级别的事件在此单独裁定。
      </p>
      <table className="data-table">
        <thead>
          <tr>
            <th>事件</th>
            <th>检测规则</th>
            <th>级别</th>
            <th>命中截面</th>
            <th>首次命中</th>
            <th>当前状态</th>
            <th>通知批次</th>
            <th>裁定说明</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id}>
              <td className="mono">{event.id}</td>
              <td>{ruleMap.get(event.ruleId) ?? event.ruleId}</td>
              <td>
                <Badge text={event.level} tone={toneOf(event.level)} />
              </td>
              <td>{event.sectionStart.slice(5, 16)}</td>
              <td>{event.firstHitAt}</td>
              <td>
                <Badge text={event.status} tone={toneOf(event.status)} />
              </td>
              <td>{event.batchId ? batchMap.get(event.batchId) ?? event.batchId : '—'}</td>
              <td>{event.adjudication ?? '—'}</td>
              <td className="row-actions">
                {event.status === '待裁定' && (
                  <>
                    <button className="link" type="button" onClick={() => onDone(adjudicateEvent(event.id, '升级发送'))}>
                      升级发送
                    </button>
                    <button className="link" type="button" onClick={() => onDone(adjudicateEvent(event.id, '维持抑制'))}>
                      维持抑制
                    </button>
                  </>
                )}
                {event.status !== '待裁定' && '—'}
              </td>
            </tr>
          ))}
          {events.length === 0 && <EmptyRow colSpan={9}>暂无告警事件</EmptyRow>}
        </tbody>
      </table>
    </div>
  )
}
