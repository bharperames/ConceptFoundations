PORT ?= 8743

.PHONY: serve test test-setup sync-clips audio-requests

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

# reconcile our demand ledger (audio-requests.json) against live gold —
# reports OPEN / READY / STALE. --check (in CI) fails on READY/STALE.
audio-requests:
	python3 scripts/export_requests.py

serve:
	@lsof -ti tcp:$(PORT) | xargs kill 2>/dev/null || true
	@echo "Serving http://127.0.0.1:$(PORT)/   (mute for testing: http://127.0.0.1:$(PORT)/?mute=1)"
	@python3 -m http.server $(PORT) --bind 127.0.0.1
