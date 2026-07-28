-- 最小迁移：为生产库的旧版建单函数增加图片限额与管理员降限保护。
-- 可重复执行。整个迁移位于同一事务中，任一步失败都会回滚。

begin;

-- 生产函数与仓库历史版本一致时才继续。原函数只重命名，不改函数体。
do $preflight$
declare
  v_current regprocedure := to_regprocedure(
    'public.create_generation_job_with_billing(uuid,integer,text,text,text,text,text,text,integer,text,text,integer,boolean,text,jsonb)'
  );
  v_legacy regprocedure := to_regprocedure(
    'public.create_generation_job_with_billing_unlimited_legacy(uuid,integer,text,text,text,text,text,text,integer,text,text,integer,boolean,text,jsonb)'
  );
  v_body_hash text;
  v_expected_legacy_hash constant text := '95adeffdafdb30d41b0b7faf90d27196';
begin
  if v_legacy is null then
    if v_current is null then
      raise exception '未找到预期签名的 create_generation_job_with_billing，迁移已中止。';
    end if;

    select md5(regexp_replace(p.prosrc, '[[:space:]]+', '', 'g'))
    into v_body_hash
    from pg_catalog.pg_proc as p
    where p.oid = v_current;

    if v_body_hash <> v_expected_legacy_hash then
      raise exception '生产建单函数指纹不匹配（实际 %），迁移已中止。', v_body_hash;
    end if;

    execute 'alter function public.create_generation_job_with_billing(
      uuid, integer, text, text, text, text, text, text, integer,
      text, text, integer, boolean, text, jsonb
    ) rename to create_generation_job_with_billing_unlimited_legacy';
  else
    select md5(regexp_replace(p.prosrc, '[[:space:]]+', '', 'g'))
    into v_body_hash
    from pg_catalog.pg_proc as p
    where p.oid = v_legacy;

    if v_body_hash <> v_expected_legacy_hash then
      raise exception '保留的旧建单函数指纹不匹配（实际 %），迁移已中止。', v_body_hash;
    end if;
  end if;
end;
$preflight$;

-- 配置行必须先存在，建单与管理员保存才能锁定同一个确定对象。
-- 已有配置通过 on conflict 保持原值不变。
insert into public.site_settings (key, value)
values (
  'generation_limits',
  jsonb_build_object(
    'enabled', true,
    'maxActiveImageTasks', 3,
    'maxDailyImageTasks', 50
  )
)
on conflict (key) do nothing;

