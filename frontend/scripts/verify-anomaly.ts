/**
 * 异常检测领域逻辑验证：把需求里的边界场景逐条跑一遍。
 * 运行：npm run verify
 * 说明：anomaly-store 在没有 window 的环境下退化为内存存储，正好用于脚本验证。
 */
import { inSilenceWindow, judgeValue, sectionOf } from '../src/api/anomaly-engine'
import {
  adjudicateEvent,
  changeLevel,
  disableRule,
  enableRule,
  evidencesOfRun,
  getRule,
  ingestSample,
  listBatches,
  listEvents,
  listEvidences,
  listRuns,
  publishBaseline,
  resetAnomaly,
  resumeRule,
  runDetection,
  sendBatch,
  submitRule,
  withdrawBatch,
} from '../src/api/anomaly-service'

let passed = 0
let failed = 0

function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.error(`  ✗ ${name} ${detail}`)
  }
}

console.log('— 引擎口径 —')
// 静默窗口边界：左闭右开，全系统同一函数
check('窗口开始边界算窗口内', inSilenceWindow('2026-11-14T12:00:00', '12:00', '13:00') === true)
check('窗口结束边界算窗口外', inSilenceWindow('2026-11-14T13:00:00', '12:00', '13:00') === false)
check('窗口内时刻被抑制', inSilenceWindow('2026-11-14T12:30:00', '12:00', '13:00') === true)
check('跨零点窗口 23:00 在内', inSilenceWindow('2026-11-14T23:00:00', '22:00', '06:00') === true)
check('跨零点窗口 05:59 在内', inSilenceWindow('2026-11-14T05:59:00', '22:00', '06:00') === true)
check('跨零点窗口 06:00 在外', inSilenceWindow('2026-11-14T06:00:00', '22:00', '06:00') === false)
// 阈值边界：恰好等于阈值判异常
check('边界恰好等于阈值判异常', judgeValue(130, 100, 10, 3).hit === true && judgeValue(130, 100, 10, 3).onThreshold)
check('阈值之下判正常', judgeValue(129.9, 100, 10, 3).hit === false)
// 截面归属
const sec = sectionOf('2026-11-14T08:15:00', 30)
check('截面按周期对齐', sec.start === '2026-11-14T08:00:00' && sec.end === '2026-11-14T08:30:00')

resetAnomaly()

console.log('— 检测批次：边界等于阈值 / 多频率 / 迟到留证 —')
const run1 = runDetection('rule-1')
check('S2 截面判定成功', run1.ok, run1.message)
const runs1 = listRuns()
const s2Run = runs1.find((r) => r.ruleId === 'rule-1' && r.sectionStart === '2026-11-14T08:30:00')
check('S2 批次存在', !!s2Run)
const s2Evidence = s2Run ? evidencesOfRun(s2Run.id) : []
const boundaryEvidence = s2Evidence.find((e) => e.sampleValue === 130)
check('边界样本判异常且说明口径', boundaryEvidence?.verdict === '异常' && boundaryEvidence.reason.includes('恰好等于阈值'))
const freqEvidence = s2Evidence.find((e) => e.frequencySeconds === 300)
check('300s 频率分组判定留痕', !!freqEvidence && freqEvidence.reason.includes('300s'))
const lateEvidence = s2Evidence.find((e) => e.verdict === '迟到留证')
check('迟到样本转入下一截面留证', !!lateEvidence && lateEvidence.reason.includes('不回填'))
check('迟到样本不生成告警事件', lateEvidence?.eventId === null)
const s2Event = listEvents().find((e) => e.eventKey === 'rule-1#2026-11-14T08:30:00')
check('S2 命中生成唯一待发送事件', s2Event?.status === '待发送')
check('S2 事件进入待发送批次', !!s2Event?.batchId && listBatches().find((b) => b.id === s2Event.batchId)?.status === '待发送')

console.log('— 连续两个周期都异常 —')
runDetection('rule-1')
const s3Run = listRuns().find((r) => r.ruleId === 'rule-1' && r.sectionStart === '2026-11-14T09:00:00')
const s3Hit = s3Run ? evidencesOfRun(s3Run.id).find((e) => e.verdict === '异常') : undefined
check('第二周期独立判定命中', s3Hit?.verdict === '异常')
check('判定依据说明连续周期', !!s3Hit && s3Hit.reason.includes('连续第 2 个异常周期'), s3Hit?.reason)

console.log('— 静默窗口：抑制与边界一致 —')
runDetection('rule-1')
const s4Run = listRuns().find((r) => r.ruleId === 'rule-1' && r.sectionStart === '2026-11-14T12:00:00')
const s4Evidences = s4Run ? evidencesOfRun(s4Run.id) : []
check('窗口内命中被抑制', s4Evidences.filter((e) => e.verdict === '异常').every((e) => e.silence === '窗口内抑制'))
const boundaryStart = s4Evidences.find((e) => e.sampledAt.endsWith('12:00:00'))
check('窗口开始边界说明口径', !!boundaryStart && boundaryStart.reason.includes('恰好等于静默窗口开始'))
const s4Event = listEvents().find((e) => e.eventKey === 'rule-1#2026-11-14T12:00:00')
check('抑制事件不进入待发送', s4Event?.status === '已抑制')

runDetection('rule-1')
const s5Run = listRuns().find((r) => r.ruleId === 'rule-1' && r.sectionStart === '2026-11-14T13:00:00')
const s5Hit = s5Run ? evidencesOfRun(s5Run.id).find((e) => e.verdict === '异常') : undefined
check('窗口结束边界判窗口外告警', s5Hit?.silence === '窗口外' && s5Hit.reason.includes('恰好等于静默窗口结束'), s5Hit?.reason)

