import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'civicpulse-auth-verification-test-'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(tempDirectory, 'verification.sqlite');
process.env.JWT_SECRET = 'verification-test-secret-long-enough-to-work';
process.env.JWT_EXPIRES_IN = '5m';
process.env.CORS_ORIGINS = 'http://localhost:3000';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-key';
process.env.GEMINI_API_KEY = 'test-key';
process.env.BREVO_API_KEY = 'test-brevo-api-key';
process.env.BREVO_SENDER_EMAIL = 'verify@gmail.test';
process.env.OTP_SECRET = 'verification-otp-secret-distinct-from-jwt';

const originalFetch = globalThis.fetch;
const deliveredCodes = {};
let emailFailure = null;
let sentMailCount = 0;
let emailSendGate = null;

const { db, closeDatabase } = await import('../src/config/database.js');
const { migrateDatabase } = await import('../src/database/migrate.js');
migrateDatabase(db);
const { setEmailTransportForTesting } = await import('../src/services/email.service.js');
setEmailTransportForTesting({
  async sendMail(message) {
    deliveredCodes.email = message.text.match(/Use (\d{6})/)?.[1];
    if (emailSendGate) {
      emailSendGate.onStarted();
      await emailSendGate.promise;
    }
    if (emailFailure) throw Object.assign(new Error('sensitive provider response'), {
      ...emailFailure,
      response: `recipient=${message.to}; code=${deliveredCodes.email}`
    });
    sentMailCount += 1;
    return { accepted: [message.to] };
  }
});
const { default: app } = await import('../src/app.js');
const { calculateAge, getCitizenEligibility } = await import('../src/modules/auth/citizenEligibility.js');

let server;
let baseUrl;

