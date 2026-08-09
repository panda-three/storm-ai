Previous session: unknown
JSONL: ~/.claude/projects/<project-dir>/<SESSION_ID>.jsonl
To review: use /agent-log skill with the JSONL path above

## Context
We added Gemini Omni Flash video support to the Manju chain. The model metadata, hidden seed config, Manju payload branch, and video reference-image limits were implemented and verified. After deployment testing on Vercel, the user reported `FUNCTION_PAYLOAD_TOO_LARGE`.

## Current state
Done:
- `Gemini Omni Flash` exists in `lib/model-options.ts`, `lib/model-catalog.ts`, and `supabase-schema.sql` as a hidden video model.
- `lib/manju.ts` now sends the new model with `prompt + duration + aspect_ratio + resolution + input_reference[]`.
- Frontend and route validation enforce the model's 0-5 reference-image window.
- `test/manju-video.test.mjs` covers payload shape and metadata.
- `pnpm test`, `pnpm lint`, and `pnpm build` passed before the Vercel issue came up.
- `docs/vercel-error-troubleshooting.md` now documents the payload-too-large root cause pattern for video reference images.

Not done:
- The Vercel issue is not fixed yet. The current video submit path in `components/chat-area.tsx` still posts local reference image files directly to `/api/generate/video` as multipart/form-data.

## Key files
- `components/chat-area.tsx` - video workspace currently submits file uploads directly to the generate route; this is the main fix target.
- `app/api/generate/video/route.ts` - current server route accepts multipart uploads and needs a smaller request shape.
- `app/api/uploads/reference-image/route.ts` - existing upload endpoint that can be reused to pre-upload references.
- `lib/server-supabase.ts` - contains `uploadReferenceImage` and Storage helpers.
- `lib/reference-images.ts` - shared metadata and path helpers for reference images.
- `lib/manju.ts` - Manju video payload logic already updated and should be kept.
- `lib/model-options.ts` - new model constants and reference-image limit helper.
- `lib/model-catalog.ts` - hidden model catalog entry.
- `supabase-schema.sql` - hidden `model_configs` seed for the model.
- `scripts/audit-production-model-config.mjs` - audit allow-list includes the new model.
- `docs/vercel-error-troubleshooting.md` - contains the new deployment note about payload size.
- `test/manju-video.test.mjs` - payload and metadata coverage.

## Next steps
1. Change the video UI flow so local reference images are uploaded to `app/api/uploads/reference-image/route.ts` before generation.
2. Make `/api/generate/video` accept only reference-image URLs / stored metadata, or otherwise stop sending file binaries through that route.
3. Keep the Gemini Omni Flash min/max validation aligned with the new flow, allowing 0-5 reference images.
4. Re-run `pnpm test`, `pnpm lint`, and `pnpm build`.
5. If needed, reproduce on Vercel again and confirm the request body is now small.

## Suggested skills
- `/bugfix`
- `/functional-test` if you want a user-facing verification pass after the transport fix
