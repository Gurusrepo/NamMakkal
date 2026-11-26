import { Link } from 'react-router-dom';
import nammakkalLogo from '../assets/nammakkal-logo.png';

const sections = [
  ['Purpose of NamMakkal', 'NamMakkal is a citizen engagement platform that helps users document and track local civic complaints. The platform is intended to improve communication and visibility; it is not established as an official government service unless separately and clearly authorized.'],
  ['User eligibility and account responsibilities', 'You must provide accurate information and use an account belonging to you. Keep login details secure, notify us of unauthorized account use, and ensure that information submitted from your account is truthful and relevant.'],
  ['Citizen complaint submission rules', 'Submit complaints only for genuine civic issues in the location you describe. Provide a clear title, factual description, accurate location, and only relevant evidence. Contact details and unrelated personal information should not be included in public complaint descriptions.'],
  ['False or harmful complaints', 'Do not submit false, abusive, threatening, misleading, malicious, duplicated, discriminatory, or deliberately deceptive complaints. Do not use another person or organization as a target without a legitimate civic concern.'],
  ['Verification and moderation', 'Submitted complaints may be reviewed for completeness, duplication, safety, appropriateness, and applicable platform rules. Automated assessments may assist categorization or prioritization, but they do not replace human review or guarantee action.'],
  ['Complaint tracking and resolution', 'NamMakkal may show status updates and available information about submitted reports. Submission does not guarantee resolution, official delivery to a government department, or a particular outcome or timeline. Resolution depends on the responsible authority and other factors outside this platform.'],
  ['User content and permitted use', 'You retain responsibility for content you submit and confirm that you have the right to provide it. By submitting content, you grant NamMakkal permission to store, process, display, link, and use it only as reasonably needed to operate and moderate the service. Do not misuse, scrape, interfere with, or attempt unauthorized access to the platform.'],
  ['Privacy and personal information', 'Account and complaint information is processed to provide account, complaint, moderation, and support functions. Upload only information necessary for the concern being reported. NamMakkal may retain records according to operational and legal requirements. See the privacy notices displayed within the service, if and when available.'],
  ['Platform availability', 'The service may be unavailable because of maintenance, network conditions, storage limits, third-party failures, or other technical issues. Features and information may change, and interrupted or delayed submissions should be checked before resubmission.'],
  ['Intellectual property', 'NamMakkal software, branding, interface design, and original platform materials belong to their respective owners and may not be copied or reused except as permitted by applicable law or written authorization. User content remains subject to the permissions described above.'],
  ['Account suspension and termination', 'Accounts or submissions may be suspended or removed when there is a violation of these Terms, a security risk, suspected fraud or abuse, or a need to comply with applicable requirements. Where appropriate, we may provide notice or a route to request review.'],
  ['Changes to these Terms', 'These Terms may be updated as the platform, features, or legal requirements change. Material updates should be reviewed before continued use. The most recent version will be identified by its effective date on this page.'],
  ['Governing law', 'These Terms are governed by the laws of India, subject to applicable mandatory local or consumer protections. Disputes should first be raised with the support contact below.'],
  ['Contact and support', 'For questions, concerns, account issues, or reports of inappropriate content, contact mrguruprasad05@gmail.com.']
];

export default function TermsAndConditions() {
  return (
    <main className="min-h-screen bg-[#f7f6ef] px-4 py-8 sm:px-6 sm:py-12">
      <article className="mx-auto max-w-4xl overflow-hidden rounded-3xl border border-[#e5e2d5] bg-white shadow-sm">
        <header className="border-b border-[#edf0e9] bg-[#173d2b] px-6 py-8 text-white sm:px-10">
          <Link to="/login" className="inline-block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[#e2c77f]">
            <img src={nammakkalLogo} alt="NamMakkal" className="h-12 w-auto rounded-md bg-white p-1" />
          </Link>
          <p className="mt-7 text-xs font-semibold uppercase tracking-[0.18em] text-[#e2c77f]">Legal information</p>
          <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">Terms &amp; Conditions</h1>
          <p className="mt-3 text-sm text-white/75">Effective 27 November 2026</p>
        </header>
        <div className="px-6 py-8 sm:px-10 sm:py-10">
          <p className="text-sm leading-7 text-[#526258]">
            These Terms govern your use of NamMakkal. By creating an account or submitting a complaint, you agree to use the platform responsibly and lawfully.
          </p>
          <div className="mt-8 space-y-8">
            {sections.map(([title, text], index) => (
              <section key={title} aria-labelledby={`terms-section-${index}`}>
                <h2 id={`terms-section-${index}`} className="text-lg font-semibold text-[#20382a]">{index + 1}. {title}</h2>
                {title === 'Contact and support' ? (
                  <p className="mt-2 text-sm leading-7 text-[#526258]">
                    For questions, concerns, account issues, or reports of inappropriate content, contact{' '}
                    <a href="mailto:mrguruprasad05@gmail.com" className="font-semibold text-[#1d4933] underline underline-offset-4">mrguruprasad05@gmail.com</a>.
                  </p>
                ) : <p className="mt-2 text-sm leading-7 text-[#526258]">{text}</p>}
              </section>
            ))}
          </div>
        </div>
      </article>
    </main>
  );
}
