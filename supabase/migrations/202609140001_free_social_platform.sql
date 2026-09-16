-- Social identity is separate from historical billing/account records.
-- No browser role has direct table DML. Security-definer RPCs enforce ownership,
-- canonical game deadlines, friendships and explicit public DTOs.
create table public.social_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name text not null check (char_length(display_name) between 1 and 60),
  avatar text not null default '⚾' check (avatar in ('⚾','🏈','🏆','📊','🦊','🐻','🦅','🐯')),
  favorite_mlb text check (char_length(favorite_mlb) <= 60),
  favorite_nfl text check (char_length(favorite_nfl) <= 60),
  created_at timestamptz not null default clock_timestamp()
);

create table public.social_games (
  sport text not null check (sport in ('mlb','nfl')),
  game_id text not null check (char_length(game_id) between 1 and 80),
  slate_date date not null,
  starts_at timestamptz not null,
  home_team text not null,
  away_team text not null check (away_team <> home_team),
  model_selection text not null,
  model_probability double precision not null check (model_probability between 0 and 1),
  model_version text not null,
  status text not null check (status in ('scheduled','closed','final','void')),
  winner text,
  checked_at timestamptz not null default clock_timestamp(),
  primary key (sport,game_id),
  check (model_selection in (home_team,away_team)),
  check (winner is null or winner in (home_team,away_team))
);

create table public.user_picks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.social_profiles(user_id) on delete cascade,
  sport text not null,
  game_id text not null,
  selection text not null,
  model_selection text not null,
  model_probability double precision not null check (model_probability between 0 and 1),
  model_version text not null,
  starts_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  result text not null default 'PENDING' check (result in ('PENDING','WIN','LOSS','PUSH','VOID')),
  model_correct boolean,
  graded_at timestamptz,
  tailed_from uuid references public.social_profiles(user_id) on delete set null,
  tailed_username text,
  source_pick_id uuid,
  tailed_at timestamptz,
  unique (user_id,sport,game_id),
  foreign key (sport,game_id) references public.social_games(sport,game_id) on delete restrict
);
-- Source IDs and username are immutable attribution snapshots: deliberately no
-- FK to a deletable pregame pick. Later source edits/deletion never change a tail.
create index user_picks_game_idx on public.user_picks(sport,game_id);
create index user_picks_profile_idx on public.user_picks(user_id,created_at desc);
create index user_picks_pending_idx on public.user_picks(sport,game_id) where result = 'PENDING';

