import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import nammakkalLogo from '../../assets/nammakkal-logo.png';
import { getApiErrorMessage } from '../../api/errors.js';
import { isValidEmail } from '../../utils/validation.js';
import { useTranslation } from '../../i18n/LocaleProvider.jsx';

const roleLandingRoutes = {
  CITIZEN: '/citizen',
  OFFICER: '/officer',
  ADMIN: '/admin'
};

function getRetryAfterSeconds(error) {
  const value = Number(
    error?.response?.data?.retryAfterSeconds ??
    error?.response?.headers?.['retry-after']
  );
  return Number.isFinite(value) && value > 0 ? Math.ceil(value) : 0;
}

// Shows a calm loading screen while an existing cookie session is restored.
function SessionLoading() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f7f6ef] px-6">
      <p role="status" className="text-sm font-medium text-[#385743]">Checking your session...</p>
    </main>
  );
}

// Provides the branded sign-in form and routes users according to their backend role.
export default function Login() {
  const {
    user, isAuthenticated, isLoading, sessionError, logoutWarning, login, completeLoginOtp,
    resendLoginOtp, completeRegistrationEmail, resendRegistrationEmail, logout
  } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRetryingLogout, setIsRetryingLogout] = useState(false);
  const [logoutRetryMessage, setLogoutRetryMessage] = useState('');
  const [verificationRequired, setVerificationRequired] = useState(false);
  const [verificationPurpose, setVerificationPurpose] = useState('LOGIN');
  const [verificationCode, setVerificationCode] = useState('');
  const [verificationMessage, setVerificationMessage] = useState('');
  const [otpDestination, setOtpDestination] = useState('');
  const [resendSeconds, setResendSeconds] = useState(0);

  useEffect(() => {
    if (resendSeconds <= 0) return undefined;
    const timer = window.setTimeout(() => setResendSeconds((seconds) => seconds - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendSeconds]);

  // Sends authenticated visitors directly to the landing page for their role.
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate(roleLandingRoutes[user?.role] ?? '/', { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate, user]);

  // Submits credentials through the shared cookie-based authentication context.
  async function handleSubmit(event) {
    event.preventDefault();
    setErrorMessage('');
    const value = email.trim();
    if (!isValidEmail(value)) {
      setErrorMessage('Enter a valid email address.');
      return;
    }
    if (password.length > 72 || new TextEncoder().encode(password).length > 72) {
      setErrorMessage('Your password must be no more than 72 characters and 72 bytes.');
      return;
    }
    setIsSubmitting(true);

    try {
      const result = await login({ email: value.toLowerCase(), password });
      if (result.requiresOtpVerification || result.requiresEmailVerification) {
        setVerificationRequired(true);
        setVerificationPurpose(result.requiresEmailVerification ? 'REGISTRATION' : 'LOGIN');
        setVerificationMessage(result.message);
        setOtpDestination(result.destination ?? '');
        setResendSeconds(result.retryAfterSeconds ?? 0);
        return;
      }
      navigate(roleLandingRoutes[result.user?.role] ?? '/', { replace: true });
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, 'We could not sign you in. Check your details and try again.'));
      setResendSeconds(getRetryAfterSeconds(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleVerifyOtp(event) {
    event.preventDefault();
    setErrorMessage('');
    setIsSubmitting(true);
    try {
      if (verificationPurpose === 'REGISTRATION') {
        await completeRegistrationEmail({ email: email.trim().toLowerCase(), code: verificationCode });
        setVerificationPurpose('LOGIN');
        setVerificationCode('');
        const result = await login({ email: email.trim().toLowerCase(), password });
        setVerificationMessage(result.message);
        setOtpDestination(result.destination ?? '');
        setResendSeconds(result.retryAfterSeconds ?? 0);
        return;
      }
      const authenticatedUser = await completeLoginOtp({ email: email.trim().toLowerCase(), code: verificationCode });
      navigate(roleLandingRoutes[authenticatedUser?.role] ?? '/', { replace: true });
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, 'We could not verify your email code. Please try again.'));
      setResendSeconds(getRetryAfterSeconds(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRetryLogout() {
    setErrorMessage('');
    setLogoutRetryMessage('');
    setIsRetryingLogout(true);
    try {
      await logout();
      setLogoutRetryMessage('The server confirmed sign out.');
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, 'The server could not confirm sign out. Try again when your connection is available.'));
    } finally {
      setIsRetryingLogout(false);
    }
  }

  // Keeps the password field synchronized with the form state.
  function handlePasswordChange(event) {
    setPassword(event.target.value);
    setVerificationRequired(false);
    setVerificationPurpose('LOGIN');
    setVerificationCode('');
    setVerificationMessage('');
  }

  // Toggles password visibility for easier entry on personal devices.
  function handlePasswordVisibility() {
    setShowPassword(!showPassword);
  }

  if (isLoading) return <SessionLoading />;
  if (isAuthenticated) return <SessionLoading />;

  return (
    <main className="min-h-screen bg-[#f7f6ef] lg:grid lg:grid-cols-[0.92fr_1.08fr]">
      <aside className="relative hidden min-h-screen overflow-hidden bg-[#173d2d] px-12 py-10 text-white lg:flex lg:flex-col lg:justify-between xl:px-20">
        <div className="absolute -right-28 top-1/4 h-96 w-96 rounded-full border border-white/10" />
        <div className="absolute -right-12 top-[30%] h-64 w-64 rounded-full border border-[#d4ae58]/25" />
        <img
  className="hidden h-auto w-56 sm:block"
  src={nammakkalLogo}
  alt="NAMMAKKAL"
/>

        <div className="relative z-10 max-w-lg pb-12">
  <p className="mb-5 font-['Inter'] text-xs font-bold uppercase tracking-[0.24em] text-[#e2c77f] transition-transform duration-300 ease-in-out hover:scale-105">
    Together, We Build Better Tomorrow
  </p>

  <h1 className="font-['Manrope'] text-5xl font-extrabold leading-[1.12] ">
      Our town.<br />
      Our voice.<br />
      <span className="text-[#e2c77f]">Our future.</span>
  </h1>

  <p className="mt-7 max-w-md font-['Inter'] text-base leading-8 text-white/80 transition-transform duration-300 ease-in-out hover:scale-105">
    Your voice matters. Share ideas, raise concerns, and work together to create a better, stronger future for everyone.
  </p>
</div>
        <p className="relative z-10 text-xs text-white/55">
  By continuing, you agree to our{" "}
  <a
    href="/terms-and-conditions"
    className="text-[#e2c77f] transition-colors hover:text-white hover:underline"
  >
    Terms & Conditions
  </a>
</p>
      </aside>

      <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-10 lg:px-14 xl:px-24">
        <div className="w-full max-w-md">
          <img className="mb-9 h-auto w-48 rounded-xl bg-white p-2 shadow-sm lg:hidden" src={nammakkalLogo} alt="NAMMAKKAL" />
          <div className="mb-8">
            <p className="mb-3 text-l font-semibold uppercase tracking-[0.2em] text-[#9a7832]">Welcome 🙏</p>
            <h2 className="text-3xl font-semibold tracking-tight text-[#20382a] sm:text-4xl"><span class = "text-[#725a23] font-['Inter']">SignIn</span> to your account</h2>

          </div>

          {sessionError && <p role="status" className="mb-5 rounded-xl border border-[#e7d9b4] bg-[#fff9e9] px-4 py-3 text-sm text-[#725a23]">We could not verify an existing session. You can still try signing in.</p>}
          {logoutWarning && <div role="status" className="mb-5 rounded-xl border border-[#e7d9b4] bg-[#fff9e9] px-4 py-3 text-sm text-[#725a23]">
            <p>Your local session was cleared, but the server could not confirm sign out. The session cookie may remain valid until the server can clear it.</p>
            <button type="button" onClick={handleRetryLogout} disabled={isRetryingLogout} className="mt-3 min-h-10 rounded-lg font-semibold underline underline-offset-2 disabled:opacity-60">{isRetryingLogout ? 'Retrying sign out...' : 'Retry sign out'}</button>
          </div>}
          {logoutRetryMessage && <p role="status" className="mb-5 rounded-xl border border-[#d4e2d3] bg-[#f2f8f1] px-4 py-3 text-sm text-[#385743]">{logoutRetryMessage}</p>}
          {errorMessage && <p role="alert" className="mb-5 rounded-xl border border-[#e9c9c2] bg-[#fff5f2] px-4 py-3 text-sm text-[#8b3c2d]">{errorMessage}</p>}

            <form className="space-y-5" onSubmit={handleSubmit} aria-busy={isSubmitting}>
            <div>
              <label htmlFor="login-email" className="mb-2 block text-sm font-medium text-[#34483a]">Email address</label>
              <input id="login-email" name="email" type="email" autoComplete="username" maxLength={254} required value={email} onChange={(event) => {
                setEmail(event.target.value);
                setVerificationRequired(false);
                setVerificationCode('');
                setVerificationMessage('');
              }} className="w-full rounded-xl border border-[#d9ded5] bg-white px-4 py-3.5 text-sm text-[#24362a] outline-none placeholder:text-[#9aa39b] focus:border-[#477454] focus:ring-4 focus:ring-[#477454]/10" placeholder="Enter your email address" />
            </div>
            <div>
              <label htmlFor="login-password" className="mb-2 block text-sm font-medium text-[#34483a]">Password</label>
            <div className="relative">
              <input
                id="login-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                maxLength={72}
                required
                value={password}
                onChange={handlePasswordChange}
                className="password-input w-full rounded-xl border border-[#d9ded5] bg-white px-4 py-3.5 pr-12 text-sm text-[#24362a] outline-none transition placeholder:text-[#9aa39b] focus:border-[#477454] focus:ring-4 focus:ring-[#477454]/10"
                placeholder="Enter your password"
              />

              <button
                type="button"
                onClick={handlePasswordVisibility}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                className="absolute inset-y-0 right-3 z-10 grid w-8 place-items-center rounded-full text-[#426c4d] transition-colors hover:bg-[#edf2eb] hover:text-[#1d4933] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#477454]/40"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-5 w-5"
                >
                  {showPassword ? (
                    <>
                      <path d="M3 3l18 18" />
                      <path d="M10.6 10.6a2 2 0 002.8 2.8" />
                      <path d="M9.9 5.2A11.7 11.7 0 0112 5c5.2 0 8.8 4.4 10 7-.4.9-1.2 2.1-2.3 3.2M6.2 6.2C3.9 7.5 2.5 9.5 2 12c.6 1.4 1.9 3.1 3.8 4.4A10.4 10.4 0 0012 19c1 0 1.9-.1 2.8-.4" />
                    </>
                  ) : (
                    <>
                      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
                      <circle cx="12" cy="12" r="3" />
                    </>
                  )}
                </svg>
              </button>
            </div>

            </div>
            <button type="submit" disabled={isSubmitting} className="flex w-full items-center justify-center rounded-xl bg-[#1d4933] px-5 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#163b29] focus:outline-none focus:ring-4 focus:ring-[#477454]/25 disabled:cursor-not-allowed disabled:opacity-65">
              {isSubmitting ? (
                <><span aria-hidden="true" className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white/50 border-t-white motion-reduce:animate-none" />Signing you in...</>
              ) : verificationRequired ? 'Send or resend email code' : 'Sign in'}
            </button>
            <div className="text-right">
              <Link className="text-sm font-semibold text-[#1d4933] underline underline-offset-2" to="/forgot-password">{t('auth.forgotPassword')}</Link>
            </div>
          </form>

          {verificationRequired && <section aria-labelledby="login-verification-title" className="mt-5 space-y-4 rounded-2xl border border-[#e5e2d5] bg-white p-5 shadow-sm">
                        
            <div>
              <h3 id="login-verification-title" className="text-lg font-semibold text-[#20382a]">
                Verify your email
              </h3>
              {otpDestination && (
                <p className="mt-1 text-sm text-[#68736a]">
                  OTP sent to : {otpDestination}
                </p>
              )}
            </div>

            <form onSubmit={handleVerifyOtp} className="space-y-3" aria-busy={isSubmitting}>
              <label htmlFor="login-otp-code" className="block text-sm font-medium text-[#34483a]">Verification code</label>
              <input id="login-otp-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required value={verificationCode} onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))} className="w-full rounded-xl border border-[#d9ded5] bg-white px-4 py-3 text-sm text-[#24362a] outline-none focus:border-[#477454] focus:ring-4 focus:ring-[#477454]/10" />
              <button type="submit" disabled={isSubmitting || verificationCode.length !== 6} className="flex min-h-11 w-full items-center justify-center rounded-xl bg-[#1d4933] px-5 text-sm font-semibold text-white disabled:opacity-60">{isSubmitting ? 'Verifying...' : verificationPurpose === 'REGISTRATION' ? 'Verify email and continue' : 'Verify code and sign in'}</button>
            </form>
            <button type="button" disabled={isSubmitting || resendSeconds > 0} onClick={async () => {
              setErrorMessage('');
              setIsSubmitting(true);
              try {
                const result = verificationPurpose === 'REGISTRATION'
                  ? await resendRegistrationEmail({ email: email.trim().toLowerCase(), password })
                  : await resendLoginOtp({ email: email.trim().toLowerCase(), password });
                setVerificationMessage(result.message);
                setResendSeconds(result.retryAfterSeconds ?? 0);
              } catch (error) {
                setErrorMessage(getApiErrorMessage(error, 'Please wait before requesting another code.'));
                setResendSeconds(getRetryAfterSeconds(error));
              } finally {
                setIsSubmitting(false);
              }
            }} className="min-h-10 text-sm font-semibold text-[#1d4933] underline disabled:cursor-not-allowed disabled:text-[#8b948d]">
              {resendSeconds > 0 ? `Resend code in ${resendSeconds} seconds` : 'Resend code'}
            </button>
          </section>}

          <p className="mt-7 text-center text-sm text-[#68736a]">New to NamMakkal? {" "}<Link className="font-semibold text-[#1d4933] underline decoration-[#d4ae58] decoration-2 underline-offset-4 hover:text-[#9a7832]" to="/register">  Create a Account</Link></p>
        </div>
      </section>
    </main>
  );
}
