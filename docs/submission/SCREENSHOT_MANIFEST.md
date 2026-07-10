# Screenshot Manifest

This manifest records the five public-safe submission images produced from the
live HTTPS application. The machine-readable capture result is stored beside
them as `artifacts/submission/screenshots/capture-report.json`.

| Final filename | Live capture state | Submission caption |
| --- | --- | --- |
| `artifacts/submission/screenshots/01-home-capability-memory-1440.png` | `/`, canonical website-delivery task loaded | "Organizational AI Memory retrieves reusable prompts, workflows, agent patterns, decisions, and practices before optional generation." |
| `artifacts/submission/screenshots/02-demo-website-delivery-recommendation-1440.png` | `/demo?task=website_delivery_handoff`, all three stored assets visible | "The website delivery task deterministically retrieves a governed prompt, workflow, and decision pattern from Postgres." |
| `artifacts/submission/screenshots/03-assets-governance-provenance-1440.png` | `/assets?asset=prompt%3Awebsite_handoff_brief_v1`, selected inspector visible | "Each capability records the problem solved, why it worked, lifecycle and role metadata, and `asset -> observation -> source turn` provenance." |
| `artifacts/submission/screenshots/04-demo-temporal-truth-1440.png` | `/demo?task=website_delivery_handoff`, canonical continuity query submitted | "Current and superseded facts remain auditable together, with every claim linked through `fact -> observation -> source turn`." |
| `artifacts/submission/screenshots/05-method-authority-1440.png` | `/method`, six-stage authority flow and canonical reuse example visible | "Postgres is authoritative; task mappings are deterministic; Spark adaptation is bounded and optional; internal memory is not publicly routed." |

## Capture contract

1. Use the public domain in a fresh browser at `1440 x 900` and 100% zoom.
2. Capture only public-safe product surfaces. Do not include browser account
   chrome, terminals, service logs, authentication screens, or operator data.
3. Make labels and evidence text readable at submission-thumbnail size.
4. Do not show a generated state unless the live response reports
   `interaction.status = "generated"`.
5. Keep the deterministic-record and non-authoritative/fallback labels in
   frame whenever an assist result is shown.
6. Record the capture date and tested URL in the final handoff. The capture
   report is the authoritative timestamp and route record.
