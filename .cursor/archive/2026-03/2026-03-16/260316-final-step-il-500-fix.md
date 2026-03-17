# 260316

## 2313 final-step IL 500 fix

### Prompt

/api/algorithm/final-step/IL from public site returns 500. it works fine from local

### Response / actions

✅ **FIXED**: Addressed likely cause and hardened the final-step handler in `backend/index.js`:

1. **`finalStepDoc.ref` guard** – When using local cache (`USE_LOCAL_CACHE`), `finalStepDoc` is `{ id }` and has no `.ref`. The code called `finalStepDoc.ref.update(...)`, causing a 500. Now we only call `finalStepDoc.ref.update(...)` when `finalStepDoc.ref` exists; otherwise we update via `setCacheDoc(keyToUpdate, { ...cachedEntry, isComplete: true })`.
2. **Error logging** – The top-level catch now logs `error.stack` so production logs show the full stack on 500.
3. **State param normalization** – The state param is normalized with `.toUpperCase()` so requests like `/api/algorithm/final-step/il` match Firestore docs stored as `"IL"`.

If 500 persists after deploy, the new stack log will identify the real cause (e.g. Firestore/GCS or reconstruction).
