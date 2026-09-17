-- Follow-up to the already merged social schema. Preserve applied migration history.
create or replace function public.social_read(p_view text,p_params jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_user uuid:=auth.uid(); v_target uuid; v_result jsonb; v_sport text; v_scope text;
begin
  if p_view='me' then return jsonb_build_object('authenticated',v_user is not null,'profile',public.social_profile_dto(v_user)); end if;
  if p_view in ('friends','feed') and v_user is null then raise exception 'Sign in to use account features.' using errcode='28000'; end if;
  if p_view='profile' then
    select user_id into v_target from public.social_profiles where username=lower(p_params->>'username');
    return public.social_profile_dto(v_target);
  elsif p_view='picks' then
    if p_params->>'username' is null and v_user is null then raise exception 'Sign in to view your picks.' using errcode='28000'; end if;
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


-- Existing accounts and new sign-ups get a private-data-free default identity.
-- Users can choose their own username from My Profile at any time.
create function public.social_create_profile() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_username text;
begin
  loop
    v_username := 'player_' || substr(replace(gen_random_uuid()::text,'-',''),1,12);
    begin
      insert into public.social_profiles(user_id,username,display_name,created_at)
      values(new.id,v_username,v_username,new.created_at) on conflict(user_id) do nothing;
      exit;
    exception when unique_violation then null;
    end;
  end loop;
  perform public.social_refresh_stats(new.id);
  return new;
end $$;
revoke all on function public.social_create_profile() from public,anon,authenticated;
create trigger on_sportiq_profile_created after insert on public.profiles
for each row execute function public.social_create_profile();

do $$ declare p record; v_username text;
begin
  for p in select id,created_at from public.profiles loop
    loop
      v_username := 'player_' || substr(replace(gen_random_uuid()::text,'-',''),1,12);
      begin
        insert into public.social_profiles(user_id,username,display_name,created_at)
        values(p.id,v_username,v_username,p.created_at) on conflict(user_id) do nothing;
        exit;
      exception when unique_violation then null;
      end;
    end loop;
    perform public.social_refresh_stats(p.id);
  end loop;
end $$;
