alter table public.prediction_snapshots drop constraint if exists prediction_snapshots_sport_check;
alter table public.prediction_snapshots add constraint prediction_snapshots_sport_check check (sport in ('mlb','nfl','nba'));
