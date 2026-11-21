
import { env } from '../config/env.js';

let testTransport;

export class EmailDeliveryError extends Error {
  constructor(message = 'Email delivery failed') {
    super(message);
    this.name = 'EmailDeliveryError';
  }
}

function getPurposeContent(purpose, code) {
  const purposeText = {
    REGISTRATION: 'verify your NamMakkal account',
    LOGIN: 'sign in to NamMakkal',
    PASSWORD_RESET: 'reset your NamMakkal password',
    PROFILE_VERIFICATION: 'verify your email address'
  }[purpose];

  if (!purposeText) {
    throw new Error('Unsupported email verification purpose');
  }

  return {
    subject: purpose === 'PASSWORD_RESET'
      ? 'Reset your NamMakkal password'
      : 'Your NamMakkal verification code',
    text: `Use ${code} to ${purposeText}. This code expires in 10 minutes. If you did not request it, you can ignore this email.`
  };
}

export async function sendVerificationEmail({ to, code, purpose }) {
  const content = getPurposeContent(purpose, code);
  if (testTransport) {
    try {
      await testTransport.sendMail({
        from: { name: 'NamMakkal', address: env.BREVO_SENDER_EMAIL },
        to,
        ...content
      });

      return;
    } catch (error) {
      const knownCodes = new Set([
        'EAUTH',
        'ECONNECTION',
        'ECONNREFUSED',
        'ECONNRESET',
        'ETIMEDOUT',
        'EHOSTUNREACH',
        'ESOCKET',
        'EENVELOPE'
      ]);

      console.error('Brevo email delivery failed', {
        code: knownCodes.has(error?.code)
          ? error.code
          : 'UNCLASSIFIED',
        responseCode: Number.isInteger(error?.responseCode)
          ? error.responseCode
          : undefined
      });

      throw new EmailDeliveryError();
    }
  }

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': env.BREVO_API_KEY,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        sender: {
          name: 'NamMakkal',
          email: env.BREVO_SENDER_EMAIL
        },
        to: [{ email: to }],
        subject: content.subject,
        textContent: content.text
      }),
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      console.error('Brevo email delivery failed', {
        status: response.status
      });
      throw new EmailDeliveryError();
    }

    const result = await response.json();

    if (!result?.messageId) {
      throw new EmailDeliveryError();
    }
  } catch (error) {
    if (error instanceof EmailDeliveryError) throw error;

    console.error('Brevo email request failed', {
      name: error?.name || 'UnknownError'
    });

    throw new EmailDeliveryError();
  }
}

export function setEmailTransportForTesting(transport) {
  if (env.NODE_ENV !== 'test') {
    throw new Error('Email transport injection is available only in tests');
  }

  if (!transport || typeof transport.sendMail !== 'function') {
    throw new TypeError('A test transport with sendMail is required');
  }

  testTransport = transport;
}