async function request(pathname, { method = 'GET', body, cookie } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return originalFetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

function authCookie(response) {
  return response.headers.get('set-cookie')?.match(/civicpulse_token=([^;]+)/)?.[0];
}

async function register(email, dateOfBirth = '1960-01-02') {
  register.phoneSuffix = (register.phoneSuffix ?? 20) + 1;
  return request('/api/auth/register', {
    method: 'POST',
    body: {
      name: 'Verification Citizen', email, password: 'StrongPassword123',
      phoneNumber: `+9198765432${register.phoneSuffix}`, dateOfBirth, address: '12 Main Road'
    }
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

test('registration remains pending until email verification and sign-in requires a separate email OTP', async () => {
  const base = {
    name: 'Verification Citizen', email: 'verification@example.test', password: 'StrongPassword123',
    phoneNumber: '+919876543210', dateOfBirth: '1960-01-02', address: '12 Main Road'
  };
  assert.equal((await request('/api/auth/register', {
    method: 'POST', body: { ...base, email: 'future@example.test', dateOfBirth: '2099-01-01' }
  })).status, 400);
  assert.equal((await request('/api/auth/register', {
    method: 'POST', body: { ...base, email: 'invalid-date@example.test', dateOfBirth: '2026-02-31' }
  })).status, 400);
  assert.equal((await request('/api/auth/register', {
    method: 'POST', body: { ...base, citizenType: 'SENIOR_CITIZEN' }
  })).status, 400);

  const response = await request('/api/auth/register', { method: 'POST', body: base });
  assert.equal(response.status, 202);
  assert.equal(authCookie(response), undefined);
  assert.equal((await response.json()).verificationRequired, true);
  assert.match(deliveredCodes.email, /^\d{6}$/);
  const registrationCode = deliveredCodes.email;
  const user = db.prepare(`SELECT id,email_verified,account_status,
    citizen_identity_verification_status FROM users WHERE email=?`).get(base.email);
  assert.deepEqual(user, {
    id: user.id, email_verified: 0,
    account_status: 'PENDING_EMAIL_VERIFICATION',
    citizen_identity_verification_status: 'NOT_CONFIGURED'
  });
  assert.equal((await request('/api/auth/me')).status, 401);

  const originalAccount = db.prepare(`SELECT display_name,email,password_hash,role,phone_number,
    date_of_birth,address,account_status,email_verified FROM users WHERE id=?`).get(user.id);
  const sentBeforeResume = sentMailCount;
  const incorrectPassword = await request('/api/auth/login', {
    method: 'POST', body: { email: base.email, password: 'IncorrectPassword123' }
  });
  assert.equal(incorrectPassword.status, 401);
  assert.equal(sentMailCount, sentBeforeResume);

  const unverifiedLogin = await request('/api/auth/login', {
    method: 'POST', body: { email: base.email, password: base.password }
  });
  assert.equal(unverifiedLogin.status, 202);
  assert.equal(authCookie(unverifiedLogin), undefined);
  const resumed = await unverifiedLogin.json();
  assert.equal(resumed.requiresEmailVerification, true);
  assert.equal(resumed.deliveryState, 'SENT');
  assert.ok(resumed.retryAfterSeconds > 0 && resumed.retryAfterSeconds <= 60);
  assert.match(resumed.message, /may still be usable/);
  assert.equal(sentMailCount, sentBeforeResume);
  assert.deepEqual(db.prepare(`SELECT display_name,email,password_hash,role,phone_number,
    date_of_birth,address,account_status,email_verified FROM users WHERE id=?`).get(user.id), originalAccount);

  const duplicatePending = await request('/api/auth/register', {
    method: 'POST',
    body: { ...base, name: 'Changed Name', phoneNumber: '+919876543299', address: 'Changed Road' }
  });
  assert.equal(duplicatePending.status, 202);
  assert.equal((await duplicatePending.json()).verificationRequired, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users WHERE email=?').get(base.email).count, 1);
  assert.deepEqual(db.prepare(`SELECT display_name,email,password_hash,role,phone_number,
    date_of_birth,address,account_status,email_verified FROM users WHERE id=?`).get(user.id), originalAccount);
  const wrongPasswordResume = await request('/api/auth/register', {
    method: 'POST',
    body: { ...base, password: 'DifferentPassword123' }
  });
  assert.equal(wrongPasswordResume.status, 409);
  const duplicateError = await wrongPasswordResume.json();
  assert.deepEqual(db.prepare(`SELECT display_name,email,password_hash,role,phone_number,
    date_of_birth,address,account_status,email_verified FROM users WHERE id=?`).get(user.id), originalAccount);

  const wrongCode = registrationCode === '000000' ? '000001' : '000000';
  const incorrectCode = await request('/api/auth/registration/email/verify', {
    method: 'POST', body: { email: base.email, code: wrongCode }
  });
  assert.equal(incorrectCode.status, 400);
  assert.equal((await incorrectCode.json()).code, 'OTP_INVALID_OR_EXPIRED');
  const complete = await request('/api/auth/registration/email/verify', {
    method: 'POST', body: { email: base.email, code: registrationCode }
  });
  assert.equal(complete.status, 200);
  assert.equal(authCookie(complete), undefined);
  assert.equal(db.prepare('SELECT email_verified FROM users WHERE id=?').get(user.id).email_verified, 1);
  assert.equal(db.prepare('SELECT account_status FROM users WHERE id=?').get(user.id).account_status, 'ACTIVE');

  const activeAccount = db.prepare(`SELECT display_name,email,password_hash,role,phone_number,
    date_of_birth,address,account_status,email_verified FROM users WHERE id=?`).get(user.id);
  const sentBeforeDuplicateActive = sentMailCount;
  const duplicateActive = await request('/api/auth/register', {
    method: 'POST',
    body: { ...base, name: 'Changed Name', phoneNumber: '+919876543298', address: 'Changed Road' }
  });
  assert.equal(duplicateActive.status, 409);
  assert.deepEqual(await duplicateActive.json(), duplicateError);
  assert.equal(sentMailCount, sentBeforeDuplicateActive);
  assert.deepEqual(db.prepare(`SELECT display_name,email,password_hash,role,phone_number,
    date_of_birth,address,account_status,email_verified FROM users WHERE id=?`).get(user.id), activeAccount);

  const sentBeforeInvalidCredentials = sentMailCount;
  const incorrectEmail = await request('/api/auth/login', {
    method: 'POST', body: { email: 'missing@example.test', password: base.password }
  });
  assert.equal(incorrectEmail.status, 401);
  const incorrectActivePassword = await request('/api/auth/login', {
    method: 'POST', body: { email: base.email, password: 'IncorrectPassword123' }
  });
  assert.equal(incorrectActivePassword.status, 401);
  assert.equal(sentMailCount, sentBeforeInvalidCredentials);

  const sentBeforeLogin = sentMailCount;
  let signalMailStarted;
  let releaseMail;
  const mailStarted = new Promise((resolve) => { signalMailStarted = resolve; });
  const mailRelease = new Promise((resolve) => { releaseMail = resolve; });
  emailSendGate = { onStarted: signalMailStarted, promise: mailRelease };
  let login;
  try {
    const firstLoginRequest = request('/api/auth/login', {
      method: 'POST', body: { email: base.email, password: base.password }
    });
    await mailStarted;
    const inFlightLogin = await request('/api/auth/login', {
      method: 'POST', body: { email: base.email, password: base.password }
    });
    assert.equal(inFlightLogin.status, 202);
    assert.equal(authCookie(inFlightLogin), undefined);
    assert.equal((await inFlightLogin.json()).deliveryState, 'PENDING');
    releaseMail();
    login = await firstLoginRequest;
  } finally {
    releaseMail();
    emailSendGate = null;
  }
  assert.equal(login.status, 202);
  assert.equal(authCookie(login), undefined);
  assert.equal((await login.json()).requiresOtpVerification, true);
  const firstLoginCode = deliveredCodes.email;
  assert.match(firstLoginCode, /^\d{6}$/);
  const loginChallenge = await request('/api/auth/login', {
    method: 'POST', body: { email: base.email, password: base.password }
  });
  assert.equal(loginChallenge.status, 202);
  assert.equal((await loginChallenge.json()).deliveryState, 'SENT');
  assert.equal(sentMailCount - sentBeforeLogin, 1);
  const incorrectLoginCode = firstLoginCode === '000000' ? '000001' : '000000';
  const incorrectLoginOtp = await request('/api/auth/login/otp/verify', {
    method: 'POST', body: { email: base.email, code: incorrectLoginCode }
  });
  assert.equal(incorrectLoginOtp.status, 400);
  assert.equal((await incorrectLoginOtp.json()).code, 'OTP_INVALID_OR_EXPIRED');
  db.prepare(`UPDATE user_verification_challenges SET expires_at=?,resend_after=?
    WHERE user_id=? AND channel='EMAIL' AND purpose='LOGIN'`)
    .run(new Date(Date.now() - 1000).toISOString(), new Date(Date.now() - 1000).toISOString(), user.id);
  const expiredLoginOtp = await request('/api/auth/login/otp/verify', {
    method: 'POST', body: { email: base.email, code: firstLoginCode }
  });
  assert.equal(expiredLoginOtp.status, 400);
  assert.equal((await expiredLoginOtp.json()).code, 'OTP_INVALID_OR_EXPIRED');
  const sentBeforeRenewedLogin = sentMailCount;
  const renewedLogin = await request('/api/auth/login', {
    method: 'POST', body: { email: base.email, password: base.password }
  });
  assert.equal(renewedLogin.status, 202);
  assert.equal(sentMailCount, sentBeforeRenewedLogin + 1);
  const renewedLoginCode = deliveredCodes.email;
  const signIn = await request('/api/auth/login/otp/verify', {
    method: 'POST', body: { email: base.email, code: renewedLoginCode }
  });
  assert.equal(signIn.status, 200);
  assert.ok(authCookie(signIn));
  const authenticated = await request('/api/auth/me', { cookie: authCookie(signIn) });
  assert.equal(authenticated.status, 200);
  assert.equal('mobileVerified' in (await authenticated.json()).user, false);
});

test('simultaneous and repeated registration requests create one account and send only one code', async () => {
  const body = {
    name: 'Concurrent Citizen',
    email: 'concurrent-registration@example.test',
    password: 'StrongPassword123',
    phoneNumber: '+919876543277',
    dateOfBirth: '1960-01-02',
    address: '12 Main Road'
  };
  const sentBefore = sentMailCount;

  let signalMailStarted;
  let releaseMail;
  const mailStarted = new Promise((resolve) => { signalMailStarted = resolve; });
  const mailRelease = new Promise((resolve) => { releaseMail = resolve; });
  emailSendGate = { onStarted: signalMailStarted, promise: mailRelease };

  let firstResponse;
  let inFlightResponse;
  try {
    const firstRequest = request('/api/auth/register', { method: 'POST', body });
    await mailStarted;
    inFlightResponse = await request('/api/auth/register', { method: 'POST', body });
    assert.equal(inFlightResponse.status, 202);
    const inFlight = await inFlightResponse.json();
    assert.equal(inFlight.deliveryState, 'PENDING');
    assert.ok(inFlight.retryAfterSeconds > 0 && inFlight.retryAfterSeconds <= 60);
    assert.match(inFlight.message, /still being processed/);
    assert.equal(sentMailCount, sentBefore);

    releaseMail();
    firstResponse = await firstRequest;
    assert.equal(firstResponse.status, 202);
    assert.equal((await firstResponse.json()).deliveryState, 'SENT');
  } finally {
    releaseMail();
    emailSendGate = null;
  }

  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users WHERE email=?').get(body.email).count, 1);
  assert.equal(sentMailCount - sentBefore, 1);
  assert.equal(firstResponse.headers.get('set-cookie'), null);
  assert.equal(inFlightResponse.headers.get('set-cookie'), null);

  const original = db.prepare(`SELECT display_name,email,password_hash,role,phone_number,
    date_of_birth,address,account_status,email_verified FROM users WHERE email=?`).get(body.email);
  const wrongPasswordDuplicate = await request('/api/auth/register', {
    method: 'POST',
    body: { ...body, password: 'DifferentPassword123', name: 'Changed Name' }
  });
  assert.equal(wrongPasswordDuplicate.status, 409);
  const repeated = await request('/api/auth/register', { method: 'POST', body: { ...body, name: 'Changed Name' } });
  assert.equal(repeated.status, 202);
  const repeatedResult = await repeated.json();
  assert.equal(repeatedResult.deliveryState, 'SENT');
  assert.match(repeatedResult.message, /may still be usable/);
  assert.equal(sentMailCount - sentBefore, 1);
  assert.deepEqual(db.prepare(`SELECT display_name,email,password_hash,role,phone_number,
    date_of_birth,address,account_status,email_verified FROM users WHERE email=?`).get(body.email), original);

  assert.equal((await request('/api/auth/registration/email/verify', {
    method: 'POST', body: { email: body.email, code: deliveredCodes.email }
  })).status, 200);
});

test('registration email OTP expiry, five-attempt limit, resend cooldown and replacement are enforced', async () => {
  const email = 'otp-limits@example.test';
  const response = await register(email);
  assert.equal(response.status, 202);
  const user = db.prepare('SELECT id FROM users WHERE email=?').get(email);
  const expiredCode = deliveredCodes.email;
  db.prepare(`UPDATE user_verification_challenges SET expires_at=? WHERE user_id=? AND channel='EMAIL' AND purpose='REGISTRATION'`)
    .run(new Date(Date.now() - 1000).toISOString(), user.id);
  const expiredVerification = await request('/api/auth/registration/email/verify', {
    method: 'POST', body: { email, code: expiredCode }
  });
  assert.equal(expiredVerification.status, 400);
  assert.equal((await expiredVerification.json()).code, 'OTP_INVALID_OR_EXPIRED');
  const cooldown = await request('/api/auth/registration/email/resend', {
    method: 'POST', body: { email, password: 'StrongPassword123' }
  });
  assert.equal(cooldown.status, 429);
  assert.ok(Number(cooldown.headers.get('retry-after')) > 0);
  assert.ok((await cooldown.json()).retryAfterSeconds > 0);

  db.prepare(`UPDATE user_verification_challenges SET resend_after=? WHERE user_id=? AND channel='EMAIL' AND purpose='REGISTRATION'`)
    .run(new Date(Date.now() - 1000).toISOString(), user.id);
  assert.equal((await request('/api/auth/registration/email/resend', {
    method: 'POST', body: { email, password: 'StrongPassword123' }
  })).status, 200);
  const firstReplacement = deliveredCodes.email;
  const incorrectCode = firstReplacement === '000000' ? '000001' : '000000';
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    assert.equal((await request('/api/auth/registration/email/verify', {
      method: 'POST', body: { email, code: incorrectCode }
    })).status, 400);
  }
  assert.equal((await request('/api/auth/registration/email/verify', {
    method: 'POST', body: { email, code: incorrectCode }
  })).status, 429);
  assert.equal((await request('/api/auth/registration/email/resend', {
    method: 'POST', body: { email, password: 'StrongPassword123' }
  })).status, 429);

  db.prepare(`UPDATE user_verification_challenges SET resend_after=? WHERE user_id=? AND channel='EMAIL' AND purpose='REGISTRATION'`)
    .run(new Date(Date.now() - 1000).toISOString(), user.id);
  assert.equal((await request('/api/auth/registration/email/resend', {
    method: 'POST', body: { email, password: 'StrongPassword123' }
  })).status, 200);
  const currentCode = deliveredCodes.email;
  if (currentCode !== firstReplacement) {
    assert.equal((await request('/api/auth/registration/email/verify', {
      method: 'POST', body: { email, code: firstReplacement }
    })).status, 400);
  }
  assert.equal((await request('/api/auth/registration/email/verify', {
    method: 'POST', body: { email, code: currentCode }
  })).status, 200);
});

test('mobile verification endpoints are unavailable and email delivery failure keeps registration recoverable', async () => {
  const registration = await register('email-separation@example.test');
  const user = db.prepare('SELECT id FROM users WHERE email=?').get('email-separation@example.test');
  assert.equal(registration.status, 202);
  const registrationCode = deliveredCodes.email;
  assert.equal((await request('/api/auth/registration/email/verify', {
    method: 'POST', body: { email: 'email-separation@example.test', code: registrationCode }
  })).status, 200);
  const login = await request('/api/auth/login', {
    method: 'POST', body: { email: 'email-separation@example.test', password: 'StrongPassword123' }
  });
  const cookie = authCookie(await request('/api/auth/login/otp/verify', {
    method: 'POST', body: { email: 'email-separation@example.test', code: deliveredCodes.email }
  }));
  assert.ok(cookie);
  assert.equal(login.status, 202);

  assert.equal((await request('/api/auth/verification/email/send', { method: 'POST', cookie })).status, 409);
  assert.equal((await request('/api/auth/verification/mobile/send', { method: 'POST', cookie })).status, 404);
  assert.equal((await request('/api/auth/verification/mobile/verify', { method: 'POST', cookie, body: { code: '123456' } })).status, 404);
  assert.equal((await request('/api/auth/mobile-verification/complete', {
    method: 'POST', body: { email: 'email-separation@example.test', code: '123456' }
  })).status, 404);
  assert.equal((await request('/api/auth/mobile-verification/resend', {
    method: 'POST', body: { email: 'email-separation@example.test', password: 'StrongPassword123' }
  })).status, 404);
  assert.equal(db.prepare('SELECT email_verified FROM users WHERE id=?').get(user.id).email_verified, 1);

  emailFailure = { code: 'EAUTH' };
  const failedRegistration = await register('smtp-failure@example.test');
  emailFailure = null;
  assert.equal(failedRegistration.status, 502);
  const pendingAfterFailure = db.prepare(`SELECT id,account_status,email_verified FROM users
    WHERE email=?`).get('smtp-failure@example.test');
  assert.equal(pendingAfterFailure.account_status, 'PENDING_EMAIL_VERIFICATION');
  assert.equal(pendingAfterFailure.email_verified, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM user_verification_challenges WHERE destination=?')
    .get('smtp-failure@example.test').count, 0);

  const recovery = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'smtp-failure@example.test', password: 'StrongPassword123' }
  });
  assert.equal(recovery.status, 202);
  assert.equal((await recovery.json()).deliveryState, 'SENT');
  assert.equal(db.prepare('SELECT account_status FROM users WHERE id=?').get(pendingAfterFailure.id).account_status, 'PENDING_EMAIL_VERIFICATION');

  emailFailure = { code: 'ETIMEDOUT' };
  const timeoutRegistration = await register('smtp-timeout@example.test');
  emailFailure = null;
  assert.equal(timeoutRegistration.status, 502);
  const pendingAfterTimeout = db.prepare(`SELECT id,account_status,email_verified FROM users
    WHERE email=?`).get('smtp-timeout@example.test');
  assert.equal(pendingAfterTimeout.account_status, 'PENDING_EMAIL_VERIFICATION');
  assert.equal(pendingAfterTimeout.email_verified, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM user_verification_challenges WHERE destination=?')
    .get('smtp-timeout@example.test').count, 0);
  const timeoutRecovery = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'smtp-timeout@example.test', password: 'StrongPassword123' }
  });
  assert.equal(timeoutRecovery.status, 202);
  assert.equal((await timeoutRecovery.json()).deliveryState, 'SENT');
});

