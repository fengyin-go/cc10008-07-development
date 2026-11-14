import { useEffect, useState } from 'react'

import { listLogs } from '@/api/anomaly-service'
import type { StateLog } from '@/data/anomaly-types'

import { EmptyRow } from './components'

export default function LogPanel({ token }: { token: number }) {
  const [logs, setLogs] = useState<StateLog[]>([])

  useEffect(() => {
    setLogs(listLogs())
  }, [token])

  return (
    <div>
      <p className="panel-desc">
        生命周期推进、基线发布、级别变更、事件裁定、批次撤回全部留痕，暂停后恢复等状态变更可在此复核。
      </p>
      <table className="data-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>对象类型</th>
            <th>对象</th>
            <th>从</th>
            <th>到</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id}>
              <td>{log.at}</td>
              <td>{log.objectType}</td>
              <td className="mono">{log.objectId}</td>
              <td>{log.from}</td>
              <td>{log.to}</td>
              <td>{log.note}</td>
            </tr>
          ))}
          {logs.length === 0 && <EmptyRow colSpan={6}>暂无状态变更记录</EmptyRow>}
        </tbody>
      </table>
    </div>
  )
}
