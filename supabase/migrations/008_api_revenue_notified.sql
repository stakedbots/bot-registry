-- Track which revenue rows have already been pushed to a notification channel
-- (Telegram), so the notifier only fires once per payment.

alter table bot_registry.api_revenue
  add column if not exists notified_at timestamptz;

create index if not exists api_revenue_unnotified_idx
  on bot_registry.api_revenue (notified_at)
  where notified_at is null;
