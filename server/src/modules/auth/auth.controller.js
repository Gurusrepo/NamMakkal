import * as authService from './auth.service.js';
import { env } from '../../config/env.js';
import jwt from 'jsonwebtoken';
import * as objectStorage from '../../services/objectStorage.js';
import * as verificationService from './verification.service.js';

export function cookieBaseOptionsForEnvironment(nodeEnv) {
  const isProduction = nodeEnv === 'production';
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/'
  };
}

const cookieBaseOptions = cookieBaseOptionsForEnvironment(env.NODE_ENV);

function cookieOptionsForToken(token) {
  const payload = jwt.decode(token);
  if (!payload || typeof payload !== 'object' ||
      !Number.isFinite(payload.iat) || !Number.isFinite(payload.exp) || payload.exp <= payload.iat) {
    throw new Error('Authentication token is missing a valid expiration');
  }
  return { ...cookieBaseOptions, maxAge: (payload.exp - payload.iat) * 1000 };
}

export async function register(req, res, next) {
  try {
    const result = await authService.register(req.body);
    res.status(202).json(result);
  } catch (error) { next(error); }
}

export async function login(req, res, next) {
  try {
    const result = await authService.login(req.body);
    if (result.requiresOtpVerification || result.requiresEmailVerification) return res.status(202).json(result);
    const { user, token } = result;
    res.cookie('civicpulse_token', token, cookieOptionsForToken(token));
    res.json({ user });
  } catch (error) { next(error); }
}

export async function completeLoginOtp(req, res, next) {
  try {
    const { user, token } = await authService.completeLoginOtp(req.body);
    res.cookie('civicpulse_token', token, cookieOptionsForToken(token));
    res.json({ user });
  } catch (error) { next(error); }
}

export async function resendLoginOtp(req, res, next) {
  try { res.json(await authService.login(req.body)); }
  catch (error) { next(error); }
}

export async function requestPasswordReset(req, res, next) {
  try { res.status(202).json(await authService.requestPasswordReset(req.body)); }
  catch (error) { next(error); }
}

export async function completePasswordReset(req, res, next) {
  try { res.json(await authService.completePasswordReset(req.body)); }
  catch (error) { next(error); }
}

export async function completeRegistrationEmail(req, res, next) {
  try { res.json(await authService.completeRegistrationEmail({ email: req.body.email, code: req.body.code })); }
  catch (error) { next(error); }
}

export async function resendRegistrationEmail(req, res, next) {
  try { res.json(await authService.resendRegistrationEmail(req.body)); }
  catch (error) { next(error); }
}

export async function deactivateAccount(req, res, next) {
  try {
    const result = await authService.deactivateAccount(req.user.id, req.body.password);
    res.clearCookie('civicpulse_token', cookieBaseOptions);
    res.json(result);
  } catch (error) { next(error); }
}

export function me(req, res) {
  res.json({ user: authService.getPublicUserById(req.user.id) });
}

export function updateProfile(req, res, next) {
  try {
    res.json({ user: authService.updateProfile(req.user.id, req.body) });
  } catch (error) { next(error); }
}

export function preferences(req, res, next) {
  try { res.json({ preferences: authService.getPreferences(req.user.id) }); }
  catch (error) { next(error); }
}

export function updatePreferences(req, res, next) {
  try { res.json({ preferences: authService.updatePreferences(req.user.id, req.body) }); }
  catch (error) { next(error); }
}

export async function sendEmailVerification(req, res, next) {
  try { res.json(await verificationService.sendVerificationCode(req.user.id, 'PROFILE_VERIFICATION')); }
  catch (error) { next(error); }
}

export async function verifyEmail(req, res, next) {
  try {
    const result = verificationService.verifyCode(req.user.id, req.body.code, 'PROFILE_VERIFICATION');
    res.json({ ...result, user: authService.getPublicUserById(req.user.id) });
  } catch (error) { next(error); }
}

export async function uploadProfileImage(req, res, next) {
  try {
    const result = await authService.replaceProfileImage(req.user.id, req.file, objectStorage);
    res.json({ user: result.user, profileImageUrl: result.profileImageUrl });
  } catch (error) { next(error); }
}

export async function getProfileImageUrl(req, res, next) {
  try {
    if (!req.user.profileImageKey || !req.user.profileImageMimeType) {
      return res.status(404).json({ error: 'No profile photo is set' });
    }
    const url = await objectStorage.createProfileImageReadUrl(req.user.profileImageKey, req.user.profileImageMimeType);
    res.json({ url, expiresIn: 300 });
  } catch (error) { next(error); }
}

export async function removeProfileImage(req, res, next) {
  try {
    const user = await authService.removeProfileImage(req.user.id, objectStorage);
    res.json({ user });
  } catch (error) { next(error); }
}

export function logout(req, res) {
  res.clearCookie('civicpulse_token', cookieBaseOptions);
  res.status(204).end();
}
