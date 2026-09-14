/**
 * Neon cloud-sync endpoint configuration.
 *
 * The app talks directly to Neon's Data API (SQL over HTTP) from the
 * browser, so the app works as a pure static PWA with no server of its
 * own. The credentials below belong to the `workout_app` Postgres role,
 * which is deliberately restricted: it can only read/insert/update/delete
 * rows in the `app_items`, `app_blobs` and `app_meta` tables. It cannot
 * create tables, read other schemas, or manage the database.
 *
 * Note: anyone who extracts these credentials from the app bundle could
 * read or modify cloud-synced rows for this app (they would still need a
 * valid passcode-derived user ID to find data, and a device's passcode to
 * enroll/link). For a personal app this is an acceptable trade; rotate
 * the role password in the Neon console if you ever feel exposed.
 */
export const NEON_SQL_URL =
  'https://ep-tiny-pine-zagjp18z-pooler.c-2.eu-west-2.aws.neon.tech/sql';
export const NEON_CONN =
  'postgresql://workout_app:wp_9f3a7c1e8b42d605@ep-tiny-pine-zagjp18z-pooler.c-2.eu-west-2.aws.neon.tech/neondb?sslmode=require';
