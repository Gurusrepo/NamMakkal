import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { db } from '../../config/database.js';
import { env } from '../../config/env.js';
import { EmailDeliveryError, sendVerificationEmail } from '../../services/email.service.js';

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const DELIVERY_LEASE_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;
const codeLength = 6;
const purposes = new Set(['REGISTRATION', 'LOGIN', 'PASSWORD_RESET', 'PROFILE_VERIFICATION']);

const findUser = db.prepare(`SELECT id, email, email_verified, account_status
  FROM users WHERE id=?`);
const findChallenge = db.prepare(`SELECT code_hash,expires_at,resend_after,attempt_count,
  consumed_at,delivery_status
  FROM user_verification_challenges WHERE user_id=? AND channel='EMAIL' AND purpose=?`);
const saveChallenge = db.prepare(`INSERT INTO user_verification_challenges
  (user_id,channel,purpose,destination,code_hash,expires_at,resend_after,attempt_count,
    consumed_at,delivery_status)
  VALUES (?,'EMAIL',?,?,?,?,?,0,NULL,'PENDING')
  ON CONFLICT(user_id,channel,purpose) DO UPDATE SET code_hash=excluded.code_hash,
    destination=excluded.destination,expires_at=excluded.expires_at,resend_after=excluded.resend_after,
    attempt_count=0,consumed_at=NULL,delivery_status='PENDING'`);
const deleteChallenge = db.prepare(`DELETE FROM user_verification_challenges
  WHERE user_id=? AND channel='EMAIL' AND purpose=? AND code_hash=?`);
const markChallengeSent = db.prepare(`UPDATE user_verification_challenges
  SET delivery_status='SENT',resend_after=?
  WHERE user_id=? AND channel='EMAIL' AND purpose=? AND code_hash=? AND delivery_status='PENDING'`);

export class VerificationError extends Error {
  constructor(message, status, details = {}) {
    super(message);
    this.status = status;
    this.expose = true;
    this.code = details.code;
    this.retryAfterSeconds = details.retryAfterSeconds;
    this.deliveryState = details.deliveryState;
  }
}

