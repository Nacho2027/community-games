# Publishing and monetization

Five games ship from this repo. The web build is deployable today; the Reddit and
Discord packages are prepared and require platform accounts to go live.

## 1. Web - DONE, live

**<https://nacho2027.github.io/community-games/>** - five playable games, PWA manifest,
icon, and share text. Verified serving HTTP 200 for the page, JS bundle, CSS, manifest,
and icon.

Deployed automatically from `main` by `.github/workflows/deploy.yml`, which runs the full
test suite before publishing, so a red test can never reach the live site.

```bash
npm install
npm run verify        # 128 tests + production build into dist/
npm run preview       # serve the built app locally
```

Any static host works (Cloudflare Pages, Netlify, Vercel). GitHub Pages needs no extra
account because `gh` is already authenticated.

## 2. Reddit (Devvit) - primary monetization path

Requirements:

- A Reddit account with a Devvit developer app registered at developers.reddit.com
- A dedicated, non-test subreddit you moderate
- Node 22+

The CLI is installed and wired into scripts. Verified state after `npm run login`:

- `npm run whoami` -> `Logged in as u/MaintenanceLive7212` (login is done)
- `devvit.json` parses cleanly against `@devvit/shared-types/schemas/config-file.v1.json`
- `node build.mjs` produces `public/` (client) and `dist-server/index.js` (34 kB self-contained
  CommonJS server bundle, as the schema requires)

**One human step remains.** `npm run upload` stops with:

```
Please finish setting up your developer account before proceeding:
https://developers.reddit.com/create-account?cli=true
```

That page is where the developer account and its terms are accepted. After it:

```bash
cd reddit
npm run upload     # runs the full test suite, builds, then uploads
npm run playtest   # installs to your test subreddit
```

`npm run upload` deliberately runs `npm run verify` first, so a failing test can never be
uploaded to Reddit.

For release:

```bash
npm run publish                        # unlisted, installable by moderators
npx devvit-cli publish --public        # request App Directory listing
```

Confirm the login state at any time with `npm run whoami`. Verified behaviour before
login: `npm run whoami` reports "Not currently logged in", and `npm run build` succeeds.

Reddit review typically targets 1-2 business days for updates; new apps and apps that
use payments or external fetch take longer.

Monetization checklist:

1. Accept the Reddit Earn Terms and Earn Policy in the developer account.
2. Complete payment/verification details.
3. Set `payments.enabled` to `true` in `reddit/devvit.json` only after acceptance.
4. Add paid products (cosmetics, extra daily attempts, supporter badge) as SKUs.
5. Submit the update for product approval.

Game rules must never be purchasable: paid items are cosmetic or convenience only.
Scoring, hidden roles, and outcomes stay server-authoritative and identical for
paying and non-paying players.

## 3. Discord Activity

Requirements: a Discord application owned by a developer team with an 18+ owner,
verified email and 2FA, Terms and Privacy URLs, and a public HTTPS host for `dist/`.

Steps:

1. Create the app in the Discord Developer Portal and enable Activities.
2. Host `dist/` over HTTPS and register that URL as the Activity.
3. Initialize the Embedded App SDK in the client and key multiplayer rooms by
   `instanceId`, never by a client-supplied participant id.
4. Validate session authenticity with the Activity Instance API before trusting
   any launch payload.

Monetization checklist:

1. Verify the app, then enable monetization in the Developer Portal.
2. Add SKUs (monthly subscription, durable items, consumables).
3. Configure Stripe payouts; eligibility starts after the app earns its first $100.
4. Check entitlements server-side before granting any reward.

## 4. What still requires a human

- Creating and verifying Reddit, Discord, and payment accounts
- Accepting platform terms and setting payout/tax details
- Approving the public listing of each app
- Deciding pricing and responding to platform review feedback

Everything else - game rules, packaging, tests, build, and the adapter contract -
is automated in this repo and verified by `npm run verify`.

## 5. Guardrails

- One scored action per player per period, enforced by `src/engine/actions.js`
- No secrets (solutions, culprits, outcomes) in public round payloads
- `submit()` never throws and always returns integer points within `meta.maxPoints`
- Local storage failures never break gameplay
