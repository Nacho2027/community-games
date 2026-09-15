# Product Pipeline

## Scope

This project will test seven narrowly scoped products. The goal is not to assume demand; it is to produce evidence, build inexpensive prototypes, measure usage, and stop weak products quickly.

No revenue or adoption outcome is guaranteed. The guaranteed deliverables are research, implementation, testing, instrumentation, deployment artifacts, and evidence-based decisions.

## Candidate products

1. **Construction document tracker** — track W-9s, certificates of insurance, licenses, lien waivers, expiration dates, and missing subcontractor documents.
2. **Agency invoice recovery** — detect overdue invoices, draft relationship-safe reminders, track replies, and report recovered cash.
3. **Shopify profit-leak detector** — identify products losing money after COGS, ads, shipping, fees, discounts, and refunds; recommend specific actions.
4. **Apparel inventory predictor** — forecast size/color stockouts and suggest reorder quantities for Shopify apparel stores.
5. **Rental document assistant** — collect and organize application documents, draft responses, and flag missing information without making tenant-selection decisions.
6. **Vertical browser calculator** — one-page decision tool for a narrowly defined professional workflow, selected after research.
7. **Community-generated Reddit/Discord game** — short daily games generated from each community's own posts and culture.

## Adversarial decision criteria

Each candidate is scored 0–5 on:

- Pain and frequency
- Cost of the current problem
- Willingness to pay
- Reachability without paid ads
- Competitive differentiation
- AI buildability
- Data/API access
- Trust and regulatory risk (reverse scored)
- Support burden (reverse scored)
- Platform dependency (reverse scored)

A product is eligible for continued build work only when it has a documented wedge, an accessible first user, a testable core workflow, and a score of at least 28/50. A prototype does not count as validation.

## Operating rules

- Build the smallest useful workflow, not a feature-complete platform.
- Prefer approval-based actions over autonomous actions in finance, housing, and business communications.
- Every generated financial or operational result must expose its source data and assumptions.
- Record competitors, pricing, integration requirements, and failure modes before implementation.
- Instrument activation, weekly retention, successful outcomes, errors, API cost, and support events from day one.
- Stop or pivot when a product fails its evidence gate; do not add features to compensate for absent demand.

## Evidence gates

### Gate 1: Desk research

Required before coding:

- 5+ direct competitors or substitutes
- current pricing and platform requirements
- at least 3 recurring user complaints or workflow gaps
- a specific differentiated promise
- risk and compliance review

### Gate 2: Concierge test

Deliver the outcome manually or with a thin prototype to available test users. Measure completion, usefulness, corrections, and willingness to continue. Do not infer demand from likes or hypothetical survey answers.

### Gate 3: MVP

Required instrumentation:

- signup and activation
- time-to-first-value
- successful core actions
- repeat usage
- errors and support requests
- cost per active user
- conversion or explicit rejection

### Gate 4: Continue / pivot / stop

Continue only when users complete the core action repeatedly and at least one user expresses a concrete willingness to pay or platform reward path is verified. Otherwise document the failure and pivot or stop.

## Initial research sources

- Shopify App Store listings for TrueProfit, BeProfit, Lifetimely, inventory tools, and direct competitors.
- Official Shopify developer revenue-share and app-distribution documentation.
- Official Reddit Developer Funds and Devvit documentation.
- Official Discord Activities and monetization documentation.
- Official Google Workspace Marketplace and Chrome Web Store documentation.
- Industry workflow sources for construction compliance, accounts receivable, property management, and apparel inventory.

## Known constraints

External account creation, payment verification, legal/tax decisions, production credentials, and sensitive customer-data access require the owner's participation. Customer support can be automated and drafted, but high-risk or ambiguous cases require human approval.
