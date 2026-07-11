# Screenshot Manifest

The machine-readable live capture result is
`artifacts/submission/screenshots/capture-report.json`. The final run captured
eight images and passed 8/8 with no unexpected browser errors at
`2026-07-11T04:12:59.529Z`.

| Final filename | Verified live state | Suggested caption |
| --- | --- | --- |
| `01-home-capability-memory-1440.png` | Home recommendation and four temporal facts loaded | "Organizational AI Memory starts from proven capability and preserves current truth without erasing history." |
| `02-judge-demo-capability-loop-1440.png` | Three deterministic assets, four analytics metrics, and 22/22 proof visible | "One judge screen connects grounded search, governed reuse, analytics, and executed access evidence." |
| `03-judge-demo-spark-plan-1440.png` | Live `gpt-5.3-codex-spark` plan with validated asset and source-turn citations | "Spark adapts only the selected records; the deterministic capability result remains authoritative." |
| `04-assets-governance-provenance-1440.png` | Prompt inspector with open source path | "Typed capability memory retains version, review state, why it worked, and `asset -> observation -> source turn` provenance." |
| `05-method-architecture-1440.png` | Public architecture and authority method | "Four aligned planes separate application identity, policy, runtime identity, and data authority." |
| `06-judge-demo-mobile-390.png` | Responsive deterministic search and proof path | "The complete public judge workflow remains usable without horizontal overflow on mobile." |
| `07-architect-console-four-plane-1440.png` | Authenticated four-plane overview using a private token not present in the image | "The protected console maps every principal to policy, runtime bindings, and data authority." |
| `08-architect-effective-access-1440.png` | AI Architect evaluation shows 12 allowed actions and explicit canonical-write denial | "Even the architect cannot write canonical memory directly; reviewed promotion produces a draft." |

All paths are relative to `artifacts/submission/screenshots/`.

## Capture contract

1. Public screens are captured from `https://memory.sellsystems.agency` at
   `1440 x 1000`; the mobile image uses `390 x 844`.
2. The Browser plugin was unavailable, so the repository Playwright workflow
   used system Chrome and recorded that fallback.
3. The generated screenshot is accepted only when the rendered mode is exactly
   `generated`; one bounded retry is allowed after an explicit fallback.
4. Operator credentials are read from a private root-owned file, exchanged for
   an HttpOnly session, and never written to the report or image.
5. The expected public `400` scope-injection probe and initial operator `401`
   session check are recorded as explained security responses. Any other console
   or page error fails capture.
6. Do not edit screenshot content or add unsupported metrics after capture.
