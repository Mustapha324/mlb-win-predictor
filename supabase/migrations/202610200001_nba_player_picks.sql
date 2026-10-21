-- Extend the existing immutable player-board snapshot store to basketball.
alter table public.player_pick_snapshots
  drop constraint if exists player_pick_snapshots_sport_check;
alter table public.player_pick_snapshots
  add constraint player_pick_snapshots_sport_check check (sport in ('mlb', 'nfl', 'nba'));
