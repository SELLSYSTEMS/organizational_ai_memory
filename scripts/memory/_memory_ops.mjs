import {
  compactText,
  createPgClient,
  embedText,
  ensurePlatformEnvLoaded,
  ensureQdrantCollection,
  hashString,
  normalizeText,
  qdrantBaseUrl,
  searchQdrant,
  stableUuidFromKey,
  uniqueStrings,
  upsertQdrantPoints,
} from './_memory_runtime.mjs';

const AGENT_MEMORY_COLLECTION = process.env.QDRANT_AGENT_MEMORY_COLLECTION || 'agent_memory';
const VECTOR_NAME = process.env.QDRANT_VECTOR_NAME || 'dense_main';
const EMBEDDING_PROFILE = process.env.MEMORY_EMBEDDING_PROFILE || 'dense-main-v1';

function nowIso() {
  return new Date().toISOString();
}

function normalizeList(value) {
  return uniqueStrings(
    compactText(value)
      .split(/,|\band\b/gi)
      .map((item) => compactText(item))
      .filter((item) => item && item.length >= 2),
  );
}

function buildObservationKey(threadKey, turnId, kind, detail) {
  return `obs:${threadKey}:${turnId}:${kind}:${hashString(detail).slice(0, 16)}`;
}

function buildFactKey(threadKey, subjectKey, predicate, objectValue, sourceTurnId) {
  return `fact:${threadKey}:${hashString([subjectKey, predicate, objectValue, sourceTurnId].join('|')).slice(0, 24)}`;
}

function buildEntityKey(entityType, value) {
  return `entity:${entityType}:${hashString(compactText(value)).slice(0, 24)}`;
}

function buildPredicateText(predicate) {
  return predicate.replace(/_/g, ' ');
}

