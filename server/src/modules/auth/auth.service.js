import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../../config/database.js';
import { env } from '../../config/env.js';
import { getCitizenEligibility } from './citizenEligibility.js';
import {
  getVerificationAvailability, sendVerificationCode, sendLoginVerificationCode,
  VerificationError, verifyCode, verifyLoginCode, verifyPasswordResetCode
} from './verification.service.js';

const findByEmail = db.prepare(`SELECT id, display_name, email, password_hash, role, created_at,
  profile_image_key, profile_image_mime_type, phone_number, date_of_birth,
  date_of_birth_verification_status, address, email_verified,
  citizen_identity_verification_status, account_status,
  session_version FROM users WHERE email = ?`);
const findByPhone = db.prepare('SELECT id FROM users WHERE phone_number = ?');
const findPublicUserById = db.prepare(`SELECT id, display_name, email, role, created_at,
  profile_image_key, profile_image_mime_type, phone_number, date_of_birth,
  date_of_birth_verification_status, address, email_verified,
  citizen_identity_verification_status, account_status FROM users WHERE id = ?`);
const insertCitizen = db.prepare(`INSERT INTO users
  (display_name,email,password_hash,role,phone_number,date_of_birth,address,account_status)
  VALUES (?,?,?,'CITIZEN',?,?,?,'PENDING_EMAIL_VERIFICATION')`);
const registrationConflictMessage = 'Unable to complete registration. Sign in if you already have an account.';

function publicUser(user) {
  if (!user) return null;
  const { id, display_name, email, role, created_at, profile_image_key, phone_number,
    date_of_birth, date_of_birth_verification_status, address } = user;
  return {
    id, name: display_name, email, role, createdAt: created_at,
    profileImage: { available: Boolean(profile_image_key) },
    phoneNumber: phone_number ?? null,
    dateOfBirth: date_of_birth ?? null,
    dateOfBirthVerificationStatus: date_of_birth_verification_status ?? 'NOT_VERIFIED',
    address: address ?? null,
    emailVerified: Boolean(user.email_verified),
    citizenIdentityVerificationStatus: user.citizen_identity_verification_status ?? 'NOT_CONFIGURED',
    verificationAvailability: getVerificationAvailability(),
    ...getCitizenEligibility(date_of_birth)
  };
}

export class AuthError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function register({ email, password, name, phoneNumber, dateOfBirth, address }) {
  const emailAvailability = getVerificationAvailability().email;
  if (!emailAvailability.available) {
    throw new VerificationError(`Email verification is unavailable. Set ${emailAvailability.missingConfiguration.join(', ')}.`, 503);
  }

  const existingUser = findByEmail.get(email);
  if (existingUser) {
    return resumePendingRegistration(existingUser, password);
  }

  if (findByPhone.get(phoneNumber)) throw new AuthError(registrationConflictMessage, 409);

  const passwordHash = await bcrypt.hash(password, 12);

  let result;
  try {
    result = insertCitizen.run(name, email, passwordHash, phoneNumber, dateOfBirth, address);
  } catch (error) {
    if (error.code !== 'SQLITE_CONSTRAINT_UNIQUE') throw error;

    const racedUser = findByEmail.get(email);
    if (racedUser) {
      return resumePendingRegistration(racedUser, password);
    }

    throw new AuthError(registrationConflictMessage, 409);
  }

  const user = findByEmail.get(email);
  return requestRegistrationVerification(user);
}

function registrationVerificationResponse(user, delivery) {
  return {
    verificationRequired: true,
    requiresEmailVerification: true,
    verificationChannel: 'EMAIL',
    destination: maskEmail(user.email),
    ...delivery
  };
}

async function requestRegistrationVerification(user) {
  try {
    const delivery = await sendVerificationCode(user.id, 'REGISTRATION');
    return registrationVerificationResponse(user, delivery);
  } catch (error) {
    if (!(error instanceof VerificationError) ||
        !['OTP_COOLDOWN', 'OTP_DELIVERY_PENDING'].includes(error.code)) {
      throw error;
    }

    return registrationVerificationResponse(user, {
      message: error.message,
      deliveryState: error.deliveryState,
      retryAfterSeconds: error.retryAfterSeconds
    });
  }
}

async function requestLoginVerification(user) {
  try {
    const delivery = await sendLoginVerificationCode(user.id);
    return {
      requiresOtpVerification: true,
      verificationChannel: 'EMAIL',
      destination: maskEmail(user.email),
      ...delivery
    };
  } catch (error) {
    if (!(error instanceof VerificationError) ||
        !['OTP_COOLDOWN', 'OTP_DELIVERY_PENDING'].includes(error.code)) {
      throw error;
    }

    return {
      requiresOtpVerification: true,
      verificationChannel: 'EMAIL',
      destination: maskEmail(user.email),
      message: error.message,
      deliveryState: error.deliveryState,
      retryAfterSeconds: error.retryAfterSeconds
    };
  }
}

