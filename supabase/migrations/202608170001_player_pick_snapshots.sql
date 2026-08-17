create table if not exists public.player_pick_snapshots (
  id uuid primary key default gen_random_uuid(),
  pick_key text not null,
  sport text not null check (sport in ('mlb', 'nfl')),
  slate_date date not null,
  game_id text not null,
  rank integer not null check (rank between 1 and 50),
  player_id text not null,
  player_name text not null,
  headshot_url text,
  position text,
  team text not null,
  opponent text not null,
  game_time timestamptz,
  market text not null,
  selection text not null check (selection in ('Over', 'Under')),
  line double precision not null,
  projection double precision not null,
  confidence double precision not null check (confidence between 0.5 and 1),
  supporting_stats jsonb not null default '[]'::jsonb,
  explanation text,
  model_version text not null,
  model_edge double precision,
  sample_size integer not null default 0 check (sample_size >= 0),
  status text not null default 'scheduled' check (status in ('scheduled', 'live', 'final', 'postponed')),
  status_label text not null default 'Scheduled',
  actual_value double precision,
  result text not null default 'pending' check (result in ('pending', 'correct', 'incorrect', 'push', 'void')),
  result_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sport, slate_date, pick_key)
);

create index if not exists player_pick_snapshots_results_idx
  on public.player_pick_snapshots (sport, result, result_updated_at desc);
create index if not exists player_pick_snapshots_game_idx
  on public.player_pick_snapshots (sport, game_id);

alter table public.player_pick_snapshots enable row level security;

-- Picks are read through the server route after entitlement checks. Direct
-- browser access would expose premium ranks, so anon/authenticated receive no
-- table privileges and no permissive RLS policy.
revoke all on table public.player_pick_snapshots from anon, authenticated;