-- 新入口持有账号锁和配置共享锁，再调用原函数完成原有扣费与建单。
create or replace function public.create_generation_job_with_billing(
  p_user_id uuid,
  p_amount integer,
  p_reason text,
  p_reference text,
  p_provider text,
  p_type text,
  p_model text,
  p_prompt text,
  p_expected_result_count integer,
  p_quality text default null,
  p_aspect_ratio text default null,
  p_duration_seconds integer default null,
  p_is_free boolean default false,
  p_client_request_id text default null,
  p_input_reference_images jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_request_id text := nullif(trim(coalesce(p_client_request_id, '')), '');
  v_limits jsonb := '{}'::jsonb;
  v_limits_enabled boolean := true;
  v_max_active_image_tasks integer := 3;
  v_max_daily_image_tasks integer := 50;
  v_active_image_tasks bigint := 0;
  v_daily_image_tasks bigint := 0;
  v_daily_reset_at timestamptz;
  v_daily_start_at timestamptz;
  v_job public.generation_jobs%rowtype;
begin
  if p_user_id is null then
    raise exception '缺少用户 ID。';
  end if;

  if v_client_request_id is not null then
    select *
    into v_job
    from public.generation_jobs
    where user_id = p_user_id
      and client_request_id = v_client_request_id
    limit 1;

    if found then
      return to_jsonb(v_job) || jsonb_build_object('already_exists', true);
    end if;
  end if;

  insert into public.user_accounts (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  perform 1
  from public.user_accounts
  where user_id = p_user_id
  for update;

  if v_client_request_id is not null then
    select *
    into v_job
    from public.generation_jobs
    where user_id = p_user_id
      and client_request_id = v_client_request_id
    limit 1;

    if found then
      return to_jsonb(v_job) || jsonb_build_object('already_exists', true);
    end if;
  end if;

  if p_type = 'image' then
    select value
    into v_limits
    from public.site_settings
    where key = 'generation_limits'
    for share;

    if not found or jsonb_typeof(v_limits) <> 'object' then
      v_limits := '{}'::jsonb;
    end if;

    if jsonb_typeof(v_limits->'enabled') = 'boolean' then
      v_limits_enabled := (v_limits->>'enabled')::boolean;
    end if;

    if jsonb_typeof(v_limits->'maxActiveImageTasks') = 'number'
      and (v_limits->>'maxActiveImageTasks') ~ '^[1-9][0-9]*$'
      and char_length(v_limits->>'maxActiveImageTasks') <= 9 then
      v_max_active_image_tasks := (v_limits->>'maxActiveImageTasks')::integer;
    end if;

    if jsonb_typeof(v_limits->'maxDailyImageTasks') = 'number'
      and (v_limits->>'maxDailyImageTasks') ~ '^[1-9][0-9]*$'
      and char_length(v_limits->>'maxDailyImageTasks') <= 9 then
      v_max_daily_image_tasks := (v_limits->>'maxDailyImageTasks')::integer;
    end if;

    if v_limits_enabled then
      select count(*)
      into v_active_image_tasks
      from public.generation_jobs
      where user_id = p_user_id
        and type = 'image'
        and status in ('submitted', 'processing');

      if v_active_image_tasks >= v_max_active_image_tasks then
        return jsonb_build_object(
          'limit_code', 'ACTIVE_IMAGE_TASK_LIMIT',
          'current', v_active_image_tasks,
          'limit', v_max_active_image_tasks
        );
      end if;

      v_daily_reset_at := (
        date_trunc('day', now() at time zone 'Asia/Shanghai') + interval '1 day'
      ) at time zone 'Asia/Shanghai';
      v_daily_start_at := v_daily_reset_at - interval '1 day';

      select count(*)
      into v_daily_image_tasks
      from public.generation_jobs
      where user_id = p_user_id
        and type = 'image'
        and created_at >= v_daily_start_at
        and created_at < v_daily_reset_at;

      if v_daily_image_tasks >= v_max_daily_image_tasks then
        return jsonb_build_object(
          'limit_code', 'DAILY_IMAGE_TASK_LIMIT',
          'current', v_daily_image_tasks,
          'limit', v_max_daily_image_tasks,
          'reset_at', v_daily_reset_at
        );
      end if;
    end if;
  end if;

  return public.create_generation_job_with_billing_unlimited_legacy(
    p_user_id,
    p_amount,
    p_reason,
    p_reference,
    p_provider,
    p_type,
    p_model,
    p_prompt,
    p_expected_result_count,
    p_quality,
    p_aspect_ratio,
    p_duration_seconds,
    p_is_free,
    p_client_request_id,
    p_input_reference_images
  );
end;
$$;

create or replace function public.save_generation_limits(
  p_enabled boolean,
  p_max_active integer,
  p_max_daily integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_affected_accounts bigint := 0;
  v_current_max bigint := 0;
  v_settings jsonb;
begin
  if not public.is_admin() then
    raise exception '无管理员权限。';
  end if;

  perform public.assert_current_active_session();

  if p_enabled is null then
    raise exception '缺少生成限制开关。';
  end if;

  if p_max_active is null or p_max_active <= 0 or p_max_daily is null or p_max_daily <= 0 then
    raise exception '生成限制额度必须是正整数。';
  end if;

  insert into public.site_settings (key, value)
  values (
    'generation_limits',
    jsonb_build_object(
      'enabled', true,
      'maxActiveImageTasks', 3,
      'maxDailyImageTasks', 50
    )
  )
  on conflict (key) do nothing;

  perform 1
  from public.site_settings
  where key = 'generation_limits'
  for update;

  if p_enabled then
    select
      coalesce(max(active_tasks), 0),
      count(*) filter (where active_tasks > p_max_active)
    into v_current_max, v_affected_accounts
    from (
      select user_id, count(*) as active_tasks
      from public.generation_jobs
      where type = 'image'
        and status in ('submitted', 'processing')
      group by user_id
    ) as account_usage;

    if v_affected_accounts > 0 then
      return jsonb_build_object(
        'ok', false,
        'code', 'ACTIVE_IMAGE_TASKS_EXCEED_NEW_LIMIT',
        'current_max', v_current_max,
        'limit', p_max_active,
        'affected_accounts', v_affected_accounts
      );
    end if;
  end if;

  v_settings := jsonb_build_object(
    'enabled', p_enabled,
    'maxActiveImageTasks', p_max_active,
    'maxDailyImageTasks', p_max_daily
  );

  update public.site_settings
  set value = v_settings,
      updated_at = now()
  where key = 'generation_limits';

  return jsonb_build_object('ok', true, 'settings', v_settings);
end;
$$;

-- 旧函数只能由 security definer 包装函数内部调用。
revoke execute on function public.create_generation_job_with_billing_unlimited_legacy(
  uuid, integer, text, text, text, text, text, text, integer,
  text, text, integer, boolean, text, jsonb
) from public, anon, authenticated, service_role;

revoke execute on function public.create_generation_job_with_billing(
  uuid, integer, text, text, text, text, text, text, integer,
  text, text, integer, boolean, text, jsonb
) from public, anon, authenticated;
grant execute on function public.create_generation_job_with_billing(
  uuid, integer, text, text, text, text, text, text, integer,
  text, text, integer, boolean, text, jsonb
) to service_role;

revoke execute on function public.save_generation_limits(boolean, integer, integer) from public, anon;
grant execute on function public.save_generation_limits(boolean, integer, integer) to authenticated;

-- 提交前验证对象、锁、调用链和权限；失败则整笔回滚。
do $verification$
declare
  v_wrapper text;
begin
  if to_regprocedure(
    'public.create_generation_job_with_billing_unlimited_legacy(uuid,integer,text,text,text,text,text,text,integer,text,text,integer,boolean,text,jsonb)'
  ) is null then
    raise exception '旧建单函数未保留，迁移已中止。';
  end if;

  if to_regprocedure('public.save_generation_limits(boolean,integer,integer)') is null then
    raise exception 'save_generation_limits 创建失败，迁移已中止。';
  end if;

  select p.prosrc
  into v_wrapper
  from pg_catalog.pg_proc as p
  where p.oid = to_regprocedure(
    'public.create_generation_job_with_billing(uuid,integer,text,text,text,text,text,text,integer,text,text,integer,boolean,text,jsonb)'
  );

  if position('for share' in lower(v_wrapper)) = 0
    or position('ACTIVE_IMAGE_TASK_LIMIT' in v_wrapper) = 0
    or position('create_generation_job_with_billing_unlimited_legacy' in v_wrapper) = 0 then
    raise exception '新建单入口验证失败，迁移已中止。';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.create_generation_job_with_billing(uuid,integer,text,text,text,text,text,text,integer,text,text,integer,boolean,text,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'service_role 缺少建单入口权限，迁移已中止。';
  end if;

  if has_function_privilege(
    'service_role',
    'public.create_generation_job_with_billing_unlimited_legacy(uuid,integer,text,text,text,text,text,text,integer,text,text,integer,boolean,text,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'service_role 仍可绕过新入口调用旧函数，迁移已中止。';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.save_generation_limits(boolean,integer,integer)',
    'EXECUTE'
  ) then
    raise exception 'authenticated 缺少保存 RPC 权限，迁移已中止。';
  end if;
end;
$verification$;

commit;
