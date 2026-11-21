import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import nammakkalLogo from '../../assets/nammakkal-logo.png';
import { getApiErrorMessage } from '../../api/errors.js';
import { isValidEmail } from '../../utils/validation.js';
import { isValidIndianMobile, normalizeIndianMobile } from '../../utils/phone.js';
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

// Returns the first field validation message for public citizen registration.
function getRegistrationError({ name, email, phoneNumber, dateOfBirth, address, password, confirmPassword }) {
  const cleanName = name.trim();
  const cleanEmail = email.trim();
  const passwordBytes = new TextEncoder().encode(password).length;

  if (cleanName.length < 1 || cleanName.length > 100) return 'Enter a name between 1 and 100 characters.';
  if (cleanEmail.length > 254 || !isValidEmail(cleanEmail)) return 'Enter a valid email address.';
  if (!isValidIndianMobile(phoneNumber)) return 'Enter a valid 10-digit Indian mobile number.';
  const parsedDate = new Date(`${dateOfBirth}T00:00:00Z`);
  if (!dateOfBirth || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== dateOfBirth || dateOfBirth >= new Date().toISOString().slice(0, 10)) return 'Enter a valid date of birth in the past.';
  if (!address.trim() || address.trim().length > 400) return 'Enter your residential address (400 characters or fewer).';
  if (password.length < 10 || password.length > 72 || passwordBytes > 72) return 'Your password must be 10 to 72 characters and no more than 72 bytes.';
  if (password !== confirmPassword) return 'The passwords do not match.';
  return '';
}

