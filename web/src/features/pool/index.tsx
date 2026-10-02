import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { VIEW_TITLES } from '@/config/nav'
import { api } from '@/lib/api'
import { fmtAgo } from '@/lib/format'
import { importErrorMessage } from '@/lib/import-errors'
import type { Vm } from '@/types/panel-vm'
import { toast } from 'sonner'
import { HardDriveUpload, Plus } from 'lucide-react'
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

// 号池页把底层「虚拟机=号位」完全藏掉：供应商只看到「我的号」。
// 上号 = 自动 POST /vms/create（盖 owner 戳、吃自建配额）再 POST /vms/import 凭据。

// 与 vm/credential-panel.tsx 保持一致：sk-ant-sid 前缀走 cookie 换票分支。
const SESSION_KEY_PREFIX = /^sk-ant-sid/i

const CRED_KIND_LABELS = {
  apikey: 'SK / API Key',
  oauth: 'OAuth 会话令牌',
  'setup-token': 'Setup Token',
} as const

type CredKind = keyof typeof CRED_KIND_LABELS

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

        <div className='overflow-x-auto rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>号</TableHead>
                <TableHead>账号</TableHead>
                <TableHead>凭据类型</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>上次探测</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className='h-28 text-center'>
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
                  <TableCell>
                    {CRED_LABEL(v)}
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
          onSuccess={() => {
            toast.success('号已入池')
            setCreateOpen(false)
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

function PoolStatusBadge({ vm }: { vm: Vm }) {
  if (vm.schedule_state === 'off') return <Badge variant='outline'>停用</Badge>
  if (vm.schedule_state === 'restricted' || !vm.availability?.usable)
    return <Badge variant='destructive'>受限</Badge>
  return <Badge variant='secondary'>正常</Badge>
}

function PoolImportDialog({
  open,
  onOpenChange,
  onDone,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => Promise<unknown>
  onSuccess?: (vmId: string) => unknown
}) {
  const [kind, setKind] = useState<CredKind>('oauth')
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  const reset = () => {
    setName('')
    setValue('')
    setError('')
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    if (!value.trim()) {
      setError('请填写凭据内容')
      return
    }
    setPending(true)
    try {
      // 1) 建号位：走既有种子 VM 流程，服务端自动盖 owner 与自建配额。
      const created = await api<{ item?: Vm; id?: string }>(
        '/api/panel/vms/create',
        {
          method: 'POST',
          body: JSON.stringify(name.trim() ? { name: name.trim() } : {}),
        },
      )
      const vmId = created?.item?.id ?? created?.id
      if (!vmId) throw new Error('创建号位失败：未返回 vm id')
      // 2) 导入凭据（字段映射对齐 vm/credential-panel.tsx）。
      const body: Record<string, unknown> = { vm_id: vmId }
      if (kind === 'apikey') {
        body.type = 'apikey'
        body.api_key = value.trim()
      } else {
        if (kind === 'setup-token') {
          body.type = 'setup-token'
          body.scope = 'inference'
        }
        const v = value.trim()
        if (SESSION_KEY_PREFIX.test(v)) body.session_key = v
        else body.access_token = v
      }
      await api('/api/panel/vms/import', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      reset()
      onSuccess?.(vmId)
      await onDone()
    } catch (e) {
      setError(importErrorMessage(e as Error))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <form className='space-y-4' onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>上号</DialogTitle>
            <DialogDescription>
              凭据只提交一次、不回显。入池后由平台自动调度出流，占你名下的自建配额。
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
          <div className='space-y-1.5'>
            <Label htmlFor='pool-name'>号标签（选填）</Label>
            <Input
              id='pool-name'
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder='留空自动编号'
              autoComplete='off'
            />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='pool-cred'>
              {kind === 'apikey' ? 'API Key（sk-ant-api...）' : '凭据内容'}
            </Label>
            <Input
              id='pool-cred'
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoComplete='off'
              spellCheck={false}
              placeholder={
                kind === 'apikey'
                  ? 'sk-ant-api03-...'
                  : 'sk-ant-sid / 访问令牌 / setup token'
              }
            />
          </div>
          {error ? <p className='text-sm text-destructive'>{error}</p> : null}
          <DialogFooter>
            <Button
              type='submit'
              className='w-full'
              disabled={!value.trim() || pending}
              loading={pending}
            >
              <HardDriveUpload />
              {pending ? '入池中…' : '导入号池'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
