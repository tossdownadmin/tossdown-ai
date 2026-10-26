# Campaign Builder v2 — paused campaign package

## Scope

Extend the standalone `/campaign-builder` flow from a campaign container to a complete paused package:

`campaign → ad set → creative → ad`

Each object is created server-side through the direct Meta Marketing API using `META_SYSTEM_USER_TOKEN`. The browser never receives credentials. No AI, chat, MCP, activation, publishing, or automatic retry is included.

## User flow

1. Select an accessible ad account.
2. Enter campaign name, objective, and special category.
3. Enter ad set name, daily budget in the account's normal currency amount (for example, 4.00 CAD), country, and age range. Traffic uses link-click optimization; Sales uses Purchase conversion optimization and requires a Pixel ID.
4. Choose one of three creative sources: reuse a complete creative from the selected ad account; reuse an account image to create a new creative; or upload a JPEG/PNG to create a new creative. For new creatives, enter Page ID, copy, CTA, and destination URL. An existing creative retains its own copy, link, CTA, and identity.
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
- `GET /act_{account_id}/adimages` or `/adcreatives`: account-scoped picker with server-side token and selected asset verification before approval and execution.
- `POST /act_{account_id}/adimages`: only for upload mode; server-side multipart upload after approval, with the approved image SHA-256 matching the submitted file.
- `POST /act_{account_id}/adcreatives`: only for upload or account-image mode; name and object story spec use the chosen image hash, Page ID, copy, CTA, and link.
- `POST /act_{account_id}/ads`: name, ad set ID, creative ID, and `status=PAUSED`.

Readback verifies IDs, relationships, and paused/configured status before success.

## First release constraints

- Traffic and Sales are the supported objectives for full-package creation. Sales uses a supplied Pixel ID and Purchase event.
- Country and age range are explicit. Other targeting and placement controls use Meta defaults.
- Existing complete creatives can be reused without image upload or new creative creation. Account image reuse skips upload but still creates a new creative. Direct video upload is deferred.
- A Meta ad cannot be created without a creative. An existing-creative ad uses that creative's existing contents unchanged; it cannot carry new draft copy awaiting an image. Staff may edit or replace it in Ads Manager before activation. All created delivery objects are PAUSED, not unpublished Ads Manager drafts.
- The system-user token's Meta app is currently reported as development-mode by Meta when creating a new creative. Reusing an existing creative avoids that particular POST, but success still depends on Meta accepting that creative for the account and ad.
- Facebook Page ID and optional Instagram actor ID are entered manually.
- Budget is entered as a major currency amount. The server reads the selected account's currency from Meta, validates its decimal precision, and converts to integer minor units before approval. The trusted converted amount is included in the single-use approval. Meta's actual minimum budget still applies.

## Test plan

- Unit-test validation and exact URL-encoded payloads for every object.
- Test `NONE` category and `PAUSED` enforcement.
- Mock sequential success and failure at each Meta write boundary.
- Assert sanitized diagnostics reach the UI and no token/request payload is present.
- Run tests, typecheck, lint, production build, and diff check. No live writes in local checks.
