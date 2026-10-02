import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { VIEW_TITLES } from '@/config/nav'
import { api } from '@/lib/api'
import { fmtAgo } from '@/lib/format'
import { importErrorMessage } from '@/lib/import-errors'
import type { Vm, VmProxySnap } from '@/types/panel-vm'
import { toast } from 'sonner'
import { Cable, HardDriveUpload, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/page-header'
import { TableSkeleton } from '@/components/page-skeletons'
import { QueryGate } from '@/components/query-gate'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { vmsListQueryOptions } from '@/features/vm/queries'
import { proxiesQueryOptions, useRefreshProxies } from '@/features/proxies/queries'

// 号池页把底层「虚拟机=号位」完全藏掉：供应商只看到「我的号」。
// 上号 = 自动 POST /vms/create（盖 owner 戳、吃自建配额、从自己的代理池自动分配出口）
// 再 POST /vms/import 凭据。出口 IP 绑定对齐管理端导入流。

// 与 vm/credential-panel.tsx 保持一致：sk-ant-sid 前缀走 cookie 换票分支。
const SESSION_KEY_PREFIX = /^sk-ant-sid/i

const CRED_KIND_LABELS = {
  apikey: 'SK / API Key',
  oauth: 'OAuth 会话令牌',
  'setup-token': 'Setup Token',
} as const

type CredKind = keyof typeof CRED_KIND_LABELS

// OAuth 凭据的三种上号方式：直接粘贴会话令牌 / 授权链接换票（单号交互）/ 导入 RT。
const OAUTH_METHODS = {
  session: '会话令牌',
  authlink: '授权链接',
  rt: '导入 RT',
} as const
type OAuthMethod = keyof typeof OAUTH_METHODS

// 伪装档（出站 system/persona 身份）。custom 是管理员在「system 提示词」页
// 编辑的自定义模板，不对号商开放；留空 = 平台默认档。
const DISGUISE_PRESETS = {
  official: '官方 CC',
  official_full: '官方全量',
  zero: '零注入',
} as const
type DisguisePreset = keyof typeof DISGUISE_PRESETS

/** 回调 URL 或裸 code#state → code。 */
function parseOAuthCallback(text: string): string {
  const value = text.trim()
  if (!value) return ''
  if (/^https?:/i.test(value)) {
    const hashIndex = value.indexOf('#')
    const hash = hashIndex >= 0 ? value.slice(hashIndex + 1) : ''
    if (hash) {
      const params = new URLSearchParams(hash.startsWith('code=') || hash.includes('=') ? hash : `code=${hash}`)
      const fromHash = params.get('code') || params.get('state') || ''
      if (fromHash) return fromHash.split('&')[0]
    }
    try {
      const url = new URL(value)
      return url.searchParams.get('code') || ''
    } catch {
      return ''
    }
  }
  return value.includes('#') ? value.split('#')[0] : value
}

function splitLines(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((line) => line.trim())
    .filter(Boolean)
}

export function PoolPage() {
  const qc = useQueryClient()
  const q = useQuery(vmsListQueryOptions(15000))
  const items: Vm[] = q.data?.items ?? []
  const [createOpen, setCreateOpen] = useState(false)

  const stats = {
    total: items.length,
    ok: items.filter((v) => v.schedule_state !== 'off' && v.availability?.usable !== false)
      .length,
    restricted: items.filter((v) => v.schedule_state === 'restricted').length,
    off: items.filter((v) => v.schedule_state === 'off').length,
  }

  return (
    <PageHeader
      title={VIEW_TITLES.pool}
      extra={
        <Button onClick={() => setCreateOpen(true)}>
          <Plus />
          上号
        </Button>
      }
    >
      <p className='mb-4 text-sm text-muted-foreground'>
        把号导入池子里即可，平台自动调度；你名下的用量与分成在「计费」里查看。
      </p>
      <QueryGate
        loading={q.isLoading}
        error={q.error}
        skeleton={<TableSkeleton rows={6} columns={5} />}
      >
        <div className='mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4'>
          {[
            ['号池总数', stats.total],
            ['正常在池', stats.ok],
            ['受限', stats.restricted],
            ['停用', stats.off],
          ].map(([label, value]) => (
            <div key={label as string} className='rounded-md border p-3'>
              <div className='text-xs text-muted-foreground'>{label}</div>
              <div className='mt-1 text-2xl font-semibold tabular-nums'>
                {value}
              </div>
            </div>
          ))}
        </div>

        <PoolProxyCard />
        <div className='mb-4' />

        <div className='overflow-x-auto rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>号</TableHead>
                <TableHead>账号</TableHead>
                <TableHead>凭据类型</TableHead>
                <TableHead>出口 IP</TableHead>
                <TableHead>伪装档</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>上次探测</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className='h-28 text-center'>
                    <div className='text-muted-foreground'>
                      号池还是空的 —— 点右上角「上号」把第一个号导入
                    </div>
                  </TableCell>
                </TableRow>
              ) : null}
              {items.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className='font-medium'>{v.name || v.id}</TableCell>
                  <TableCell className='text-muted-foreground'>
                    {v.email || '—'}
                  </TableCell>
                  <TableCell>{CRED_LABEL(v)}</TableCell>
                  <TableCell className='text-muted-foreground'>
                    {PROXY_LABEL(v)}
                  </TableCell>
                  <TableCell className='text-muted-foreground'>
                    {v.resolved_persona_preset || v.persona_preset || '平台默认'}
                  </TableCell>
                  <TableCell>
                    <PoolStatusBadge vm={v} />
                  </TableCell>
                  <TableCell className='text-muted-foreground'>
                    {fmtAgo(v.last_probe_at) || '从未'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <PoolImportDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onDone={async () => {
            await qc.invalidateQueries({
              queryKey: vmsListQueryOptions().queryKey,
            })
          }}
        />
      </QueryGate>
    </PageHeader>
  )
}

function CRED_LABEL(vm: Vm): string {
  const mode = typeof vm.credential_mode === 'string' ? vm.credential_mode : ''
  if (mode === 'apikey') return 'SK / API Key'
  if (mode === 'setup-token') return 'Setup Token'
  if (mode === 'oauth') return 'OAuth'
  if (mode) return mode
  return '—'
}

function PROXY_LABEL(vm: Vm): string {
  const proxy = vm.proxy
  if (proxy?.kind === 'local') return '本地出口'
  if (proxy?.host) {
    const host = proxy.host
    const port = proxy.port != null ? `:${proxy.port}` : ''
    return `${host}${port}`
  }
  if (vm.proxy_configured) return '本地出口'
  return '—'
}

function PoolStatusBadge({ vm }: { vm: Vm }) {
  if (vm.schedule_state === 'off') return <Badge variant='outline'>停用</Badge>
  if (vm.schedule_state === 'restricted' || !vm.availability?.usable)
    return <Badge variant='destructive'>受限</Badge>
  return <Badge variant='secondary'>正常</Badge>
}

/** 出口 IP 卡片：供应商自己导入的 SOCKS5 池（服务端按 owner 过滤）。 */
function PoolProxyCard() {
  const q = useQuery(proxiesQueryOptions())
  const refresh = useRefreshProxies()
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const proxies = (q.data?.proxies ?? []).filter((p) => p.kind !== 'local')

  async function importProxies() {
    if (!text.trim()) return
    setPending(true)
    try {
      await api('/api/panel/proxies/import', {
        method: 'POST',
        body: JSON.stringify({ text: text.trim() }),
      })
      toast.success('出口 IP 已入池，上号时自动分配')
      setText('')
      await refresh()
    } catch (e) {
      toast.error(importErrorMessage(e as Error))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className='mb-4 rounded-md border p-4 space-y-3'>
      <div className='flex items-center gap-2 text-sm font-medium'>
        <Cable className='size-4' />
        出口 IP（SOCKS5）
        <span className='text-xs text-muted-foreground'>
          共 {proxies.length} 个 · 上号时按号自动 1:1 分配
        </span>
      </div>
      <div className='flex flex-wrap gap-2'>
        {proxies.length === 0 ? (
          <p className='text-xs text-muted-foreground'>
            还没有出口 IP —— 粘贴下方的行导入；没有 IP 时号会走平台本地出口。
          </p>
        ) : (
          proxies.map((p) => (
            <ProxyChip key={p.id} proxy={p} />
          ))
        )}
      </div>
      <textarea
        className='w-full rounded-md border bg-transparent p-2 text-sm'
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'host:port:user:pass 或 socks5://user:pass@host:1080\n支持多行，一次导入多个 IP'}
      />
      <Button
        size='sm'
        variant='outline'
        onClick={importProxies}
        disabled={!text.trim() || pending}
        loading={pending}
      >
        导入出口 IP
      </Button>
    </div>
  )
}

function ProxyChip({ proxy }: { proxy: VmProxySnap }) {
  const host = proxy.host ?? ''
  const port = proxy.port != null ? `:${proxy.port}` : ''
  const ok = proxy.status === 'ok' || proxy.latency_ms != null
  return (
    <span className='inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs'>
      <span
        className={`inline-block size-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-amber-500'}`}
      />
      {host}
      {port}
      {proxy.bound_count ? (
        <span className='text-muted-foreground'>·{proxy.bound_count}</span>
      ) : null}
    </span>
  )
}

type PoolImportResult = { label: string; ok: boolean; message: string }

function PoolImportDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => Promise<unknown>
}) {
  const [kind, setKind] = useState<CredKind>('oauth')
  const [oauthMethod, setOauthMethod] = useState<OAuthMethod>('session')
  const [oauthPhase, setOauthPhase] = useState<'form' | 'link'>('form')
  const [linkInfo, setLinkInfo] = useState<{
    vmId: string
    sessionId: string
    authUrl: string
  } | null>(null)
  const [callback, setCallback] = useState('')
  const [prefix, setPrefix] = useState('')
  const [creds, setCreds] = useState('')
  const [proxyMode, setProxyMode] = useState<'auto' | 'manual'>('auto')
  const [proxyLines, setProxyLines] = useState('')
  const [disguise, setDisguise] = useState<'' | DisguisePreset>('')
  const [results, setResults] = useState<PoolImportResult[]>([])
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const proxyQ = useQuery(proxiesQueryOptions())

  const reset = () => {
    setPrefix('')
    setCreds('')
    setProxyLines('')
    setOauthMethod('session')
    setOauthPhase('form')
    setLinkInfo(null)
    setCallback('')
    setDisguise('')
    setError('')
  }

  async function exchangeNow() {
    if (!linkInfo) return
    const code = parseOAuthCallback(callback)
    if (!code) {
      setError('请粘贴回调 URL 或 code#state')
      return
    }
    setPending(true)
    try {
      await api(
        `/api/panel/vms/${encodeURIComponent(linkInfo.vmId)}/oauth/exchange-code`,
        {
          method: 'POST',
          body: JSON.stringify({
            session_id: linkInfo.sessionId,
            code,
            flavor: 'claude_code',
          }),
        },
      )
      toast.success('换票完成，号已入池')
      setCallback('')
      setLinkInfo(null)
      setOauthPhase('form')
      setResults([])
      setCreds('')
      onOpenChange(false)
      await onDone()
    } catch (e) {
      setError(importErrorMessage(e as Error))
    } finally {
      setPending(false)
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    // 自动模式前置校验：凭据转换必须经过出口 SOCKS5，池里没有 IP 就不建号位
    //（否则每行失败都会留下空号位吃自建配额）。
    const ownProxies = (proxyQ.data?.proxies ?? []).filter(
      (p) => p.kind !== 'local' && p.enabled !== false,
    )
    if (proxyMode === 'auto' && ownProxies.length === 0) {
      setError(
        '自动模式需要先有出口 IP：在「出口 IP」卡片导入 SOCKS5，或切手动模式逐行粘贴'
      )
      return
    }
    const lines = splitLines(creds)
    if (lines.length === 0) {
      setError('请填写凭据内容（支持多行批量）')
      return
    }
    const proxies = proxyMode === 'manual' ? splitLines(proxyLines) : []
    if (proxyMode === 'manual' && proxies.length === 0) {
      setError('手动模式需要粘贴出口 IP，每行一个')
      return
    }
    // 授权链接换票：单号交互 —— 先建号位并生成 Claude 登录链接，粘回回调后再换票。
    if (kind === 'oauth' && oauthMethod === 'authlink') {
      setPending(true)
      setResults([])
      try {
        const label = prefix.trim()
          ? `${prefix.trim().replace(/[-_]+$/, '')}-01`
          : ''
        const created = await api<{ item?: Vm; id?: string }>(
          '/api/panel/vms/create',
          {
            method: 'POST',
            body: JSON.stringify(
              label
                ? { name: label, auto_allocate_proxy: proxyMode === 'auto' }
                : { auto_allocate_proxy: proxyMode === 'auto' },
            ),
          },
        )
        const vmId = created?.item?.id ?? created?.id
        if (!vmId) throw new Error('创建号位失败：未返回 vm id')
        const link = await api<{ auth_url?: string; session_id?: string }>(
          `/api/panel/vms/${encodeURIComponent(vmId)}/oauth/generate-auth-url`,
          { method: 'POST', body: JSON.stringify({ flavor: 'claude_code' }) },
        )
        if (!link.auth_url) throw new Error('授权链接生成失败：未返回 auth_url')
        setLinkInfo({
          vmId,
          sessionId: String(link.session_id || ''),
          authUrl: String(link.auth_url),
        })
        setOauthPhase('link')
        setResults([
          { label: label || vmId, ok: true, message: '号位已建，等待换票' },
        ])
        await onDone()
      } catch (e) {
        setError(importErrorMessage(e as Error))
      } finally {
        setPending(false)
      }
      return
    }
    setPending(true)
    setResults([])
    const outcomes: PoolImportResult[] = []
    try {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const label = prefix.trim()
          ? `${prefix.trim().replace(/[-_]+$/, '')}-${String(i + 1).padStart(2, '0')}`
          : ''
        try {
          // 0) 去重前置判定：命中自己的号 → 覆盖（沿用号位与用量）；命中他人 → 跳过。
          const check = await api<{
            action: 'new' | 'replace' | 'blocked'
            vm_id?: string | null
          }>('/api/panel/pool/check', {
            method: 'POST',
            body: JSON.stringify({ kind: 'raw', credential: line }),
          })
          let vmId: string | undefined
          if (check.action === 'blocked') {
            outcomes.push({
              label: label || `第 ${i + 1} 行`,
              ok: false,
              message: '该凭据已被其他号位使用',
            })
            setResults([...outcomes])
            continue
          }
          // 1) 建号位：服务端盖 owner 戳 + 吃自建配额 + 自动从我的代理池分配出口；
          //    伪装档在创建时一次定档（号位 persona_preset）。
          if (check.action === 'replace' && check.vm_id) {
            vmId = check.vm_id
          } else {
            const created = await api<{ item?: Vm; id?: string }>(
              '/api/panel/vms/create',
              {
                method: 'POST',
                body: JSON.stringify({
                  ...(label ? { name: label } : {}),
                  auto_allocate_proxy: proxyMode === 'auto',
                  ...(disguise ? { persona_preset: disguise } : {}),
                }),
              },
            )
            const vmObj = (created as { vm?: Vm })?.vm
            vmId = created?.item?.id ?? created?.id ?? vmObj?.id
            if (!vmId) throw new Error('创建号位失败：未返回 vm id')
          }
          // 2) 导入凭据（字段映射对齐 vm/credential-panel.tsx）。
          const body: Record<string, unknown> = { vm_id: vmId }
          if (kind === 'apikey') {
            body.type = 'apikey'
            body.api_key = line
          } else if (kind === 'oauth' && oauthMethod === 'rt') {
            // RT 行格式：access_token|refresh_token（refresh 选填）
            const [accessToken, refreshToken] = line.split('|')
            if (!accessToken?.trim())
              throw new Error('行格式应为 access_token|refresh_token')
            body.access_token = accessToken.trim()
            if (refreshToken?.trim()) body.refresh_token = refreshToken.trim()
          } else {
            if (kind === 'setup-token') {
              body.type = 'setup-token'
              body.scope = 'inference'
            }
            if (SESSION_KEY_PREFIX.test(line)) body.session_key = line
            else body.access_token = line
          }
          const imported = await api<{ duplicate_of?: string | null }>(
            '/api/panel/vms/import',
            { method: 'POST', body: JSON.stringify(body) },
          )
          // 替换竞态兜底：后端判重命中自己号位 → 删掉刚建的空号位，沿用原号。
          if (imported?.duplicate_of && vmId !== imported.duplicate_of) {
            await api(`/api/panel/vms/${encodeURIComponent(vmId)}`, {
              method: 'DELETE',
            }).catch(() => undefined)
            vmId = imported.duplicate_of
          }
          // 2.5) 覆盖已有号时保持原号身份不变（伪装档只在创建时定档）。
          // 3) 手动模式：按行 1:1 绑定粘贴的出口 IP。
          if (proxyMode === 'manual' && proxies[i]) {
            await api('/api/panel/proxies/import', {
              method: 'POST',
              body: JSON.stringify({ text: proxies[i], bind_vm_id: vmId }),
            })
          }
          outcomes.push({
            label: label || vmId,
            ok: true,
            message:
              check.action === 'replace' ? '已覆盖（沿用原号）' : '已入池',
          })
        } catch (e) {
          outcomes.push({
            label: label || `第 ${i + 1} 行`,
            ok: false,
            message: importErrorMessage(e as Error),
          })
        }
        setResults([...outcomes])
      }
      const failed = outcomes.filter((r) => !r.ok).length
      if (failed === 0) {
        toast.success(`${outcomes.length} 个号已入池`)
        reset()
        onOpenChange(false)
      } else {
        toast.warning(`成功 ${outcomes.length - failed} / 失败 ${failed}`)
      }
      await onDone()
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) {
          reset()
          setResults([])
        }
        onOpenChange(next)
      }}
    >
      <DialogContent className='max-w-lg'>
        {oauthPhase === 'link' && linkInfo ? (
          <div className='space-y-4'>
            <DialogHeader>
              <DialogTitle>授权链接换票</DialogTitle>
              <DialogDescription>
                打开链接完成 Claude
                登录，回到回调页后把完整 URL 或 code#state 粘到这里。
              </DialogDescription>
            </DialogHeader>
            <div className='rounded-md border p-2'>
              <a
                href={linkInfo.authUrl}
                target='_blank'
                rel='noreferrer'
                className='text-sm text-primary underline'
              >
                {linkInfo.authUrl}
              </a>
            </div>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() => {
                void navigator.clipboard?.writeText(linkInfo.authUrl)
                toast.success('链接已复制')
              }}
            >
              复制链接
            </Button>
            <div className='space-y-1.5'>
              <Label htmlFor='pool-callback'>回调 URL 或 code#state</Label>
              <Input
                id='pool-callback'
                value={callback}
                onChange={(e) => setCallback(e.target.value)}
                autoComplete='off'
                spellCheck={false}
                placeholder='完整回调 URL 或 code#state'
              />
            </div>
            {error ? <p className='text-sm text-destructive'>{error}</p> : null}
            <DialogFooter>
              <Button
                type='button'
                variant='outline'
                onClick={() => {
                  setOauthPhase('form')
                  setLinkInfo(null)
                  setError('')
                }}
              >
                返回
              </Button>
              <Button
                type='button'
                className='flex-1'
                onClick={exchangeNow}
                disabled={!callback.trim() || pending}
                loading={pending}
              >
                换票
              </Button>
            </DialogFooter>
          </div>
        ) : (
        <form className='space-y-4' onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>上号</DialogTitle>
            <DialogDescription>
              支持多行批量，一行一个号；凭据只提交一次、不回显。上号建议绑定自己的出口 IP。
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-1.5'>
            <Label>凭据类型</Label>
            <div className='flex gap-2'>
              {(Object.keys(CRED_KIND_LABELS) as CredKind[]).map((k) => (
                <button
                  key={k}
                  type='button'
                  onClick={() => setKind(k)}
                  className={`rounded-md border px-3 py-1.5 text-sm ${
                    kind === k
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'text-muted-foreground'
                  }`}
                >
                  {CRED_KIND_LABELS[k]}
                </button>
              ))}
            </div>
          </div>
          {kind === 'oauth' ? (
            <div className='space-y-1.5'>
              <Label>OAuth 方式</Label>
              <div className='flex gap-2'>
                {(Object.keys(OAUTH_METHODS) as OAuthMethod[]).map((m) => (
                  <button
                    key={m}
                    type='button'
                    onClick={() => setOauthMethod(m)}
                    className={`rounded-md border px-3 py-1.5 text-sm ${
                      oauthMethod === m
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'text-muted-foreground'
                    }`}
                  >
                    {OAUTH_METHODS[m]}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {!(kind === 'oauth' && oauthMethod === 'authlink') ? (
            <div className='space-y-1.5'>
              <Label htmlFor='pool-creds'>
                {kind === 'apikey'
                  ? 'API Key（每行一个）'
                  : kind === 'oauth' && oauthMethod === 'rt'
                    ? '凭据内容（每行 access_token|refresh_token）'
                    : '凭据内容（每行一个号）'}
              </Label>
              <textarea
                id='pool-creds'
                className='w-full rounded-md border bg-transparent p-2 text-sm font-mono'
                rows={4}
                value={creds}
                onChange={(e) => setCreds(e.target.value)}
                autoComplete='off'
                spellCheck={false}
                placeholder={
                  kind === 'apikey'
                    ? 'sk-ant-api03-...\nsk-ant-api03-...'
                    : kind === 'oauth' && oauthMethod === 'rt'
                      ? 'sk-ant-api03-...|sk-ant-oat01-...'
                      : 'sk-ant-sid01-... 或 access token\n支持逗号 / 空格 / 换行分隔，自动去重'
                }
              />
            </div>
          ) : (
            <p className='text-xs text-muted-foreground'>
              授权链接模式：填号名前缀后提交，系统建号位并生成 Claude
              登录链接，打开登录后把回调 URL 粘回来换票。一次上 1 个号。
            </p>
          )}
          <div className='space-y-1.5'>
            <Label htmlFor='pool-prefix'>号名前缀（选填）</Label>
            <Input
              id='pool-prefix'
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              placeholder='如 shop-a，生成 shop-a-01 / shop-a-02'
              autoComplete='off'
            />
          </div>
          <div className='space-y-1.5'>
            <Label>出口 IP</Label>
            <div className='flex gap-2'>
              <button
                type='button'
                onClick={() => setProxyMode('auto')}
                className={`rounded-md border px-3 py-1.5 text-sm ${
                  proxyMode === 'auto'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'text-muted-foreground'
                }`}
              >
                自动匹配我的代理池
              </button>
              <button
                type='button'
                onClick={() => setProxyMode('manual')}
                className={`rounded-md border px-3 py-1.5 text-sm ${
                  proxyMode === 'manual'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'text-muted-foreground'
                }`}
              >
                手动粘贴（与号 1:1）
              </button>
            </div>
            {proxyMode === 'manual' ? (
              <textarea
                className='w-full rounded-md border bg-transparent p-2 text-sm font-mono'
                rows={3}
                value={proxyLines}
                onChange={(e) => setProxyLines(e.target.value)}
                autoComplete='off'
                spellCheck={false}
                placeholder={'host:port:user:pass 或 socks5://user:pass@host:1080\n行序与上面的号一一对应'}
              />
            ) : (
              <p className='text-xs text-muted-foreground'>
                自动模式：从你导入的出口 IP 里按可用度挑一个绑到号上；没导入 IP 时走平台本地出口。
              </p>
            )}
          </div>
          <div className='space-y-1.5'>
            <Label>伪装档</Label>
            <div className='flex gap-2'>
              <button
                type='button'
                onClick={() => setDisguise('')}
                className={`rounded-md border px-3 py-1.5 text-sm ${
                  disguise === ''
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'text-muted-foreground'
                }`}
              >
                平台默认
              </button>
              {(Object.keys(DISGUISE_PRESETS) as DisguisePreset[]).map((p) => (
                <button
                  key={p}
                  type='button'
                  onClick={() => setDisguise(p)}
                  className={`rounded-md border px-3 py-1.5 text-sm ${
                    disguise === p
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'text-muted-foreground'
                  }`}
                >
                  {DISGUISE_PRESETS[p]}
                </button>
              ))}
            </div>
            <p className='text-xs text-muted-foreground'>
              出站 system/persona 身份档（官方 Claude Code 身份）。覆盖已有号时保持原号身份不变。
            </p>
          </div>
          {error ? <p className='text-sm text-destructive'>{error}</p> : null}
          {results.length > 0 ? (
            <div className='max-h-32 space-y-1 overflow-y-auto rounded-md border p-2'>
              {results.map((r) => (
                <div key={r.label} className='flex items-center justify-between text-xs'>
                  <span className='font-medium'>{r.label}</span>
                  <span className={r.ok ? 'text-emerald-600' : 'text-destructive'}>
                    {r.message}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type='submit'
              className='w-full'
              disabled={
                (kind === 'oauth' && oauthMethod === 'authlink'
                  ? false
                  : !creds.trim()) || pending
              }
              loading={pending}
            >
              <HardDriveUpload />
              {pending
                ? '入池中…'
                : kind === 'oauth' && oauthMethod === 'authlink'
                  ? '建号并生成授权链接'
                  : `导入号池${splitLines(creds).length > 1 ? `（${splitLines(creds).length} 个号）` : ''}`}
            </Button>
          </DialogFooter>
        </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
