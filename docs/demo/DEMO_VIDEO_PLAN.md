# Demo Video Plan

Target: one `110` second public product walkthrough.

Status: recording plan only. No final video asset is claimed by this document.

## Canonical scenario

Use the task key `website_delivery_handoff` throughout. The stored result must
show these three assets before any optional generation:

```text
prompt:website_handoff_brief_v1
workflow:portfolio_site_delivery_v1
decision:source_first_before_generation_v1
```

Use this adaptation request:

```text
Adapt this starting point for a small agency team preparing a client handoff.
```

Use this continuity query:

```text
What is the current budget and deadline, and what changed?
```

## 110-second shot list

| Time | Screen and action | Narration point |
| --- | --- | --- |
| `00:00-00:12` | Open `https://memory.sellsystems.agency/`. Hold on the product name, promise, and task-start proof. | "Organizational AI Memory turns proven work into reusable, governed capability memory, while retaining the evidence behind it." |
| `00:12-00:22` | Point to the deterministic-record label and capability inventory, then open the public demo. | "A task starts from a stored Postgres record, not from a model guess." |
| `00:22-00:44` | On `/demo`, keep the default `Prepare a new website delivery handoff` task and retrieve the starting point. Pause on the three ranked assets. | "This task maps deterministically to a handoff prompt, a delivery workflow, and a source-first decision pattern. That selection remains authoritative." |
| `00:44-01:01` | Open `/assets`, select `Website design-to-build handoff brief`, and show review state, version, owner and consumer roles, why it worked, and `asset -> observation -> source turn`. | "Capability memory keeps operational value, lifecycle metadata, and a traceable source narrative together. These roles are governance metadata, not enforced RBAC in this MVP." |
| `01:01-01:15` | Return to `/demo`, submit the short adaptation request, and hold on the interaction status. | If generated: "Spark adapts only the selected public-safe record and is labeled non-authoritative." If fallback: "The isolated model account is not authenticated, so the product keeps the complete deterministic recommendation and states that adaptation is unavailable." |
| `01:15-01:37` | Run the continuity query. Show current and superseded budget and deadline values, then open one provenance disclosure. | "Temporal memory preserves what is current without erasing what changed, and every fact follows `fact -> observation -> source turn`." |
| `01:37-01:50` | Open `/method`. Hold on canonical store, deterministic recommendation, bounded adaptation, and the public/internal safety boundary. | "Postgres remains the authority, optional prose cannot write memory, and the browser cannot select the isolated internal corpus." |

Total planned duration: `1 minute 50 seconds`.

## Recording rules

1. Record a fresh desktop browser at `1440 x 900`, 100% zoom, with no terminal,
   cookies, account details, or operator UI visible.
2. Confirm readiness and run both canonical requests once before recording.
3. Do not simulate a generated response. Record whichever interaction status
   the endpoint actually returns.
4. Keep the cursor still while evidence and governance details are readable.
5. Use direct cuts only. Do not add fake metrics, animated architecture, or
   claims that are absent from the product.
6. Export an H.264 MP4 at 1080p with legible text and normalized speech.

Suggested final filename:

```text
artifacts/submission/video/organizational-ai-memory-demo-110s.mp4
```

## Final review

The video is ready only if a reviewer can answer all five questions from the
recording alone:

1. What is stored?
2. Which task was started?
3. Why were those assets selected?
4. Where is the evidence?
5. Which part is authoritative when generation is unavailable?
