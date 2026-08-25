import { LegalDocument } from "@/components/LegalDocument";

export const metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return (
    <LegalDocument title="Terms of Service" summary="These terms explain the rules for using Sport IQ. They are a practical product policy and should be reviewed by qualified counsel before a commercial launch.">
      <h2>1. What Sport IQ provides</h2>
      <p>Sport IQ provides sports analytics, model projections, market comparisons, and tracked results for informational and entertainment purposes. Predictions are estimates, can be wrong, and are never guarantees of an outcome or payout.</p>
      <h2>2. Eligibility and local rules</h2>
      <p>You must be legally able to use this service where you live. If you use analytics in connection with wagering, you are solely responsible for age requirements, local law, operator rules, taxes, and limits that apply to you.</p>
      <h2>3. Accounts and access</h2>
      <p>Keep your credentials secure and provide accurate account information. Friends & Family codes are single-use, cannot be sold or transferred, and may be disabled if obtained through abuse. Do not share premium content in a way that defeats access controls.</p>
      <h2>4. Acceptable use</h2>
      <p>Do not attack, scrape at harmful volume, reverse engineer access controls, upload malicious material, impersonate others, or use Sport IQ to violate another service&apos;s terms. Automated access requires written permission.</p>
      <h2>5. Data and third parties</h2>
      <p>Schedules, statistics, odds, payment tools, authentication, and community features may rely on third parties. Their data can be delayed, corrected, unavailable, or subject to separate terms. Sport IQ may pause a feature when data quality is uncertain.</p>
      <h2>6. Changes and availability</h2>
      <p>Features, policies, and access levels may change as the product develops. Material policy changes should be announced in the product. The service may be interrupted for maintenance, security, or provider outages.</p>
      <h2>7. Disclaimers and limitation</h2>
      <p>The service is provided on an “as available” basis to the extent permitted by law. Sport IQ is not responsible for wagering losses, missed opportunities, third-party errors, or decisions made from a prediction. Nothing here removes rights that cannot legally be waived.</p>
    </LegalDocument>
  );
}
