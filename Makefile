PORT ?= 8743

.PHONY: serve test test-setup

# one-time: install the test runner and headless browsers (Chromium + WebKit)
test-setup:
	npm install
	npx playwright install chromium webkit

# run the full suite headlessly against both engines (WebKit ≈ iPad Safari)
test:
	npx playwright test

serve:
	@lsof -ti tcp:$(PORT) | xargs kill 2>/dev/null || true
	@echo "Serving http://127.0.0.1:$(PORT)/   (mute for testing: http://127.0.0.1:$(PORT)/?mute=1)"
	@python3 -m http.server $(PORT) --bind 127.0.0.1
