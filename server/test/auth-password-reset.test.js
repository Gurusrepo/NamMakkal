import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'civicpulse-password-reset-test-'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(tempDirectory, 'password-reset.sqlite');
process.env.JWT_SECRET = 'password-reset-test-secret-long-enough';
process.env.JWT_EXPIRES_IN = '5m';
process.env.OTP_SECRET = 'password-reset-otp-secret-distinct-from-jwt';
process.env.BREVO_API_KEY = 'test-brevo-api-key';
process.env.BREVO_SENDER_EMAIL = 'verify@gmail.test';
process.env.CORS_ORIGINS = 'http://localhost:3000';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-key';

const deliveredCodes = {};
let smtpFailure = false;
const { db, closeDatabase } = await import('../src/config/database.js');
const { migrateDatabase } = await import('../src/database/migrate.js');
migrateDatabase(db);
const { setEmailTransportForTesting } = await import('../src/services/email.service.js');
setEmailTransportForTesting({
  async sendMail(message) {
    const code = message.text.match(/Use (\d{6})/)?.[1];
    deliveredCodes[message.subject.startsWith('Reset') ? 'reset' : 'login'] = code;
    if (smtpFailure) throw Object.assign(new Error('Sensitive SMTP response'), {
      code: 'EAUTH',
      response: `recipient=${message.to}; code=${code}; password=secret`
    });
    return { accepted: [message.to] };
  }
});
const { default: app } = await import('../src/app.js');

let server;
let baseUrl;
const currentPassword = 'CitizenPassword123';
const newPassword = 'CitizenPassword456';

async function request(pathname, { method = 'GET', body, cookie } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

function tokenFor(userId, version = 0) {
  return jwt.sign({ ver: version }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    subject: String(userId),
    expiresIn: '5m',
    issuer: 'civicpulse-api',
    audience: 'civicpulse-client'
  });
}

async function addCitizen(email) {
  const passwordHash = await bcrypt.hash(currentPassword, 4);
  return Number(db.prepare(`INSERT INTO users
    (display_name,email,password_hash,role,email_verified)
    VALUES(?, ?, ?, 'CITIZEN', 1)`)
    .run('Reset Test Citizen', email, passwordHash).lastInsertRowid);
}

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  closeDatabase();
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

test('password reset is generic, purpose-scoped, atomic, and revokes existing sessions', async () => {
  const email = 'reset-citizen@example.test';
  const userId = await addCitizen(email);
  const missing = await request('/api/auth/password/forgot', {
    method: 'POST', body: { email: 'unknown@example.test' }
  });
  assert.equal(missing.status, 202);
  const missingBody = await missing.json();

  const oldCookie = `civicpulse_token=${tokenFor(userId)}`;
  assert.equal((await request('/api/auth/me', { cookie: oldCookie })).status, 200);
  const requested = await request('/api/auth/password/forgot', { method: 'POST', body: { email } });
  assert.equal(requested.status, 202);
  assert.deepEqual(await requested.json(), missingBody);
  assert.match(deliveredCodes.reset, /^\d{6}$/);

  const loginChallenge = await request('/api/auth/login', {
    method: 'POST', body: { email, password: currentPassword }
  });
  assert.equal(loginChallenge.status, 202);
  assert.match(deliveredCodes.login, /^\d{6}$/);
  const purposes = db.prepare(`SELECT purpose FROM user_verification_challenges
    WHERE user_id=? AND channel='EMAIL' ORDER BY purpose`).all(userId).map((row) => row.purpose);
  assert.deepEqual(purposes, ['LOGIN', 'PASSWORD_RESET']);

  const invalid = await request('/api/auth/password/reset', {
    method: 'POST', body: {
      email,
      code: deliveredCodes.reset === '000000' ? '000001' : '000000',
      password: newPassword
    }
  });
  assert.equal(invalid.status, 400);
  assert.equal(await bcrypt.compare(currentPassword, db.prepare('SELECT password_hash FROM users WHERE id=?').get(userId).password_hash), true);
  assert.equal(db.prepare('SELECT session_version FROM users WHERE id=?').get(userId).session_version, 0);

  const completed = await request('/api/auth/password/reset', {
    method: 'POST', body: { email, code: deliveredCodes.reset, password: newPassword }
  });
  assert.equal(completed.status, 200);
  assert.equal(completed.headers.get('set-cookie'), null);
  assert.equal(await bcrypt.compare(newPassword, db.prepare('SELECT password_hash FROM users WHERE id=?').get(userId).password_hash), true);
  assert.equal(db.prepare('SELECT session_version FROM users WHERE id=?').get(userId).session_version, 1);
  assert.equal((await request('/api/auth/me', { cookie: oldCookie })).status, 401);
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM user_verification_challenges
    WHERE user_id=? AND purpose='LOGIN'`).get(userId).count, 0);
  assert.equal(db.prepare(`SELECT consumed_at FROM user_verification_challenges
    WHERE user_id=? AND purpose='PASSWORD_RESET'`).get(userId).consumed_at !== null, true);

  const oldPasswordLogin = await request('/api/auth/login', {
    method: 'POST', body: { email, password: currentPassword }
  });
  assert.equal(oldPasswordLogin.status, 401);
  const newPasswordLogin = await request('/api/auth/login', {
    method: 'POST', body: { email, password: newPassword }
  });
  assert.equal(newPasswordLogin.status, 202);
  assert.equal(newPasswordLogin.headers.get('set-cookie'), null);
});

test('SMTP failure leaves no usable password-reset challenge and does not change the password', async () => {
  const email = 'smtp-reset-failure@example.test';
  const userId = await addCitizen(email);
  smtpFailure = true;
  const response = await request('/api/auth/password/forgot', { method: 'POST', body: { email } });
  smtpFailure = false;

  assert.equal(response.status, 202);
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM user_verification_challenges
    WHERE user_id=? AND purpose='PASSWORD_RESET'`).get(userId).count, 0);
  assert.equal(await bcrypt.compare(currentPassword, db.prepare('SELECT password_hash FROM users WHERE id=?').get(userId).password_hash), true);
});
