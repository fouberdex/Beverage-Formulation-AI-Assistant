-- Expand the workspace role vocabulary without changing ownership or RLS rules.
-- Authorization remains enforced by the API; authenticated users still cannot
-- update the role column on their own profile.

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check check (
    role in (
      'admin',
      'rd_manager',
      'formulator',
      'lab',
      'sensory',
      'qa',
      'regulatory',
      'procurement',
      'viewer'
    )
  );

comment on column public.profiles.role is
  'Workspace role resolved to server-side capabilities by the BeverageAI API.';
