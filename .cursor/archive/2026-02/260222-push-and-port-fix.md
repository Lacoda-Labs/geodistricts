# 260222

## 2200 push and port 8080 fix

### Prompt

/push

[Later:] Terminal selection showing backend crash: `Error: listen EADDRINUSE: address already in use :::8080` when running `npm run dev`.

[Later:] /archive

### Response / actions

✅ **RESOLVED** (push): Ran git add, commit, and push for geodistricts (13 files: backend local-only cache, VEST download/persist, scripts, archive). Pushed to origin main. gdip had nothing to commit; pushed (already up-to-date). Left `data/dataverse_files.zip` and `data/dataverse_files/` untracked.

✅ **FIXED** (EADDRINUSE): Identified node process (PID 35193) using port 8080 via `lsof -i :8080` and killed it so `npm run dev` can bind.

Archive: this chat written to `.cursor/archive/2026-02/260222-push-and-port-fix.md`.
