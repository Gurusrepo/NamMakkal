
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_PATH: z.string().min(1).default('./data/civicpulse.sqlite'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must contain at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('1d'),
  CORS_ORIGINS: z.string().min(1, 'Configure at least one CORS origin'),
  SEED_EMAIL: z.string().optional(),
  SEED_PASSWORD: z.string().optional(),
  SEED_ROLE: z.enum(['OFFICER', 'ADMIN']).default('OFFICER'),

  BREVO_API_KEY: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.string().trim().optional()
  ),
  BREVO_SENDER_EMAIL: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.string().trim().email('BREVO_SENDER_EMAIL must be a valid email').optional()
  ),

  OTP_SECRET: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.string().optional()
  ),

  CITIZEN_ELIGIBILITY_MIN_AGE: z.coerce.number().int().min(0).max(120).default(18),
  SENIOR_CITIZEN_MIN_AGE: z.coerce.number().int().min(0).max(120).default(60),
  SUPABASE_URL: z.string().url('SUPABASE_URL must be a valid URL'),
  SUPABASE_SECRET_KEY: z.string().min(1, 'SUPABASE_SECRET_KEY is required'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().min(1).default('gemini-2.5-flash-lite')
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');
  throw new Error(`Invalid server environment: ${details}`);
}

if (parsed.data.SENIOR_CITIZEN_MIN_AGE < parsed.data.CITIZEN_ELIGIBILITY_MIN_AGE) {
  throw new Error('Invalid server environment: SENIOR_CITIZEN_MIN_AGE must not be below CITIZEN_ELIGIBILITY_MIN_AGE');
}

if (parsed.data.OTP_SECRET && parsed.data.OTP_SECRET.length < 32) {
  throw new Error('Invalid server environment: OTP_SECRET must contain at least 32 characters');
}

if (parsed.data.OTP_SECRET && parsed.data.OTP_SECRET === parsed.data.JWT_SECRET) {
  throw new Error('Invalid server environment: OTP_SECRET must be different from JWT_SECRET');
}

if (
  parsed.data.NODE_ENV === 'production' &&
  (!parsed.data.BREVO_API_KEY || !parsed.data.BREVO_SENDER_EMAIL || !parsed.data.OTP_SECRET)
) {
  throw new Error('Invalid server environment: BREVO_API_KEY, BREVO_SENDER_EMAIL, and OTP_SECRET are required in production');
}

const origins = parsed.data.CORS_ORIGINS
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

for (const origin of origins) {
  try {
    const parsedOrigin = new URL(origin);
    if (!['http:', 'https:'].includes(parsedOrigin.protocol) || parsedOrigin.origin !== origin) {
      throw new Error();
    }
  } catch {
    throw new Error(`Invalid CORS origin: ${origin}`);
  }
}

if (parsed.data.NODE_ENV === 'production' && parsed.data.JWT_SECRET.includes('replace-with-')) {
  throw new Error('JWT_SECRET must be replaced before production startup');
}

export const env = Object.freeze({
  ...parsed.data,
  CORS_ORIGINS: origins
});
