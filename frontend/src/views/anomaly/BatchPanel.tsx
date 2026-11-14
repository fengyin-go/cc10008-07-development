import { Fragment, useEffect, useState } from 'react'

import { eventsOfBatch, evidencesOfEvent, listBatches, sendBatch, withdrawBatch } from '@/api/anomaly-service'
import type { NotifyBatch } from '@/data/anomaly-types'
import type { ActionResult } from '@/data/types'

import { Badge, EmptyRow, toneOf } from './components'
import { EvidenceCard } from './RunPanel'

type PanelProps = {
  token: number
  onDone: (result: ActionResult) => void
}

export default function BatchPanel({ token, onDone }: PanelProps) {
  const [batches, setBatches] = useState<NotifyBatch[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [withdrawForm, setWithdrawForm] = useState<{ batchId: string; reason: string } | null>(null)

  useEffect(() => {
    setBatches(listBatches())
  }, [token])

  function submitWithdraw() {
    if (!withdrawForm) return
    const result = withdrawBatch(withdrawForm.batchId, withdrawForm.reason)
    if (result.ok) setWithdrawForm(null)
    onDone(result)
  }

  return (
    <div>
      <p className="panel-desc">
        命中样本合并为通知批次发送。批次撤回后，检测证据、基线值和命中样本仍保留在原批次可查看，对应事件不会重新进入待发送队列。
      </p>
      <table className="data-table">
        <thead>
          <tr>
            <th>批次编号</th>
            <th>通知渠道</th>
            <th>事件数</th>
            <th>当前状态</th>
            <th>创建时间</th>
            <th>发送时间</th>
            <th>撤回时间</th>
            <th>撤回原因</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {batches.map((batch) => (
            <Fragment key={batch.id}>
              <tr>
                <td className="mono">{batch.code}</td>
                <td>{batch.channels.length > 0 ? batch.channels.join('、') : <Badge text="缺少通知渠道" tone="warn" />}</td>
                <td>{batch.eventIds.length}</td>
                <td>
                  <Badge text={batch.status} tone={toneOf(batch.status)} />
                </td>
                <td>{batch.createdAt}</td>
                <td>{batch.sentAt ?? '—'}</td>
                <td>{batch.withdrawnAt ?? '—'}</td>
                <td>{batch.withdrawReason ?? '—'}</td>
                <td className="row-actions">
                  {batch.status === '待发送' && (
                    <>
                      <button className="link" type="button" onClick={() => onDone(sendBatch(batch.id))}>
                        发送
                      </button>
                      <button
                        className="link"
                        type="button"
                        onClick={() => setWithdrawForm({ batchId: batch.id, reason: '' })}
                      >
                        撤回
                      </button>
                    </>
                  )}
                  <button
                    className="link"
                    type="button"
                    onClick={() => setExpanded((current) => (current === batch.id ? null : batch.id))}
                  >
                    {expanded === batch.id ? '收起证据' : '查看证据'}
                  </button>
                </td>
              </tr>
              {withdrawForm?.batchId === batch.id && (
                <tr>
                  <td colSpan={9} className="detail-block">
                    <div className="inline-form">
                      <span>撤回批次（检测证据保留，事件不重回待发送队列）：</span>
                      <label>
                        撤回原因
                        <input
                          value={withdrawForm.reason}
                          onChange={(event) => setWithdrawForm({ ...withdrawForm, reason: event.target.value })}
                        />
                      </label>
                      <button className="btn primary" type="button" onClick={submitWithdraw}>
                        确认撤回
                      </button>
                      <button className="btn ghost" type="button" onClick={() => setWithdrawForm(null)}>
                        取消
                      </button>
                    </div>
                  </td>
                </tr>
              )}
              {expanded === batch.id && (
                <tr>
                  <td colSpan={9} className="detail-block">
                    {eventsOfBatch(batch.id).map((event) => (
                      <div key={event.id} className="batch-event">
                        <p className="evidence-head">
                          <strong>事件 {event.id}</strong>
                          <Badge text={event.level} tone={toneOf(event.level)} />
                          <Badge text={event.status} tone={toneOf(event.status)} />
                          <span className="muted-text">命中截面 {event.sectionStart}</span>
                        </p>
                        {evidencesOfEvent(event.id).map((evidence) => (
                          <EvidenceCard key={evidence.id} evidence={evidence} event={event} batch={batch} />
                        ))}
                      </div>
                    ))}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
          {batches.length === 0 && <EmptyRow colSpan={9}>暂无通知批次</EmptyRow>}
        </tbody>
      </table>
    </div>
  )
}
