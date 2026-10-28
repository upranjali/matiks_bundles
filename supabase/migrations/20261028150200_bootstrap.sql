-- Owners confirmed by Pranjali on 28 Oct 2026. Further admins are added from the app by an admin.
insert into public.admins (email, added_by) values
  ('pranjali@matiks.com', 'owner-confirmed 2026-10-28'),
  ('meenal@matiks.com', 'owner-confirmed 2026-10-28')
on conflict (email) do nothing;

insert into public.weeks (number, label, is_current) values
  (17, 'Week 17', false), (18, 'Week 18', false), (19, 'Week 19', false), (20, 'Week 20', true)
on conflict (number) do nothing;
