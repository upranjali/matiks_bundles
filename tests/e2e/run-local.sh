#!/usr/bin/env bash
# Starts PostgREST + a Supabase-shaped gateway + the app, runs the acceptance test, stops them.
# Needs: a Postgres at $PGHOST:$PGPORT with database mb_e2e (shim + migrations + seed applied),
# a PostgREST binary at $PGRST, and Playwright. See README → Testing.
set -u
S=${S:?scratch dir}; ROOT=$(cd "$(dirname "$0")/../.." && pwd)
( cd "$S/pgrst" && exec ./postgrest "$ROOT/tests/e2e/pgrst.conf" ) > "$S/pgrst/pgrst.log" 2>&1 & P1=$!
node "$ROOT/tests/e2e/gateway.cjs" > "$S/e2e/gw.log" 2>&1 & P2=$!
sleep 2
ANON=$(curl -s localhost:54321/anonkey)
( cd "$ROOT" && VITE_SUPABASE_URL=http://localhost:54321 VITE_SUPABASE_PUBLISHABLE_KEY=$ANON exec npx vite --port 5174 --strictPort ) > "$S/e2e/vite.log" 2>&1 & P3=$!
for i in $(seq 1 30); do curl -s localhost:5174 >/dev/null && break; sleep 1; done
( cd "$ROOT" && APP=http://localhost:5174 GW=http://localhost:54321 SHOTS="$S/shots" node tests/e2e/acceptance.mjs ); RC=$?
kill $P1 $P2 $P3 2>/dev/null; pkill -f "vite --port 5174" 2>/dev/null
exit $RC
