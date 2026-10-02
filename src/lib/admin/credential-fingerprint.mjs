/**
 * 凭据指纹与导入去重判定。
 *
 * 指纹基于「粘贴的原始凭据」而非换票后的 access token —— 会话令牌每次
 * sid→OAuth 换出的 token 都不同，只有原始凭据是稳定的判定锚点（对齐
 * ccg 的语义：同一凭据重复上号不应在池子里长出第二个号位）。
 *
 * 动作：
 *   new      — 没有命中，正常建新号位
 *   replace  — 命中自己（或管理员视角任意）号位，覆盖凭据、沿用号位与用量
 *   blocked  — 命中其他供应商在用的号位，拒绝导入
 */

import { createHash } from 'node:crypto'
import { vmOriginOf, VM_ORIGIN } from './resource-owner.mjs'

export function credentialFingerprint(value) {
  const normalized = String(value || '').trim()
  if (!normalized) return ''
  return createHash('sha256').update(`raw:${normalized}`).digest('hex')
}

/**
 * @param {string|null} ownerId 当前操作者的 panel user id（admin 传 null）
 * @param {'admin'|'user'} role
 */
export function resolveImportDuplicate({ fingerprint, vms, ownerId, role }) {
  if (!fingerprint) return { action: 'new', vm_id: null, hit: null }
  const hit = (vms || []).find(
    (vm) => vm && vm.credential_fingerprint === fingerprint,
  )
  if (!hit) return { action: 'new', vm_id: null, hit: null }
  if (role === 'admin') return { action: 'replace', vm_id: hit.id, hit }
  const owner = String(ownerId || '').trim()
  const hitOwner = String(hit.owner_user_id || '').trim()
  const hitIsOwnUserCreated =
    owner && hitOwner === owner && vmOriginOf(hit) === VM_ORIGIN.userCreated
  if (hitIsOwnUserCreated) return { action: 'replace', vm_id: hit.id, hit }
  return { action: 'blocked', vm_id: hit.id, hit }
}
