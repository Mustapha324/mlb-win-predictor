import { LegalDocument } from "@/components/LegalDocument";

export const metadata = { title: "Responsible Use" };

export default function ResponsibleUsePage() {
  return (
    <LegalDocument title="Responsible Use" summary="A good model is an uncertainty tool—not permission to risk more. Use Sport IQ to understand a matchup and to verify past performance, never as a promise.">
      <h2>Read probabilities correctly</h2>
      <p>A 65% probability still includes many losses. Confidence reflects model separation from a line and the available sample; it does not mean the result is certain.</p>
      <h2>Lines and payouts move</h2>
      <p>Sport IQ locks the line and best captured price used for a pick. A sportsbook may display a different line later, reject a wager, limit availability, or apply its own grading rules.</p>
      <h2>Set limits before decisions</h2>
      <p>Never use money needed for housing, food, bills, education, or debt. Do not chase losses. If sports wagering stops feeling recreational, step away and use the responsible-gaming tools available in your jurisdiction.</p>
      <h2>Keep the community safe</h2>
      <p>Do not pressure others, advertise “guaranteed” wins, sell access codes, or post private account and payment information. Report misleading claims and suspicious links instead of engaging with them.</p>
      <h2>Judge the model by tracked results</h2>
      <p>Use the Results view, sample sizes, pushes, voids, and market splits. Pregame picks remain locked so performance can be reviewed honestly after games finish.</p>
    </LegalDocument>
  );
}
