import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'civicpulse-auth-verification-config-test-'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(tempDirectory, 'verification-config.sqlite');
process.env.JWT_SECRET = 'verification-config-test-secret-long-enough';
process.env.OTP_SECRET = 'verification-config-otp-secret-distinct-from-jwt';
process.env.CORS_ORIGINS = 'http://localhost:3000';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-key';
process.env.BREVO_API_KEY = '';
process.env.BREVO_SENDER_EMAIL = '';
const { db, closeDatabase } = await import('../src/config/database.js');
const { migrateDatabase } = await import('../src/database/migrate.js');
migrateDatabase(db);
const { default: app } = await import('../src/app.js');
let server;
let baseUrl;

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

test('registration refuses to create an account when Brevo configuration is missing', async () => {
  const registration = await request('/api/auth/register', {
    method: 'POST',
    body: {
      name: 'Unconfigured Citizen', email: 'unconfigured@example.test', password: 'StrongPassword123',
      phoneNumber: '+919876543210', dateOfBirth: '1990-01-01', address: '12 Main Road'
    }
  });
  assert.equal(registration.status, 503);
  assert.match((await registration.json()).error, /BREVO_API_KEY.*BREVO_SENDER_EMAIL/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 0);
});