// Provides the branded citizen registration form and role-aware session redirects.
export default function Register() {
  const { user, isAuthenticated, isLoading, sessionError, register, completeRegistrationEmail, resendRegistrationEmail } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [address, setAddress] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [verificationMessage, setVerificationMessage] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [isEmailVerificationPending, setIsEmailVerificationPending] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
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

  // Validates and submits a public citizen registration request.
  async function handleSubmit(event) {
    event.preventDefault();
    setErrorMessage('');
    const validationError = getRegistrationError({ name, email, phoneNumber, dateOfBirth, address, password, confirmPassword });
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await register({
        name: name.trim(), email: email.trim().toLowerCase(), password, phoneNumber: normalizeIndianMobile(phoneNumber),
        dateOfBirth, address: address.trim()
      });
      setIsEmailVerificationPending(true);
      setVerificationMessage(result.message);
      setResendSeconds(result.retryAfterSeconds ?? 0);
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, 'We could not create your account. Please try again.'));
      setResendSeconds(getRetryAfterSeconds(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleVerifyEmail(event) {
    event.preventDefault();
    setErrorMessage('');
    setIsSubmitting(true);
    try {
      await completeRegistrationEmail({ email: email.trim().toLowerCase(), code: verificationCode });
      setVerificationMessage('Email verified successfully. You can now sign in.');
      setIsEmailVerificationPending(false);
      navigate('/login', { replace: true });
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, 'We could not verify your email address. Please try again.'));
      setResendSeconds(getRetryAfterSeconds(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResendEmailCode() {
    setErrorMessage('');
    setIsSubmitting(true);
    try {
      const result = await resendRegistrationEmail({ email: email.trim().toLowerCase(), password });
      setVerificationMessage(result.message);
      setResendSeconds(result.retryAfterSeconds ?? 0);
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, 'We could not send a new verification code.'));
      setResendSeconds(getRetryAfterSeconds(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  // Keeps the display name field synchronized with the form state.
  function handleNameChange(event) {
    setName(event.target.value);
  }

  // Keeps the email field synchronized with the form state.
  function handleEmailChange(event) {
    setEmail(event.target.value);
  }

  // Keeps the password field synchronized with the form state.
  function handlePasswordChange(event) {
    setPassword(event.target.value);
  }

  // Keeps the password confirmation field synchronized with the form state.
  function handleConfirmPasswordChange(event) {
    setConfirmPassword(event.target.value);
  }

  // Toggles password visibility to support easier form entry.
  function handlePasswordVisibility() {
    setShowPassword(!showPassword);
  }

  if (isLoading) {
    return <main className="grid min-h-screen place-items-center bg-[#f7f6ef] px-6"><p role="status" className="text-sm font-medium text-[#385743]">Checking your session...</p></main>;
  }
  if (isAuthenticated) {
    return <main className="grid min-h-screen place-items-center bg-[#f7f6ef] px-6"><p role="status" className="text-sm font-medium text-[#385743]">Taking you to your account...</p></main>;
  }

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
        <p className="mb-5 font-['Inter'] text-xs font-bold uppercase tracking-[0.24em] text-[#e2c77f]">
          Together, We Build Better Tomorrow
        </p>

        <h1 className="font-['Manrope'] text-5xl font-extrabold leading-[1.12] tracking-tight xl:text-6xl">
          Our town.<br />
          Our voice.<br />
          <span className="text-[#e2c77f]">Our future.</span>
        </h1>

        <p className="mt-7 max-w-md font-['Inter'] text-base leading-8 text-white/80">
          Your voice matters. Share ideas, raise concerns, and work together to create a better, stronger Place for everyone.
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
        <img className="mb-9 h-auto w-52 rounded-xl bg-white p-2 shadow-sm lg:hidden" src={nammakkalLogo} alt="NAMMAKKAL" />
          <div className="mb-7">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-[#9a7832]">Join ourCommunity</p>
          </div>

          {sessionError && <p role="status" className="mb-5 rounded-xl border border-[#e7d9b4] bg-[#fff9e9] px-4 py-3 text-sm text-[#725a23]">We could not verify an existing session. You can still create an account.</p>}
          {errorMessage && <p role="alert" className="mb-5 rounded-xl border border-[#e9c9c2] bg-[#fff5f2] px-4 py-3 text-sm text-[#8b3c2d]">{errorMessage}</p>}

          {!isEmailVerificationPending ? <form className="space-y-4" onSubmit={handleSubmit} aria-busy={isSubmitting}>
            <div>
              <label htmlFor="register-name" className="mb-2 block text-sm font-medium text-[#34483a]">Full name</label>
              <input id="register-name" name="name" type="text" autoComplete="name" maxLength={100} required value={name} onChange={handleNameChange} className="w-full rounded-xl border border-[#d9ded5] bg-white px-4 py-3 text-sm text-[#24362a] outline-none transition placeholder:text-[#9aa39b] focus:border-[#477454] focus:ring-4 focus:ring-[#477454]/10" placeholder="Your name" />
            </div>
            <div>
              <label htmlFor="register-email" className="mb-2 block text-sm font-medium text-[#34483a]">Email address</label>
              <input id="register-email" name="email" type="email" autoComplete="email" maxLength={254} required value={email} onChange={handleEmailChange} className="w-full rounded-xl border border-[#d9ded5] bg-white px-4 py-3 text-sm text-[#24362a] outline-none transition placeholder:text-[#9aa39b] focus:border-[#477454] focus:ring-4 focus:ring-[#477454]/10" placeholder="you@example.com" />
            </div>
            <div>
              <label htmlFor="register-phone" className="mb-2 block text-sm font-medium text-[#34483a]">Mobile number</label>
              <div className="flex rounded-xl border border-[#d9ded5] bg-white focus-within:border-[#477454] focus-within:ring-4 focus-within:ring-[#477454]/10">
                <span className="flex shrink-0 items-center border-r border-[#d9ded5] px-3 text-sm font-semibold text-[#426c4d]">+91</span>
                <input id="register-phone" name="phoneNumber" type="tel" autoComplete="tel-national" inputMode="numeric" maxLength={12} required value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '').slice(0, 10))} className="min-w-0 flex-1 rounded-r-xl bg-transparent px-4 py-3 text-sm text-[#24362a] outline-none placeholder:text-[#9aa39b]" placeholder="9876543210" />
              </div>
            </div>
            <div>
              <label htmlFor="register-dob" className="mb-2 block text-sm font-medium text-[#34483a]">Date of birth</label>
              <input id="register-dob" name="dateOfBirth" type="date" autoComplete="bday" max={new Date().toISOString().slice(0, 10)} required value={dateOfBirth} onChange={(event) => setDateOfBirth(event.target.value)} className="w-full rounded-xl border border-[#d9ded5] bg-white px-4 py-3 text-sm text-[#24362a] outline-none transition focus:border-[#477454] focus:ring-4 focus:ring-[#477454]/10" />
            </div>
            <div>
              <label htmlFor="register-address" className="mb-2 block text-sm font-medium text-[#34483a]">Residential address</label>
              <textarea id="register-address" name="address" autoComplete="street-address" maxLength={400} rows={3} required value={address} onChange={(event) => setAddress(event.target.value)} className="w-full rounded-xl border border-[#d9ded5] bg-white px-4 py-3 text-sm text-[#24362a] outline-none transition placeholder:text-[#9aa39b] focus:border-[#477454] focus:ring-4 focus:ring-[#477454]/10" placeholder="Street, Landmark, City, District, Pincode" />
            </div>
            <div>
              <label htmlFor="register-password" className="mb-2 block text-sm font-medium text-[#34483a]">Password</label>
              <div className="relative">
              <input id="register-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={10} maxLength={72} required value={password} onChange={handlePasswordChange} className="w-full rounded-xl border border-[#d9ded5] bg-white px-4 py-3 pr-20 text-sm text-[#24362a] outline-none transition placeholder:text-[#9aa39b] focus:border-[#477454] focus:ring-4 focus:ring-[#477454]/10" placeholder="At least 10 characters" />
                <button type="button" onClick={handlePasswordVisibility} aria-label={showPassword ? 'Hide passwords' : 'Show passwords'} aria-pressed={showPassword} className="absolute inset-y-0 right-2 z-10 grid w-10 place-items-center rounded-lg text-[#426c4d] transition hover:bg-[#edf2eb] hover:text-[#1d4933] focus:outline-none focus:ring-2 focus:ring-[#477454]/40">
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                    {showPassword ? <><path d="M3 3l18 18" /><path d="M10.6 10.6a2 2 0 002.8 2.8" /><path d="M9.9 5.2A11.7 11.7 0 0112 5c5.2 0 8.8 4.4 10 7-.4.9-1.2 2.1-2.3 3.2M6.2 6.2C3.9 7.5 2.5 9.5 2 12c.6 1.4 1.9 3.1 3.8 4.4A10.4 10.4 0 0012 19c1 0 1.9-.1 2.8-.4" /></> : <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>}
                  </svg>
                </button>
              </div>
              <p className="mt-2 ml-2 text-xs text-[#7a847b]">max 72 characters.</p>
            </div>
            <div>
              <label htmlFor="register-confirm-password" className="mb-2 block text-sm font-medium text-[#34483a]">Confirm password</label>
              <input id="register-confirm-password" name="confirmPassword" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required value={confirmPassword} onChange={handleConfirmPasswordChange} className="w-full rounded-xl border border-[#d9ded5] bg-white px-4 py-3 text-sm text-[#24362a] outline-none transition placeholder:text-[#9aa39b] focus:border-[#477454] focus:ring-4 focus:ring-[#477454]/10" placeholder="Enter your password again" />
            </div>
            <button type="submit" disabled={isSubmitting} className="flex w-full items-center justify-center rounded-xl bg-[#1d4933] px-5 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#163b29] focus:outline-none focus:ring-4 focus:ring-[#477454]/25 disabled:cursor-not-allowed disabled:opacity-65">
              {isSubmitting ? 'Creating your account...' : 'Create account'}
            </button>
          </form> : <section aria-labelledby="register-email-verification-title" className="space-y-4 rounded-2xl border border-[#e5e2d5] bg-white p-5 shadow-sm">
            <div>
              <h3 id="register-email-verification-title" className="text-lg font-semibold text-[#20382a]">Verify your account</h3>
              <p className="mt-1 text-sm leading-6 text-[#68736a]">Enter the 6-digit code sent to {email.trim()}. Your account will not be available until this step is complete.</p>
            </div>
            {verificationMessage && <p role="status" className="text-sm text-[#385743]">{verificationMessage}</p>}
            <form onSubmit={handleVerifyEmail} className="space-y-3" aria-busy={isSubmitting}>
              <label htmlFor="register-email-code" className="block text-sm font-medium text-[#34483a]">Email verification code</label>
              <input id="register-email-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required value={verificationCode} onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))} className="w-full rounded-xl border border-[#d9ded5] bg-white px-4 py-3 text-sm text-[#24362a] outline-none focus:border-[#477454] focus:ring-4 focus:ring-[#477454]/10" />
              <button type="submit" disabled={isSubmitting || verificationCode.length !== 6} className="flex min-h-11 w-full items-center justify-center rounded-xl bg-[#1d4933] px-5 text-sm font-semibold text-white disabled:opacity-60">{isSubmitting ? 'Verifying...' : 'Verify email and complete registration'}</button>
            </form>
            <button type="button" onClick={handleResendEmailCode} disabled={isSubmitting || resendSeconds > 0} className="min-h-10 rounded-lg border border-[#cfd8ce] px-3 text-sm font-semibold text-[#1d4933] disabled:opacity-60">{isSubmitting ? 'Sending...' : resendSeconds > 0 ? `Resend in ${resendSeconds}s` : 'Resend code'}</button>
          </section>}

          <p className="mt-6 text-center text-sm text-[#68736a]">
            {t('auth.registrationResumePrompt')}{' '}
            <Link className="font-semibold text-[#1d4933] underline decoration-[#d4ae58] decoration-2 underline-offset-4 hover:text-[#9a7832]" to="/login">
              {t('auth.signInToResume')}
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
