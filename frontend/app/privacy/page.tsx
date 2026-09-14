import { LegalDocument } from "@/components/LegalDocument";

export const metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <LegalDocument title="Privacy Policy" summary="This policy describes the data Sport IQ currently uses. It should be reviewed and updated before launch whenever data handling or new vendors change.">
      <h2>1. Data you provide</h2>
      <p>Optional account features process your email address and authentication information through Supabase. Public profiles include your username, display name, avatar, favorite teams, and pick record. Friendship requests and personal picks are stored to operate social features. Never post credentials in public.</p>
      <h2>2. Product and device data</h2>
      <p>The service may receive basic request information needed for security and reliability, such as timestamps, browser details, network address, requested pages, and error events. Accessibility and live-refresh preferences are stored locally in your browser.</p>
      <h2>3. Why data is used</h2>
      <p>Data is used to authenticate accounts, track picks and friendships, operate live updates, protect the service, investigate errors, prevent abuse, and improve usability. It is not used to change a locked pregame pick after the result becomes known.</p>
      <h2>4. Service providers</h2>
      <p>Sport IQ may use infrastructure, authentication, database, sports-data, and odds providers. Those providers process limited data for their role and have their own privacy terms. SportIQ does not collect payment-card details.</p>
      <h2>Pick visibility</h2>
      <p>Friends can see submitted picks before game time so they can compare and tail them. Other visitors can see individual picks after they lock. Community consensus contains only aggregate counts. Email addresses and authentication information are never included in public profiles.</p>
      <h2>5. Retention and security</h2>
      <p>Account and audit data should be retained only as long as needed for the service, legal obligations, fraud prevention, and dispute handling. Reasonable access controls, encrypted connections, server-only secrets, and least-privilege database rules are used, but no system can promise perfect security.</p>
      <h2>6. Your choices</h2>
      <p>You can edit your profile, manage friends, change browser preferences in Settings, and sign out from Account. A production launch should provide a private support channel for access, correction, export, and deletion requests as required by applicable law.</p>
      <h2>7. Children</h2>
      <p>Sport IQ is not directed to children. Do not create an account if you are below the minimum age required for online services in your location.</p>
    </LegalDocument>
  );
}
