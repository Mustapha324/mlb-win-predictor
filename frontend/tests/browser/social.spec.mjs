import { test, expect } from "@playwright/test";

// Deterministic UI contract tests, with social API responses isolated from real
// users. Database/API authorization and grading run separately in npm test.
const record = { wins: 16, losses: 4, pending: 1, pushes: 0, voids: 0, graded: 20, winPercentage: 80 };
const stats = { ...record, total: 21, currentStreak: "W4", bestStreak: 8, last10: { ...record, wins: 7, losses: 3, graded: 10 }, mlb: record, nfl: { ...record, wins: 0, losses: 0, graded: 0, winPercentage: null }, modelWinPercentage: 75, agreementPercentage: 70, agreeWinPercentage: 85.7, disagreeWinPercentage: 66.7, tails: [{ username: "bob", profileUsername: "bob", wins: 7, losses: 3, winPercentage: 70 }] };
const profile = { username: "alice", displayName: "Alice", avatar: "⚾", joinedAt: "2026-01-01T00:00:00Z", favoriteMlb: "New York Yankees", favoriteNfl: "Buffalo Bills", friendCount: 1, isOwn: true, relationship: "self", stats };
const friend = { ...profile, username: "bob", displayName: "Bob", isOwn: false, relationship: "friends" };
const pick = { id: "pick-bob", username: "bob", displayName: "Bob", avatar: "⚾", sport: "mlb", gameId: "123", homeTeam: "Home", awayTeam: "Away", selection: "Home", modelSelection: "Home", modelProbability: 0.64, modelVersion: "test", startsAt: "2030-01-01T12:00:00Z", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", locked: false, result: "PENDING", correct: null, tailedFrom: null, sourcePickId: null, tailedAt: null, isOwn: false };
const team = (name, id) => ({ name, id, abbreviation: name, primary: "#22d3ee", accent: "#ffffff", record: "1-0" });
const game = { sport: "mlb", game_id: "123", gameId: "123", date: "2030-01-01", home_team: "Home", away_team: "Away", homeTeam: team("Home", 1), awayTeam: team("Away", 2), game_time_utc: "2030-01-01T12:00:00Z", status: "Scheduled", inning: null, venue: "Test park", homeProbablePitcher: null, awayProbablePitcher: null, predicted_winner: "Home", pregame_predicted_winner: "Home", home_win_probability: 0.64, away_win_probability: 0.36, pregame_home_win_probability: 0.64, pregame_away_win_probability: 0.36, live_home_win_probability: null, live_away_win_probability: null, live_market: null, actual_winner: null, is_final: false, prediction_source: "test", confidence: "Strong", factors: ["Pregame team strength"], home_score: null, away_score: null };

async function mock(page, guest = false) {
  const writes = [];
  const errors = [];
  const current = structuredClone(profile);
  let incoming = [{ ...friend, relationship: "incoming" }];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/games/123*", (route) => route.fulfill({ json: game }));
  await page.route("**/api/account/access", (route) => route.fulfill({ json: { authenticated: !guest } }));
  await page.route("**/api/social*", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON(); writes.push(body);
      if (guest) return route.fulfill({ status: 401, json: { available: false, error: "Sign in to make picks." } });
      if (body.action === "profile") Object.assign(current, body);
      if (body.action === "friend") incoming = [];
      return route.fulfill({ json: { available: true, data: current } });
    }
    const data = {
      me: { authenticated: !guest, profile: guest ? null : current }, profile: friend,
      picks: [{ ...pick, username: "alice", isOwn: true }], friends: { friends: incoming.length ? [] : [friend], incoming, outgoing: [] },
      feed: [{ id: pick.id, type: "pick", createdAt: pick.createdAt, pick }],
      game: { ownPick: null, picks: [], friends: { total: 0, home: 0, away: 0 }, community: { total: 0, home: 0, away: 0 } },
      leaderboard: { minimumPicks: 20, sport: "overall", scope: "community", entries: [{ ...profile, rank: 1, wins: 16, losses: 4, winPercentage: 80, picks: 20 }] }
    }[url.searchParams.get("view")];
    return route.fulfill({ json: { available: true, data } });
  });
  return { writes, errors };
}

test("guest sees full model detail and receives a login prompt only when choosing a pick", async ({ page }) => {
  const state = await mock(page, true);
  await page.goto("/games/123");
  await expect(page.getByText("Pregame team strength")).toBeVisible();
  await expect(page.getByText("64%", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Pick Home", exact: true }).click();
  await expect(page.getByRole("link", { name: "Log in / Sign up to pick" })).toBeVisible();
  expect(state.writes[0]).toMatchObject({ action: "pick", sport: "mlb", gameId: "123", selection: "Home" });
  expect(state.errors).toEqual([]);
});

test("profile editing, model comparison, and mobile layout", async ({ page }) => {
  const state = await mock(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Alice", exact: true })).toBeVisible();
  await expect(page.getByText("SportIQ on your games")).toBeVisible();
  await expect(page.getByRole("link", { name: "@bob", exact: true }).first()).toHaveAttribute("href", "/profile/bob");
  await page.getByText("Edit your profile", { exact: true }).click();
  await page.getByRole("textbox", { name: /^Username/ }).fill("alice_updated");
  await page.getByLabel("Display name", { exact: true }).fill("Alice Updated");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("heading", { name: "Alice Updated", exact: true })).toBeVisible();
  await expect(page.getByLabel("Primary").locator("summary")).toContainText("alice_updated");
  expect(state.writes[0]).toMatchObject({ action: "profile", username: "alice_updated", displayName: "Alice Updated" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(state.errors).toEqual([]);
});

test("friend acceptance, independent tail action, pick editing and leaderboard sample", async ({ page }) => {
  const state = await mock(page);
  await page.goto("/friends");
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.getByText("You’re now friends.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Tail pick", exact: true }).click();
  await expect(page.getByText(/You tailed @bob/)).toBeVisible();
  expect(state.writes).toEqual(expect.arrayContaining([expect.objectContaining({ action: "friend", username: "bob", operation: "accept" }), expect.objectContaining({ action: "tail", pickId: "pick-bob" })]));
  await page.goto("/my-picks");
  await page.getByRole("button", { name: "Switch to Away" }).click();
  await expect(page.getByText("Your selection is updated.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove pick", exact: true }).click();
  await expect(page.getByText("Pick removed.", { exact: true })).toBeVisible();
  await page.goto("/leaderboard");
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByText(/Minimum 20 graded/)).toBeVisible();
  expect(state.errors).toEqual([]);
});
