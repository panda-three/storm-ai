# GrsAi Integration Pitfalls

- When submitting nano-banana image tasks to GrsAi, internal `quality` must be sent as upstream `imageSize`. Violation: GrsAi can return a 200 response without a task ID, causing local job submission to fail before polling starts.
- When using the existing Storm AI generation job flow, keep GrsAi `replyType` as `async`. Violation: switching to `json` bypasses the local upstream task ID, polling, billing recovery, and history sync assumptions.
- When reading GrsAi responses, parse from raw text and preserve a safe HTTP/body summary. Violation: `response.json().catch(() => ({}))` hides non-JSON or empty upstream responses, leaving production logs with no status, keys, or body clue.
