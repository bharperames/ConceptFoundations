PORT ?= 8743

.PHONY: serve
serve:
	@lsof -ti tcp:$(PORT) | xargs kill 2>/dev/null || true
	@echo "Serving http://127.0.0.1:$(PORT)/   (mute for testing: http://127.0.0.1:$(PORT)/?mute=1)"
	@python3 -m http.server $(PORT) --bind 127.0.0.1