create table public.friendships (
  requester uuid not null references public.social_profiles(user_id) on delete cascade,
  recipient uuid not null references public.social_profiles(user_id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default clock_timestamp(),
  primary key (requester,recipient),
  check (requester <> recipient)
);
create unique index friendships_pair_idx on public.friendships(least(requester,recipient),greatest(requester,recipient));
create index friendships_recipient_idx on public.friendships(recipient,status);

create table public.social_stats (
  user_id uuid primary key references public.social_profiles(user_id) on delete cascade,
  stats jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default clock_timestamp()
);

alter table public.social_profiles enable row level security;
alter table public.social_games enable row level security;
alter table public.user_picks enable row level security;
alter table public.friendships enable row level security;
alter table public.social_stats enable row level security;
create policy friendships_participants on public.friendships for select using (auth.uid() in (requester,recipient));
create policy user_picks_owner on public.user_picks for select using (auth.uid() = user_id);
revoke all on public.social_profiles,public.social_games,public.user_picks,public.friendships,public.social_stats from public,anon,authenticated;
grant all on public.social_profiles,public.social_games,public.user_picks,public.friendships,public.social_stats to service_role;

-- Retain old billing history, but remove every client entitlement mutation path.
revoke all on public.profiles,public.promo_codes from public,anon,authenticated;
revoke all on function public.redeem_pro_code(text) from public,anon,authenticated;

create function public.social_percentage(w bigint,l bigint) returns numeric
language sql immutable set search_path = public as $$ select case when w+l > 0 then round(w*100.0/(w+l),1) else null end $$;

create function public.social_record(p_user uuid,p_sport text default null,p_last integer default null) returns jsonb
language sql stable security definer set search_path = public as $$
  with selected as (
    select result from public.user_picks where user_id=p_user and (p_sport is null or sport=p_sport)
      and (p_last is null or result in ('WIN','LOSS'))
    order by starts_at desc,created_at desc,id desc limit p_last
  ), counts as (
    select count(*) filter(where result='WIN') w,count(*) filter(where result='LOSS') l,
      count(*) filter(where result='PENDING') p,count(*) filter(where result='PUSH') t,
      count(*) filter(where result='VOID') v from selected
  ) select jsonb_build_object('wins',w,'losses',l,'pending',p,'pushes',t,'voids',v,'graded',w+l,'winPercentage',public.social_percentage(w,l)) from counts
$$;

create function public.social_refresh_stats(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_current text := '—'; v_best integer := 0; v_run integer := 0; v_first text; v_streak integer := 0; v_seen_other boolean := false; r record; v_stats jsonb;
begin
  if not exists(select 1 from public.social_profiles where user_id=p_user) then return; end if;
  -- Lock profile so concurrent pick mutations serialize each user's cache update.
  perform 1 from public.social_profiles where user_id=p_user for update;
  for r in select result from public.user_picks where user_id=p_user and result in ('WIN','LOSS') order by starts_at desc,created_at desc,id desc loop
    if v_first is null then v_first:=r.result; end if;
    if r.result=v_first and not v_seen_other then v_streak:=v_streak+1; else v_seen_other:=true; end if;
    if r.result='WIN' then v_run:=v_run+1; v_best:=greatest(v_best,v_run); else v_run:=0; end if;
  end loop;
  if v_first is not null then v_current:=case when v_first='WIN' then 'W' else 'L' end || v_streak; end if;
  select public.social_record(p_user) || jsonb_build_object(
    'total',count(*),'mlb',public.social_record(p_user,'mlb'),'nfl',public.social_record(p_user,'nfl'),
    'last10',public.social_record(p_user,null,10),'currentStreak',v_current,'bestStreak',v_best,
    'agreementPercentage',public.social_percentage(count(*) filter(where selection=model_selection and result in ('WIN','LOSS')),count(*) filter(where selection<>model_selection and result in ('WIN','LOSS'))),
    'modelWinPercentage',public.social_percentage(count(*) filter(where model_correct=true),count(*) filter(where model_correct=false)),
    'agreeWinPercentage',public.social_percentage(count(*) filter(where selection=model_selection and result='WIN'),count(*) filter(where selection=model_selection and result='LOSS')),
    'disagreeWinPercentage',public.social_percentage(count(*) filter(where selection<>model_selection and result='WIN'),count(*) filter(where selection<>model_selection and result='LOSS')),
    'tails',coalesce((select jsonb_agg(t) from (
      select tailed_username as username,count(*) filter(where result='WIN') as wins,count(*) filter(where result='LOSS') as losses,
        public.social_percentage(count(*) filter(where result='WIN'),count(*) filter(where result='LOSS')) as "winPercentage"
      from public.user_picks where user_id=p_user and tailed_username is not null and result in ('WIN','LOSS') group by tailed_username order by count(*) desc
    ) t),'[]'::jsonb)) into v_stats from public.user_picks where user_id=p_user;
  insert into public.social_stats(user_id,stats) values(p_user,v_stats)
    on conflict(user_id) do update set stats=excluded.stats,updated_at=clock_timestamp();
end $$;

create function public.social_are_friends(a uuid,b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.friendships where status='accepted' and ((requester=a and recipient=b) or (requester=b and recipient=a)))
$$;

create function public.social_profile_dto(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('username',p.username,'displayName',p.display_name,'avatar',p.avatar,
    'favoriteMlb',p.favorite_mlb,'favoriteNfl',p.favorite_nfl,'joinedAt',p.created_at,'isOwn',coalesce(p.user_id=auth.uid(),false),
    'friendCount',(select count(*) from public.friendships where status='accepted' and p.user_id in (requester,recipient)),
    'relationship',case when p.user_id=auth.uid() then 'self' when public.social_are_friends(p.user_id,auth.uid()) then 'friends'
      when exists(select 1 from public.friendships where requester=p.user_id and recipient=auth.uid()) then 'incoming'
      when exists(select 1 from public.friendships where requester=auth.uid() and recipient=p.user_id) then 'outgoing' else 'none' end,
    'stats',coalesce(s.stats,public.social_record(p.user_id)))
  from public.social_profiles p left join public.social_stats s using(user_id) where p.user_id=p_user
$$;

create function public.social_pick_dto(p public.user_picks,p_viewer uuid default auth.uid()) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id',p.id,'username',u.username,'displayName',u.display_name,'avatar',u.avatar,
    'sport',p.sport,'gameId',p.game_id,'homeTeam',g.home_team,'awayTeam',g.away_team,'selection',p.selection,
    'modelSelection',p.model_selection,'modelProbability',p.model_probability,'modelVersion',p.model_version,
    'startsAt',least(p.starts_at,g.starts_at),'createdAt',p.created_at,'updatedAt',p.updated_at,
    'locked',least(p.starts_at,g.starts_at)<=clock_timestamp() or g.status<>'scheduled',
    'result',p.result,'correct',case when p.result='WIN' then true when p.result='LOSS' then false else null end,
    'tailedFrom',p.tailed_username,'sourcePickId',p.source_pick_id,'tailedAt',p.tailed_at,'isOwn',coalesce(p.user_id=p_viewer,false))
  from public.social_profiles u,public.social_games g where u.user_id=p.user_id and g.sport=p.sport and g.game_id=p.game_id
$$;

-- Only the trusted prediction pipeline may register games or outcomes. Deadlines
-- never move later, including postponements; a postponed fixture is voided.
create function public.social_register_game(p_game jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare v_game public.social_games%rowtype; v_user uuid; v_count integer;
begin
  insert into public.social_games(sport,game_id,slate_date,starts_at,home_team,away_team,model_selection,model_probability,model_version,status,winner)
  values(p_game->>'sport',p_game->>'gameId',(p_game->>'date')::date,(p_game->>'startsAt')::timestamptz,p_game->>'homeTeam',p_game->>'awayTeam',p_game->>'modelSelection',(p_game->>'modelProbability')::double precision,p_game->>'modelVersion',p_game->>'status',p_game->>'winner')
  on conflict(sport,game_id) do update set
    starts_at=least(social_games.starts_at,excluded.starts_at),
    model_selection=case when social_games.starts_at>clock_timestamp() and social_games.status='scheduled' then excluded.model_selection else social_games.model_selection end,
    model_probability=case when social_games.starts_at>clock_timestamp() and social_games.status='scheduled' then excluded.model_probability else social_games.model_probability end,
    model_version=case when social_games.starts_at>clock_timestamp() and social_games.status='scheduled' then excluded.model_version else social_games.model_version end,
    status=case when social_games.status in ('final','void') then social_games.status else excluded.status end,
    winner=case when social_games.status in ('final','void') then social_games.winner else excluded.winner end,
    checked_at=clock_timestamp()
  returning * into v_game;
  if v_game.status not in ('final','void') then return 0; end if;
  update public.user_picks set
    result=case when v_game.status='void' then 'VOID' when v_game.winner is null then 'PUSH' when selection=v_game.winner then 'WIN' else 'LOSS' end,
    model_correct=case when v_game.status='void' or v_game.winner is null then null else model_selection=v_game.winner end,
    graded_at=clock_timestamp()
  where sport=v_game.sport and game_id=v_game.game_id and result='PENDING';
  get diagnostics v_count = row_count;
  for v_user in select distinct user_id from public.user_picks where sport=v_game.sport and game_id=v_game.game_id order by user_id loop
    perform public.social_refresh_stats(v_user);
  end loop;
  return v_count;
end $$;

create function public.social_write(p_action text,p_payload jsonb default '{}'::jsonb,p_actor uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_user uuid:=case when auth.role()='service_role' then p_actor else auth.uid() end; v_other uuid; v_game public.social_games%rowtype; v_source public.user_picks%rowtype;
  v_pick public.user_picks%rowtype; v_selection text; v_sport text; v_game_id text; v_username text; v_operation text;
begin
  if p_actor is not null and coalesce(auth.role(),'')<>'service_role' then raise exception 'You cannot act for another account.' using errcode='28000'; end if;
  if v_user is null then raise exception 'Sign in to use account features.' using errcode='28000'; end if;
  if p_action='profile' then
    v_username:=lower(trim(p_payload->>'username'));
    if v_username is null or v_username !~ '^[a-z0-9_]{3,24}$' then raise exception 'Use 3–24 lowercase letters, numbers or underscores for your username.'; end if;
    insert into public.profiles(id,email) select id,email from auth.users where id=v_user on conflict(id) do nothing;
    insert into public.social_profiles(user_id,username,display_name,avatar,favorite_mlb,favorite_nfl,created_at)
    values(v_user,v_username,coalesce(nullif(trim(p_payload->>'displayName'),''),v_username),coalesce(p_payload->>'avatar','⚾'),nullif(trim(p_payload->>'favoriteMlb'),''),nullif(trim(p_payload->>'favoriteNfl'),''),(select created_at from public.profiles where id=v_user))
    on conflict(user_id) do update set username=excluded.username,display_name=excluded.display_name,avatar=excluded.avatar,favorite_mlb=excluded.favorite_mlb,favorite_nfl=excluded.favorite_nfl;
    perform public.social_refresh_stats(v_user);
    return public.social_profile_dto(v_user);
  end if;
  if not exists(select 1 from public.social_profiles where user_id=v_user) then raise exception 'Create your SportIQ profile first.'; end if;
  if p_action='friend' then
    select user_id into v_other from public.social_profiles where username=lower(p_payload->>'username');
    if v_other is null or v_other=v_user then raise exception 'Choose another SportIQ profile.'; end if;
    v_operation:=p_payload->>'operation';
    if v_operation='request' then
      insert into public.friendships(requester,recipient) values(v_user,v_other) on conflict do nothing;
    elsif v_operation='accept' then
      update public.friendships set status='accepted' where requester=v_other and recipient=v_user and status='pending';
      if not found then raise exception 'No incoming request to accept.'; end if;
    elsif v_operation='decline' then
      delete from public.friendships where requester=v_other and recipient=v_user and status='pending';
      if not found then raise exception 'No incoming request to decline.'; end if;
    elsif v_operation='remove' then
      delete from public.friendships where (requester=v_user and recipient=v_other) or (requester=v_other and recipient=v_user);
    else raise exception 'Unknown friendship action.'; end if;
    return public.social_profile_dto(v_other);
  end if;
  if p_action not in ('pick','deletePick','tail') then raise exception 'Unknown account action.'; end if;
  -- Pick mutations must come through the server after a fresh authoritative
  -- pipeline lookup. Calling this RPC directly cannot reuse a stale game row or
  -- bypass that lookup. The actor is set from auth.getUser(), never request JSON.
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Submit picks through SportIQ so game availability can be verified.' using errcode='42501'; end if;
  if p_action='tail' then
    select * into v_source from public.user_picks where id=(p_payload->>'pickId')::uuid;
    if v_source.id is null or not public.social_are_friends(v_user,v_source.user_id) then raise exception 'Only current friends can tail a pick.'; end if;
    v_sport:=v_source.sport; v_game_id:=v_source.game_id;
  else v_sport:=p_payload->>'sport'; v_game_id:=p_payload->>'gameId'; end if;
  -- This row lock serializes game refresh, grading and all selection writes.
  select * into v_game from public.social_games where sport=v_sport and game_id=v_game_id for update;
  if v_game.game_id is null then raise exception 'Game unavailable. Refresh the predictions and try again.'; end if;
  if v_game.status<>'scheduled' or clock_timestamp()>=v_game.starts_at then raise exception 'This game has started or is unavailable. Picks are locked.'; end if;
  select * into v_pick from public.user_picks where user_id=v_user and sport=v_sport and game_id=v_game_id for update;
  if v_pick.id is not null and (v_pick.result<>'PENDING' or clock_timestamp()>=v_pick.starts_at) then raise exception 'Picks are locked.'; end if;
  if p_action='deletePick' then
    delete from public.user_picks where user_id=v_user and sport=v_sport and game_id=v_game_id;
    perform public.social_refresh_stats(v_user); return jsonb_build_object('deleted',true);
  end if;
  if p_action='tail' then
    select * into v_source from public.user_picks where id=v_source.id for update;
    if v_source.id is null or v_source.result<>'PENDING' or v_source.starts_at<=clock_timestamp() then raise exception 'This source pick is no longer available to tail.'; end if;
    -- Serialize relationship changes too, so removal cannot race tail creation.
    perform 1 from public.friendships where status='accepted' and ((requester=v_user and recipient=v_source.user_id) or (requester=v_source.user_id and recipient=v_user)) for share;
    if not found then raise exception 'Only current friends can tail a pick.'; end if;
    v_selection:=v_source.selection;
  else v_selection:=p_payload->>'selection'; end if;
  if v_selection is null or v_selection not in (v_game.home_team,v_game.away_team) then raise exception 'Choose one of the teams in this game.'; end if;
  if clock_timestamp()>=v_game.starts_at then raise exception 'Picks are locked.'; end if;
  insert into public.user_picks(user_id,sport,game_id,selection,model_selection,model_probability,model_version,starts_at,tailed_from,tailed_username,source_pick_id,tailed_at)
  values(v_user,v_sport,v_game_id,v_selection,v_game.model_selection,v_game.model_probability,v_game.model_version,v_game.starts_at,
    v_source.user_id,(select username from public.social_profiles where user_id=v_source.user_id),v_source.id,case when v_source.id is not null then clock_timestamp() end)
  on conflict(user_id,sport,game_id) do update set selection=excluded.selection,updated_at=clock_timestamp(),
    tailed_from=excluded.tailed_from,tailed_username=excluded.tailed_username,source_pick_id=excluded.source_pick_id,tailed_at=excluded.tailed_at
  returning * into v_pick;
  perform public.social_refresh_stats(v_user);
  return public.social_pick_dto(v_pick,v_user);
exception when unique_violation then raise exception 'That username is already taken.';
end $$;

create function public.social_read(p_view text,p_params jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_user uuid:=auth.uid(); v_target uuid; v_result jsonb; v_sport text; v_scope text;
begin
  if p_view='me' then return jsonb_build_object('authenticated',v_user is not null,'profile',public.social_profile_dto(v_user)); end if;
  if p_view in ('friends','feed') and v_user is null then raise exception 'Sign in to use account features.' using errcode='28000'; end if;
  if p_view='profile' then
    select user_id into v_target from public.social_profiles where username=lower(p_params->>'username');
    return public.social_profile_dto(v_target);
  elsif p_view='picks' then
    if p_params->>'username' is null then v_target:=v_user; else select user_id into v_target from public.social_profiles where username=lower(p_params->>'username'); end if;
    select coalesce(jsonb_agg(public.social_pick_dto(p) order by p.starts_at desc,p.created_at desc),'[]') into v_result from
      (select p.* from public.user_picks p join public.social_games g on g.sport=p.sport and g.game_id=p.game_id where p.user_id=v_target
        and (p.user_id=v_user or public.social_are_friends(p.user_id,v_user) or least(p.starts_at,g.starts_at)<=clock_timestamp() or g.status<>'scheduled')
        order by p.starts_at desc,p.created_at desc limit 100) p;
    return v_result;
  elsif p_view='search' then
    select coalesce(jsonb_agg(public.social_profile_dto(user_id)),'[]') into v_result from (
      select user_id from public.social_profiles where char_length(p_params->>'q')>=2 and starts_with(username,lower(left(p_params->>'q',24))) order by username limit 20
    ) s; return v_result;
  elsif p_view='friends' then
    return jsonb_build_object(
      'friends',coalesce((select jsonb_agg(public.social_profile_dto(case when requester=v_user then recipient else requester end)) from public.friendships where status='accepted' and v_user in (requester,recipient)),'[]'),
      'incoming',coalesce((select jsonb_agg(public.social_profile_dto(requester)) from public.friendships where status='pending' and recipient=v_user),'[]'),
      'outgoing',coalesce((select jsonb_agg(public.social_profile_dto(recipient)) from public.friendships where status='pending' and requester=v_user),'[]'));
  elsif p_view='feed' then
    select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'type','pick','createdAt',p.updated_at,'pick',public.social_pick_dto(p)) order by p.updated_at desc),'[]') into v_result
      from (select * from public.user_picks where public.social_are_friends(user_id,v_user) order by updated_at desc limit 50) p;
    return v_result;
  elsif p_view='game' then
    return jsonb_build_object(
      'picks',coalesce((select jsonb_agg(public.social_pick_dto(p)) from public.user_picks p join public.social_games g on g.sport=p.sport and g.game_id=p.game_id
        where p.sport=p_params->>'sport' and p.game_id=p_params->>'gameId' and (p.user_id=v_user or public.social_are_friends(p.user_id,v_user) or least(p.starts_at,g.starts_at)<=clock_timestamp() or g.status<>'scheduled')),'[]'),
      'ownPick',(select public.social_pick_dto(p) from public.user_picks p where p.user_id=v_user and p.sport=p_params->>'sport' and p.game_id=p_params->>'gameId'),
      'friends',(select jsonb_build_object('total',count(*),'home',count(*) filter(where p.selection=g.home_team),'away',count(*) filter(where p.selection=g.away_team))
        from public.user_picks p join public.social_games g on g.sport=p.sport and g.game_id=p.game_id where p.sport=p_params->>'sport' and p.game_id=p_params->>'gameId' and public.social_are_friends(p.user_id,v_user)),
      'community',(select jsonb_build_object('total',count(*),'home',count(*) filter(where p.selection=g.home_team),'away',count(*) filter(where p.selection=g.away_team))
        from public.user_picks p join public.social_games g on g.sport=p.sport and g.game_id=p.game_id where p.sport=p_params->>'sport' and p.game_id=p_params->>'gameId' and (least(p.starts_at,g.starts_at)<=clock_timestamp() or g.status<>'scheduled')));
  elsif p_view='leaderboard' then
    v_sport:=coalesce(p_params->>'sport','overall'); v_scope:=coalesce(p_params->>'scope','community');
    if v_sport not in ('overall','mlb','nfl') or v_scope not in ('friends','community') then raise exception 'Invalid leaderboard category.'; end if;
    if v_scope='friends' and v_user is null then raise exception 'Sign in to view your friends leaderboard.' using errcode='28000'; end if;
    select coalesce(jsonb_agg(e),'[]') into v_result from (
      select row_number() over(order by (record->>'winPercentage')::numeric desc,(record->>'graded')::integer desc,username) as rank,
        username,display_name as "displayName",avatar,(record->>'wins')::integer as wins,(record->>'losses')::integer as losses,
        (record->>'winPercentage')::numeric as "winPercentage",(record->>'graded')::integer as picks
      from (select p.*,case when v_sport='overall' then s.stats else s.stats->v_sport end as record
        from public.social_profiles p join public.social_stats s using(user_id)
        where v_scope='community' or p.user_id=v_user or public.social_are_friends(p.user_id,v_user)) records
      where (record->>'graded')::integer>=20
      order by (record->>'winPercentage')::numeric desc,(record->>'graded')::integer desc,username limit 100
    ) e;
    return jsonb_build_object('minimumPicks',20,'sport',v_sport,'scope',v_scope,'entries',v_result);
  end if;
  raise exception 'Unknown social view.';
end $$;

revoke all on function public.social_percentage(bigint,bigint),public.social_record(uuid,text,integer),public.social_refresh_stats(uuid),public.social_are_friends(uuid,uuid),public.social_profile_dto(uuid),public.social_pick_dto(public.user_picks,uuid),public.social_register_game(jsonb),public.social_write(text,jsonb,uuid),public.social_read(text,jsonb) from public,anon,authenticated;
grant execute on function public.social_read(text,jsonb) to anon,authenticated;
grant execute on function public.social_write(text,jsonb,uuid) to authenticated,service_role;
grant execute on function public.social_register_game(jsonb) to service_role;
