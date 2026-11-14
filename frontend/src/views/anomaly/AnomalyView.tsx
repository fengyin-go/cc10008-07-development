import { useCallback, useEffect, useState } from 'react'

import { anomalyStats, resetAnomaly } from '@/api/anomaly-service'
import type { ActionResult } from '@/data/types'

import BatchPanel from './BatchPanel'
import EventPanel from './EventPanel'
import LogPanel from './LogPanel'
import RulePanel from './RulePanel'
import RunPanel from './RunPanel'
import SamplePanel from './SamplePanel'

const TABS = [
  { key: 'rules', label: '检测规则' },
  { key: 'samples', label: '样本流' },
  { key: 'runs', label: '检测批次' },
  { key: 'events', label: '告警事件' },
  { key: 'batches', label: '通知批次' },
  { key: 'logs', label: '状态日志' },
] as const

type TabKey = (typeof TABS)[number]['key']

export default function AnomalyView() {
  const [tab, setTab] = useState<TabKey>('rules')
  const [token, setToken] = useState(0)
  const [stats, setStats] = useState<{ label: string; value: number }[]>([])
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    setStats(anomalyStats())
  }, [token])

  const handleDone = useCallback((result: ActionResult) => {
    setMessage({ ok: result.ok, text: result.message })
    setToken((value) => value + 1)
  }, [])

  return (
    <section className="page" data-module="anomaly">
      <header className="page-head">
        <div>
          <h2>异常检测管理</h2>
          <p className="page-desc">
            按监控指标的基线均值与标准差倍数判定异常；命中样本、静默窗口结果与通知批次全程关联留证，每一次判定都能说明依据。
          </p>
        </div>
        <div className="page-actions">
          <button className="btn ghost" type="button" onClick={() => handleDone(resetAnomaly())}>
            重置演示数据
          </button>
        </div>
      </header>

      <div className="stat-row">
        {stats.map((item) => (
          <article key={item.label} className="stat-card">
            <span className="stat-label">{item.label}</span>
            <strong className="stat-value">{item.value}</strong>
          </article>
        ))}
      </div>

      <nav className="tab-bar">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={tab === item.key ? 'tab-item active' : 'tab-item'}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {message && <p className={message.ok ? 'action-message ok' : 'action-message fail'}>{message.text}</p>}

      {tab === 'rules' && <RulePanel token={token} onDone={handleDone} />}
      {tab === 'samples' && <SamplePanel token={token} onDone={handleDone} />}
      {tab === 'runs' && <RunPanel token={token} />}
      {tab === 'events' && <EventPanel token={token} onDone={handleDone} />}
      {tab === 'batches' && <BatchPanel token={token} onDone={handleDone} />}
      {tab === 'logs' && <LogPanel token={token} />}
    </section>
  )
}
