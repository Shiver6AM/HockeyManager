/**
 * Local username/password auth with server-side sessions.
 * Swappable for Supabase Auth later: everything else only depends on
 * `userFromToken` returning a user.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Queryable } from './db';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const SESSION_DAYS = 30;

export interface User {
  id: string;
  username: string;
  displayName: string;
}

export const newId = (prefix: string) => `${prefix}_${randomBytes(9).toString('base64url')}`;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, saltB64, keyB64] = stored.split('$');
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(key, expected);
}

export async function createSession(db: Queryable, userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.query(`insert into sessions (token, user_id, expires_at) values ($1, $2, now() + interval '${SESSION_DAYS} days')`, [
    token,
    userId,
  ]);
  return token;
}

export async function userFromToken(db: Queryable, token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const rows = await db.query<{ id: string; username: string; display_name: string }>(
    `select u.id, u.username, u.display_name from sessions s join users u on u.id = s.user_id
     where s.token = $1 and s.expires_at > now()`,
    [token],
  );
  const r = rows[0];
  return r ? { id: r.id, username: r.username, displayName: r.display_name } : null;
}

export async function deleteSession(db: Queryable, token: string) {
  await db.query('delete from sessions where token = $1', [token]);
}
