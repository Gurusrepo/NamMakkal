
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), 'civicpulse-registration-destination-test-')
);

process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(tempDirectory, 'registration.sqlite');
process.env.JWT_SECRET = 'registration-destination-test-secret-long-enough';
process.env.JWT_EXPIRES_IN = '5m';
process.env.CORS_ORIGINS = 'http://localhost:3000';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-key';
process.env.GEMINI_API_KEY = 'test-key';
process.env.BREVO_API_KEY = 'test-brevo-api-key';
process.env.BREVO_SENDER_EMAIL = 'verify@gmail.test';
process.env.OTP_SECRET = 'registration-destination-otp-secret-distinct';

let deliveredCode;
let emailFailure;

const { db, closeDatabase } = await import('../src/config/database.js');
const { migrateDatabase } = await import('../src/database/migrate.js');

migrateDatabase(db);

const { setEmailTransportForTesting } = await import(
  '../src/services/email.service.js'
);

setEmailTransportForTesting({
  async sendMail(message) {
    deliveredCode = message.text.match(/Use (\d{6})/)?.[1];

    if (emailFailure) {
      throw emailFailure;
    }

    return { accepted: [message.to] };
  }
});

const { default: app } = await import('../src/app.js');

let server;
let baseUrl;

async function post(pathname, body) {
  return fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

before(async () => {
  server = app.listen(0, '127.0.0.1');

  await new Promise((resolve) => server.once('listening', resolve));

  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }

  closeDatabase();
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

test(
  'registration persists the required OTP destination and stays pending until email verification',
  async () => {
    const email = 'destination-regression@example.test';

    const registration = await post('/api/auth/register', {
      name: 'Destination Regression',
      email,
      password: 'StrongPassword123',
      phoneNumber: '9876543210',
      dateOfBirth: '1990-01-02',
      address: '12 Main Road'
    });

    assert.equal(registration.status, 202);
    assert.equal(registration.headers.get('set-cookie'), null);
    assert.equal((await registration.json()).verificationRequired, true);
    assert.match(deliveredCode, /^\d{6}$/);

    const user = db.prepare(`
      SELECT id, account_status, email_verified
      FROM users
      WHERE email = ?
    `).get(email);

    assert.deepEqual(user, {
      id: user.id,
      account_status: 'PENDING_EMAIL_VERIFICATION',
      email_verified: 0
    });

    const challenge = db.prepare(`
      SELECT destination, code_hash
      FROM user_verification_challenges
      WHERE user_id = ?
        AND channel = 'EMAIL'
        AND purpose = 'REGISTRATION'
    `).get(user.id);

    assert.equal(challenge.destination, email);
    assert.match(challenge.code_hash, /^[a-f0-9]{64}$/);
    assert.notEqual(challenge.code_hash, deliveredCode);

    const verified = await post(
      '/api/auth/registration/email/verify',
      { email, code: deliveredCode }
    );

    assert.equal(verified.status, 200);
    assert.equal(verified.headers.get('set-cookie'), null);

    assert.equal(
      db.prepare('SELECT email_verified FROM users WHERE id = ?')
        .get(user.id).email_verified,
      1
    );

    assert.equal(
      db.prepare('SELECT account_status FROM users WHERE id = ?')
        .get(user.id).account_status,
      'ACTIVE'
    );
  }
);

test(
  'Brevo email rejection is diagnosed safely and leaves the pending account recoverable',
  async () => {
    const email = 'provider-failure@example.test';

    emailFailure = Object.assign(
      new Error(
        `Rejected recipient ${email}; password=StrongPassword456; code=${deliveredCode}`
      ),
      {
        code: 'EAUTH',
        responseCode: 535,
        response: `recipient=${email}; secret=test-secret; code=${deliveredCode}`
      }
    );

    const diagnostics = [];
    const originalConsoleError = console.error;

    console.error = (...args) => diagnostics.push(args);

    let response;

    try {
      response = await post('/api/auth/register', {
        name: 'Provider Failure',
        email,
        password: 'StrongPassword456',
        phoneNumber: '9876543211',
        dateOfBirth: '1990-01-02',
        address: '14 Main Road'
      });
    } finally {
      console.error = originalConsoleError;
      emailFailure = null;
    }

    assert.equal(response.status, 502);

    assert.deepEqual(await response.json(), {
      error: 'Email delivery failed. Please try again later.',
      code: 'EMAIL_DELIVERY_FAILED'
    });

    assert.equal(response.headers.get('set-cookie'), null);

    const pending = db.prepare(`
      SELECT id, account_status, email_verified
      FROM users
      WHERE email = ?
    `).get(email);

    assert.equal(pending.account_status, 'PENDING_EMAIL_VERIFICATION');
    assert.equal(pending.email_verified, 0);

    assert.equal(
      db.prepare(`
        SELECT COUNT(*) AS count
        FROM user_verification_challenges
        WHERE destination = ?
      `).get(email).count,
      0
    );

    const diagnosticText = JSON.stringify(diagnostics);

    assert.match(diagnosticText, /Brevo email delivery failed/);
    assert.match(diagnosticText, /535/);
    assert.match(diagnosticText, /EAUTH/);
    assert.doesNotMatch(diagnosticText, new RegExp(email));
    assert.doesNotMatch(
      diagnosticText,
      /StrongPassword456|test-secret|code=/
    );

    const recovered = await post('/api/auth/login', {
      email,
      password: 'StrongPassword456'
    });

    assert.equal(recovered.status, 202);
    assert.equal((await recovered.json()).deliveryState, 'SENT');

    assert.equal(
      db.prepare('SELECT account_status FROM users WHERE id = ?')
        .get(pending.id).account_status,
      'PENDING_EMAIL_VERIFICATION'
    );
  }
);

test(
  'Brevo connection failures are logged without exposing request data',
  async () => {
    const email = 'provider-network-failure@example.test';

    emailFailure = Object.assign(
      new Error(`Network error for ${email}; code=${deliveredCode}`),
      {
        code: 'ECONNECTION',
        response: `password=StrongPassword789; recipient=${email}`
      }
    );

    const diagnostics = [];
    const originalConsoleError = console.error;

    console.error = (...args) => diagnostics.push(args);

    let response;

    try {
      response = await post('/api/auth/register', {
        name: 'Network Failure',
        email,
        password: 'StrongPassword789',
        phoneNumber: '9876543212',
        dateOfBirth: '1990-01-02',
        address: '16 Main Road'
      });
    } finally {
      console.error = originalConsoleError;
      emailFailure = null;
    }

    assert.equal(response.status, 502);

    assert.equal(
      db.prepare('SELECT account_status FROM users WHERE email = ?')
        .get(email).account_status,
      'PENDING_EMAIL_VERIFICATION'
    );

    assert.equal(
      db.prepare(`
        SELECT COUNT(*) AS count
        FROM user_verification_challenges
        WHERE destination = ?
      `).get(email).count,
      0
    );

    const diagnosticText = JSON.stringify(diagnostics);

    assert.match(diagnosticText, /Brevo email delivery failed/);
    assert.match(diagnosticText, /ECONNECTION/);
    assert.doesNotMatch(diagnosticText, new RegExp(email));
    assert.doesNotMatch(
      diagnosticText,
      /StrongPassword789|password=|code=/
    );
  }
);