async function resumePendingRegistration(user, password) {
  if (user.account_status !== 'PENDING_EMAIL_VERIFICATION' || user.email_verified) {
    throw new AuthError(registrationConflictMessage, 409);
  }

  const matches = await bcrypt.compare(password, user.password_hash);
  if (!matches) {
    throw new AuthError(registrationConflictMessage, 409);
  }

  return requestRegistrationVerification(user);
}

function makeSessionToken(user) {
  return jwt.sign({ ver: user.session_version ?? 0 }, env.JWT_SECRET, {
    algorithm: 'HS256',
    subject: String(user.id),
    expiresIn: env.JWT_EXPIRES_IN,
    issuer: 'civicpulse-api',
    audience: 'civicpulse-client'
  });
}

export async function login({ email, password }) {
  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  const user = findByEmail.get(normalizedEmail);
  const matches = user ? await bcrypt.compare(password, user.password_hash) : false;
  if (!matches || user.account_status === 'DEACTIVATED') {
    throw new AuthError('Incorrect password or login details', 401);
  }

  if (user.account_status === 'PENDING_EMAIL_VERIFICATION') {
    return requestRegistrationVerification(user);
  }

  if (user.account_status !== 'ACTIVE') {
    throw new AuthError('Invalid email or password', 401);
  }

  if (!user.email_verified) {
    return requestRegistrationVerification(user);
  }

  return requestLoginVerification(user);
}

function maskEmail(email) {
  const [local, domain] = String(email).split('@');
  return `Email: ${local.charAt(0)}***@${domain}`;
}

export async function completeLoginOtp({ email, code }) {
  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  const user = findByEmail.get(normalizedEmail);
  if (!user || user.account_status === 'DEACTIVATED') {
    throw new VerificationError('The verification code is invalid or expired', 400);
  }
  verifyLoginCode(user.id, code);
  const verifiedUser = findByEmail.get(normalizedEmail);
  if (!verifiedUser || verifiedUser.account_status !== 'ACTIVE' || !verifiedUser.email_verified) {
    throw new VerificationError('The verification code is invalid or expired', 400);
  }
  return { user: publicUser(verifiedUser), token: makeSessionToken(verifiedUser) };
}

export async function resendLoginOtp({ email, password }) {
  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  const user = findByEmail.get(normalizedEmail);
  const matches = user ? await bcrypt.compare(password, user.password_hash) : false;
  if (!matches || user.account_status === 'DEACTIVATED') {
    throw new AuthError('Incorrect password or login details', 401);
  }
  if (!user.email_verified || user.account_status !== 'ACTIVE') {
    throw new AuthError('A verified email and active account are required', 403);
  }
  return requestLoginVerification(user);
}

export async function completeRegistrationEmail({ email, code }) {
  const user = findByEmail.get(email);
  if (!user || user.account_status === 'DEACTIVATED') {
    throw new VerificationError('The verification code is invalid or expired', 400);
  }
  verifyCode(user.id, code, 'REGISTRATION');
  const verifiedUser = findByEmail.get(email);
  if (!verifiedUser || !verifiedUser.email_verified) {
    throw new AuthError('Email verification could not be completed', 409);
  }
  return { verificationCompleted: true, message: 'Email verified successfully. Your account is eligible to sign in.' };
}

export async function resendRegistrationEmail({ email, password }) {
  const user = findByEmail.get(email);
  const matches = user ? await bcrypt.compare(password, user.password_hash) : false;
  if (!matches || user.account_status === 'DEACTIVATED') {
    throw new AuthError('Incorrect password or login details', 401);
  }
  if (user.email_verified) throw new AuthError('Email address is already verified', 409);
  return sendVerificationCode(user.id, 'REGISTRATION');
}

const passwordResetRequestMessage = 'If an active account with a verified email exists, a reset code will be sent.';

export async function requestPasswordReset({ email }) {
  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  const user = findByEmail.get(normalizedEmail);
  if (user && user.account_status === 'ACTIVE' && user.email_verified) {
    try {
      await sendVerificationCode(user.id, 'PASSWORD_RESET');
    } catch (error) {
      if (!(error instanceof VerificationError)) throw error;
    }
  }
  return { message: passwordResetRequestMessage };
}

export async function completePasswordReset({ email, code, password }) {
  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  const user = findByEmail.get(normalizedEmail);
  const passwordHash = await bcrypt.hash(password, 12);
  if (!user || user.account_status !== 'ACTIVE' || !user.email_verified) {
    throw new VerificationError('The reset code is invalid or expired', 400);
  }
  verifyPasswordResetCode(user.id, code, passwordHash);
  return { message: 'Password reset complete. Sign in with your new password.' };
}

