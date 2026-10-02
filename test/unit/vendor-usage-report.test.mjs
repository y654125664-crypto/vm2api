import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createDatabase } from '../../src/lib/db/database.mjs'
import { UsageLogsRepo } from '../../src/lib/db/repos/usage-logs-repo.mjs'
import { PanelUserStore } from '../../src/lib/admin/panel-users.mjs'

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-vendor-usage-'))
  return { dir, db: createDatabase({ dataDir: dir }) }
}

test('aggregateByOwner groups platform rows out and vendors in', () => {
  const { db } = tmpDb()
  const repo = new UsageLogsRepo(db)
  const now = new Date().toISOString()
  const ins = db.prepare(`
    INSERT INTO usage_logs (created_at, status, user_id, api_key_id, vm_id, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, total_cost)
    VALUES (?, 200, ?, NULL, NULL, 1000, 500, 0, 0, ?)
  `)
  ins.run(now, 'u-1', 1.5)
  ins.run(now, 'u-1', 2.5)
  ins.run(now, 'u-2', 7.0)
  ins.run(now, null, 99.0) // platform traffic, must be excluded
  const rows = repo.aggregateByOwner({})
  assert.equal(rows.length, 2)
  const u1 = rows.find((r) => r.owner_user_id === 'u-1')
  const u2 = rows.find((r) => r.owner_user_id === 'u-2')
  assert.equal(u1.requests, 2)
  assert.equal(u1.total_cost, 4)
  assert.equal(u2.total_cost, 7)
  assert.ok(rows[0].total_cost >= rows[1].total_cost, 'sorted by cost desc')
})

test('vendor-usage payout math matches share', () => {
  const { db } = tmpDb()
  const store = new PanelUserStore({ db })
  store.bootstrapFromEnv({ username: 'admin', password: 'adminpass' })
  const v = store.create({ username: 'vendor', password: 'longenough', role: 'user', vendor_share: 25 })
  assert.equal(v.vendor_share, 25)
  const total = 10
  const payout = Math.round(total * (v.vendor_share / 100) * 10000) / 10000
  assert.equal(payout, 2.5)
})
