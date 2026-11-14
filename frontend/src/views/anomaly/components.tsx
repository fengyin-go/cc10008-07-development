import type { ReactNode } from 'react'

export type Tone = 'ok' | 'warn' | 'bad' | 'muted' | 'info'

export function Badge({ text, tone }: { text: string; tone: Tone }) {
  return <span className={`badge badge-${tone}`}>{text}</span>
}

/** 状态/结论 → 徽章色调，全页面统一 */
export function toneOf(text: string): Tone {
  if (['已启用', '已发送', '正常', '窗口外', '已连接', '已生效'].includes(text)) return 'ok'
  if (['待发送', '待校验', '待裁定', '窗口内待裁定', '迟到留证', '迟到待留证', '待判定'].includes(text)) return 'warn'
  if (['异常', '严重'].includes(text)) return 'bad'
  if (['窗口内抑制', '窗口内升级'].includes(text)) return 'info'
  return 'muted'
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td className="empty-state" colSpan={colSpan}>
        {children}
      </td>
    </tr>
  )
}
