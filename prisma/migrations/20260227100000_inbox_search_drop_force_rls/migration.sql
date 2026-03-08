-- Drop FORCE ROW LEVEL SECURITY on inbox-search tables.
-- FORCE makes RLS policies apply even to table owners and superusers, which
-- causes silent zero-row results for any Prisma query that does not go through
-- runInboxSearchTransaction (e.g., debug tools, future features).
-- ENABLE ROW LEVEL SECURITY alone provides defense-in-depth for non-owner roles
-- while keeping superuser/owner access unblocked for operational safety.

ALTER TABLE "InboxSearchDocument" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "InboxSearchChunk" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "InboxSearchCheckpoint" NO FORCE ROW LEVEL SECURITY;
