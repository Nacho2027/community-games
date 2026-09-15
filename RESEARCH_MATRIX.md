# Initial Adversarial Research Matrix

_Last updated: 2026-08-17_

This is a starting hypothesis, not proof of product-market fit. Pricing and programs change; verify directly before launch.

| Candidate | Existing alternatives | Why users may not switch | Narrow wedge to test | Main kill risk |
| --- | --- | --- | --- | --- |
| Construction document tracker | Procore, Autodesk Construction Cloud, Contractor Compliance, shared drives/spreadsheets | Large platforms are entrenched; compliance errors require trust | Small subcontractors needing expiration/missing-document alerts without adopting a full project platform | Cannot reach buyers; legal/compliance liability |
| Agency invoice recovery | QuickBooks, Xero, Stripe, Chaser, Upflow, manual email | Reminders already exist; aggressive reminders can damage relationships | Relationship-safe follow-up with evidence, reply tracking, and recovered-cash reporting | Low willingness to pay; email permissions |
| Shopify profit-leak detector | TrueProfit, BeProfit, Lifetimely, Triple Whale, spreadsheets | Established integrations and historical data; financial accuracy expectations | Action-level alerts: “pause this ad,” “refund leakage,” “shipping undercharge” | Attribution/data correctness; crowded marketplace |
| Apparel inventory predictor | Shopify inventory, Stockful, Prediko, Inventory Planner | Forecasting errors are expensive; tools already offer reorder points | Size/color and shared-variant forecasting for one apparel niche | Insufficient data; bad recommendations |
| Rental document assistant | AppFolio, Buildium, TenantCloud, email/forms | Housing workflow has compliance and privacy risk; existing systems are sticky | Document collection/checklists only; no tenant selection or eligibility decisions | Fair-housing/privacy exposure; incumbent suites |
| Vertical browser calculator | Generic AI browsers, spreadsheets, niche SaaS | Browser AI is crowded and easy to copy | One professional decision with structured source extraction and a verifiable calculation | No distribution; data source changes |
| Community-generated game | Native platform games, bots, thousands of free games | Discovery and retention are difficult; platform economics change | Daily game derived from each community’s own posts and inside jokes | No community distribution; weak retention |

## Research-backed market signals

- Small-business surveys consistently report demand for simpler, cheaper, integrated software, while also reporting barriers around cost, setup, reliability, privacy, and training.
- Shopify merchant research repeatedly surfaces inventory synchronization, forecasting, returns, acquisition costs, and true-margin visibility as problems. Existing apps prove demand but also make generic entry unattractive.
- Workflow automation is a proven market, but Zapier, Make, Relay, and platform-native tools make generic automation a weak wedge.
- Enterprise search and document reuse have strong incumbents including Glean, Notion, Guru, and Microsoft/Google products. A vertical outcome is more defensible than search.
- Reddit and Discord can make game distribution inexpensive, but neither guarantees discovery or income. Engagement programs and payout terms are time-sensitive.

## Source links

- <https://apps.shopify.com/beprofit-profit-tracker>
- <https://apps.shopify.com/trueprofit>
- <https://apps.shopify.com/lifetimely-lifetime-value-and-profit-analytics>
- <https://apps.shopify.com/stockcast-inventory-forecast>
- <https://www.procore.com/>
- <https://www.chaserhq.com/>
- <https://zapier.com/>
- <https://www.make.com/>
- <https://www.notion.com/product/enterprise-search>
- <https://support.reddithelp.com/hc/en-us/articles/27958169342996-Reddit-Developer-Funds-H1-2026-Terms>
- <https://docs.discord.com/developers/monetization/implementing-iap-for-activities>

## First-party verification update

- **Construction compliance:** Procore Pay, Buildium, AppFolio, and Contractor Compliance already cover insurance records, expiration alerts, uploads, and compliance status. A new product must avoid competing as a full system of record. The viable wedge is a lightweight intake/expiration inbox for smaller operators who still use email and spreadsheets.
- **Invoice recovery:** QuickBooks and Stripe already provide scheduled reminders; Chaser and Upflow cover deeper AR automation. A generic reminder product is rejected. Any viable version needs a narrow workflow, such as evidence-rich collections for one agency niche, or it should be dropped.
- **Shopify profit analytics:** TrueProfit and BeProfit already offer trials, profit metrics, ad spend, fees, and related reporting. Generic analytics is rejected. A profit-leak action alert remains a conditional experiment.
- **Shopify inventory:** Stockful and other apps provide forecasting, seasonality, reorder recommendations, alerts, and purchase orders. Generic forecasting is rejected. Variant/shared-stock handling for a narrow apparel niche remains conditional.
- **Rental applications:** TenantCloud supports required/optional application fields and applicant attachments. Full application automation is rejected because of incumbent coverage and housing risk. A document checklist for a non-decision-making administrative workflow remains conditional.
- **Reddit/Discord:** Devvit supports embedded games and documents Gold/Developer Funds as possible earning paths; Discord supports native subscriptions and one-time purchases. Payout terms are not reliable enough here to use as a revenue forecast.

## Provisional scorecard

Scores are hypotheses from desk research, not user validation. 0–5 per criterion; higher is better. Risk scores already use the favorable direction (low risk = high score).

| Candidate | Pain | Pay | Reach | Wedge | Build | Data | Risk | Support | Platform | Total | Decision |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Construction document intake | 5 | 4 | 2 | 3 | 4 | 4 | 3 | 3 | 4 | 32 | Prototype conditionally |
| Agency invoice recovery | 5 | 3 | 3 | 3 | 5 | 4 | 3 | 3 | 4 | 33 | Prototype conditionally |
| Shopify profit-leak alerts | 4 | 4 | 4 | 3 | 4 | 3 | 3 | 3 | 3 | 35 | Prototype conditionally |
| Apparel inventory predictor | 5 | 4 | 3 | 3 | 3 | 2 | 2 | 2 | 3 | 27 | Reject for now |
| Rental document assistant | 4 | 4 | 2 | 3 | 3 | 3 | 1 | 2 | 4 | 26 | Reject for now |
| Vertical browser calculator | 3 | 3 | 2 | 2 | 5 | 3 | 4 | 4 | 4 | 30 | Needs niche selection |
| Community-generated game | 3 | 1 | 2 | 4 | 5 | 4 | 3 | 2 | 2 | 26 | Low-cost optional experiment |

## Current selection

The first prototype should be **Shopify profit-leak alerts**, but not a dashboard. The narrow test is:

> Given Shopify orders, product costs, refunds, shipping, payment fees, and optional ad spend, identify one specific product or order pattern that is reducing profit and explain the evidence and recommended action.

Why this is the first test:

- Shopify provides a relatively accessible distribution channel.
- The outcome is measurable and financially legible.
- Existing competitors validate demand while revealing the need for differentiation.
- The initial version can work from CSV exports before requesting sensitive OAuth access.
- It can be built and tested cheaply without making financial decisions automatically.

The first implementation must support CSV import, transparent calculations, evidence links, a report, and feedback—not full integrations, autonomous ad changes, or a large dashboard.
