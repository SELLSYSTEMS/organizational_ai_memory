# Organizational AI Memory Recording Script

Status: canonical narration and interaction order, bound to verified employee
workflow run `0711-final-f` and release commit
`525ff861b3580365839f487ca0dca10d0bf791cd`.

Target length: 2 minutes 58 seconds for the official three-minute pitch. Do not merge the employee preview and
the physical Personal Memory Agent proof into one claim; they are different
execution paths.

## Recording preflight

Before recording, an operator must fill and verify:

```text
release commit:             525ff861b3580365839f487ca0dca10d0bf791cd
deployed source SHA-256:    da4a85d2c50f0605f9bc43287c768edf2a113d00b69fe7ef0c8c36c62c0ce561
public readiness time UTC:  2026-07-11T13:52:47Z, HTTP 200 ready
employee readiness time:    2026-07-11T13:52:47Z, HTTP 200 ready
employee proof run ID:      0711-final-f
browser capture report:     artifacts/submission/media/employee-workflow-capture-report.json, PASS
```

Use a dedicated synthetic employee. Never display or narrate an operator
token, employee workspace token, cookie, broker credential, private path,
database password, shell history, or model-authentication state. The one-time
workspace link must be transferred off camera and omitted from every artifact.

## 1. Establish the product (`0:00-0:12`)

Open `https://memory.sellsystems.agency/`.

Say:

> Organizational AI Memory preserves proven prompts, workflows, decisions,
> and employee experience as governed capability. It separates personal
> memory, reviewed organizational memory, and agent authority instead of
> treating a chatbot transcript as the company brain.

State that all visible public source material is synthetic and public-safe.

## 2. Retrieve reviewed organizational capability (`0:12-0:42`)

Open `/capabilities` and search:

```text
Prepare a website delivery handoff
```

Show the deterministic PostgreSQL result:

```text
prompt:website_handoff_brief_v1
workflow:portfolio_site_delivery_v1
decision:source_first_before_generation_v1
```

Open one source path and point to type, version, review state,
`why_it_worked`, and `asset -> observation -> source turn` provenance.
Submit the bounded adaptation request and show that the Spark plan cites only
the same selected asset and source-turn IDs.

Say:

> Retrieval selects stored records before generation. Optional Spark prose can
> adapt this starting point, but it cannot change the selected assets or their
> authority.

Do not spend recording time on decorative filters or repeated button clicks.

## 3. Onboard exactly one employee-agent pair (`0:42-1:07`)

Use an already authenticated `/architect/` session or a freshly captured,
credential-free sequence. Open **Onboard employee** and show only synthetic,
non-secret fields.

Show the returned outcome after the raw workspace link has been hidden:

- one active human principal
- exactly one draft Personal Memory Agent
- one authoritative human-to-agent pair
- one private profile and hash-only workspace credential
- physical provisioning still pending

Say:

> Onboarding creates one employee and one distinct Personal Memory Agent in one
> database transaction. The agent is not a digital copy and cannot impersonate
> the employee. Onboarding alone does not activate a physical runtime.

Do not show the one-time workspace link.

## 4. Confirm physical provisioning (`1:07-1:29`)

Show the generated provisioning plan, explicit confirmation, and succeeded
status. Point to the resulting independent boundaries:

- locked Linux UID
- sandboxed systemd unit
- private runtime directory
- broker credential and active personal-context grant
- no direct PostgreSQL login

Say:

> A separate root-owned provisioner applies an allowlisted plan. PostgreSQL
> activates the pair only after the physical job, runtime binding, credential,
> policy, and grants agree.

If this scene is not freshly verified, use a pending placeholder rather than an
older screenshot or a simulated success state.

## 5. Capture employee memory privately (`1:29-1:54`)

Open `/workspace/` in a separate employee browser profile. The workspace must
already be authenticated off camera.

Show:

1. the employee profile and Personal Memory Agent identity
2. a new synthetic `experience` memory
3. context, `why_it_worked`, evidence, tags, sensitivity, version, and hash
4. its initial `owner_only` state

Suggested safe record:

```text
Title: Verify the public route before handoff
Context: Website release
Experience: Check the public hostname immediately before delivery.
Why it worked: It caught reverse-proxy drift before customer handoff.
Evidence: Synthetic release checklist result
Tags: release, handoff
Sensitivity: private
```

Say:

> Employee memory is private, versioned, and separate from reviewed
> organizational capability. Saving it does not publish it and does not grant
> the agent access.

## 6. Grant access and run employee preview (`1:54-2:16`)

Use the explicit **Allow Personal Memory Agent access** action for the current
revision. Then ask:

```text
What should I verify before a website handoff?
```

Show the deterministic answer and its `memory_id`, revision, and
`content_sha256` citation.

Say:

> This screen is the employee-authorized preview. The employee web service
> executes the same bounded personal-memory selector so the employee can inspect
> what the linked agent would be allowed to retrieve. It is not proof that the
> dedicated Linux agent process ran.

## 7. Prove the physical agent path (`2:16-2:36`)

Cut to the separately captured physical-runtime evidence. It must identify the
same synthetic pair and show:

- active agent unit and locked runtime identity
- brokered request under the agent's own credential
- the same allowed current revision and SHA-256 citation
- direct project, environment, and PostgreSQL access denied

Cross-employee and wrong-agent denial are separate real-PostgreSQL integration
evidence. Do not imply that the physical screenshot contains those probes.

Say:

> This is the physical Personal Memory Agent proof. Its dedicated process calls
> the broker, and the broker resolves policy and data authority in PostgreSQL.
> The browser preview and this runtime proof agree on the citation, but they are
> not the same execution.

## 8. Prove edit reset and revocation (`2:36-2:52`)

Edit the shared memory. Show that the new revision returns to `owner_only` and
the agent no longer retrieves it. Explicitly share the edited revision, then
show the new revision/hash citation. Finally show suspension or the sanitized
revocation proof.

Say:

> Consent is revision-bound. Editing content removes agent access until the
> employee shares the new version. Suspension revokes the workspace and the
> physical agent path instead of degrading to broader access.

## 9. Close (`2:52-2:58`)

Say:

> One employee, one governed Personal Memory Agent, explicit consent, cited
> retrieval, and a separate review path turn individual learning into durable
> organizational capability without erasing authority boundaries.

## Failure narration

- **No personal-memory match:** say that no explicitly shared current version
  supported the query. Do not substitute organizational or owner-only memory.
- **Spark fallback:** show the deterministic capability selection and state that
  generated adaptation is optional and non-authoritative.
- **Broker or agent unavailable:** state that physical retrieval failed closed;
  do not substitute the employee preview as physical-runtime proof.
- **Protected session unavailable:** omit the scene and mark its media entry
  pending. Never paste a credential during recording.
