# Known Gaps

Status: factual MVP limits verified on `2026-07-10`.

These limits are intentionally visible so the demonstration does not imply
capabilities that are not deployed.

| Gap | Current behavior | Judge impact or next step |
| --- | --- | --- |
| Spark authentication | The isolated `oam-codex` account is not logged in. Capability assist returns HTTP `200` with the authoritative deterministic recommendation and an explicit `fallback` interaction. | The complete memory demo still works. An operator can authenticate that account later without authenticating or running the application as root. |
| Semantic retrieval | `pgvector` is installed, but no live semantic retrieval lane is configured. | Exact and lexical Postgres retrieval remains available and is identified honestly in the UI. |
| Governance enforcement | Assets carry visibility, review status, version, owner, consumer roles, and validation metadata. There is no authenticated user model, enforced RBAC, or role-aware approval action. | Describe this as a governance record and product direction, not as deployed access control. |
| Historical growth analytics | The analytics route reports current asset counts and stored duplication and gap signals. It has no time-series snapshots or growth history. | Do not claim organizational-memory growth trends. A future version needs periodic snapshots and dated comparison queries. |
| Recommendation outcomes | Five tasks have deterministic ranked mappings, but the MVP does not record whether a user accepted an asset or whether it improved the result. | Recommendation quality cannot yet be measured from outcomes. |
| Automated duplication and gap detection | Duplication and missing-capability entries are authored signals from the sanitized pack, not continuously inferred findings. | Present them as compact inventory signals, not autonomous enterprise analytics. |
| Compact seed | The public demonstration contains 9 assets, 5 task definitions, and 13 mappings. | This proves the object model and reuse loop, not catalog breadth. |
| Incomplete external lineage | Some prior-version and usage keys refer to assets outside the sanitized pack. They are retained as external references rather than fabricated records. | The inspector can show the reference, but cannot open a complete historical version catalog. |
| Ingestion and writeback | There is no broad connector library, autonomous extraction service, or model-driven writeback in the public MVP. Seed imports are controlled scripts. | The demo proves storage, retrieval, provenance, and reuse, not a production ingestion platform. |
| Multi-tenant administration | Public APIs are deliberately pinned to one public-safe demonstration scope. There is no tenant administration surface. | Scope isolation is real for the demo, but this is not a general multi-tenant product. |
| Generated-path test coverage | The fallback path and sidecar boundary are tested, but a real generated browser interaction cannot be verified until isolated authentication is provisioned. | After login, run the canonical assist request and record `interaction.status = "generated"` before changing any availability claim. |
| Submission operations | Source and evidence artifacts can be prepared locally, but hackathon portal actions remain manual. | An operator must create the project entry, confirm the track, upload artifacts, and submit. |

## Authority during degraded operation

The main product does not degrade into an ungrounded chatbot when Spark is
unavailable. The server still returns the same Postgres-backed task, reason,
ranked assets, governance metadata, and evidence. Only the optional prose
field is absent.

The authoritative paths remain:

```text
task key -> stored recommendation -> selected capability assets
fact -> observation -> source turn
asset -> observation -> source turn
```
