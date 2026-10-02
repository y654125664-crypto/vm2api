import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createDatabase } from '../../src/lib/db/database.mjs'
import { PanelUserStore } from '../../src/lib/admin/panel-users.mjs'
import {
  VENDOR_REGISTRATION_SETTING,
  registerVendor,
  saveVendorSettings,
  vendorSettingsOf,
} from '../../src/lib/admin/vendor.mjs'

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-vendor-'))
  const db = createDatabase({ dataDir: dir })
  const store = new PanelUserStore({ db })
  store.bootstrapFromEnv({ username: 'admin', password: 'adminpass' })
  return { dir, db, store }
}

test('vendor registration is closed by default', () => {
  const { store } = tmpStore()
  assert.equal(vendorSettingsOf(store).enabled, false)
  assert.throws(() => registerVendor(store, { username: 'vendor1', password: 'longenough' }), /未开放/)
})

test('register creates enabled vendor user with default share', () => {
  const { store } = tmpStore()
  saveVendorSettings(store, { enabled: true, default_share: 30 })
  const rec = registerVendor(store, { username: 'vendor1', password: 'longenough', contact: 'tg:@v1' })
  assert.equal(rec.role, 'user')
  assert.equal(rec.vendor_share, 30)
  assert.equal(rec.enabled, true)
  const raw = store.getByUsername('vendor1')
  assert.equal(raw.notes, 'tg:@v1')
  assert.throws(() => registerVendor(store, { username: 'vendor1', password: 'longenough' }), /已存在/)
})

test('vendor share is admin-managed and clamped to 0-100', () => {
  const { store } = tmpStore()
  saveVendorSettings(store, { enabled: true, default_share: 20 })
  const vendor = registerVendor(store, { username: 'vend2', password: 'longenough' })
  const updated = store.update(vendor.id, { vendor_share: 55 })
  assert.equal(updated.vendor_share, 55)
  assert.throws(() => store.update(vendor.id, { vendor_share: 120 }), /分成比例/)
  assert.throws(() => store.update(vendor.id, { vendor_share: -1 }), /分成比例/)
})

test('settings round-trip and invalid shares fall back', () => {
  const { store } = tmpStore()
  const s1 = saveVendorSettings(store, { enabled: true, default_share: 10 })
  assert.equal(s1.enabled, true)
  const s2 = saveVendorSettings(store, { enabled: false, default_share: 999 })
  assert.equal(s2.enabled, false)
  assert.equal(s2.default_share, 100)
  assert.equal(VENDOR_REGISTRATION_SETTING, 'vendor_registration')
})