function isConfigured(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasOtpSecret() {
  return isConfigured(env.OTP_SECRET) && env.OTP_SECRET.length >= 32 && env.OTP_SECRET !== env.JWT_SECRET;
}


export function getVerificationAvailability() {
  const emailMissingConfiguration = [
    !isConfigured(env.BREVO_API_KEY) && 'BREVO_API_KEY',
    !isConfigured(env.BREVO_SENDER_EMAIL) && 'BREVO_SENDER_EMAIL',
    !hasOtpSecret() && 'a distinct OTP_SECRET of at least 32 characters'
  ].filter(Boolean);

  return {
    email: {
      available: emailMissingConfiguration.length === 0,
      missingConfiguration: emailMissingConfiguration
    }
  };
}


function hashCode(userId, channel, purpose, code) {
  if (!hasOtpSecret()) throw new VerificationError('OTP security is not configured', 503);
  return createHmac('sha256', env.OTP_SECRET)
    .update(`${userId}:${channel}:${purpose}:${code}`)
    .digest('hex');
}

function createCode() {
  return randomInt(0, 10 ** codeLength).toString().padStart(codeLength, '0');
}

function createChallenge(userId, purpose, destination, codeHash) {
  const now = Date.now();
  const transaction = db.transaction(() => {
    const previous = findChallenge.get(userId, purpose);
    if (previous && !previous.consumed_at && Date.parse(previous.resend_after) > now) {
      return {
        retryAfterSeconds: Math.ceil((Date.parse(previous.resend_after) - now) / 1000),
        deliveryState: previous.delivery_status
      };
    }
    saveChallenge.run(userId, purpose, destination, codeHash,
      new Date(now + CODE_TTL_MS).toISOString(), new Date(now + DELIVERY_LEASE_MS).toISOString());
    return {};
  });
  const result = transaction.immediate();
  if (result.retryAfterSeconds) {
    const isDeliveryPending = result.deliveryState === 'PENDING';
    throw new VerificationError(
      isDeliveryPending
        ? `A verification email is still being processed. Try again in ${result.retryAfterSeconds} seconds.`
        : `A verification code may still be usable. Try again in ${result.retryAfterSeconds} seconds.`,
      429,
      {
        code: isDeliveryPending ? 'OTP_DELIVERY_PENDING' : 'OTP_COOLDOWN',
        retryAfterSeconds: result.retryAfterSeconds,
        deliveryState: result.deliveryState
      }
    );
  }
}

export async function sendVerificationCode(userId, purpose = 'PROFILE_VERIFICATION') {
  if (!purposes.has(purpose)) {
    throw new VerificationError('Invalid verification request', 400);
  }
  const user = findUser.get(userId);
  if (!user) throw new VerificationError('User not found', 404);
  if (user.account_status === 'DEACTIVATED') throw new VerificationError('This account is inactive', 409);

  const isAuthPurpose = purpose === 'LOGIN' || purpose === 'PASSWORD_RESET';
  if (isAuthPurpose && (!user.email_verified || user.account_status !== 'ACTIVE')) {
    throw new VerificationError('A verified email and active account are required', 403);
  }
  if (!isAuthPurpose && user.email_verified) {
    throw new VerificationError('Email is already verified', 409);
  }

  const destination = user.email;
  if (!destination) throw new VerificationError('A registered email is required', 409);

  const availability = getVerificationAvailability().email;
  if (!availability.available) {
    throw new VerificationError(`Email verification is not configured. Set ${availability.missingConfiguration.join(', ')}.`, 503);
  }

  const code = createCode();
  const codeHash = hashCode(userId, 'EMAIL', purpose, code);
  createChallenge(userId, purpose, destination, codeHash);
  try {
    await sendVerificationEmail({ to: destination, code, purpose });
  } catch (error) {
    deleteChallenge.run(userId, purpose, codeHash);
    if (error instanceof VerificationError) throw error;
    if (error instanceof EmailDeliveryError) {
      throw new VerificationError('Email delivery failed. Please try again later.', 502, {
        code: 'EMAIL_DELIVERY_FAILED'
      });
    }
    throw error;
  }
  const sentAt = Date.now();
  const resendAfter = new Date(sentAt + RESEND_COOLDOWN_MS).toISOString();
  const markedSent = markChallengeSent.run(resendAfter, userId, purpose, codeHash);
  if (markedSent.changes !== 1) {
    throw new VerificationError('Email delivery could not be confirmed. Request a fresh code.', 503, {
      code: 'EMAIL_DELIVERY_UNCONFIRMED'
    });
  }
  const destinationLabel = purpose === 'LOGIN' || purpose === 'PASSWORD_RESET'
    ? 'registered email address' : 'email address';
  return {
    message: `A verification code was sent to your ${destinationLabel}.`,
    deliveryState: 'SENT',
    retryAfterSeconds: Math.max(0, Math.ceil((Date.parse(resendAfter) - Date.now()) / 1000))
  };
}

function consumeCode(userId, purpose, code, { isEligible = () => true, onConsumed = () => {} } = {}) {
  const verifiedAt = new Date().toISOString();
  const transaction = db.transaction(() => {
    const challenge = findChallenge.get(userId, purpose);
    if (!challenge || challenge.consumed_at || Date.parse(challenge.expires_at) <= Date.now()) {
      return { kind: 'invalid' };
    }
    if (challenge.attempt_count >= MAX_ATTEMPTS) return { kind: 'too_many' };
    if (!isEligible()) return { kind: 'invalid' };

    const expected = Buffer.from(challenge.code_hash, 'hex');
    const provided = Buffer.from(hashCode(userId, 'EMAIL', purpose, code), 'hex');
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      const attempt = db.prepare(`UPDATE user_verification_challenges SET attempt_count=attempt_count+1
        WHERE user_id=? AND channel='EMAIL' AND purpose=? AND consumed_at IS NULL AND attempt_count < ?`)
        .run(userId, purpose, MAX_ATTEMPTS);
      if (attempt.changes !== 1) return { kind: 'too_many' };
      return { kind: challenge.attempt_count + 1 >= MAX_ATTEMPTS ? 'too_many' : 'invalid' };
    }

    const consumed = db.prepare(`UPDATE user_verification_challenges SET consumed_at=?
      WHERE user_id=? AND channel='EMAIL' AND purpose=? AND consumed_at IS NULL AND expires_at>?`)
      .run(verifiedAt, userId, purpose, verifiedAt);
    if (consumed.changes !== 1) return { kind: 'invalid' };
    onConsumed(verifiedAt);
    return { kind: 'verified' };
  });

  const result = transaction.immediate();
  if (result.kind === 'too_many') {
    throw new VerificationError('Too many incorrect codes. Request a new code to try again.', 429, {
      code: 'OTP_TOO_MANY_ATTEMPTS'
    });
  }
  if (result.kind !== 'verified') {
    throw new VerificationError('The verification code is invalid or expired', 400, {
      code: 'OTP_INVALID_OR_EXPIRED'
    });
  }
  return { message: 'Verification completed' };
}

export function verifyCode(userId, code, purpose = 'PROFILE_VERIFICATION') {
  return consumeCode(userId, purpose, code, {
    onConsumed(consumedAt) {
      const updated = db.prepare(`UPDATE users SET email_verified=1,email_verified_at=?,
        account_status=CASE WHEN account_status='PENDING_EMAIL_VERIFICATION' THEN 'ACTIVE' ELSE account_status END,
        updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND account_status!='DEACTIVATED'`).run(consumedAt, userId);
      if (updated.changes !== 1) throw new VerificationError('The verification code is invalid or expired', 400);
    }
  });
}

export function sendLoginVerificationCode(userId) {
  return sendVerificationCode(userId, 'LOGIN');
}

export function verifyLoginCode(userId, code) {
  return consumeCode(userId, 'LOGIN', code, {
    isEligible() {
      const user = findUser.get(userId);
      return Boolean(user && user.account_status === 'ACTIVE' && user.email_verified);
    }
  });
}

export function verifyPasswordResetCode(userId, code, passwordHash) {
  return consumeCode(userId, 'PASSWORD_RESET', code, {
    isEligible() {
      const user = findUser.get(userId);
      return Boolean(user && user.account_status === 'ACTIVE' && user.email_verified);
    },
    onConsumed() {
      const changed = db.prepare(`UPDATE users SET password_hash=?,session_version=session_version+1,
        updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND account_status='ACTIVE' AND email_verified=1`).run(passwordHash, userId);
      if (changed.changes !== 1) throw new VerificationError('The verification code is invalid or expired', 400);
      db.prepare(`DELETE FROM user_verification_challenges
        WHERE user_id=? AND channel='EMAIL' AND purpose!='PASSWORD_RESET'`).run(userId);
    }
  });
}
