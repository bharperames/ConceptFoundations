PORT ?= 8743

.PHONY: serve test test-setup sync-clips register-demand

# one-time: install the test runner and headless browsers (Chromium + WebKit)
test-setup:
	npm install
	npx playwright install chromium webkit

# run the full suite headlessly against both engines (WebKit ≈ iPad Safari)
test:
	npx playwright test

# re-acquire mapped audio clips from the producer's gold catalog (assets.db),
# matched by durable asset_id + sha256. CLIP_SOURCE overrides the source path.
sync-clips:
	python3 scripts/sync_clips.py

# push our demand (in-use + wants) INTO the shared catalog (assets.db usage/
# requests tables) and read back the producer's fulfilled_by replies. Reports
# OPEN / READY / STALE; --check (in CI) fails on READY/STALE. Needs the producer
# to have provisioned the tables (docs/handoff-demand-tables.md).
register-demand:
	python3 scripts/register_demand.py

serve:
	@lsof -ti tcp:$(PORT) | xargs kill 2>/dev/null || true
	@echo "Serving http://127.0.0.1:$(PORT)/   (mute for testing: http://127.0.0.1:$(PORT)/?mute=1)"
	@python3 -m http.server $(PORT) --bind 127.0.0.1
