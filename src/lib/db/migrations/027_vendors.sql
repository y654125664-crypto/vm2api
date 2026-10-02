-- 027_vendors — vendor (key supplier) profile on users.
--
-- A vendor is an enabled user (role 'user') that registers via the public
-- /api/panel/register endpoint when the vendor_registration setting is on.
-- vendor_share is the revenue-share percentage (0-100), admin-managed.

ALTER TABLE users ADD COLUMN vendor_share REAL NOT NULL DEFAULT 0;