function significantTokens(text) {
  return uniqueStrings(
    normalizeText(text)
      .split(/[^a-z0-9+.#/_-]+/i)
      .filter((token) => token.length >= 3)
      .filter((token) => !new Set(['the', 'and', 'for', 'with', 'that', 'this', 'what', 'does', 'they', 'them', 'from', 'into']).has(token)),
  );
}

function chooseSubjectKey(thread, turn) {
  const role = String(turn.actor_role || '').toLowerCase();
  if (['user', 'client', 'counterparty', 'lead', 'prospect'].includes(role) && thread.scope_key) {
    return thread.scope_key;
  }
  return turn.actor_key || thread.scope_key || thread.thread_key;
}

function makeCandidate(thread, turn, kind, text, options = {}) {
  const subjectKey = options.subject_key || chooseSubjectKey(thread, turn);
  return {
    observation_key: buildObservationKey(thread.thread_key, turn.source_turn_id, kind, `${text}|${options.predicate || ''}|${options.object_value || ''}`),
    observation_kind: kind,
    subject_key: subjectKey,
    actor_key: turn.actor_key || null,
    observed_at: turn.sent_at || nowIso(),
    salience: options.salience ?? 0.75,
    confidence: options.confidence ?? 0.75,
    observation_text: compactText(text),
    source_turn_ids: [turn.source_turn_id],
    source_refs: [{ source_turn_id: turn.source_turn_id, actor_role: turn.actor_role }],
    review_status: options.review_status || 'auto_curated',
    metadata: {
      extraction_method: 'deterministic_patterns_v1',
      pattern_id: options.pattern_id || kind,
      actor_role: turn.actor_role,
      turn_kind: turn.turn_kind,
      fact_predicate: options.predicate || null,
    },
    fact: options.predicate
      ? {
          subject_key: subjectKey,
          predicate: options.predicate,
          object_value: compactText(options.object_value),
          object_payload: options.object_payload || {},
          confidence: options.fact_confidence ?? options.confidence ?? 0.75,
          valid_from: turn.sent_at || nowIso(),
          source_turn_ids: [turn.source_turn_id],
        }
      : null,
  };
}

function extractObservationCandidates(thread, turn) {
  const text = compactText(turn.text_raw);
  if (!text) return [];

  const lower = text.toLowerCase();
  const candidates = [];

  const locationMatch = text.match(/\b(?:based in|located in)\s+([A-Z][A-Za-z0-9 .,\-]+)/i);
  if (locationMatch) {
    const location = compactText(locationMatch[1])
      .replace(/\band prefer\b.*$/i, '')
      .replace(/[.!?]+$/, '');
    candidates.push(
      makeCandidate(thread, turn, 'location_fact', `Reported location: ${location}.`, {
        pattern_id: 'location_fact',
        predicate: 'location',
        object_value: location,
        salience: 0.88,
        confidence: 0.90,
      }),
    );
  }

  if (/\bprefer short written updates\b/i.test(text)) {
    candidates.push(
      makeCandidate(thread, turn, 'communication_preference', 'Prefers short written updates.', {
        pattern_id: 'communication_preference_short_updates',
        predicate: 'preferred_update_style',
        object_value: 'short written updates',
        salience: 0.88,
        confidence: 0.89,
      }),
    );
  }

  const languageMatch =
    text.match(/\b(?:updates?|communicate|communication)\s+in\s+([A-Za-z][A-Za-z ]{1,40})/i) ||
    text.match(/\blanguage\s+(?:is|should be)\s+([A-Za-z][A-Za-z ]{1,40})/i);
  if (languageMatch) {
    const language = compactText(languageMatch[1]).replace(/[.!?]+$/, '');
    candidates.push(
      makeCandidate(thread, turn, 'language_fact', `Preferred language: ${language}.`, {
        pattern_id: 'preferred_language',
        predicate: 'preferred_language',
        object_value: language,
        salience: 0.86,
        confidence: 0.88,
      }),
    );
  }

  const budgetMatch = text.match(/\b(?:budget(?: is)?|up to|around)\s*\$?([0-9][0-9,]*(?:\.[0-9]+)?)\s*(USD|HKD|EUR|GBP)?(?:\s*(per month|\/month|monthly))?/i);
  if (budgetMatch) {
    const amount = compactText(budgetMatch[1]);
    const currency = compactText(budgetMatch[2] || 'USD');
    const cadence = budgetMatch[3] ? 'per month' : '';
    const budgetValue = compactText(`${amount} ${currency} ${cadence}`);
    candidates.push(
      makeCandidate(thread, turn, 'budget_fact', `Budget stated: ${budgetValue}.`, {
        pattern_id: 'budget_fact',
        predicate: 'budget',
        object_value: budgetValue,
        salience: 0.94,
        confidence: 0.92,
        object_payload: {
          amount,
          currency,
          cadence: cadence || null,
        },
      }),
    );
  }

  const toolsMatch = text.match(/\b(?:use|using|uses|runs on|stack includes)\s+([A-Za-z0-9+.#/\-, ]{3,})/i);
  if (toolsMatch) {
    const tools = normalizeList(
      toolsMatch[1]
        .replace(/\b(?:today|currently|right now)\b.*$/i, '')
        .replace(/[.!?]+$/, ''),
    );
    if (tools.length) {
      candidates.push(
        makeCandidate(thread, turn, 'tools_fact', `Current tools: ${tools.join(', ')}.`, {
          pattern_id: 'tools_in_use',
          predicate: 'tools_in_use',
          object_value: tools.join(', '),
          salience: 0.83,
          confidence: 0.84,
          object_payload: { tools },
        }),
      );
    }
  }

  if (lower.includes('everything should be remote') || lower.includes('no shipping') || lower.includes('no on-site')) {
    candidates.push(
      makeCandidate(thread, turn, 'delivery_preference', 'Delivery preference: remote only, no shipping or on-site hardware.', {
        pattern_id: 'remote_only',
        predicate: 'delivery_model',
        object_value: 'remote_only',
        salience: 0.91,
        confidence: 0.90,
      }),
    );
  }

  const timezoneMatch = text.match(/\btimezone\s+(?:is|:)?\s*([A-Za-z0-9_\/+\-]{2,40})\b/i);
  if (timezoneMatch) {
    const timezone = compactText(timezoneMatch[1]);
    candidates.push(
      makeCandidate(thread, turn, 'timezone_fact', `Timezone: ${timezone}.`, {
        pattern_id: 'timezone_fact',
        predicate: 'timezone',
        object_value: timezone,
        salience: 0.81,
        confidence: 0.84,
      }),
    );
  }

  const deadlineMatch = text.match(/\b(?:before|by)\s+([A-Za-z]+ \d{1,2},? \d{4}|20\d\d-\d\d-\d\d)\b/i);
  if (deadlineMatch) {
    const deadline = compactText(deadlineMatch[1]).replace(/[.!?]+$/, '');
    candidates.push(
      makeCandidate(thread, turn, 'deadline_fact', `Requested deadline: ${deadline}.`, {
        pattern_id: 'deadline_fact',
        predicate: 'desired_deadline',
        object_value: deadline,
        salience: 0.86,
        confidence: 0.85,
      }),
    );
  }

  const requirementMatch = text.match(/\bneed\s+([^.!?]+)/i);
  if (requirementMatch) {
    const requirement = compactText(requirementMatch[1]).replace(/[.!?]+$/, '');
    candidates.push(
      makeCandidate(thread, turn, 'requirement', `Requirement mentioned: ${requirement}.`, {
        pattern_id: 'requirement',
        salience: 0.80,
        confidence: 0.80,
      }),
    );
  }

  const avoidanceMatch = text.match(/\b(?:do not want|don't want|avoid|no need for)\s+([^.!?]+)/i);
  if (avoidanceMatch) {
    const avoidance = compactText(avoidanceMatch[1]).replace(/[.!?]+$/, '');
    candidates.push(
      makeCandidate(thread, turn, 'avoidance', `Avoidance preference: ${avoidance}.`, {
        pattern_id: 'avoidance',
        salience: 0.82,
        confidence: 0.81,
      }),
    );
  }

  const commitmentMatch = text.match(/\b(?:we|i)\s+(?:will|can)\s+([^.!?]+)/i);
  if (commitmentMatch && ['assistant', 'founder', 'operator', 'sales_rep'].includes(String(turn.actor_role || '').toLowerCase())) {
    const commitment = compactText(commitmentMatch[1]).replace(/[.!?]+$/, '');
    candidates.push(
      makeCandidate(thread, turn, 'commitment', `Commitment recorded: ${commitment}.`, {
        pattern_id: 'commitment',
        salience: 0.72,
        confidence: 0.79,
      }),
    );
  }

  return candidates;
}

async function insertWriteEvent(client, threadId, jobId, eventType, recordType, recordId, payload) {
  await client.query(
    `
      INSERT INTO memory.write_events (
        thread_id,
        job_id,
        event_type,
        record_type,
        record_id,
        payload
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    `,
    [threadId, jobId || null, eventType, recordType, recordId || null, JSON.stringify(payload || {})],
  );
}

function inferObjectEntityType(predicate) {
  if (predicate === 'tools_in_use') return 'tool_set';
  if (predicate === 'location') return 'location';
  if (predicate === 'preferred_language') return 'language';
  if (predicate === 'timezone') return 'timezone';
  if (predicate === 'delivery_model') return 'delivery_model';
  if (predicate === 'desired_deadline') return 'deadline';
  if (predicate === 'budget') return 'budget';
  if (predicate === 'preferred_update_style') return 'communication_preference';
  return 'fact_object';
}

async function upsertEntity(client, brandKey, entityKey, entityType, displayLabel, metadata = {}) {
  const res = await client.query(
    `
      INSERT INTO memory.entities (
        entity_key,
        brand_key,
        entity_type,
        display_label,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5::jsonb)
      ON CONFLICT (entity_key)
      DO UPDATE SET
        brand_key = EXCLUDED.brand_key,
        entity_type = EXCLUDED.entity_type,
        display_label = EXCLUDED.display_label,
        metadata = EXCLUDED.metadata,
        updated_at = now()
      RETURNING id, entity_key
    `,
    [entityKey, brandKey, entityType, displayLabel, JSON.stringify(metadata)],
  );

  return res.rows[0];
}

async function upsertEntityRelation(client, thread, subjectEntityId, predicate, objectEntityId, objectValue, factId, confidence) {
  const relationKey = `relation:${thread.thread_key}:${hashString([subjectEntityId, predicate, objectEntityId || objectValue || ''].join('|')).slice(0, 24)}`;
  const res = await client.query(
    `
      INSERT INTO memory.entity_relations (
        relation_key,
        thread_id,
        subject_entity_id,
        predicate,
        object_entity_id,
        object_value,
        fact_id,
        confidence,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
      ON CONFLICT (relation_key)
      DO UPDATE SET
        fact_id = EXCLUDED.fact_id,
        confidence = GREATEST(memory.entity_relations.confidence, EXCLUDED.confidence),
        metadata = EXCLUDED.metadata,
        updated_at = now()
      RETURNING id, relation_key
    `,
    [
      relationKey,
      thread.id,
      subjectEntityId,
      predicate,
      objectEntityId || null,
      objectValue || null,
      factId || null,
      confidence || 0.5,
      JSON.stringify({
        relation_method: 'fact_projection_v1',
      }),
    ],
  );

  return res.rows[0];
}

async function loadThreadContext(client, threadKey) {
  const threadRes = await client.query(
    `
      SELECT *
      FROM memory.threads
      WHERE thread_key = $1
    `,
    [threadKey],
  );

  if (!threadRes.rows[0]) {
    throw new Error(`Thread not found: ${threadKey}`);
  }

  const thread = threadRes.rows[0];
  const turnsRes = await client.query(
    `
      SELECT *
      FROM memory.thread_turns
      WHERE thread_id = $1
      ORDER BY COALESCE(sent_at, created_at), created_at, source_turn_id
    `,
    [thread.id],
  );

  return {
    thread,
    turns: turnsRes.rows,
  };
}

async function upsertObservation(client, thread, turn, candidate, jobId) {
  const res = await client.query(
    `
      INSERT INTO memory.observations (
        observation_key,
        thread_id,
        turn_id,
        observation_kind,
        subject_key,
        actor_key,
        observed_at,
        salience,
        confidence,
        observation_text,
        source_turn_ids,
        source_refs,
        review_status,
        metadata
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10,
        $11::jsonb, $12::jsonb, $13, $14::jsonb
      )
      ON CONFLICT (observation_key)
      DO UPDATE SET
        observation_text = EXCLUDED.observation_text,
        salience = GREATEST(memory.observations.salience, EXCLUDED.salience),
        confidence = GREATEST(memory.observations.confidence, EXCLUDED.confidence),
        review_status = EXCLUDED.review_status,
        metadata = EXCLUDED.metadata,
        updated_at = now()
      RETURNING id, observation_key
    `,
    [
      candidate.observation_key,
      thread.id,
      turn.id,
      candidate.observation_kind,
      candidate.subject_key,
      candidate.actor_key,
      candidate.observed_at,
      candidate.salience,
      candidate.confidence,
      candidate.observation_text,
      JSON.stringify(candidate.source_turn_ids),
      JSON.stringify(candidate.source_refs),
      candidate.review_status,
      JSON.stringify(candidate.metadata),
    ],
  );

  await insertWriteEvent(client, thread.id, jobId, 'observation_upsert', 'memory.observations', res.rows[0].id, {
    observation_key: candidate.observation_key,
    observation_kind: candidate.observation_kind,
  });

  return res.rows[0];
}

async function upsertTemporalFact(client, thread, candidate, observationId, jobId) {
  if (!candidate.fact) return null;

  const fact = candidate.fact;
  const factKey = buildFactKey(thread.thread_key, fact.subject_key, fact.predicate, fact.object_value, fact.source_turn_ids[0] || nowIso());
  const ensureEntityProjection = async (factId) => {
    const subjectEntity = await upsertEntity(
      client,
      thread.brand_key,
      buildEntityKey('thread_subject', fact.subject_key),
      'thread_subject',
      fact.subject_key,
      {
        source_thread_key: thread.thread_key,
      },
    );
    const objectEntity = await upsertEntity(
      client,
      thread.brand_key,
      buildEntityKey(inferObjectEntityType(fact.predicate), fact.object_value),
      inferObjectEntityType(fact.predicate),
      fact.object_value,
      {
        predicate: fact.predicate,
        source_thread_key: thread.thread_key,
      },
    );
    const relation = await upsertEntityRelation(
      client,
      thread,
      subjectEntity.id,
      fact.predicate,
      objectEntity.id,
      fact.object_value,
      factId,
      fact.confidence,
    );

    await insertWriteEvent(client, thread.id, jobId, 'entity_relation_upsert', 'memory.entity_relations', relation.id, {
      predicate: fact.predicate,
      subject_entity_key: subjectEntity.entity_key,
      object_entity_key: objectEntity.entity_key,
    });
  };

  const existingByKey = await client.query(
    `
      SELECT id
      FROM memory.facts
      WHERE fact_key = $1
    `,
    [factKey],
  );

  if (existingByKey.rows[0]) {
    await ensureEntityProjection(existingByKey.rows[0].id);
    return existingByKey.rows[0];
  }

  const currentRes = await client.query(
    `
      SELECT *
      FROM memory.current_facts
      WHERE thread_id = $1
        AND subject_key = $2
        AND predicate = $3
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [thread.id, fact.subject_key, fact.predicate],
  );

  const current = currentRes.rows[0] || null;

  if (current && current.object_value === fact.object_value) {
    const mergedTurnIds = uniqueStrings([...(current.source_turn_ids || []), ...(fact.source_turn_ids || [])]);
    const mergedObservationIds = uniqueStrings([...(current.source_observation_ids || []), observationId]);
    const updateRes = await client.query(
      `
        UPDATE memory.facts
        SET
          confidence = GREATEST(confidence, $2),
          source_turn_ids = $3::jsonb,
          source_observation_ids = $4::jsonb,
          updated_at = now()
        WHERE id = $1
        RETURNING id
      `,
      [
        current.id,
        fact.confidence,
        JSON.stringify(mergedTurnIds),
        JSON.stringify(mergedObservationIds),
      ],
    );

    await insertWriteEvent(client, thread.id, jobId, 'fact_reconfirmed', 'memory.facts', updateRes.rows[0].id, {
      predicate: fact.predicate,
      object_value: fact.object_value,
    });

    await ensureEntityProjection(updateRes.rows[0].id);

    return updateRes.rows[0];
  }

  const newFactId = stableUuidFromKey(`fact_id:${factKey}`);
  if (current && current.object_value !== fact.object_value) {
    // Retire the prior row before inserting its replacement so the partial
    // unique index never observes two current facts in the transaction.
    await client.query(
      `
        UPDATE memory.facts
        SET
          is_current = false,
          valid_to = $2,
          updated_at = now()
        WHERE id = $1
      `,
      [current.id, fact.valid_from],
    );
  }

  const insertRes = await client.query(
    `
      INSERT INTO memory.facts (
        id,
        fact_key,
        thread_id,
        subject_key,
        predicate,
        object_value,
        object_payload,
        confidence,
        provenance_kind,
        source_turn_ids,
        source_observation_ids,
        review_status,
        valid_from,
        metadata
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9,
        $10::jsonb, $11::jsonb, $12, $13, $14::jsonb
      )
      RETURNING id
    `,
    [
      newFactId,
      factKey,
      thread.id,
      fact.subject_key,
      fact.predicate,
      fact.object_value,
      JSON.stringify(fact.object_payload || {}),
      fact.confidence,
      'observation_derived',
      JSON.stringify(fact.source_turn_ids || []),
      JSON.stringify(uniqueStrings([observationId])),
      'auto_curated',
      fact.valid_from,
      JSON.stringify({
        extraction_method: 'deterministic_patterns_v1',
      }),
    ],
  );

  if (current && current.object_value !== fact.object_value) {
    await client.query(
      `
        UPDATE memory.facts
        SET
          superseded_by_fact_id = $2,
          updated_at = now()
        WHERE id = $1
      `,
      [current.id, newFactId],
    );

    await client.query(
      `
        INSERT INTO memory.fact_supersessions (
          previous_fact_id,
          new_fact_id,
          reason,
          source_job_id,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5::jsonb)
        ON CONFLICT (previous_fact_id, new_fact_id)
        DO NOTHING
      `,
      [
        current.id,
        newFactId,
        `superseded_${fact.predicate}`,
        jobId || null,
        JSON.stringify({
          previous_object_value: current.object_value,
          new_object_value: fact.object_value,
        }),
      ],
    );
  }

  await insertWriteEvent(client, thread.id, jobId, 'fact_upsert', 'memory.facts', newFactId, {
    predicate: fact.predicate,
    object_value: fact.object_value,
    superseded_previous: Boolean(current && current.object_value !== fact.object_value),
  });

  await ensureEntityProjection(newFactId);

  return insertRes.rows[0];
}

async function buildThreadSummary(client, threadId) {
  const factsRes = await client.query(
    `
      SELECT predicate, object_value
      FROM memory.current_facts
      WHERE thread_id = $1
      ORDER BY predicate
    `,
    [threadId],
  );
  const observationsRes = await client.query(
    `
      SELECT observation_kind, observation_text
      FROM memory.observations
      WHERE thread_id = $1
        AND is_active = true
      ORDER BY observed_at DESC, created_at DESC
      LIMIT 6
    `,
    [threadId],
  );

  const factText = factsRes.rows.length
    ? factsRes.rows.map((row) => `${buildPredicateText(row.predicate)}=${row.object_value}`).join('; ')
    : 'no stable facts yet';
  const observationText = observationsRes.rows.length
    ? observationsRes.rows.map((row) => `${row.observation_kind}: ${row.observation_text}`).join(' | ')
    : 'no recent observations yet';

  return compactText(`Stable facts: ${factText}. Recent observations: ${observationText}.`);
}

async function upsertRunningSummary(client, thread, turns, jobId) {
  const summaryText = await buildThreadSummary(client, thread.id);
  const summaryKey = `summary:${thread.thread_key}:running`;
  const latestTurnIds = turns.slice(-8).map((turn) => turn.source_turn_id);
  const summaryHash = hashString(summaryText);
  const res = await client.query(
    `
      INSERT INTO memory.thread_summaries (
        summary_key,
        thread_id,
        summary_scope,
        summary_text,
        turn_count,
        source_turn_ids,
        quality_label,
        review_status,
        is_active,
        summary_hash,
        metadata
      )
      VALUES (
        $1, $2, $3, $4, $5, $6::jsonb, $7, $8, true, $9, $10::jsonb
      )
      ON CONFLICT (summary_key)
      DO UPDATE SET
        summary_text = EXCLUDED.summary_text,
        turn_count = EXCLUDED.turn_count,
        source_turn_ids = EXCLUDED.source_turn_ids,
        quality_label = EXCLUDED.quality_label,
        review_status = EXCLUDED.review_status,
        summary_hash = EXCLUDED.summary_hash,
        metadata = EXCLUDED.metadata,
        updated_at = now()
      RETURNING id
    `,
    [
      summaryKey,
      thread.id,
      'running',
      summaryText,
      turns.length,
      JSON.stringify(latestTurnIds),
      'working',
      'auto_curated',
      summaryHash,
      JSON.stringify({
        generation_method: 'deterministic_summary_v1',
      }),
    ],
  );

  await insertWriteEvent(client, thread.id, jobId, 'summary_upsert', 'memory.thread_summaries', res.rows[0].id, {
    summary_key: summaryKey,
    turn_count: turns.length,
  });

  return res.rows[0];
}

async function insertCheckpoint(client, thread, turns, jobId) {
  const latestTurn = turns[turns.length - 1] || null;
  const checkpointKey = `checkpoint:${thread.thread_key}:${latestTurn?.source_turn_id || 'empty'}`;
  const res = await client.query(
    `
      INSERT INTO memory.thread_checkpoints (
        checkpoint_key,
        thread_id,
        latest_turn_id,
        checkpoint_type,
        window_turn_count,
        state_json,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
      ON CONFLICT (checkpoint_key)
      DO UPDATE SET
        latest_turn_id = EXCLUDED.latest_turn_id,
        window_turn_count = EXCLUDED.window_turn_count,
        state_json = EXCLUDED.state_json,
        metadata = EXCLUDED.metadata
      RETURNING id
    `,
    [
      checkpointKey,
      thread.id,
      latestTurn?.id || null,
      'running_window',
      turns.length,
      JSON.stringify({
        latest_source_turn_id: latestTurn?.source_turn_id || null,
        turn_count: turns.length,
      }),
      JSON.stringify({
        checkpoint_method: 'memory_job_v1',
      }),
    ],
  );

  await insertWriteEvent(client, thread.id, jobId, 'checkpoint_upsert', 'memory.thread_checkpoints', res.rows[0].id, {
    checkpoint_key: checkpointKey,
  });

  return res.rows[0];
}

async function runEpisodicExtractionJob(client, job) {
  const { thread, turns } = await loadThreadContext(client, job.thread_key);

  let observationCount = 0;
  let factCount = 0;

  for (const turn of turns) {
    const candidates = extractObservationCandidates(thread, turn);
    for (const candidate of candidates) {
      const observation = await upsertObservation(client, thread, turn, candidate, job.id);
      observationCount += 1;
      if (candidate.fact) {
        await upsertTemporalFact(client, thread, candidate, observation.id, job.id);
        factCount += 1;
      }
    }
  }

  const summary = await upsertRunningSummary(client, thread, turns, job.id);
  const checkpoint = await insertCheckpoint(client, thread, turns, job.id);

  return {
    thread_key: thread.thread_key,
    processed_turns: turns.length,
    observation_candidates_processed: observationCount,
    fact_candidates_processed: factCount,
    summary_id: summary.id,
    checkpoint_id: checkpoint.id,
  };
}

async function runReflectionJob(client, job) {
  const { thread } = await loadThreadContext(client, job.thread_key);

  const factsRes = await client.query(
    `
      SELECT predicate, object_value, id
      FROM memory.current_facts
      WHERE thread_id = $1
      ORDER BY predicate
    `,
    [thread.id],
  );
  const observationsRes = await client.query(
    `
      SELECT id, observation_kind, observation_text
      FROM memory.observations
      WHERE thread_id = $1
        AND is_active = true
      ORDER BY observed_at DESC, created_at DESC
      LIMIT 8
    `,
    [thread.id],
  );
  const summariesRes = await client.query(
    `
      SELECT summary_text
      FROM memory.thread_summaries
      WHERE thread_id = $1
        AND summary_scope = 'running'
        AND is_active = true
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    [thread.id],
  );

  const stableFacts = factsRes.rows.length
    ? factsRes.rows.map((row) => `${buildPredicateText(row.predicate)} ${row.object_value}`).join('; ')
    : 'no stable facts yet';
  const recentSignals = observationsRes.rows.length
    ? observationsRes.rows.map((row) => row.observation_text).join(' | ')
    : 'no recent signals yet';
  const baseSummary = summariesRes.rows[0]?.summary_text || 'no running summary available';

  const reflectionText = compactText(
    `Thread reflection for ${thread.thread_key}. Stable facts: ${stableFacts}. ` +
    `Recent signals: ${recentSignals}. ` +
    `Running summary: ${baseSummary}`,
  );

  const reflectionKey = `reflection:${thread.thread_key}:latest`;
  const res = await client.query(
    `
      INSERT INTO memory.reflections (
        reflection_key,
        thread_id,
        reflection_scope,
        reflection_text,
        supporting_observation_ids,
        supporting_fact_ids,
        confidence,
        review_status,
        is_active,
        metadata
      )
      VALUES (
        $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, true, $9::jsonb
      )
      ON CONFLICT (reflection_key)
      DO UPDATE SET
        reflection_text = EXCLUDED.reflection_text,
        supporting_observation_ids = EXCLUDED.supporting_observation_ids,
        supporting_fact_ids = EXCLUDED.supporting_fact_ids,
        confidence = EXCLUDED.confidence,
        review_status = EXCLUDED.review_status,
        metadata = EXCLUDED.metadata,
        updated_at = now()
      RETURNING id
    `,
    [
      reflectionKey,
      thread.id,
      'latest_thread_state',
      reflectionText,
      JSON.stringify(observationsRes.rows.map((row) => row.id)),
      JSON.stringify(factsRes.rows.map((row) => row.id)),
      0.82,
      'auto_curated',
      JSON.stringify({
        reflection_method: 'deterministic_reflection_v1',
      }),
    ],
  );

  await insertWriteEvent(client, thread.id, job.id, 'reflection_upsert', 'memory.reflections', res.rows[0].id, {
    reflection_key: reflectionKey,
  });

  return {
    thread_key: thread.thread_key,
    reflection_id: res.rows[0].id,
    fact_count: factsRes.rows.length,
    observation_count: observationsRes.rows.length,
  };
}

function buildAgentMemoryEmbeddingInput(record) {
  const payload = record.payload || {};
  return [
    `record_type=agent_memory`,
    `memory_kind=${record.memory_kind}`,
    `brand=${record.brand_key}`,
    `thread=${record.thread_key}`,
    `scope=${record.scope_kind}`,
    `resource=${record.resource_key || ''}`,
    `subject=${record.subject_key || ''}`,
    `language=${record.language_code || ''}`,
    `review_status=${record.review_status}`,
    `valid_from=${record.valid_from || ''}`,
    `valid_to=${record.valid_to || ''}`,
    `text=${compactText(record.text_body)}`,
    `payload=${compactText(JSON.stringify(payload))}`,
  ].filter(Boolean).join('\n');
}

export async function importThreadBundlePg(bundle, { outputPath } = {}) {
  await ensurePlatformEnvLoaded();
  const client = await createPgClient();

  try {
    await client.query('BEGIN');

    const threadInput = bundle.thread || {};
    if (!threadInput.thread_key || !threadInput.brand_key || !threadInput.source_system || !threadInput.scope_kind) {
      throw new Error('Thread bundle is missing one of: thread.thread_key, brand_key, source_system, scope_kind.');
    }

    const threadRes = await client.query(
      `
        INSERT INTO memory.threads (
          thread_key,
          brand_key,
          scope_kind,
          scope_key,
          source_system,
          external_thread_ref,
          title,
          language_code,
          status,
          metadata
        )
        VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10::jsonb
        )
        ON CONFLICT (thread_key)
        DO UPDATE SET
          brand_key = EXCLUDED.brand_key,
          scope_kind = EXCLUDED.scope_kind,
          scope_key = EXCLUDED.scope_key,
          source_system = EXCLUDED.source_system,
          external_thread_ref = EXCLUDED.external_thread_ref,
          title = EXCLUDED.title,
          language_code = EXCLUDED.language_code,
          status = EXCLUDED.status,
          metadata = EXCLUDED.metadata,
          updated_at = now()
        RETURNING id, thread_key
      `,
      [
        threadInput.thread_key,
        threadInput.brand_key,
        threadInput.scope_kind,
        threadInput.scope_key || null,
        threadInput.source_system,
        threadInput.external_thread_ref || null,
        threadInput.title || null,
        threadInput.language_code || null,
        threadInput.status || 'active',
        JSON.stringify(threadInput.metadata || {}),
      ],
    );

    const threadId = threadRes.rows[0].id;
    let importedTurns = 0;

    for (const turnInput of bundle.turns || []) {
      if (!turnInput.source_turn_id || !turnInput.actor_role || !turnInput.text_raw) {
        throw new Error('Each turn must include source_turn_id, actor_role, and text_raw.');
      }

      await client.query(
        `
          INSERT INTO memory.thread_turns (
            thread_id,
            source_turn_id,
            actor_role,
            actor_key,
            turn_kind,
            sent_at,
            text_raw,
            text_normalized,
            payload,
            artifact_refs,
            metadata
          )
          VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9::jsonb, $10::jsonb, $11::jsonb
          )
          ON CONFLICT (thread_id, source_turn_id)
          DO UPDATE SET
            actor_role = EXCLUDED.actor_role,
            actor_key = EXCLUDED.actor_key,
            turn_kind = EXCLUDED.turn_kind,
            sent_at = EXCLUDED.sent_at,
            text_raw = EXCLUDED.text_raw,
            text_normalized = EXCLUDED.text_normalized,
            payload = EXCLUDED.payload,
            artifact_refs = EXCLUDED.artifact_refs,
            metadata = EXCLUDED.metadata,
            updated_at = now()
        `,
        [
          threadId,
          turnInput.source_turn_id,
          turnInput.actor_role,
          turnInput.actor_key || null,
          turnInput.turn_kind || 'message',
          turnInput.sent_at || null,
          turnInput.text_raw,
          turnInput.text_normalized || normalizeText(turnInput.text_raw),
          JSON.stringify(turnInput.payload || {}),
          JSON.stringify(turnInput.artifact_refs || {}),
          JSON.stringify(turnInput.metadata || {}),
        ],
      );
      importedTurns += 1;
    }

    await client.query('COMMIT');

    const result = {
      thread_key: threadInput.thread_key,
      thread_id: threadId,
      imported_turns: importedTurns,
    };

    if (outputPath) {
      return { result, outputPath };
    }
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

export async function enqueueThreadMemoryJobs(threadKey, requestedBy = 'memory_pipeline') {
  await ensurePlatformEnvLoaded();
  const client = await createPgClient();

  try {
    await client.query('BEGIN');
    const threadRes = await client.query(
      `SELECT id, thread_key FROM memory.threads WHERE thread_key = $1`,
      [threadKey],
    );
    if (!threadRes.rows[0]) {
      throw new Error(`Thread not found: ${threadKey}`);
    }
    const thread = threadRes.rows[0];
    const jobs = [];

    for (const jobType of ['episodic_extraction', 'reflection']) {
      const jobKey = `memory_job:${threadKey}:${jobType}`;
      const res = await client.query(
        `
          INSERT INTO memory.jobs (
            job_key,
            thread_id,
            job_type,
            status,
            requested_by,
            input_payload
          )
          VALUES ($1, $2, $3, 'pending', $4, $5::jsonb)
          ON CONFLICT (job_key)
          DO UPDATE SET
            status = 'pending',
            requested_by = EXCLUDED.requested_by,
            input_payload = EXCLUDED.input_payload,
            error_text = NULL,
            started_at = NULL,
            finished_at = NULL
          RETURNING id, job_key, job_type, status
        `,
        [
          jobKey,
          thread.id,
          jobType,
          requestedBy,
          JSON.stringify({ thread_key: threadKey }),
        ],
      );
      jobs.push(res.rows[0]);
    }

    await client.query('COMMIT');
    return {
      thread_key: threadKey,
      enqueued_jobs: jobs,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

export async function runMemoryJob(selection = '--next') {
  await ensurePlatformEnvLoaded();
  const client = await createPgClient();

  try {
    await client.query('BEGIN');

    const jobRes = selection === '--next'
      ? await client.query(
          `
            SELECT j.*, t.thread_key
            FROM memory.jobs j
            JOIN memory.threads t ON t.id = j.thread_id
            WHERE j.status = 'pending'
            ORDER BY j.created_at
            LIMIT 1
          `,
        )
      : await client.query(
          `
            SELECT j.*, t.thread_key
            FROM memory.jobs j
            JOIN memory.threads t ON t.id = j.thread_id
            WHERE j.job_key = $1
            LIMIT 1
          `,
          [selection],
        );

    const job = jobRes.rows[0];
    if (!job) {
      await client.query('COMMIT');
      return {
        selection,
        processed: false,
        reason: 'no_pending_job',
      };
    }

    await client.query(
      `
        UPDATE memory.jobs
        SET status = 'running',
            started_at = now(),
            error_text = NULL
        WHERE id = $1
      `,
      [job.id],
    );

    let output;
    if (job.job_type === 'episodic_extraction') {
      output = await runEpisodicExtractionJob(client, job);
    } else if (job.job_type === 'reflection') {
      output = await runReflectionJob(client, job);
    } else {
      throw new Error(`Unsupported memory job type: ${job.job_type}`);
    }

    await client.query(
      `
        UPDATE memory.jobs
        SET status = 'completed',
            output_payload = $2::jsonb,
            finished_at = now()
        WHERE id = $1
      `,
      [job.id, JSON.stringify(output)],
    );

    await client.query('COMMIT');
    return {
      processed: true,
      job_key: job.job_key,
      job_type: job.job_type,
      output,
    };
  } catch (err) {
    await client.query(
      `
        UPDATE memory.jobs
        SET status = 'failed',
            error_text = $2,
            finished_at = now()
        WHERE job_key = $1
      `,
      [selection === '--next' ? null : selection, err.message],
    ).catch(() => {});
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

export async function syncAgentMemory({ threadKey = null } = {}) {
  await ensurePlatformEnvLoaded();
  const client = await createPgClient();

  try {
    const params = [];
    let where = `WHERE review_status IN ('auto_curated', 'reviewed', 'approved')`;
    if (threadKey) {
      params.push(threadKey);
      where += ` AND thread_key = $${params.length}`;
    }

    const sourceRes = await client.query(
      `
        SELECT *
        FROM memory.agent_memory_source_records
        ${where}
        ORDER BY created_at
      `,
      params,
    );

    const rows = sourceRes.rows;
    if (!rows.length) {
      return {
        thread_key: threadKey,
        synced_points: 0,
        skipped_points: 0,
        created_collection: false,
        qdrant_collection: AGENT_MEMORY_COLLECTION,
      };
    }

    const points = [];
    let createdCollection = false;
    let skippedPoints = 0;

    for (const row of rows) {
      const contentHash = hashString(JSON.stringify({
        text_body: row.text_body,
        payload: row.payload,
        valid_from: row.valid_from,
        valid_to: row.valid_to,
      }));

      const syncStateRes = await client.query(
        `
          SELECT content_hash
          FROM ops.qdrant_sync_state
          WHERE collection_name = $1
            AND source_table = $2
            AND source_record_id = $3
            AND embedding_profile = $4
        `,
        [AGENT_MEMORY_COLLECTION, row.source_table, row.source_record_id, EMBEDDING_PROFILE],
      );

      if (syncStateRes.rows[0]?.content_hash === contentHash) {
        skippedPoints += 1;
        continue;
      }

      const vector = await embedText(buildAgentMemoryEmbeddingInput(row));
      if (!points.length) {
        const ensureResult = await ensureQdrantCollection(AGENT_MEMORY_COLLECTION, VECTOR_NAME, vector.length);
        createdCollection = ensureResult.created;
      }

      points.push({
        source_table: row.source_table,
        source_record_id: row.source_record_id,
        content_hash: contentHash,
        point: {
          id: stableUuidFromKey(row.record_key),
          vector,
          payload: {
            record_type: 'agent_memory',
            record_key: row.record_key,
            source_table: row.source_table,
            source_record_id: row.source_record_id,
            brand_key: row.brand_key,
            thread_key: row.thread_key,
            scope_kind: row.scope_kind,
            resource_key: row.resource_key,
            subject_key: row.subject_key,
            memory_kind: row.memory_kind,
            review_status: row.review_status,
            language_code: row.language_code,
            valid_from: row.valid_from,
            valid_to: row.valid_to,
            embedding_profile: EMBEDDING_PROFILE,
            text_body: row.text_body,
            payload: row.payload || {},
          },
        },
      });
    }

    let qdrantResult = null;
    if (points.length) {
      qdrantResult = await upsertQdrantPoints(
        AGENT_MEMORY_COLLECTION,
        VECTOR_NAME,
        points.map((item) => item.point),
      );

      for (const item of points) {
        await client.query(
          `
            INSERT INTO ops.qdrant_sync_state (
              collection_name,
              source_table,
              source_record_id,
              point_id,
              embedding_profile,
              content_hash
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (collection_name, source_table, source_record_id, embedding_profile)
            DO UPDATE SET
              point_id = EXCLUDED.point_id,
              content_hash = EXCLUDED.content_hash,
              last_synced_at = now()
          `,
          [
            AGENT_MEMORY_COLLECTION,
            item.source_table,
            item.source_record_id,
            item.point.id,
            EMBEDDING_PROFILE,
            item.content_hash,
          ],
        );
      }
    }

    return {
      thread_key: threadKey,
      qdrant_collection: AGENT_MEMORY_COLLECTION,
      synced_points: points.length,
      skipped_points: skippedPoints,
      created_collection: createdCollection,
      vector_name: VECTOR_NAME,
      vector_dimensions: points[0]?.point?.vector?.length || null,
      qdrant_result: qdrantResult,
    };
  } finally {
    await client.end();
  }
}

export async function queryAgentMemory(request) {
  await ensurePlatformEnvLoaded();
  const client = await createPgClient();

  try {
    const threadKey = request.thread_key;
    if (!threadKey || !request.brand_key || !request.query_text) {
      throw new Error('Query request must include brand_key, thread_key, and query_text.');
    }

    const { thread } = await loadThreadContext(client, threadKey);
    const subjectKey = request.subject_key || thread.scope_key || thread.thread_key;

    const summaryRes = await client.query(
      `
        SELECT summary_text, updated_at
        FROM memory.thread_summaries
        WHERE thread_id = $1
          AND summary_scope = 'running'
          AND is_active = true
        ORDER BY updated_at DESC
        LIMIT 1
      `,
      [thread.id],
    );

    const factsRes = await client.query(
      `
        SELECT predicate, object_value, confidence, subject_key
        FROM memory.current_facts
        WHERE thread_id = $1
        ORDER BY (subject_key = $2) DESC, predicate
      `,
      [thread.id, subjectKey],
    );

    const reflectionsRes = await client.query(
      `
        SELECT reflection_text, confidence, updated_at
        FROM memory.reflections
        WHERE thread_id = $1
          AND is_active = true
        ORDER BY updated_at DESC
        LIMIT 3
      `,
      [thread.id],
    );

    const sourceRes = await client.query(
      `
        SELECT record_key, memory_kind, subject_key, text_body, payload, created_at
        FROM memory.agent_memory_source_records
        WHERE thread_key = $1
        ORDER BY created_at DESC
        LIMIT 100
      `,
      [threadKey],
    );

    const queryTokens = significantTokens(request.query_text);
    const keywordHits = sourceRes.rows
      .map((row) => {
        const haystack = `${row.text_body} ${JSON.stringify(row.payload || {})}`.toLowerCase();
        const overlap = queryTokens.filter((token) => haystack.includes(token));
        return {
          ...row,
          keyword_overlap: overlap.length,
          matched_tokens: overlap,
        };
      })
      .filter((row) => row.keyword_overlap > 0)
      .sort((a, b) => b.keyword_overlap - a.keyword_overlap || String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, request.keyword_limit || 5);

    let semanticHits = [];
    try {
      const vector = await embedText(request.query_text);
      const filter = {
        must: [
          { key: 'brand_key', match: { value: request.brand_key } },
          { key: 'thread_key', match: { value: threadKey } },
        ],
      };
      const semanticRes = await searchQdrant(AGENT_MEMORY_COLLECTION, VECTOR_NAME, vector, filter, request.semantic_limit || 5);
      semanticHits = (semanticRes.result || []).map((item) => ({
        score: item.score,
        payload: item.payload,
      }));
    } catch (error) {
      semanticHits = [{
        score: 0,
        payload: {
          record_type: 'semantic_search_error',
          error: error.message,
        },
      }];
    }

    const assembledContext = compactText([
      summaryRes.rows[0]?.summary_text || '',
      factsRes.rows.map((row) => `${buildPredicateText(row.predicate)}=${row.object_value}`).join('; '),
      reflectionsRes.rows.map((row) => row.reflection_text).join(' | '),
      keywordHits.map((row) => row.text_body).join(' | '),
      semanticHits.map((row) => row.payload?.text_body || row.payload?.record_key || '').join(' | '),
    ].filter(Boolean).join(' '));

    const result = {
      query_key: request.query_key || null,
      brand_key: request.brand_key,
      thread_key: threadKey,
      subject_key: subjectKey,
      query_text: request.query_text,
      summary: summaryRes.rows[0] || null,
      current_facts: factsRes.rows,
      reflections: reflectionsRes.rows,
      keyword_hits: keywordHits,
      semantic_hits: semanticHits,
      assembled_context: assembledContext,
    };

    await client.query(
      `
        INSERT INTO memory.retrieval_events (
          thread_id,
          query_key,
          query_text,
          requested_memory_types,
          retrieved_payload,
          metadata
        )
        VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb)
      `,
      [
        thread.id,
        request.query_key || null,
        request.query_text,
        JSON.stringify(['summary', 'current_facts', 'keyword_hits', 'semantic_hits', 'reflections']),
        JSON.stringify({
          summary: Boolean(result.summary),
          fact_count: result.current_facts.length,
          keyword_hit_count: result.keyword_hits.length,
          semantic_hit_count: result.semantic_hits.length,
        }),
        JSON.stringify({
          subject_key: subjectKey,
        }),
      ],
    );

    return result;
  } finally {
    await client.end();
  }
}

export async function runMemoryEval(dataset) {
  await ensurePlatformEnvLoaded();
  const client = await createPgClient();

  try {
    const threadRes = await client.query(
      `SELECT id FROM memory.threads WHERE thread_key = $1 LIMIT 1`,
      [dataset.thread_key],
    );
    const threadId = threadRes.rows[0]?.id || null;

    const cases = [];
    let passed = 0;
    let expectedFactChecks = 0;
    let expectedFactHits = 0;
    let expectedTermChecks = 0;
    let expectedTermHits = 0;

    for (const evalCase of dataset.cases || []) {
      const result = await queryAgentMemory({
        brand_key: dataset.brand_key,
        thread_key: dataset.thread_key,
        subject_key: evalCase.subject_key || null,
        query_key: evalCase.case_key,
        query_text: evalCase.query_text,
        semantic_limit: evalCase.semantic_limit || 5,
        keyword_limit: evalCase.keyword_limit || 5,
      });

      const factMatches = (evalCase.expected_facts || []).map((expected) => {
        expectedFactChecks += 1;
        const matched = result.current_facts.some((fact) => (
          String(fact.predicate) === String(expected.predicate) &&
          String(fact.object_value).toLowerCase().includes(String(expected.value_contains).toLowerCase())
        ));
        if (matched) expectedFactHits += 1;
        return {
          ...expected,
          matched,
        };
      });

      const contextBlob = JSON.stringify(result).toLowerCase();
      const termMatches = (evalCase.expected_text_terms || []).map((term) => {
        expectedTermChecks += 1;
        const matched = contextBlob.includes(String(term).toLowerCase());
        if (matched) expectedTermHits += 1;
        return {
          term,
          matched,
        };
      });

      const casePassed = factMatches.every((item) => item.matched) && termMatches.every((item) => item.matched);
      if (casePassed) passed += 1;

      cases.push({
        case_key: evalCase.case_key,
        query_text: evalCase.query_text,
        passed: casePassed,
        fact_matches: factMatches,
        term_matches: termMatches,
        retrieved_counts: {
          current_facts: result.current_facts.length,
          keyword_hits: result.keyword_hits.length,
          semantic_hits: result.semantic_hits.length,
        },
      });
    }

    const metrics = {
      cases_total: cases.length,
      cases_passed: passed,
      case_pass_rate: cases.length ? Number((passed / cases.length).toFixed(4)) : 0,
      expected_fact_checks: expectedFactChecks,
      expected_fact_hits: expectedFactHits,
      expected_fact_hit_rate: expectedFactChecks ? Number((expectedFactHits / expectedFactChecks).toFixed(4)) : 0,
      expected_term_checks: expectedTermChecks,
      expected_term_hits: expectedTermHits,
      expected_term_hit_rate: expectedTermChecks ? Number((expectedTermHits / expectedTermChecks).toFixed(4)) : 0,
    };

    const payload = {
      eval_key: dataset.eval_key,
      thread_key: dataset.thread_key,
      brand_key: dataset.brand_key,
      cases,
      metrics,
    };

    await client.query(
      `
        INSERT INTO memory.eval_runs (
          eval_key,
          thread_id,
          status,
          input_payload,
          output_payload,
          metrics,
          finished_at
        )
        VALUES ($1, $2, 'completed', $3::jsonb, $4::jsonb, $5::jsonb, now())
        ON CONFLICT (eval_key)
        DO UPDATE SET
          thread_id = EXCLUDED.thread_id,
          status = EXCLUDED.status,
          input_payload = EXCLUDED.input_payload,
          output_payload = EXCLUDED.output_payload,
          metrics = EXCLUDED.metrics,
          finished_at = EXCLUDED.finished_at
      `,
      [
        dataset.eval_key,
        threadId,
        JSON.stringify(dataset),
        JSON.stringify(payload),
        JSON.stringify(metrics),
      ],
    );

    return payload;
  } finally {
    await client.end();
  }
}

export async function getQdrantCollectionState() {
  const response = await fetch(`${qdrantBaseUrl()}/collections/${encodeURIComponent(AGENT_MEMORY_COLLECTION)}`, {
    method: 'GET',
    headers: { 'content-type': 'application/json', ...(process.env.QDRANT_API_KEY ? { 'api-key': process.env.QDRANT_API_KEY } : {}) },
  });

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Failed to inspect ${AGENT_MEMORY_COLLECTION}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}
