import { Fragment, useEffect, useState } from 'react'

import {
  baselinesOf,
  changeLevel,
  createRuleDraft,
  deleteTarget,
  disableRule,
  enableRule,
  listRules,
  pauseRule,
  publishBaseline,
  resumeRule,
  runDetection,
  submitRule,
  versionsOf,
} from '@/api/anomaly-service'
import type { AlertLevel, DetectionRule } from '@/data/anomaly-types'
import type { ActionResult } from '@/data/types'

import { Badge, EmptyRow, toneOf } from './components'

const LEVELS: AlertLevel[] = ['提示', '警告', '严重']

type PanelProps = {
  token: number
  onDone: (result: ActionResult) => void
}

type DraftForm = {
  metric: string
  target: string
  periodMinutes: string
  sigmaMultiple: string
  level: AlertLevel
  silenceStart: string
  silenceEnd: string
  silenceEscalateLevel: AlertLevel
  channels: string
}

const EMPTY_DRAFT: DraftForm = {
  metric: '',
  target: '',
  periodMinutes: '30',
  sigmaMultiple: '3',
  level: '警告',
  silenceStart: '',
  silenceEnd: '',
  silenceEscalateLevel: '严重',
  channels: '',
}

export default function RulePanel({ token, onDone }: PanelProps) {
  const [rules, setRules] = useState<DetectionRule[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [draft, setDraft] = useState<DraftForm>(EMPTY_DRAFT)
  const [baselineForm, setBaselineForm] = useState<{ ruleId: string; mean: string; stddev: string; count: string } | null>(null)
  const [levelForm, setLevelForm] = useState<{ ruleId: string; level: AlertLevel; reason: string } | null>(null)

  useEffect(() => {
    setRules(listRules())
  }, [token])

  function submitDraft() {
    const result = createRuleDraft({
      metric: draft.metric,
      target: draft.target,
      periodMinutes: Number(draft.periodMinutes),
      sigmaMultiple: Number(draft.sigmaMultiple),
      level: draft.level,
      silenceStart: draft.silenceStart,
      silenceEnd: draft.silenceEnd,
      silenceEscalateLevel: draft.silenceEscalateLevel,
      channels: draft.channels.split(/[,，、\s]+/).filter((item) => item !== ''),
    })
    if (result.ok) {
      setDraft(EMPTY_DRAFT)
      setShowCreate(false)
    }
    onDone(result)
  }

  function submitBaseline() {
    if (!baselineForm) return
    const result = publishBaseline(
      baselineForm.ruleId,
      Number(baselineForm.mean),
      Number(baselineForm.stddev),
      Number(baselineForm.count || '0'),
    )
    if (result.ok) setBaselineForm(null)
    onDone(result)
  }

  function submitLevel() {
    if (!levelForm) return
    const result = changeLevel(levelForm.ruleId, levelForm.level, levelForm.reason)
    if (result.ok) setLevelForm(null)
    onDone(result)
  }

  function renderActions(rule: DetectionRule) {
    const buttons: { label: string; run: () => void }[] = []
    if (rule.status === '草稿') {
      buttons.push({ label: '提交校验', run: () => onDone(submitRule(rule.id)) })
    }
    if (rule.status === '待校验') {
      buttons.push({ label: '启用检测', run: () => onDone(enableRule(rule.id)) })
    }
    if (rule.status === '已启用') {
      buttons.push({ label: '执行检测', run: () => onDone(runDetection(rule.id)) })
      buttons.push({ label: '暂停检测', run: () => onDone(pauseRule(rule.id)) })
    }
    if (rule.status === '已暂停') {
      buttons.push({ label: '恢复（回到待校验）', run: () => onDone(resumeRule(rule.id)) })
    }
    if (rule.status === '已启用' || rule.status === '已暂停') {
      buttons.push({ label: '停用检测', run: () => onDone(disableRule(rule.id)) })
    }
    if (rule.status !== '已停用') {
      buttons.push({
        label: '发布基线',
        run: () => setBaselineForm({ ruleId: rule.id, mean: '', stddev: '', count: '' }),
      })
      buttons.push({
        label: '变更级别',
        run: () => setLevelForm({ ruleId: rule.id, level: rule.level === '严重' ? '警告' : '严重', reason: '' }),
      })
    }
    if (!rule.targetDeleted) {
      buttons.push({
        label: '删除监控目标',
        run: () => {
          if (window.confirm(`确认删除监控目标 ${rule.target}？删除后历史检测仍可复核，但不能创建新的判定。`)) {
            onDone(deleteTarget(rule.id))
          }
        },
      })
    }
    return (
      <>
        {buttons.map((button) => (
          <button key={button.label} className="link" type="button" onClick={button.run}>
            {button.label}
          </button>
        ))}
        <button
          className="link"
          type="button"
          onClick={() => setExpanded((current) => (current === rule.id ? null : rule.id))}
        >
          {expanded === rule.id ? '收起版本' : '版本记录'}
        </button>
      </>
    )
  }

  return (
    <div>
      <div className="panel-head">
        <p className="panel-desc">
          生命周期：草稿 → 待校验 → 已启用 ⇄ 已暂停（恢复回到待校验）→ 已停用。未配置通知渠道可保存草稿但不能启用；停用后待发送事件撤回，检测证据保留。
        </p>
        <button className="btn primary" type="button" onClick={() => setShowCreate((value) => !value)}>
          {showCreate ? '收起登记表单' : '登记检测规则'}
        </button>
      </div>

      {showCreate && (
        <div className="inline-form">
          <label>
            监控指标
            <input value={draft.metric} onChange={(event) => setDraft({ ...draft, metric: event.target.value })} />
          </label>
          <label>
            监控目标
            <input value={draft.target} onChange={(event) => setDraft({ ...draft, target: event.target.value })} />
          </label>
          <label>
            检测周期（分钟）
            <input
              type="number"
              value={draft.periodMinutes}
              onChange={(event) => setDraft({ ...draft, periodMinutes: event.target.value })}
            />
          </label>
          <label>
            标准差倍数
            <input
              type="number"
              step="0.1"
              value={draft.sigmaMultiple}
              onChange={(event) => setDraft({ ...draft, sigmaMultiple: event.target.value })}
            />
          </label>
          <label>
            告警级别
            <select value={draft.level} onChange={(event) => setDraft({ ...draft, level: event.target.value as AlertLevel })}>
              {LEVELS.map((level) => (
                <option key={level}>{level}</option>
              ))}
            </select>
          </label>
          <label>
            静默窗口开始
            <input
              type="time"
              value={draft.silenceStart}
              onChange={(event) => setDraft({ ...draft, silenceStart: event.target.value })}
            />
          </label>
          <label>
            静默窗口结束
            <input
              type="time"
              value={draft.silenceEnd}
              onChange={(event) => setDraft({ ...draft, silenceEnd: event.target.value })}
            />
          </label>
          <label>
            窗口内裁定级别
            <select
              value={draft.silenceEscalateLevel}
              onChange={(event) => setDraft({ ...draft, silenceEscalateLevel: event.target.value as AlertLevel })}
            >
              {LEVELS.map((level) => (
                <option key={level}>{level}</option>
              ))}
            </select>
          </label>
          <label>
            通知渠道（逗号分隔，可空）
            <input
              placeholder="邮件,短信"
              value={draft.channels}
              onChange={(event) => setDraft({ ...draft, channels: event.target.value })}
            />
          </label>
          <button className="btn primary" type="button" onClick={submitDraft}>
            保存草稿
          </button>
        </div>
      )}

      <table className="data-table">
        <thead>
          <tr>
            <th>规则编号</th>
            <th>监控指标 / 目标</th>
            <th>检测周期</th>
            <th>标准差倍数</th>
            <th>告警级别</th>
            <th>静默窗口</th>
            <th>通知渠道</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((rule) => (
            <Fragment key={rule.id}>
              <tr>
                <td>{rule.code}</td>
                <td>
                  {rule.metric} / {rule.target}
                  {rule.targetDeleted && <Badge text="目标已删除" tone="bad" />}
                </td>
                <td>{rule.periodMinutes} 分钟</td>
                <td>{rule.sigmaMultiple}σ</td>
                <td>
                  <Badge text={rule.level} tone={toneOf(rule.level)} /> <span className="muted-text">v{rule.version}</span>
                </td>
                <td>{rule.silenceStart && rule.silenceEnd ? `[${rule.silenceStart}, ${rule.silenceEnd})` : '—'}</td>
                <td>
                  {rule.channels.length > 0 ? rule.channels.join('、') : <Badge text="缺少通知渠道" tone="warn" />}
                </td>
                <td>
                  <Badge text={rule.status} tone={toneOf(rule.status)} />
                </td>
                <td className="row-actions">{renderActions(rule)}</td>
              </tr>
              {baselineForm?.ruleId === rule.id && (
                <tr key={`${rule.id}-baseline`}>
                  <td colSpan={9} className="detail-block">
                    <div className="inline-form">
                      <span>发布新基线（发布后历史证据仍按原口径复核）：</span>
                      <label>
                        基线均值
                        <input
                          type="number"
                          value={baselineForm.mean}
                          onChange={(event) => setBaselineForm({ ...baselineForm, mean: event.target.value })}
                        />
                      </label>
                      <label>
                        标准差
                        <input
                          type="number"
                          step="0.01"
                          value={baselineForm.stddev}
                          onChange={(event) => setBaselineForm({ ...baselineForm, stddev: event.target.value })}
                        />
                      </label>
                      <label>
                        样本数
                        <input
                          type="number"
                          value={baselineForm.count}
                          onChange={(event) => setBaselineForm({ ...baselineForm, count: event.target.value })}
                        />
                      </label>
                      <button className="btn primary" type="button" onClick={submitBaseline}>
                        确认发布
                      </button>
                      <button className="btn ghost" type="button" onClick={() => setBaselineForm(null)}>
                        取消
                      </button>
                    </div>
                  </td>
                </tr>
              )}
              {levelForm?.ruleId === rule.id && (
                <tr key={`${rule.id}-level`}>
                  <td colSpan={9} className="detail-block">
                    <div className="inline-form">
                      <span>变更告警级别（生成新检测版本，历史命中样本仍记录原级别）：</span>
                      <label>
                        新级别
                        <select
                          value={levelForm.level}
                          onChange={(event) => setLevelForm({ ...levelForm, level: event.target.value as AlertLevel })}
                        >
                          {LEVELS.map((level) => (
                            <option key={level}>{level}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        变更原因
                        <input
                          value={levelForm.reason}
                          onChange={(event) => setLevelForm({ ...levelForm, reason: event.target.value })}
                        />
                      </label>
                      <button className="btn primary" type="button" onClick={submitLevel}>
                        确认变更
                      </button>
                      <button className="btn ghost" type="button" onClick={() => setLevelForm(null)}>
                        取消
                      </button>
                    </div>
                  </td>
                </tr>
              )}
              {expanded === rule.id && (
                <tr key={`${rule.id}-versions`}>
                  <td colSpan={9} className="detail-block">
                    <div className="version-grid">
                      <div>
                        <h4>基线版本</h4>
                        <table className="sub-table">
                          <thead>
                            <tr>
                              <th>版本</th>
                              <th>均值</th>
                              <th>标准差</th>
                              <th>样本数</th>
                              <th>发布时间</th>
                            </tr>
                          </thead>
                          <tbody>
                            {baselinesOf(rule.id).map((baseline) => (
                              <tr key={baseline.id}>
                                <td>v{baseline.version}</td>
                                <td>{baseline.mean}</td>
                                <td>{baseline.stddev}</td>
                                <td>{baseline.sampleCount}</td>
                                <td>{baseline.publishedAt}</td>
                              </tr>
                            ))}
                            {baselinesOf(rule.id).length === 0 && (
                              <tr>
                                <td colSpan={5} className="empty-state">
                                  尚未发布基线
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                      <div>
                        <h4>检测版本（判定口径快照）</h4>
                        <table className="sub-table">
                          <thead>
                            <tr>
                              <th>版本</th>
                              <th>告警级别</th>
                              <th>标准差倍数</th>
                              <th>检测周期</th>
                              <th>变更说明</th>
                            </tr>
                          </thead>
                          <tbody>
                            {versionsOf(rule.id).map((version) => (
                              <tr key={version.id}>
                                <td>v{version.version}</td>
                                <td>{version.level}</td>
                                <td>{version.sigmaMultiple}σ</td>
                                <td>{version.periodMinutes} 分钟</td>
                                <td>{version.reason}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
          {rules.length === 0 && <EmptyRow colSpan={9}>暂无检测规则，可先登记草稿</EmptyRow>}
        </tbody>
      </table>
    </div>
  )
}
