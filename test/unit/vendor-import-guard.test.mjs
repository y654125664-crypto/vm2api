import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createPanelHandler } from '../../src/lib/admin/panel-routes.mjs'
import { atomicWriteJson } from '../../src/lib/vm/vm-file.mjs'

function makeHandler(project, body, role, userId) {
  const response = {}
  const handlePanel = createPanelHandler({
    cfg: { paths: { project } },
    requireAuth(req) {
      req.panelRole = role
      req.panelUser = userId
      req.panelUserId = userId
      return true
    },
    json(_res, status, payload) {
      response.status = status
      response.body = payload
      return true
    },
    readBody: async () => body,
    proxyPool: {
      allocateForVm() {
        return null
      },
      getProxyForVm() {
        return null
      },
    },
  })
  return { handlePanel, response }
}

function seedVm(project, id, ownerUserId, origin) {
  const dir = path.join(project, 'vms')
  fs.mkdirSync(dir, { recursive: true })
  const vm = {
    id,
    platform: 'anthropic',
    owner_user_id: ownerUserId,
    origin,
    status: 'stopped',
    schedulable: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    seed_policy: {},
    stats: {},
  }
  atomicWriteJson(path.join(dir, `${id}.json`), vm, { mode: 0o600 })
}

test('user cannot import into someone else slot', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-import-'))
  try {
    seedVm(root, 'vm-admin', null, 'platform')
    const { handlePanel, response } = makeHandler(
      root,
      { vm_id: 'vm-admin', session_key: 'sk-ant-sid01-x' },
      'user',
      'u-1',
    )
    const handled = await handlePanel({ method: 'POST' }, {}, new URL('http://localhost/api/panel/vms/import'))
    assert.equal(handled, true)
    assert.equal(response.status, 403, JSON.stringify(response.body))
    assert.equal(response.body?.error?.code, 'forbidden')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('user can import into own user_created slot', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-import-own-'))
  try {
    seedVm(root, 'vm-mine', 'u-1', 'user_created')
    const { handlePanel, response } = makeHandler(
      root,
      { vm_id: 'vm-mine', session_key: 'sk-ant-sid01-x' },
      'user',
      'u-1',
    )
    const handled = await handlePanel({ method: 'POST' }, {}, new URL('http://localhost/api/panel/vms/import'))
    assert.equal(handled, true)
    // not 403: the guard lets it through (later failure is the fake credential)
    assert.notEqual(response.status, 403, JSON.stringify(response.body))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
