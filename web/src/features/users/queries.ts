import { queryOptions } from '@tanstack/react-query'
import type {
  PanelUsersPayload,
  VendorSettings,
  VendorUsagePayload,
} from '@/types/panel-users'
import { api } from '@/lib/api'

export function usersQueryOptions() {
  return queryOptions({
    queryKey: ['panel', 'users'] as const,
    queryFn: () => api<PanelUsersPayload>('/api/panel/users'),
  })
}

export function vendorSettingsQueryOptions() {
  return queryOptions({
    queryKey: ['panel', 'vendor-settings'] as const,
    queryFn: () => api<VendorSettings>('/api/panel/vendor-settings'),
  })
}

export function vendorUsageQueryOptions(since?: string, until?: string) {
  const params = new URLSearchParams()
  if (since) params.set('since', since)
  if (until) params.set('until', until)
  const qs = params.toString()
  return queryOptions({
    queryKey: ['panel', 'vendor-usage', since ?? '', until ?? ''] as const,
    queryFn: () =>
      api<VendorUsagePayload>(`/api/panel/vendor-usage${qs ? `?${qs}` : ''}`),
  })
}
