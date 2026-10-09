-- Run once (additive): lets the Android notification Reply/React buttons authenticate per device.
alter table public.devices add column if not exists reply_hash text;