test('an existing unverified citizen must verify email before sign-in or protected access', async () => {
  const email = 'legacy-unverified@example.test';
  const password = 'LegacyCitizenPassword123';
  const passwordHash = await bcrypt.hash(password, 4);
  const result = db.prepare(`INSERT INTO users
    (display_name,email,password_hash,role,phone_number,date_of_birth,address)
    VALUES (?,?,?,'CITIZEN','+919876543212','1990-01-01','Legacy Road')`)
    .run('Legacy Citizen', email, passwordHash);
  const token = jwt.sign({}, process.env.JWT_SECRET, {
    algorithm: 'HS256', subject: String(result.lastInsertRowid), expiresIn: '5m',
    issuer: 'civicpulse-api', audience: 'civicpulse-client'
  });
  assert.equal((await request('/api/auth/me', { cookie: `civicpulse_token=${token}` })).status, 401);

  const challenge = await request('/api/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(challenge.status, 202);
  assert.equal(authCookie(challenge), undefined);
  assert.equal((await challenge.json()).requiresEmailVerification, true);
  const registrationVerification = await request('/api/auth/registration/email/verify', {
    method: 'POST', body: { email, code: deliveredCodes.email }
  });
  assert.equal(registrationVerification.status, 200);
  const signInChallenge = await request('/api/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(signInChallenge.status, 202);
  const complete = await request('/api/auth/login/otp/verify', {
    method: 'POST', body: { email, code: deliveredCodes.email }
  });
  assert.equal(complete.status, 200);
  assert.equal((await complete.json()).user.emailVerified, true);
});

test('age category boundaries are calculated on the backend, independently of identity verification', () => {
  const today = new Date('2026-11-19T12:00:00.000Z');
  assert.equal(calculateAge('2008-11-20', today), 17);
  assert.deepEqual(getCitizenEligibility('2008-11-20', today), {
    age: 17, ageBasedCitizenCategory: 'MINOR', ageBasedCitizenEligible: false
  });
  assert.deepEqual(getCitizenEligibility('2008-11-19', today), {
    age: 18, ageBasedCitizenCategory: 'CITIZEN', ageBasedCitizenEligible: true
  });
  assert.deepEqual(getCitizenEligibility('1966-11-19', today), {
    age: 60, ageBasedCitizenCategory: 'SENIOR_CITIZEN', ageBasedCitizenEligible: true
  });
});
