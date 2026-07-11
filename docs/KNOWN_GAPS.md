# Known Gaps

Status: factual MVP limits verified on `2026-07-11`.

These limits are intentionally visible so the demonstration does not imply
capabilities that are not deployed.

| Gap | Current behavior | Judge impact or next step |
| --- | --- | --- |
| Model entitlement | The isolated ChatGPT-account login generates successfully with `gpt-5.3-codex-spark`. The alternate `gpt-5.3-spark` name returned HTTP `400` under the same isolated identity and runner flags. | Keep the verified model pin. Re-test under the production account before changing model identifiers or authentication type. |
| Semantic retrieval | `pgvector` is installed, but no live semantic retrieval lane is configured. | Exact and lexical Postgres retrieval remains available and is identified honestly in the UI. |
| Identity administration | Architect and reviewer are application-level human principals authenticated by root-provisioned secrets. They use one hardened operator Linux workload and PostgreSQL login; a secret-hash mapping establishes the active human and department inside each transaction, and FORCE RLS scopes the data plane. The MVP intentionally does not provision a Linux user or PostgreSQL login per human. Linked agents do receive dedicated UIDs and brokered grants. Enterprise SSO/SCIM is not connected. | Replace the root-managed human credential map with an external identity provider and managed group lifecycle while preserving the DB-bound context and four-plane intersection. Do not describe the current logical-human model as per-human host or database isolation. |
| Historical growth analytics | The analytics route reports current asset counts and stored duplication and gap signals. It has no time-series snapshots or growth history. | Do not claim organizational-memory growth trends. A future version needs periodic snapshots and dated comparison queries. |
| Recommendation outcomes | Five tasks have deterministic ranked mappings, but the MVP does not record whether a user accepted an asset or whether it improved the result. | Recommendation quality cannot yet be measured from outcomes. |
| Automated duplication and gap detection | Duplication and missing-capability entries are authored signals from the sanitized pack, not continuously inferred findings. | Present them as compact inventory signals, not autonomous enterprise analytics. |
| Compact seed | The public demonstration contains 9 assets, 5 task definitions, and 13 mappings. | This proves the object model and reuse loop, not catalog breadth. |
| Incomplete external lineage | Some prior-version and usage keys refer to assets outside the sanitized pack. They are retained as external references rather than fabricated records. | The inspector can show the reference, but cannot open a complete historical version catalog. |
| Ingestion breadth | A bounded text/Markdown quarantine, root-owned content seal, append-only scan/evidence rows, service-produced candidate, independent review, and draft-only promotion are live. There is no broad connector library or autonomous model-driven canonical writeback. | Add controlled enterprise connectors and extraction workers while preserving byte-bound quarantine integrity, append-only evidence, and independent review. |
| Multi-tenant administration | Public APIs are deliberately pinned to one public-safe demonstration scope. The protected console has DB-enforced department RLS and scoped proof/audit records, but there is no tenant creation, federation, or billing/administration surface. | The enforced department scope proves the isolation pattern, not a complete multi-tenant SaaS control plane. |
| Model-runtime breadth | The live generated browser path, structured citation validator, attempt budget, concurrency gate, and fallback boundary are verified. Provider behavior beyond the pinned Codex ChatGPT authentication and model is not covered. | Add provider-specific fixtures and authentication modes before treating the generation runtime as portable. |
| Runtime portability | Per-agent Linux UID and systemd enforcement is implemented and proven on this Linux target. Equivalent Kubernetes, macOS, and Windows workload-identity adapters do not exist. | Define a portable runtime-binding interface and preserve the same application-policy-data intersection on other platforms. |
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
