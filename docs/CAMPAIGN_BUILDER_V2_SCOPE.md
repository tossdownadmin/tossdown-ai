# Campaign Builder v2 — paused campaign package

## Scope

Extend the standalone `/campaign-builder` flow from a campaign container to a complete paused package:

`campaign → ad set → creative → ad`

Each object is created server-side through the direct Meta Marketing API using `META_SYSTEM_USER_TOKEN`. The browser never receives credentials. No AI, chat, MCP, activation, publishing, or automatic retry is included.

## User flow

1. Select an accessible ad account.
2. Enter campaign name, objective, and special category.
3. Enter ad set name, daily budget, billing event, optimization goal, country targeting, and optional schedule.
4. Enter creative name, Facebook Page ID, primary text, headline, CTA, destination URL, and upload an image. An existing Meta video ID remains an optional advanced path.
5. Review the complete package and its enforced paused states.
6. Confirm once.
7. Create and verify campaign, ad set, creative, and ad in order.

## Safety and write behavior

- Existing Google/employee authorization, rate limiting, user-bound five-minute approval, and one-time approval consumption remain in force.
- Every object sends `status=PAUSED` where supported; no later activation is implemented.
- No automatic retries. If a later object fails, the response identifies already-created IDs and exposes sanitized Meta diagnostics.
- No rollback/delete is attempted automatically because deletion is a separate destructive operation.
- Request payloads, tokens, authorization headers, and secrets are never logged or returned.

## API contract

The server validates the complete input before approval. The execute helper sends:

- `POST /act_{account_id}/campaigns`: name, objective, `special_ad_categories` (`["NONE"]` when none), `status=PAUSED`, and `is_adset_budget_sharing_enabled=false`.
- `POST /{campaign_id}/adsets`: name, campaign ID, daily budget, billing event, optimization goal, targeting, and `status=PAUSED`.
- `POST /act_{account_id}/adimages`: server-side multipart upload of the selected image; retain only the returned Meta image hash for the approval execution.
- `POST /act_{account_id}/adcreatives`: name, object story spec using the supplied Page ID and uploaded image hash or video ID, copy, CTA, and link.
- `POST /act_{account_id}/ads`: name, ad set ID, creative ID, and `status=PAUSED`.

Readback verifies IDs, relationships, and paused/configured status before success.

## Required product decisions before implementation

- Default country or multi-country targeting behavior.
- Supported billing events and optimization goals per objective.
- Image upload is the v1 creative path; video ID is optional advanced input. Direct video upload is deferred.
- Page IDs and existing video IDs are entered manually in v1; media identifiers may be fetched through additional read-only endpoints later.
- Budget currency display and minimum budget validation.

## Test plan

- Unit-test validation and exact URL-encoded payloads for every object.
- Test `NONE` category and `PAUSED` enforcement.
- Mock sequential success and failure at each Meta write boundary.
- Assert sanitized diagnostics reach the UI and no token/request payload is present.
- Run tests, typecheck, lint, production build, and diff check. No live writes in local checks.
