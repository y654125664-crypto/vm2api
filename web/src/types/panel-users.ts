import type { PanelRole } from './panel-auth'

export type PanelUser = {
  id: string
  username: string
  role: PanelRole
  enabled: boolean
  vm_create_quota?: number
  vendor_share?: number
  notes?: string
  created_at?: string
  last_login_at?: string
}

export type PanelUsersPayload = {
  items?: PanelUser[]
}

export type VendorSettings = {
  enabled?: boolean
  default_share?: number
}

export type VendorUsageRow = {
  owner_user_id: string
  username: string
  enabled: boolean
  vendor_share: number
  requests: number
  errors: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  /** 计费口径成本（actual_cost 优先，与号商自己的 billing 页同源同值） */
  cost_usd: number
  /** 官方价成本 */
  total_cost: number
  vendor_payout: number
}

export type VendorUsagePayload = {
  since?: string | null
  until?: string | null
  items: VendorUsageRow[]
}
