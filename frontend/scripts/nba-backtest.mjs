/** Select on 2024-25 only, then freeze before the 2025-26 holdout. */
import { ratingChange, winProbability } from "../lib/nbaPrediction.ts";

async function season(year) {
  const response = await fetch(`https://fixturedownload.com/feed/json/nba-${year}`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`NBA history ${year}: ${response.status}`);
  return (await response.json()).filter(g => Number.isFinite(g.HomeTeamScore) && Number.isFinite(g.AwayTeamScore)).sort((a, b) => a.DateUtc.localeCompare(b.DateUtc));
}

function replay(games, config, initial = new Map(), warmup = 0) {
  const ratings = new Map(initial);
  let loss = 0, brier = 0, correct = 0, n = 0;
  for (let i = 0; i < games.length; i++) {
    const g = games[i], home = ratings.get(g.HomeTeam) ?? 1500, away = ratings.get(g.AwayTeam) ?? 1500;
    const raw = winProbability(home, away), p = Math.max(0.1, Math.min(0.9, raw)), y = Number(g.HomeTeamScore > g.AwayTeamScore);
    if (i >= warmup) { n++; loss -= y * Math.log(p) + (1 - y) * Math.log(1 - p); brier += (p - y) ** 2; correct += Number((p >= 0.5) === Boolean(y)); }
    const delta = ratingChange(home, away, g.HomeTeamScore, g.AwayTeamScore, config);
    ratings.set(g.HomeTeam, home + delta); ratings.set(g.AwayTeam, away - delta);
  }
  return { ratings, metrics: { games: n, accuracy: correct / n, logLoss: loss / n, brier: brier / n } };
}

const [train, holdout] = await Promise.all([season(2024), season(2025)]);
const baseline = { k: 30, mov: false };
const candidates = [10, 15, 20, 25, 30].map(k => ({ k, mov: true }));
const selection = candidates.map(config => ({ config, ...replay(train, config, new Map(), 150).metrics })).sort((a, b) => a.logLoss - b.logLoss);
const selected = selection[0].config;
const evaluate = config => ({ config, train: replay(train, config, new Map(), 150).metrics, holdout: replay(holdout, config, replay(train, config).ratings).metrics });
console.log(JSON.stringify({ source: "Fixture Download NBA 2024 and 2025", selection, baseline: evaluate(baseline), candidate: evaluate(selected) }, null, 2));
