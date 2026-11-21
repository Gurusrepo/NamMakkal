import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'civicpulse-auth-session-test-'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.sqlite');
process.env.JWT_SECRET = 'auth-session-test-secret-long-enough';
process.env.JWT_EXPIRES_IN = '5m';
process.env.CORS_ORIGINS = 'http://localhost:3000';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-key';
process.env.GEMINI_API_KEY = 'test-key';
process.env.GEMINI_MODEL = 'gemini-3.5-flash-lite';
process.env.BREVO_API_KEY = 'test-brevo-api-key';
process.env.BREVO_SENDER_EMAIL = 'verify@gmail.test';
process.env.OTP_SECRET = 'auth-session-otp-secret-distinct-from-jwt';

let deliveredEmailCode;
const originalFetch = globalThis.fetch;

const { db, closeDatabase } = await import('../src/config/database.js');
const { migrateDatabase } = await import('../src/database/migrate.js');
migrateDatabase(db);
const { setEmailTransportForTesting } = await import('../src/services/email.service.js');
setEmailTransportForTesting({
  async sendMail(message) {
    deliveredEmailCode = message.text.match(/Use (\d{6})/)?.[1];
    return { accepted: [message.to] };
  }
});
const { default: app } = await import('../src/app.js');

let server;
let baseUrl;
const userId = 1;
const password = 'CitizenPassword123';

function tokenFor(user, expiresIn = '5m') {
  return jwt.sign({}, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    subject: String(user),
    expiresIn,
    issuer: 'civicpulse-api',
    audience: 'civicpulse-client'
  });
}

before(async () => {
  const passwordHash = await bcrypt.hash(password, 4);
  db.prepare(`INSERT INTO users (id,display_name,email,password_hash,role,email_verified)
    VALUES (?,? ,? ,? ,'CITIZEN',1)`).run(userId, 'Test Citizen', 'citizen@example.test', passwordHash);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  globalThis.fetch = originalFetch;
  if (server) await new Promise((resolve) => server.close(resolve));
  closeDatabase();
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

test('JWT expiration and cookie max-age remain aligned and expired sessions are rejected', async () => {
  const challenge = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'citizen@example.test', password })
  });
  assert.equal(challenge.status, 202);
  assert.equal(deliveredEmailCode?.length, 6);
  const login = await fetch(`${baseUrl}/api/auth/login/otp/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'citizen@example.test', code: deliveredEmailCode })
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /max-age=300/i);
  assert.match(cookie, /httponly/i);
  assert.match(cookie, /samesite=lax/i);
  const token = cookie.match(/civicpulse_token=([^;]+)/)?.[1];
  assert.ok(token);
  const payload = jwt.decode(token);
  assert.equal(payload.exp - payload.iat, 300);

  const restored = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie: `civicpulse_token=${token}` } });
  assert.equal(restored.status, 200);
  assert.equal((await restored.json()).user.id, userId);

  const expired = tokenFor(userId, -1);
  const rejected = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { cookie: `civicpulse_token=${expired}` }
  });
  assert.equal(rejected.status, 401);
});

test('citizen preferences are authenticated, validated, persisted, and scoped to the current account', async () => {
  const cookie = `civicpulse_token=${tokenFor(userId)}`;
  const initial = await fetch(`${baseUrl}/api/auth/preferences`, { headers: { cookie } });
  assert.equal(initial.status, 200);
  assert.equal((await initial.json()).preferences.language, 'en');

  const preferences = {
    language: 'ta', appearance: 'dark',
    notificationPreferences: { inApp: true, email: false, sms: true },
    accessibilityPreferences: { fontSize: 'large', highContrast: true, reducedMotion: false }
  };
  const saved = await fetch(`${baseUrl}/api/auth/preferences`, {
    method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(preferences)
  });
  assert.equal(saved.status, 200);
  assert.deepEqual((await saved.json()).preferences, preferences);

  const restored = await fetch(`${baseUrl}/api/auth/preferences`, { headers: { cookie } });
  assert.deepEqual((await restored.json()).preferences, preferences);
  const invalid = await fetch(`${baseUrl}/api/auth/preferences`, {
    method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ ...preferences, language: 'fr' })
  });
  assert.equal(invalid.status, 400);
  const anonymous = await fetch(`${baseUrl}/api/auth/preferences`);
  assert.equal(anonymous.status, 401);
});
