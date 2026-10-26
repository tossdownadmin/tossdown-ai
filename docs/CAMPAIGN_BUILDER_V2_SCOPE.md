# Campaign Builder v2 — paused campaign package

## Scope

Extend the standalone `/campaign-builder` flow from a campaign container to a complete paused package:

`campaign → ad set → creative → ad`

Each object is created server-side through the direct Meta Marketing API using `META_SYSTEM_USER_TOKEN`. The browser never receives credentials. No AI, chat, MCP, activation, publishing, or automatic retry is included.

## User flow

1. Select an accessible ad account.
2. Enter campaign name, objective, and special category.
3. Enter ad set name, daily budget in minor currency units, country, and age range. Traffic uses link-click optimization; Sales uses Purchase conversion optimization and requires a Pixel ID.
4. Enter creative name, Facebook Page ID, primary text, headline, CTA, destination URL, and upload a JPEG or PNG image.
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
- `POST /act_{account_id}/adsets`: name, campaign ID, daily budget, billing event, optimization goal, targeting, and `status=PAUSED`.
- `POST /act_{account_id}/adimages`: server-side multipart upload after approval; the approved image SHA-256 must match the submitted file.
- `POST /act_{account_id}/adcreatives`: name and object story spec using the supplied Page ID and uploaded image hash, copy, CTA, and link.
- `POST /act_{account_id}/ads`: name, ad set ID, creative ID, and `status=PAUSED`.

Readback verifies IDs, relationships, and paused/configured status before success.

## First release constraints

- Traffic and Sales are the supported objectives for full-package creation. Sales uses a supplied Pixel ID and Purchase event.
- Country and age range are explicit. Other targeting and placement controls use Meta defaults.
- Image upload is the creative path. Direct video upload is deferred.
- Facebook Page ID and optional Instagram actor ID are entered manually.
- Budget is entered as an integer in the ad account's minor currency units; account currency is read from Meta.

## Test plan

- Unit-test validation and exact URL-encoded payloads for every object.
- Test `NONE` category and `PAUSED` enforcement.
- Mock sequential success and failure at each Meta write boundary.
- Assert sanitized diagnostics reach the UI and no token/request payload is present.
- Run tests, typecheck, lint, production build, and diff check. No live writes in local checks.
