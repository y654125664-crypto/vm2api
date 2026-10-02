import test from 'node:test'
import assert from 'node:assert/strict'
import {
  credentialFingerprint,
  resolveImportDuplicate,
} from '../../src/lib/admin/credential-fingerprint.mjs'

const FP_A = credentialFingerprint('sk-ant-sid01-AAAA')
const FP_B = credentialFingerprint('sk-ant-sid01-BBBB')

test('credential fingerprint is deterministic, trimmed and salted', () => {
  assert.equal(FP_A, credentialFingerprint('  sk-ant-sid01-AAAA  \n'))
  assert.notEqual(FP_A, credentialFingerprint('sk-ant-sid01-AAAAA'))
  assert.notEqual(FP_A, '')
  assert.equal(credentialFingerprint(''), '')
  assert.equal(credentialFingerprint(null), '')
})

test('no hit → new', () => {
  const vms = [{ id: 'vm-01', credential_fingerprint: FP_B, owner_user_id: 'u1', origin: 'user_created' }]
  const result = resolveImportDuplicate({ fingerprint: FP_A, vms, ownerId: 'u1', role: 'user' })
  assert.deepEqual(result, { action: 'new', vm_id: null, hit: null })
})

test('same owner user_created hit → replace (keep slot & usage)', () => {
  const vms = [{ id: 'vm-01', credential_fingerprint: FP_A, owner_user_id: 'u1', origin: 'user_created' }]
  const result = resolveImportDuplicate({ fingerprint: FP_A, vms, ownerId: 'u1', role: 'user' })
  assert.equal(result.action, 'replace')
  assert.equal(result.vm_id, 'vm-01')
})

test('other vendor in-use hit → blocked', () => {
  const vms = [{ id: 'vm-09', credential_fingerprint: FP_A, owner_user_id: 'u2', origin: 'user_created' }]
  const result = resolveImportDuplicate({ fingerprint: FP_A, vms, ownerId: 'u1', role: 'user' })
  assert.equal(result.action, 'blocked')
  assert.equal(result.vm_id, 'vm-09')
})

test('platform / admin-assigned slots are never replaceable by vendors', () => {
  for (const origin of ['platform', 'admin_assigned']) {
    const vms = [{ id: 'vm-p', credential_fingerprint: FP_A, owner_user_id: 'u1', origin }]
    const result = resolveImportDuplicate({ fingerprint: FP_A, vms, ownerId: 'u1', role: 'user' })
    assert.equal(result.action, 'blocked')
  }
})

test('admin replaces any slot', () => {
  const vms = [{ id: 'vm-77', credential_fingerprint: FP_A, owner_user_id: 'someone-else', origin: 'user_created' }]
  const result = resolveImportDuplicate({ fingerprint: FP_A, vms, ownerId: null, role: 'admin' })
  assert.equal(result.action, 'replace')
  assert.equal(result.vm_id, 'vm-77')
})
