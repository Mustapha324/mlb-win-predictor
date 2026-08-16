import type { TeamIdentity } from "@/lib/api";

type TeamBadgeProps = {
  team: Pick<TeamIdentity, "name" | "abbreviation" | "primary" | "accent">;
  size?: "sm" | "md" | "lg";
};

export function TeamBadge({ team, size = "md" }: TeamBadgeProps) {
  const sizeClass = size === "lg" ? "h-16 w-16 text-base" : size === "sm" ? "h-9 w-9 text-[10px]" : "h-12 w-12 text-xs";
  return (
    <span
      aria-label={`${team.name} color badge`}
      className={`team-badge relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full font-black tracking-[-0.06em] ${sizeClass}`}
      style={{ background: `linear-gradient(145deg, ${team.primary}, ${team.primary}cc)`, color: team.accent }}
    >
      <span className="absolute inset-[3px] rounded-full border border-white/25" />
      <span className="relative">{team.abbreviation}</span>
    </span>
  );
}