const again = runDetection('rule-1')
check('没有待判定样本时拒绝', !again.ok)

console.log('— 截面幂等：同一事件不重复告警 —')
const eventsBefore = listEvents().length
const sampleDup = ingestSample({ ruleId: 'rule-1', value: 200, sampledAt: '2026-11-14T08:45:00', frequencySeconds: 60 })
check('已结算截面的样本标记迟到', sampleDup.ok && sampleDup.message.includes('迟到'))
runDetection('rule-1')
check('迟到样本只留证不重复生成事件', listEvents().filter((e) => e.eventKey === 'rule-1#2026-11-14T08:30:00').length === 1)
check('事件总数不重复膨胀', listEvents().length === eventsBefore + 0 || listEvents().length === eventsBefore + 1)

console.log('— 静默窗口内更高级别事件单独裁定 —')
const pendingEvent = listEvents().find((e) => e.status === '待裁定')
check('R2 严重事件待裁定而非丢弃', !!pendingEvent)
if (pendingEvent) {
  const adj = adjudicateEvent(pendingEvent.id, '升级发送')
  check('裁定升级发送', adj.ok, adj.message)
  check('升级后进入待发送批次', listEvents().find((e) => e.id === pendingEvent.id)?.status === '待发送')
}

console.log('— 通知批次撤回：证据保留，事件不重回队列 —')
const batch = listBatches().find((b) => b.status === '待发送')
check('存在待发送批次', !!batch)
if (batch) {
  const evidenceCountBefore = listEvidences().length
  const wd = withdrawBatch(batch.id, '验证撤回')
  check('批次撤回成功', wd.ok, wd.message)
  check('撤回后证据全部保留', listEvidences().length === evidenceCountBefore)
  const withdrawnEvents = listEvents().filter((e) => e.batchId === batch.id)
  check('事件标记已撤回', withdrawnEvents.every((e) => e.status === '已撤回'))
  check('撤回批次不可发送', !sendBatch(batch.id).ok)
  check('撤回批次不可重复撤回', !withdrawBatch(batch.id, '再次').ok)
}

console.log('— 未配置通知渠道：可存草稿不能启用 —')
check('草稿可提交校验', submitRule('rule-3').ok)
const enableEmpty = enableRule('rule-3')
check('无渠道启用被拒', !enableEmpty.ok && enableEmpty.message.includes('通知渠道'), enableEmpty.message)

console.log('— 监控目标删除：可复核不可新判定 —')
const deletedRun = runDetection('rule-5')
check('目标删除禁止新判定', !deletedRun.ok && deletedRun.message.includes('不能创建新的判定'))
check('历史证据仍可复核', listEvidences().some((e) => e.ruleId === 'rule-5'))

console.log('— 暂停后恢复：回到待校验，保留原判定 —')
const resume = resumeRule('rule-4')
check('恢复回到待校验', resume.ok && getRule('rule-4')?.status === '待校验')
check('历史判定证据保留', listEvidences().some((e) => e.ruleId === 'rule-4'))

console.log('— 级别变更：新检测版本，历史样本记原级别 —')
const levelBefore = listEvidences().find((e) => e.ruleId === 'rule-1')?.level
const cl = changeLevel('rule-1', '严重', '验证版本化')
check('级别变更生成新版本', cl.ok && getRule('rule-1')?.version === 2)
check('历史命中样本仍记录原级别', listEvidences().filter((e) => e.ruleId === 'rule-1').every((e) => e.level === levelBefore))

console.log('— 新基线发布：历史证据保持原判定口径 —')
const pb = publishBaseline('rule-1', 120, 15, 60)
check('新基线发布', pb.ok, pb.message)
const oldEvidence = listEvidences().find((e) => e.ruleId === 'rule-1' && e.baselineVersion === 1)
check('历史证据保持原基线快照', oldEvidence?.baselineMean === 100 && oldEvidence.baselineStddev === 10)

console.log('— 停用规则：待发送事件撤回，证据保留 —')
const disable = disableRule('rule-1')
check('停用成功', disable.ok, disable.message)
check('该规则无待发送事件残留', listEvents().filter((e) => e.ruleId === 'rule-1' && e.status === '待发送').length === 0)
check('停用后证据仍保留', listEvidences().some((e) => e.ruleId === 'rule-1'))
check('停用后不能再执行检测', !runDetection('rule-1').ok)

console.log('— 样本晚于检测批次：进入下一截面 —')
resetAnomaly()
runDetection('rule-1') // S2
const late2 = ingestSample({ ruleId: 'rule-1', value: 999, sampledAt: '2026-11-14T08:05:00', frequencySeconds: 60 })
check('迟到样本不回填上一告警', late2.ok && late2.message.includes('下一截面'))
const future = ingestSample({ ruleId: 'rule-1', value: 100, sampledAt: '2026-11-14T20:00:00', frequencySeconds: 60 })
check('未来样本接入成功', future.ok)
runDetection('rule-1') // 应判定 S3，而非 20:00 的截面
const runsAfter = listRuns().filter((r) => r.ruleId === 'rule-1')
check('晚到的未来样本留待下一截面', !runsAfter.some((r) => r.sectionStart.startsWith('2026-11-14T20:')), runsAfter.map((r) => r.sectionStart).join(','))

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) {
  process.exit(1)
}