export async function deactivateAccount(userId, password) {
  const user = db.prepare('SELECT password_hash,account_status FROM users WHERE id=?').get(userId);
  if (!user) throw new AuthError('User not found', 404);
  if (user.account_status !== 'ACTIVE') throw new AuthError('This account is already inactive', 409);
  if (!await bcrypt.compare(password, user.password_hash)) throw new AuthError('Password confirmation failed', 401);

  const deactivatedAt = new Date().toISOString();
  const deactivate = db.transaction(() => {
    const result = db.prepare(`UPDATE users SET account_status='DEACTIVATED',deactivated_at=?,
      session_version=session_version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id=? AND account_status='ACTIVE'`).run(deactivatedAt, userId);
    if (result.changes !== 1) throw new AuthError('This account is already inactive', 409);
  });
  deactivate.immediate();
  return {
    status: 'DEACTIVATED',
    message: 'Your account is deactivated, not permanently deleted. Civic-service records, notifications, and audit records are retained under applicable retention requirements.'
  };
}

export function updateProfile(userId, { name, phoneNumber, dateOfBirth, address }) {
  const previous = findPublicUserById.get(userId);
  if (!previous) throw new AuthError('User not found', 404);
  const update = db.transaction(() => {
    const updated = db.prepare(`UPDATE users SET display_name=?,phone_number=?,date_of_birth=?,address=?,
    date_of_birth_verification_status=CASE WHEN date_of_birth IS NOT ? THEN 'NOT_VERIFIED' ELSE date_of_birth_verification_status END,
    session_version=session_version+CASE WHEN phone_number IS NOT ? THEN 1 ELSE 0 END,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`)
      .run(name, phoneNumber, dateOfBirth, address, dateOfBirth, phoneNumber, userId);
    if (updated.changes !== 1) throw new AuthError('User not found', 404);
  });
  update.immediate();
  return publicUser(findPublicUserById.get(userId));
}

export function getPublicUserById(userId) {
  const user = findPublicUserById.get(userId);
  if (!user) throw new AuthError('User not found', 404);
  return publicUser(user);
}

export function getPreferences(userId) {
  const row = db.prepare(`SELECT language,appearance,notification_preferences,accessibility_preferences
    FROM users WHERE id=?`).get(userId);
  if (!row) throw new AuthError('User not found', 404);
  return {
    language: row.language,
    appearance: row.appearance,
    notificationPreferences: JSON.parse(row.notification_preferences),
    accessibilityPreferences: JSON.parse(row.accessibility_preferences)
  };
}

export function updatePreferences(userId, preferences) {
  const result = db.prepare(`UPDATE users SET language=?,appearance=?,notification_preferences=?,
    accessibility_preferences=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`)
    .run(preferences.language, preferences.appearance, JSON.stringify(preferences.notificationPreferences),
      JSON.stringify(preferences.accessibilityPreferences), userId);
  if (result.changes !== 1) throw new AuthError('User not found', 404);
  return getPreferences(userId);
}

export async function replaceProfileImage(userId, file, storage) {
  const previous = findPublicUserById.get(userId);
  if (!previous) throw new AuthError('User not found', 404);
  const newKey = await storage.uploadProfileImage({ buffer: file.buffer, mimeType: file.verifiedMimeType });
  let profileImageUrl;
  try {
    profileImageUrl = await storage.createProfileImageReadUrl(newKey, file.verifiedMimeType);
  } catch (error) {
    try { await storage.deleteProfileImageObject(newKey); } catch { /* Preserve the URL error; orphan cleanup can be retried. */ }
    throw error;
  }
  try {
    const update = db.prepare(`UPDATE users SET profile_image_key=?,profile_image_mime_type=?,
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND profile_image_key IS ?`)
      .run(newKey, file.verifiedMimeType, userId, previous.profile_image_key ?? null);
    if (update.changes !== 1) throw new AuthError('Profile photo changed during upload. Please try again.', 409);
  } catch (error) {
    try { await storage.deleteProfileImageObject(newKey); } catch { /* Preserve the database error; orphan cleanup can be retried. */ }
    throw error;
  }

  if (previous.profile_image_key && previous.profile_image_key !== newKey) {
    const stillReferenced = db.prepare('SELECT 1 FROM users WHERE profile_image_key=? LIMIT 1').get(previous.profile_image_key);
    if (!stillReferenced) {
      try { await storage.deleteProfileImageObject(previous.profile_image_key); } catch { /* The active image is already persisted; cleanup is best effort. */ }
    }
  }
  return { user: publicUser(findPublicUserById.get(userId)), profileImageUrl };
}

export async function removeProfileImage(userId, storage) {
  const previous = findPublicUserById.get(userId);
  if (!previous) throw new AuthError('User not found', 404);
  if (!previous.profile_image_key) return publicUser(previous);
  const removed = db.prepare(`UPDATE users SET profile_image_key=NULL,profile_image_mime_type=NULL,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND profile_image_key=?`)
    .run(userId, previous.profile_image_key);
  if (removed.changes !== 1) return publicUser(findPublicUserById.get(userId));
  const stillReferenced = db.prepare('SELECT 1 FROM users WHERE profile_image_key=? LIMIT 1').get(previous.profile_image_key);
  if (!stillReferenced) {
    try { await storage.deleteProfileImageObject(previous.profile_image_key); } catch { /* Database removal remains successful; stale objects can be cleaned up. */ }
  }
  return publicUser(findPublicUserById.get(userId));
}
