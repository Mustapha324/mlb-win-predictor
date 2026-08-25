alter table public.player_pick_snapshots
  add column if not exists line_source text not null default 'model_estimate'
    check (line_source in ('sportsbook_consensus', 'model_estimate')),
  add column if not exists american_odds integer,
  add column if not exists sportsbook text,
  add column if not exists over_odds integer,
  add column if not exists under_odds integer,
  add column if not exists market_books integer not null default 0 check (market_books >= 0),
  add column if not exists market_updated_at timestamptz,
  add column if not exists expected_value double precision;

comment on column public.player_pick_snapshots.line_source is
  'Whether the locked line came from sportsbook consensus or the conservative model fallback.';
comment on column public.player_pick_snapshots.expected_value is
  'Model-estimated return per unit at the captured price; informational only and not guaranteed.';
