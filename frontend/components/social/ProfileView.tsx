"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { SOCIAL_AVATARS, type SocialMe, type SocialPick, type SocialProfile } from "@/lib/social";
import { socialRequest, useSocialResource } from "@/lib/socialClient";
import { AccountPrompt, SocialShell, SocialStatus, StatsGrid } from "@/components/social/SocialShared";
import { PickList } from "@/components/social/PickList";

function ProfileEditor({ profile, onSaved }: { profile: SocialProfile; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      await socialRequest("", { action: "profile", username: form.get("username"), displayName: form.get("displayName"), avatar: form.get("avatar"), favoriteMlb: form.get("favoriteMlb"), favoriteNfl: form.get("favoriteNfl") });
      setMessage("Profile saved."); onSaved(); window.dispatchEvent(new Event("sportiq:profile-updated"));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to save your profile."); }
    finally { setBusy(false); }
  }
  return <details className="sport-panel mt-5 p-6"><summary className="cursor-pointer font-bold text-cyan-200">Edit your profile</summary><form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={save}><label className="text-sm text-neutral-300">Username<input className="text-input mt-2" name="username" defaultValue={profile.username} pattern="[a-z0-9_]{3,24}" minLength={3} maxLength={24} required autoComplete="username" /><span className="mt-1 block text-xs text-neutral-400">3–24 lowercase letters, numbers, or underscores.</span></label><label className="text-sm text-neutral-300">Display name<input className="text-input mt-2" name="displayName" maxLength={60} defaultValue={profile.displayName} required autoComplete="nickname" /></label><label className="text-sm text-neutral-300">Avatar<select className="text-input mt-2" name="avatar" defaultValue={profile.avatar}>{SOCIAL_AVATARS.map((avatar) => <option key={avatar} value={avatar}>{avatar}</option>)}</select></label><div className="hidden sm:block" /><label className="text-sm text-neutral-300">Favorite MLB team<input className="text-input mt-2" name="favoriteMlb" maxLength={60} defaultValue={profile.favoriteMlb ?? ""} placeholder="e.g. New York Yankees" /></label><label className="text-sm text-neutral-300">Favorite NFL team<input className="text-input mt-2" name="favoriteNfl" maxLength={60} defaultValue={profile.favoriteNfl ?? ""} placeholder="e.g. Buffalo Bills" /></label><div className="sm:col-span-2"><button disabled={busy} className="primary-button">{busy ? "Saving…" : "Save profile"}</button><p role="status" className="mt-3 text-sm text-cyan-200">{message}</p></div></form></details>;
}

function ProfileContent({ profile, reload }: { profile: SocialProfile; reload: () => void }) {
  const picks = useSocialResource<SocialPick[]>(`view=picks&username=${encodeURIComponent(profile.username)}`);
  return <><section className="sport-panel mb-5 flex flex-wrap items-center gap-5 p-6 sm:p-8"><div className="grid h-20 w-20 place-items-center rounded-3xl border border-cyan-300/20 bg-cyan-300/10 text-4xl" aria-label="Profile avatar">{profile.avatar}</div><div className="min-w-0 flex-1"><h2 className="break-words text-2xl font-black">{profile.displayName}</h2><p className="mt-1 text-sm text-cyan-200">@{profile.username}</p><p className="mt-3 text-xs leading-6 text-neutral-400">Joined {new Date(profile.joinedAt).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" })} · {profile.friendCount} friends</p><p className="text-xs leading-6 text-neutral-400">{[profile.favoriteMlb, profile.favoriteNfl].filter(Boolean).join(" · ") || "No favorite teams selected"}</p></div>{profile.isOwn ? <Link href="/my-stats" className="secondary-button">My stats</Link> : <Link href={`/friends?search=${encodeURIComponent(profile.username)}`} className="secondary-button">{profile.relationship === "friends" ? "Friends" : "Connect"}</Link>}</section><StatsGrid stats={profile.stats} comparison />{profile.isOwn ? <ProfileEditor profile={profile} onSaved={reload} /> : null}<section className="mt-8"><div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-black">Recent picks</h2>{profile.isOwn ? <Link href="/my-picks" className="text-sm text-cyan-200">All my picks →</Link> : null}</div>{picks.data ? <PickList picks={picks.data} reload={() => { picks.reload(); reload(); }} allowTail={profile.relationship === "friends"} /> : <SocialStatus error={picks.error} retry={picks.reload} />}</section></>;
}

export function ProfileView({ username }: { username?: string }) {
  const query = username ? `view=profile&username=${encodeURIComponent(username)}` : "view=me";
  const resource = useSocialResource<SocialProfile | SocialMe>(query);
  const data = resource.data;
  const profile = data ? ("authenticated" in data ? data.profile : data) : null;
  return <SocialShell title={username ? `@${username}` : "My profile"} eyebrow="SportIQ profiles" description="Your predictions tell a story. Track your record, find your edge, and see how you compare with the model.">{profile ? <ProfileContent key={profile.username} profile={profile} reload={resource.reload} /> : data && "authenticated" in data && !data.authenticated ? <AccountPrompt returnTo="/profile" /> : <SocialStatus error={resource.error} retry={resource.reload} />}</SocialShell>;
}

export function MyStatsView() {
  const me = useSocialResource<SocialMe>("view=me");
  return <SocialShell title="My stats" eyebrow="You × SportIQ" description="A transparent comparison on the games you actually picked. Every model call is captured when your pick is submitted.">{me.data?.profile ? <StatsGrid stats={me.data.profile.stats} comparison /> : me.data && !me.data.authenticated ? <AccountPrompt returnTo="/my-stats" /> : <SocialStatus error={me.error} retry={me.reload} />}</SocialShell>;
}

export function MyPicksView() {
  const picks = useSocialResource<SocialPick[]>("view=picks");
  const [filter, setFilter] = useState("all");
  const visible = picks.data?.filter((pick) => filter === "all" || (filter === "pending" ? pick.result === "PENDING" : pick.sport === filter));
  return <SocialShell title="My picks" description="Make your call before game time. Change or remove a pick until it locks, then follow the final result."><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><label className="text-sm text-neutral-300">Show <select className="ml-2 rounded-xl border border-white/15 bg-neutral-950 p-3" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All picks</option><option value="pending">Pending</option><option value="mlb">MLB</option><option value="nfl">NFL</option></select></label><Link href="/" className="primary-button">Make a pick</Link></div>{visible ? <PickList picks={visible} reload={picks.reload} /> : <SocialStatus error={picks.error} retry={picks.reload} />}</SocialShell>;
}
