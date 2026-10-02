import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { VIEW_TITLES } from '@/config/nav'
import type { PanelRole } from '@/types/panel-auth'
import type { PanelUser, VendorSettings } from '@/types/panel-users'
import { BarChart3, KeyRound, Pencil, Percent, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { api, panelFetch } from '@/lib/api'
import { fmtAgo, fmtNum, fmtUsd } from '@/lib/format'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { PageHeader } from '@/components/page-header'
import { TableSkeleton } from '@/components/page-skeletons'
import { PasswordInput } from '@/components/password-input'
import { QueryGate } from '@/components/query-gate'
import { usersQueryOptions, vendorSettingsQueryOptions, vendorUsageQueryOptions } from '@/features/users/queries'

// Mirrors assertPassword() in src/lib/admin/panel-users.mjs.
const PASSWORD_MIN = 8
const PASSWORD_MAX = 128

const ROLE_LABELS: Record<PanelRole, string> = {
  admin: '管理员',
  super: '运维',
  user: '租户 / 供应商',
}

function passwordError(pass: string, confirm: string): string {
  if (!pass) return ''
  if (pass.length < PASSWORD_MIN) return `密码至少 ${PASSWORD_MIN} 位`
  if (pass.length > PASSWORD_MAX) return `密码最多 ${PASSWORD_MAX} 位`
  if (confirm && pass !== confirm) return '两次输入的密码不一致'
  return ''
}

export function UsersPage() {
  const qc = useQueryClient()
  const me = useAuthStore((s) => s.me)
  const q = useQuery(usersQueryOptions())
  const items = q.data?.items || []
  const [createOpen, setCreateOpen] = useState(false)
  const [usageOpen, setUsageOpen] = useState(false)
  const [edit, setEdit] = useState<PanelUser | null>(null)
  const [pwTarget, setPwTarget] = useState<PanelUser | null>(null)
  const [del, setDel] = useState<PanelUser | null>(null)
  const refresh = () =>
    qc.invalidateQueries({ queryKey: usersQueryOptions().queryKey })

  return (
    <PageHeader
      title={VIEW_TITLES.users}
      extra={
        <>
          <Button variant='outline' onClick={() => setUsageOpen(true)}>
            <BarChart3 />
            分账报表
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus />
            新建用户
          </Button>
        </>
      }
    >
      <VendorSettingsCard />
      <QueryGate
        loading={q.isLoading}
        error={q.error}
        skeleton={<TableSkeleton rows={8} columns={6} />}
      >
        <div className='overflow-x-auto rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>用户名</TableHead>
                <TableHead>角色</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>自建配额</TableHead>
                <TableHead>分成</TableHead>
                <TableHead>最近登录</TableHead>
                <TableHead className='text-end'>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className='h-24 text-center text-muted-foreground'
                  >
                    暂无用户
                  </TableCell>
                </TableRow>
              ) : null}
              {items.map((u) => {
                const isSelf = u.username === me?.user
                return (
                  <TableRow key={u.id}>
                    <TableCell
                      className='font-medium'
                      title={u.notes || undefined}
                    >
                      {u.username}
                      {isSelf ? (
                        <span className='ms-2 text-xs text-muted-foreground'>
                          (当前)
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={u.role === 'admin' ? 'default' : 'secondary'}
                      >
                        {ROLE_LABELS[u.role] || u.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {u.enabled === false ? (
                        <Badge variant='outline'>已停用</Badge>
                      ) : (
                        <Badge variant='secondary'>启用</Badge>
                      )}
                    </TableCell>
                    <TableCell className='tabular-nums'>
                      {u.vm_create_quota ?? 0}
                    </TableCell>
                    <TableCell className='tabular-nums'>
                      {u.vendor_share ? `${u.vendor_share}%` : '—'}
                    </TableCell>
                    <TableCell
                      className='text-muted-foreground'
                      title={u.last_login_at || ''}
                    >
                      {fmtAgo(u.last_login_at) || '从未'}
                    </TableCell>
                    <TableCell className='space-x-1 text-end whitespace-nowrap'>
                      <Button
                        size='sm'
                        variant='ghost'
                        onClick={() => setEdit(u)}
                      >
                        <Pencil />
                        编辑
                      </Button>
                      <Button
                        size='sm'
                        variant='ghost'
                        onClick={() => setPwTarget(u)}
                      >
                        <KeyRound />
                        改密码
                      </Button>
                      <Button
                        size='sm'
                        variant='ghost'
                        className='text-destructive hover:text-destructive'
                        disabled={isSelf}
                        title={isSelf ? '不能删除当前登录账号' : undefined}
                        onClick={() => setDel(u)}
                      >
                        <Trash2 />
                        删除
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </QueryGate>

      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onDone={refresh}
      />
      <EditUserDialog
        user={edit}
        isSelf={!!edit && edit.username === me?.user}
        onClose={() => setEdit(null)}
        onDone={refresh}
      />
      <PasswordDialog
        user={pwTarget}
        isSelf={!!pwTarget && pwTarget.username === me?.user}
        onClose={() => setPwTarget(null)}
        onDone={refresh}
      />
      <ConfirmDialog
        open={!!del}
        onOpenChange={() => setDel(null)}
        title={`删除 ${del?.username}`}
        desc='删除后该用户所有会话立即失效。不能删除最后一个管理员，也不能删除自己。'
        confirmText='删除'
        cancelBtnText='取消'
        destructive
        handleConfirm={() => {
          if (!del) return
          api(`/api/panel/users/${encodeURIComponent(del.id)}`, {
            method: 'DELETE',
          })
            .then(() => {
              toast.success('已删除')
              setDel(null)
              return refresh()
            })
            .catch((e: Error) => toast.error(e.message))
        }}
      />
      <VendorUsageDialog open={usageOpen} onOpenChange={setUsageOpen} />
    </PageHeader>
  )
}

function CreateUserDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => Promise<unknown>
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [role, setRole] = useState<PanelRole>('user')
  const [quota, setQuota] = useState(0)
  const [share, setShare] = useState(0)
  const [contact, setContact] = useState('')
  const [enabled, setEnabled] = useState(true)
  const pwErr = passwordError(password, confirm)

  const reset = () => {
    setUsername('')
    setPassword('')
    setConfirm('')
    setRole('user')
    setQuota(0)
    setShare(0)
    setContact('')
    setEnabled(true)
  }

  const create = useMutation({
    mutationFn: () =>
      api('/api/panel/users', {
        method: 'POST',
        body: JSON.stringify({
          username: username.trim(),
          password,
          role,
          enabled,
          vm_create_quota: quota,
          vendor_share: share,
          notes: contact,
        }),
      }),
    onSuccess: async () => {
      toast.success('已创建')
      reset()
      onOpenChange(false)
      await onDone()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <form
          className='space-y-4'
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle>新建用户</DialogTitle>
            <DialogDescription>
              用户名 2–32 位，字母开头，仅字母数字 . _ -
            </DialogDescription>
          </DialogHeader>
          <Field id='new-username' label='用户名'>
            <Input
              id='new-username'
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete='off'
            />
          </Field>
          <PasswordFields
            password={password}
            setPassword={setPassword}
            confirm={confirm}
            setConfirm={setConfirm}
            error={pwErr}
          />
          <RoleFields
            role={role}
            setRole={setRole}
            enabled={enabled}
            setEnabled={setEnabled}
            quota={quota}
            setQuota={setQuota}
          />
          <VendorFields share={share} setShare={setShare} contact={contact} setContact={setContact} />
          <DialogFooter>
            <Button
              type='submit'
              disabled={
                !username.trim() ||
                !password ||
                password !== confirm ||
                !!pwErr ||
                create.isPending
              }
              loading={create.isPending}
            >
              创建
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function EditUserDialog({
  user,
  isSelf,
  onClose,
  onDone,
}: {
  user: PanelUser | null
  isSelf: boolean
  onClose: () => void
  onDone: () => Promise<unknown>
}) {
  // Keyed by user id so the draft resets whenever a different row opens.
  return (
    <Dialog open={!!user} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        {user ? (
          <EditUserForm
            key={user.id}
            user={user}
            isSelf={isSelf}
            onClose={onClose}
            onDone={onDone}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function EditUserForm({
  user,
  isSelf,
  onClose,
  onDone,
}: {
  user: PanelUser
  isSelf: boolean
  onClose: () => void
  onDone: () => Promise<unknown>
}) {
  const [role, setRole] = useState<PanelRole>(user.role)
  const [enabled, setEnabled] = useState(user.enabled !== false)
  const [quota, setQuota] = useState(user.vm_create_quota ?? 0)
  const [share, setShare] = useState(user.vendor_share ?? 0)
  const [contact, setContact] = useState(user.notes ?? '')

  const patch = useMutation({
    mutationFn: () =>
      api(`/api/panel/users/${encodeURIComponent(user.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          role,
          enabled,
          vm_create_quota: quota,
          vendor_share: share,
          notes: contact,
        }),
      }),
    onSuccess: async () => {
      toast.success('已更新')
      onClose()
      await onDone()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <form
      className='space-y-4'
      onSubmit={(e) => {
        e.preventDefault()
        patch.mutate()
      }}
    >
      <DialogHeader>
        <DialogTitle>编辑 {user.username}</DialogTitle>
      </DialogHeader>
      <RoleFields
        role={role}
        setRole={setRole}
        enabled={enabled}
        setEnabled={setEnabled}
        quota={quota}
        setQuota={setQuota}
        lockSelf={isSelf}
      />
      <VendorFields share={share} setShare={setShare} contact={contact} setContact={setContact} />
      <DialogFooter>
        <Button
          type='submit'
          disabled={patch.isPending}
          loading={patch.isPending}
        >
          保存
        </Button>
      </DialogFooter>
    </form>
  )
}

function PasswordDialog({
  user,
  isSelf,
  onClose,
  onDone,
}: {
  user: PanelUser | null
  isSelf: boolean
  onClose: () => void
  onDone: () => Promise<unknown>
}) {
  return (
    <Dialog open={!!user} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        {user ? (
          <PasswordForm
            key={user.id}
            user={user}
            isSelf={isSelf}
            onClose={onClose}
            onDone={onDone}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function PasswordForm({
  user,
  isSelf,
  onClose,
  onDone,
}: {
  user: PanelUser
  isSelf: boolean
  onClose: () => void
  onDone: () => Promise<unknown>
}) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const pwErr = passwordError(password, confirm)

  const save = useMutation({
    mutationFn: () =>
      api(`/api/panel/users/${encodeURIComponent(user.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ password }),
      }),
    onSuccess: async () => {
      toast.success(
        isSelf
          ? '密码已修改，其它设备的会话已退出'
          : '密码已修改，该用户需重新登录'
      )
      onClose()
      await onDone()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <form
      className='space-y-4'
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <DialogHeader>
        <DialogTitle>修改密码 · {user.username}</DialogTitle>
        <DialogDescription>
          {isSelf
            ? '保存后当前会话保留，其它设备上的登录会失效。'
            : '保存后该用户所有已登录会话立即失效。'}
        </DialogDescription>
      </DialogHeader>
      <PasswordFields
        password={password}
        setPassword={setPassword}
        confirm={confirm}
        setConfirm={setConfirm}
        error={pwErr}
        newLabel='新密码'
      />
      <DialogFooter>
        <Button type='button' variant='outline' onClick={onClose}>
          取消
        </Button>
        <Button
          type='submit'
          disabled={
            !password || password !== confirm || !!pwErr || save.isPending
          }
          loading={save.isPending}
        >
          保存密码
        </Button>
      </DialogFooter>
    </form>
  )
}

function Field({
  id,
  label,
  children,
}: {
  id?: string
  label: string
  children: React.ReactNode
}) {
  return (
    <div className='space-y-1.5'>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  )
}

function PasswordFields({
  password,
  setPassword,
  confirm,
  setConfirm,
  error,
  newLabel = '密码',
}: {
  password: string
  setPassword: (v: string) => void
  confirm: string
  setConfirm: (v: string) => void
  error: string
  newLabel?: string
}) {
  return (
    <>
      <Field id='pw-new' label={newLabel}>
        <PasswordInput
          id='pw-new'
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete='new-password'
          placeholder={`${PASSWORD_MIN}–${PASSWORD_MAX} 位`}
          aria-invalid={!!error}
          aria-describedby={error ? 'pw-error' : undefined}
        />
      </Field>
      <Field id='pw-confirm' label='确认密码'>
        <PasswordInput
          id='pw-confirm'
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete='new-password'
          aria-invalid={!!error}
          aria-describedby={error ? 'pw-error' : undefined}
        />
      </Field>
      {error ? (
        <p id='pw-error' role='alert' className='text-xs text-destructive'>
          {error}
        </p>
      ) : null}
    </>
  )
}

function RoleFields({
  role,
  setRole,
  enabled,
  setEnabled,
  quota,
  setQuota,
  lockSelf,
}: {
  role: PanelRole
  setRole: (role: PanelRole) => void
  enabled: boolean
  setEnabled: (on: boolean) => void
  quota: number
  setQuota: (n: number) => void
  lockSelf?: boolean
}) {
  return (
    <>
      <Field id='user-role' label='角色'>
        <Select
          value={role}
          onValueChange={(v) => setRole(v as PanelRole)}
          disabled={lockSelf}
        >
          <SelectTrigger id='user-role' className='w-full'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(ROLE_LABELS) as PanelRole[]).map((r) => (
              <SelectItem key={r} value={r}>
                {ROLE_LABELS[r]} ({r})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field id='user-quota' label='自建 VM 配额 (0–100)'>
        <Input
          id='user-quota'
          type='number'
          min={0}
          max={100}
          value={quota}
          onChange={(e) =>
            setQuota(Math.max(0, Math.min(100, Number(e.target.value) || 0)))
          }
        />
      </Field>
      <div className='flex items-center justify-between'>
        <Label htmlFor='user-enabled'>启用</Label>
        <Switch
          id='user-enabled'
          checked={enabled}
          onCheckedChange={setEnabled}
          disabled={lockSelf}
        />
      </div>
      {lockSelf ? (
        <p className='text-xs text-muted-foreground'>
          不能修改自己的角色或停用自己 ——
          保存后会立刻失去访问权限，且无法自助恢复。
        </p>
      ) : null}
    </>
  )
}

function VendorFields({
  share,
  setShare,
  contact,
  setContact,
}: {
  share: number
  setShare: (n: number) => void
  contact: string
  setContact: (v: string) => void
}) {
  return (
    <>
      <Field id='user-share' label='供应商分成 % (0–100)'>
        <Input
          id='user-share'
          type='number'
          min={0}
          max={100}
          value={share}
          onChange={(e) =>
            setShare(Math.max(0, Math.min(100, Number(e.target.value) || 0)))
          }
        />
      </Field>
      <Field id='user-contact' label='联系方式（备注，选填）'>
        <Input
          id='user-contact'
          value={contact}
          maxLength={500}
          onChange={(e) => setContact(e.target.value)}
          placeholder='微信 / Telegram / 邮箱'
        />
      </Field>
    </>
  )
}

function VendorSettingsCard() {
  const qc = useQueryClient()
  const q = useQuery(vendorSettingsQueryOptions())
  const data = q.data
  const [enabled, setEnabled] = useState(false)
  const [share, setShare] = useState(0)
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    if (data && !touched) {
      setEnabled(!!data.enabled)
      setShare(Math.min(100, Math.max(0, data.default_share ?? 0)))
    }
  }, [data, touched])

  const save = useMutation({
    mutationFn: () =>
      api<VendorSettings>('/api/panel/vendor-settings', {
        method: 'PATCH',
        body: JSON.stringify({ enabled, default_share: share }),
      }),
    onSuccess: () => {
      setTouched(false)
      toast.success('供应商设置已保存')
      void qc.invalidateQueries({ queryKey: ['panel', 'vendor-settings'] })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <div className='rounded-md border p-4 space-y-3'>
      <div className='flex items-center gap-2 text-sm font-medium'>
        <Percent className='size-4' />
        供应商注册
      </div>
      <p className='text-xs text-muted-foreground'>
        开放后，登录页会出现「供应商注册」入口 ——
        供应商可自助创建账号（租户角色，按默认分成记录），导入条目按归属强制隔离。
      </p>
      <div className='flex flex-wrap items-end gap-4'>
        <div className='space-y-1.5'>
          <Label htmlFor='vendor-enabled'>开放注册</Label>
          <Switch
            id='vendor-enabled'
            checked={enabled}
            onCheckedChange={(v) => {
              setEnabled(v)
              setTouched(true)
            }}
          />
        </div>
        <div className='space-y-1.5'>
          <Label htmlFor='vendor-default-share'>默认分成 % (0–100)</Label>
          <Input
            id='vendor-default-share'
            type='number'
            min={0}
            max={100}
            className='w-40'
            value={share}
            onChange={(e) => {
              setShare(Math.max(0, Math.min(100, Number(e.target.value) || 0)))
              setTouched(true)
            }}
          />
        </div>
        <Button
          size='sm'
          onClick={() => save.mutate()}
          disabled={!touched || save.isPending}
          loading={save.isPending}
        >
          保存设置
        </Button>
        {q.error ? (
          <p className='text-xs text-muted-foreground'>
            设置加载失败：{(q.error as Error).message}
          </p>
        ) : null}
      </div>
    </div>
  )
}

function VendorUsageDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [since, setSince] = useState('')
  const [until, setUntil] = useState('')
  const q = useQuery({
    ...vendorUsageQueryOptions(since || undefined, until || undefined),
    enabled: open,
  })
  const items = q.data?.items ?? []

  async function downloadCsv() {
    try {
      const params = new URLSearchParams({ format: 'csv' })
      if (since) params.set('since', since)
      if (until) params.set('until', until)
      const res = await panelFetch(`/api/panel/vendor-usage?${params}`)
      if (!res.ok) throw new Error(`导出失败 HTTP ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'vendor-usage.csv'
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导出失败')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-3xl'>
        <DialogHeader>
          <DialogTitle>供应商分账报表</DialogTitle>
          <DialogDescription>
            按号池归属聚合用量，应付 = 总成本 × 该供应商分成比例。
          </DialogDescription>
        </DialogHeader>
        <div className='flex flex-wrap items-end gap-3'>
          <div className='space-y-1.5'>
            <Label htmlFor='usage-since'>起始日</Label>
            <Input
              id='usage-since'
              type='date'
              className='w-40'
              value={since}
              onChange={(e) => setSince(e.target.value)}
            />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='usage-until'>截止日</Label>
            <Input
              id='usage-until'
              type='date'
              className='w-40'
              value={until}
              onChange={(e) => setUntil(e.target.value)}
            />
          </div>
          <Button size='sm' variant='outline' onClick={downloadCsv}>
            导出 CSV
          </Button>
        </div>
        {q.isLoading ? (
          <p className='py-6 text-center text-sm text-muted-foreground'>
            加载中…
          </p>
        ) : q.error ? (
          <p className='py-6 text-center text-sm text-destructive'>
            加载失败：{(q.error as Error).message}
          </p>
        ) : items.length === 0 ? (
          <p className='py-6 text-center text-sm text-muted-foreground'>
            暂无按归属记录的用量数据
          </p>
        ) : (
          <div className='max-h-80 overflow-y-auto rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>用户名</TableHead>
                  <TableHead className='text-end'>请求数</TableHead>
                  <TableHead className='text-end'>输入</TableHead>
                  <TableHead className='text-end'>输出</TableHead>
                  <TableHead className='text-end'>成本</TableHead>
                  <TableHead className='text-end'>分成</TableHead>
                  <TableHead className='text-end'>应付</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((r) => (
                  <TableRow key={r.owner_user_id}>
                    <TableCell className='font-medium'>
                      {r.username}
                      {r.enabled === false ? (
                        <span className='ms-2 text-xs text-muted-foreground'>
                          (已停用)
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className='text-end tabular-nums'>
                      {fmtNum(r.requests)}
                    </TableCell>
                    <TableCell className='text-end tabular-nums'>
                      {fmtNum(r.input_tokens)}
                    </TableCell>
                    <TableCell className='text-end tabular-nums'>
                      {fmtNum(r.output_tokens)}
                    </TableCell>
                    <TableCell className='text-end tabular-nums'>
                      {fmtUsd(r.total_cost)}
                    </TableCell>
                    <TableCell className='text-end tabular-nums'>
                      {r.vendor_share}%
                    </TableCell>
                    <TableCell className='text-end tabular-nums'>
                      {fmtUsd(r.vendor_payout)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
