/**
 * Vendor (key supplier) self-registration.
 *
 * Gate is stored in the settings table under VENDOR_REGISTRATION_SETTING:
 * { enabled: boolean, default_share: 0-100 }. Admins toggle it via
 * /api/panel/vendor-settings; the public endpoint below is the only
 * unauthenticated user-creation path in the panel.
 */

import { SettingsRepo } from '../db/repos/settings-repo.mjs'
import { publicUserView } from './panel-users.mjs'

export const VENDOR_REGISTRATION_SETTING = 'vendor_registration'

export function vendorSettingsOf(store) {
  const settings = new SettingsRepo(store.db)
  const rec = settings.get(VENDOR_REGISTRATION_SETTING) || {}
  return {
    enabled: rec.enabled === true,
    default_share: clampVendorShare(rec.default_share, 0),
  }
}

export function saveVendorSettings(store, patch = {}) {
  const next = { ...vendorSettingsOf(store) }
  if (patch.enabled != null) next.enabled = patch.enabled === true
  if (patch.default_share != null) next.default_share = clampVendorShare(patch.default_share, next.default_share)
  new SettingsRepo(store.db).set(VENDOR_REGISTRATION_SETTING, next)
  return next
}

function clampVendorShare(value, fallback = 0) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(100, Math.round(n * 100) / 100))
}

/** Self-service vendor signup. Throws with .code on validation errors. */
export function registerVendor(store, { username, password, contact = '' } = {}) {
  const settings = vendorSettingsOf(store)
  if (!settings.enabled) {
    const err = new Error('供应商注册未开放')
    err.code = 'registration_closed'
    throw err
  }
  const rec = store.create({
    username,
    password,
    role: 'user',
    enabled: true,
    vm_create_quota: 0,
    vendor_share: settings.default_share,
    notes: typeof contact === 'string' ? contact.slice(0, 500) : '',
  })
  return publicUserView(rec)
}
