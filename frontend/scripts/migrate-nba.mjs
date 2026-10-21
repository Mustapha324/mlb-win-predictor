// Only production releases apply these additive compatibility migrations.
import fs from "node:fs/promises";
import { rootCertificates } from "node:tls";
if (process.env.VERCEL_ENV === "production") {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
  if (!connectionString) throw new Error("Production NBA release needs the configured PostgreSQL connection.");
  const { Client } = await import("pg");
  // URL SSL options otherwise override pg's explicit trust configuration.
  const databaseUrl = new URL(connectionString);
  for (const key of ["sslmode", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat"]) databaseUrl.searchParams.delete(key);
  const supabaseRoot = await fs.readFile(new URL("./supabase-root.crt", import.meta.url), "utf8");
  const client = new Client({ connectionString: databaseUrl.toString(), connectionTimeoutMillis: 15000, ssl: { ca: [...rootCertificates, supabaseRoot], rejectUnauthorized: true } });
  try {
    await client.connect();
    await client.query("begin");
    await client.query("set local lock_timeout = '10s'");
    await client.query("select pg_advisory_xact_lock(20261021)");
    for (const name of ["202608240001_player_pick_market_odds.sql", "202610200001_nba_player_picks.sql", "202610210001_nba_game_results.sql"]) {
      await client.query(await fs.readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8"));
    }
    // Recover the complete set of original pregame preview calls, including losses.
    // Duplicate keys never overwrite any existing production call or result.
    const launch = JSON.parse(await fs.readFile(new URL("./nba-launch-snapshot.json", import.meta.url), "utf8"));
    if (launch.date !== "2026-10-20" || launch.picks.length !== 40) throw new Error("Invalid launch snapshot");
    for (const pick of launch.picks) {
      const row = { pick_key: pick.id, sport: "nba", slate_date: launch.date, game_id: pick.gameId, rank: pick.rank, player_id: pick.playerId, player_name: pick.playerName, headshot_url: pick.headshotUrl, position: pick.position, team: pick.team, opponent: pick.opponent, game_time: pick.gameTime, market: pick.market, selection: pick.selection, line: pick.line, projection: pick.projection, confidence: pick.confidence, supporting_stats: pick.supportingStats, explanation: pick.explanation, model_version: pick.modelVersion, model_edge: pick.modelEdge, line_source: pick.lineSource, american_odds: pick.americanOdds, sportsbook: pick.sportsbook, over_odds: pick.overOdds, under_odds: pick.underOdds, market_books: pick.marketBooks, market_updated_at: pick.marketUpdatedAt, expected_value: pick.expectedValue, sample_size: pick.sampleSize, status: pick.status, status_label: pick.statusLabel, actual_value: pick.actualValue, result: pick.result, result_updated_at: pick.resultUpdatedAt };
      const columns = Object.keys(row).join(",");
      await client.query(`insert into public.player_pick_snapshots (${columns}) select ${columns} from jsonb_populate_record(null::public.player_pick_snapshots,$1::jsonb) on conflict (sport,slate_date,pick_key) do nothing`, [JSON.stringify(row)]);
    }
    await client.query("commit");
    console.log("NBA result storage migrations applied.");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    // Never echo connection strings, credentials or provider diagnostic objects.
    throw new Error(`NBA storage migration failed (${error.code ?? "connection error"}). Release stopped.`);
  } finally { await client.end(); }
} else console.log("NBA production migrations skipped outside production.");
