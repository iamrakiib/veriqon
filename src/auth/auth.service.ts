import { Injectable, UnauthorizedException, ConflictException, ForbiddenException, HttpException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } from 'crypto';
import { readFileSync } from 'fs';
import { RedisService } from '../common/redis.service';
import { DatabaseService } from '../database/database.service';

export type Account = { id: string; email: string; name: string; role: string };
type UserRow = Account & { password_hash: string };
export const ACCESS_SECONDS = 15 * 60;
export const SESSION_SECONDS = 7 * 24 * 60 * 60;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
let passwordWork = 0;
async function derive(password: string, salt: string): Promise<Buffer> {
  // Bound memory-hard password work on small API instances; never queue it without limit.
  if (passwordWork >= 2) throw new HttpException('Sign-in is busy. Please retry shortly.', 429);
  passwordWork++;
  try { return await new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key))); }
  finally { passwordWork--; }
}

@Injectable()
export class AuthService {
  private readonly secret: string;
  private readonly dummy = `scrypt$${'0'.repeat(32)}$${'0'.repeat(128)}`;
  constructor(private readonly database: DatabaseService, private readonly jwt: JwtService, @Optional() private readonly redis?: RedisService) {
    this.secret = process.env.JWT_SECRET?.trim() || '';
    if (this.secret.length < 32) throw new Error('JWT_SECRET must be configured with at least 32 random characters.');
  }
  async status() { return { needsSetup: !(await this.database.hasUsers()), registrationEnabled: process.env.ALLOW_REGISTRATION !== 'false' }; }
  async limit(ip: string, email = '') {
    const now = Date.now();
    if (!this.redis?.enabled) await this.database.run('DELETE FROM auth_limits WHERE reset_at<=?', now);
    for (const [key, maximum] of [[`ip:${ip}`, 30], ...(email ? [[`email:${digest(email)}`, 10] as const] : [])] as [string, number][]) {
      if (this.redis?.enabled) { await this.redis.limit(key, maximum, 15 * 60000, 'Too many sign-in attempts. Try again in 15 minutes.'); continue; }
      const row = await this.database.get(`INSERT INTO auth_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=auth_limits.count+1 RETURNING count`, key, now + 15 * 60000);
      if (Number(row!.count) > maximum) throw new HttpException('Too many sign-in attempts. Try again in 15 minutes.', 429);
    }
  }
  async register(email: string, name: string, password: string, setupCode?: string) {
    email = email.trim().toLowerCase(); name = name.trim();
    const needsSetup = !(await this.database.hasUsers());
    if (needsSetup) {
      let expected = process.env.SETUP_CODE?.trim() || '';
      try { if (!expected && this.database.dialect === 'sqlite') expected = readFileSync(this.database.setupFile, 'utf8').trim(); } catch { /* Setup is denied without the server-local code. */ }
      if (!expected || !setupCode || !timingSafeEqual(Buffer.from(digest(expected)), Buffer.from(digest(setupCode.trim())))) throw new ForbiddenException('Enter the setup code from the server to create the owner account.');
    } else if (process.env.ALLOW_REGISTRATION === 'false') throw new ForbiddenException('Registration is disabled. Contact the workspace owner.');
    const salt = randomBytes(16).toString('hex');
    const passwordHash = `scrypt$${salt}$${(await derive(password, salt)).toString('hex')}`;
    const user: Account = { id: randomUUID(), email, name, role: needsSetup ? 'owner' : 'member' };
    let recoveryCodes: string[] = [];
    await this.database.transaction(async () => {
      if (this.database.dialect === 'postgresql') await this.database.get('SELECT pg_advisory_xact_lock(742902)');
      if (needsSetup && await this.database.hasUsers()) throw new ConflictException('Setup is already complete. Sign in or create a regular account.');
      if (await this.database.get('SELECT id FROM users WHERE email=?', email)) throw new ConflictException('An account with this email already exists. Sign in instead.');
      await this.database.run('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)', user.id, email, name, passwordHash, user.role, Date.now());
      if (needsSetup) await this.database.importLegacy(user.id);
      recoveryCodes = await this.replaceRecoveryCodes(user.id);
    });
    return { ...await this.createSession(user), recoveryCodes };
  }
  private async securityEvent(userId: string, event: string) {
    await this.database.run('INSERT INTO security_events VALUES(?,?,?,?)', randomUUID(), userId, event, Date.now());
  }
  private async replaceRecoveryCodes(userId: string) {
    const codes = Array.from({ length: 8 }, () => randomBytes(16).toString('hex').toUpperCase().match(/.{8}/g)!.join('-'));
    await this.database.run('DELETE FROM recovery_codes WHERE user_id=?', userId);
    for (const code of codes) await this.database.run('INSERT INTO recovery_codes VALUES(?,?,?)', userId, digest(code.replace(/-/g, '')), Date.now());
    await this.securityEvent(userId, 'recovery_codes_generated');
    return codes;
  }
  async recoveryStatus(userId: string) {
    return { remaining: Number((await this.database.get('SELECT COUNT(*) AS count FROM recovery_codes WHERE user_id=?', userId))!.count) };
  }
  async generateRecoveryCodes(userId: string, password: string) {
    const row = await this.database.get('SELECT password_hash FROM users WHERE id=?', userId);
    const [, salt, hash] = String(row?.password_hash || this.dummy).split('$');
    if (!timingSafeEqual(await derive(password, salt), Buffer.from(hash, 'hex')) || !row) throw new ForbiddenException('Password is incorrect.');
    return this.database.transaction(async () => {
      const current = await this.database.get(`SELECT password_hash FROM users WHERE id=?${this.database.dialect === 'postgresql' ? ' FOR UPDATE' : ''}`, userId);
      if (current?.password_hash !== row.password_hash) throw new UnauthorizedException('Your password changed. Sign in again.');
      return { codes: await this.replaceRecoveryCodes(userId) };
    });
  }
  async recoverPassword(email: string, code: string, password: string) {
    const salt = randomBytes(16).toString('hex');
    // Equal password work for known/unknown accounts; no email-enumeration response.
    const passwordHash = `scrypt$${salt}$${(await derive(password, salt)).toString('hex')}`;
    const codeHash = digest(code.replace(/[\s-]/g, '').toUpperCase());
    await this.database.transaction(async () => {
      const user = await this.database.get(`SELECT id FROM users WHERE email=?${this.database.dialect === 'postgresql' ? ' FOR UPDATE' : ''}`, email.trim().toLowerCase());
      if (!user) throw new UnauthorizedException('Email or recovery code is invalid, used, or replaced.');
      const consumed = await this.database.run('DELETE FROM recovery_codes WHERE user_id=? AND code_hash=?', user.id, codeHash);
      if (!consumed.changes) throw new UnauthorizedException('Email or recovery code is invalid, used, or replaced.');
      await this.database.run('UPDATE users SET password_hash=? WHERE id=?', passwordHash, user.id);
      await this.database.run('DELETE FROM sessions WHERE user_id=?', user.id);
      await this.securityEvent(user.id, 'password_recovered_sessions_revoked');
    });
    return { success: true };
  }
  async login(email: string, password: string) {
    const user = await this.database.get('SELECT id,email,name,role,password_hash FROM users WHERE email=?', email.trim().toLowerCase()) as UserRow | undefined;
    const [, salt, hash] = (user?.password_hash || this.dummy).split('$');
    const actual = await derive(password, salt);
    if (!user || !timingSafeEqual(actual, Buffer.from(hash, 'hex'))) throw new UnauthorizedException('Email or password is incorrect.');
    return this.database.transaction(async () => {
      const current = await this.database.get(`SELECT password_hash FROM users WHERE id=?${this.database.dialect === 'postgresql' ? ' FOR UPDATE' : ''}`, user.id);
      if (current?.password_hash !== user.password_hash) throw new UnauthorizedException('Your password changed. Sign in again.');
      return this.createSession({ id: user.id, email: user.email, name: user.name, role: user.role });
    });
  }
  private async createSession(user: Account) {
    await this.database.run('DELETE FROM sessions WHERE expires_at<=?', Date.now());
    const id = randomUUID(), refresh = randomBytes(48).toString('base64url');
    await this.database.run('INSERT INTO sessions VALUES(?,?,?,?)', id, user.id, digest(refresh), Date.now() + SESSION_SECONDS * 1000);
    return { user, refresh, access: this.sign(user.id, id) };
  }
  private sign(userId: string, sessionId: string) {
    return this.jwt.sign({ sub: userId, sid: sessionId }, { secret: this.secret, algorithm: 'HS256', issuer: 'veriqon', audience: 'veriqon-web', expiresIn: ACCESS_SECONDS });
  }
  async authenticate(token: string): Promise<Account> {
    let claims: { sub: string; sid: string };
    try {
      claims = this.jwt.verify(token, { secret: this.secret, algorithms: ['HS256'], issuer: 'veriqon', audience: 'veriqon-web' });
      if (typeof claims.sub !== 'string' || typeof claims.sid !== 'string') throw new Error('Invalid claims');
    } catch { throw new UnauthorizedException('Your session has expired. Please sign in.'); }
    const row = await this.database.get('SELECT u.id,u.email,u.name,u.role FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.id=? AND u.id=? AND s.expires_at>?', claims.sid, claims.sub, Date.now()).catch(() => { throw new ServiceUnavailableException('Session storage is temporarily unavailable. Please retry.'); }) as Account | undefined;
    if (!row) throw new UnauthorizedException('Your session has expired. Please sign in.');
    return row;
  }
  async refresh(token: string) {
    const row = await this.database.get('SELECT s.id AS session_id,u.id,u.email,u.name,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.refresh_hash=? AND s.expires_at>?', digest(token), Date.now()) as (Account & { session_id: string }) | undefined;
    if (!row) throw new UnauthorizedException('Your session has expired. Please sign in.');
    const refresh = randomBytes(48).toString('base64url');
    const changed = await this.database.run('UPDATE sessions SET refresh_hash=? WHERE id=? AND refresh_hash=? AND expires_at>?', digest(refresh), row.session_id, digest(token), Date.now());
    if (!changed.changes) throw new UnauthorizedException('Session renewal failed. Please sign in.');
    return { user: { id: row.id, email: row.email, name: row.name, role: row.role }, access: this.sign(row.id, row.session_id), refresh };
  }
  async logout(refresh?: string, access?: string) {
    if (refresh) await this.database.run('DELETE FROM sessions WHERE refresh_hash=?', digest(refresh));
    if (access) {
      let sessionId: string | undefined;
      try { sessionId = this.jwt.verify<{ sid: string }>(access, { secret: this.secret, algorithms: ['HS256'], issuer: 'veriqon', audience: 'veriqon-web', ignoreExpiration: true }).sid; } catch { /* Invalid tokens do not prevent clearing cookies. */ }
      if (sessionId) await this.database.run('DELETE FROM sessions WHERE id=?', sessionId);
    }
  }
}
