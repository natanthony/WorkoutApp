/**
 * Passcode auth for cloud sync. There are no accounts or emails: the
 * passcode IS the identity. From it we derive (a) the user_id that keys
 * every cloud row, and (b) a salted hash stored in app_meta so a wrong
 * passcode is rejected without revealing whether a library exists.
 *
 * Anyone who knows the passcode can link a device and read/write the
 * library — treat it like a password.
 */
import { cloudSql, lit } from './api';

const SESSION_KEY = 'workout-player-cloud-session';

export interface CloudSession {
  userId: string;
  passcode: string;
}

async function sha256hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const userIdFor = (passcode: string): Promise<string> =>
  sha256hex(`workout-player:user:${passcode}`);

const passHash = (passcode: string, salt: string): Promise<string> =>
  sha256hex(`workout-player:pass:${salt}:${passcode}`);

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function cloudSession(): CloudSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CloudSession>;
    return typeof parsed.userId === 'string' && typeof parsed.passcode === 'string'
      ? { userId: parsed.userId, passcode: parsed.passcode }
      : null;
  } catch {
    return null;
  }
}

export function cloudLogout(): void {
  localStorage.removeItem(SESSION_KEY);
}

function assertPasscodeStrength(passcode: string): void {
  if (passcode.length < 8) throw new Error('Passcode must be at least 8 characters.');
}

/** Create a new cloud library keyed to this passcode. */
export async function cloudEnroll(passcode: string): Promise<CloudSession> {
  assertPasscodeStrength(passcode);
  const userId = await userIdFor(passcode);
  const existing = await cloudSql(`SELECT user_id FROM app_meta WHERE user_id = ${lit(userId)}`);
  if (existing.length > 0) {
    throw new Error('A cloud library already exists for this passcode — use "Link this device" instead.');
  }
  const salt = randomHex(16);
  await cloudSql(
    `INSERT INTO app_meta (user_id, passcode_hash, salt, created_at) VALUES (${lit(userId)}, ${lit(await passHash(passcode, salt))}, ${lit(salt)}, ${Date.now()})`,
  );
  const session = { userId, passcode };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

/** Link this device to an existing cloud library. */
export async function cloudLink(passcode: string): Promise<CloudSession> {
  assertPasscodeStrength(passcode);
  const userId = await userIdFor(passcode);
  const rows = await cloudSql(`SELECT passcode_hash, salt FROM app_meta WHERE user_id = ${lit(userId)}`);
  if (rows.length === 0) throw new Error('No cloud library found for this passcode.');
  const salt = String(rows[0].salt);
  if ((await passHash(passcode, salt)) !== String(rows[0].passcode_hash)) {
    throw new Error('Wrong passcode.');
  }
  const session = { userId, passcode };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}
