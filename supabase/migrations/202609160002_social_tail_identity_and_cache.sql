-- Preserve applied migrations. Tail records follow account identity across
-- username changes; only the definer DTO may expose the private cached stats.
create or replace function public.social_refresh_stats(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_current text := '—'; v_best integer := 0; v_run integer := 0; v_first text; v_streak integer := 0; v_seen_other boolean := false; r record; v_stats jsonb;
begin
  if not exists(select 1 from public.social_profiles where user_id=p_user) then return; end if;
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
    'tails',coalesce((select jsonb_agg(t order by t.wins+t.losses desc,t.username,t."sourceUserId") from (
      select tailed_from as "sourceUserId",
        (array_agg(tailed_username order by created_at desc,id desc))[1] as username,
        count(*) filter(where result='WIN') as wins,count(*) filter(where result='LOSS') as losses,
        public.social_percentage(count(*) filter(where result='WIN'),count(*) filter(where result='LOSS')) as "winPercentage"
      from public.user_picks where user_id=p_user and tailed_username is not null and result in ('WIN','LOSS')
      group by tailed_from,case when tailed_from is null then tailed_username end
    ) t),'[]'::jsonb)) into v_stats from public.user_picks where user_id=p_user;
  insert into public.social_stats(user_id,stats) values(p_user,v_stats)
    on conflict(user_id) do update set stats=excluded.stats,updated_at=clock_timestamp();
end $$;

-- A private UUID is used only to resolve the current profile. Reused usernames
-- cannot inherit old tail results. Deleted sources retain an unlinked label.
-- Every public field is explicit; never return the cached tail object itself.
create function public.social_stats_dto(p_stats jsonb) returns jsonb
language sql stable security definer set search_path = public as $$
  select (p_stats - 'tails') || jsonb_build_object('tails',coalesce((
    select jsonb_agg(jsonb_build_object(
      'username',coalesce(p.username,t.entry->>'username','Deleted player'),
      'profileUsername',p.username,
      'wins',t.entry->'wins','losses',t.entry->'losses','winPercentage',t.entry->'winPercentage'
    ) order by t.position)
    from jsonb_array_elements(coalesce(p_stats->'tails','[]'::jsonb)) with ordinality as t(entry,position)
    left join public.social_profiles p on p.user_id=(t.entry->>'sourceUserId')::uuid
  ),'[]'::jsonb))
$$;
revoke all on function public.social_stats_dto(jsonb) from public,anon,authenticated;

create or replace function public.social_profile_dto(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('username',p.username,'displayName',p.display_name,'avatar',p.avatar,
    'favoriteMlb',p.favorite_mlb,'favoriteNfl',p.favorite_nfl,'joinedAt',p.created_at,'isOwn',coalesce(p.user_id=auth.uid(),false),
    'friendCount',(select count(*) from public.friendships where status='accepted' and p.user_id in (requester,recipient)),
    'relationship',case when p.user_id=auth.uid() then 'self' when public.social_are_friends(p.user_id,auth.uid()) then 'friends'
      when exists(select 1 from public.friendships where requester=p.user_id and recipient=auth.uid()) then 'incoming'
      when exists(select 1 from public.friendships where requester=auth.uid() and recipient=p.user_id) then 'outgoing' else 'none' end,
    'stats',public.social_stats_dto(coalesce(s.stats,public.social_record(p.user_id))))
  from public.social_profiles p left join public.social_stats s using(user_id) where p.user_id=p_user
$$;

create or replace function public.social_register_game(p_game jsonb) returns integer
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
  -- Observing the same final repeatedly must not rescan every user's history or
  -- advance their cache timestamp when there is no new grading work.
  if v_count=0 then return 0; end if;
  for v_user in select distinct user_id from public.user_picks where sport=v_game.sport and game_id=v_game.game_id order by user_id loop
    perform public.social_refresh_stats(v_user);
  end loop;
  return v_count;
end $$;

-- Convert existing caches once; subsequent reads resolve names without a scan
-- of pick history, and source renames/deletions need no follower cache writes.
do $$ declare v_user uuid;
begin
  for v_user in select user_id from public.social_profiles order by user_id loop
    perform public.social_refresh_stats(v_user);
  end loop;
end $$;
