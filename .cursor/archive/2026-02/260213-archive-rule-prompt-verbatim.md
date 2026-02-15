# 260213

## 2230 archive rule prompt verbatim

### Prompt

fix archive rule to save prompt as written, do not summarize. the summary can be part of the agent response.

### Response / actions

✅ **IMPLEMENTED**: Updated archive command and template per plan. **archive.md**: Prompt bullet now requires the user's prompt as written (verbatim), no summarization; redact only API keys, tokens, passwords, or internal URLs. Added bullet to link workspace plan (`.cursor/plans/*.plan.md`) in the entry when associated with the chat. Step 6 reworded to redact secrets in the prompt, not summarize the prompt. **ARCHIVE_ENTRY_TEMPLATE.md**: Prompt placeholder and minimal variant set to "User message as written (verbatim)"; sensitive section clarified (redact vs. summarize). Added note and example for optional Plan line when a workspace plan exists. Plan file was not edited.
