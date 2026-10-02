import { useState } from 'react'
import { toast } from 'sonner'
import { registerVendorRequest } from '@/lib/api'
import { apiBase, setApiBase } from '@/lib/session'
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

// Mirrors assertPassword() in src/lib/admin/panel-users.mjs.
const PASSWORD_MIN = 8

export function RegisterVendorDialog({
  open,
  onOpenChange,
  base,
  hideBase,
  onRegistered,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Login form's API base selection — registration targets the same server. */
  base: string
  hideBase: boolean
  onRegistered?: (username: string) => void
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [contact, setContact] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  const reset = () => {
    setUsername('')
    setPassword('')
    setConfirm('')
    setContact('')
    setError('')
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    if (password.length < PASSWORD_MIN) {
      setError(`密码至少 ${PASSWORD_MIN} 位`)
      return
    }
    if (password !== confirm) {
      setError('两次输入的密码不一致')
      return
    }
    setPending(true)
    try {
      if (hideBase) setApiBase('')
      else setApiBase(base)
      await registerVendorRequest({
        username: username.trim(),
        password,
        contact,
        base: hideBase ? '' : base.trim().replace(/\/$/, '') || apiBase(),
      })
      toast.success('注册成功，请使用新账号登录')
      reset()
      onOpenChange(false)
      onRegistered?.(username.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册失败')
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
            <DialogTitle>供应商注册</DialogTitle>
            <DialogDescription>
              注册后登录本面板即可查看您名下的 VM 与号池用量；分成比例由管理员设置。
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-2'>
            <Label htmlFor='reg-username'>用户名</Label>
            <Input
              id='reg-username'
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete='username'
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='reg-password'>密码</Label>
            <Input
              id='reg-password'
              type='password'
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete='new-password'
              placeholder={`${PASSWORD_MIN}–128 位`}
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='reg-confirm'>确认密码</Label>
            <Input
              id='reg-confirm'
              type='password'
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete='new-password'
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='reg-contact'>联系方式（选填）</Label>
            <Input
              id='reg-contact'
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder='微信 / Telegram / 邮箱'
            />
          </div>
          {error ? <p className='text-sm text-destructive'>{error}</p> : null}
          <DialogFooter>
            <Button
              type='submit'
              className='w-full'
              disabled={
                pending ||
                !username.trim() ||
                !password ||
                password !== confirm
              }
            >
              {pending ? '注册中…' : '注册'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
