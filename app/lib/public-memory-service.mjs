import { publicScopeResponse } from './config.mjs';
import { publicCorpusUnavailableError } from './errors.mjs';

const STOP_WORDS = new Set([
  'about',
  'after',
  'also',
  'and',
  'are',
  'client',
  'current',
  'did',
  'does',
  'for',
  'from',
  'have',
  'into',
  'mention',
  'project',
  'record',
  'recorded',
  'that',
  'the',
  'their',
  'them',
  'they',
  'this',
  'was',
  'what',
  'when',
  'where',
  'which',
  'with',
  'would',
]);

const CONCEPTS = [
  {
    key: 'budget',
    queryTerms: ['budget', 'cost', 'price', 'pricing', 'spend'],
    recordTerms: ['budget'],
  },
  {
    key: 'delivery',
    queryTerms: ['delivery', 'remote', 'onsite', 'on-site', 'hardware', 'shipping'],
    recordTerms: ['delivery model', 'delivery preference', 'remote only', 'on-site', 'hardware'],
  },
  {
    key: 'deadline',
    queryTerms: ['deadline', 'due', 'target', 'date', 'timeline'],
    recordTerms: ['desired deadline', 'deadline', 'delivery target', 'due'],
  },
  {
    key: 'language',
    queryTerms: ['language', 'english', 'communication'],
    recordTerms: ['preferred language', 'language', 'communication preference'],
  },
  {
    key: 'updates',
    queryTerms: ['update', 'updates', 'written', 'communication'],
    recordTerms: ['preferred update style', 'written updates', 'communication preference'],
  },
  {
    key: 'tools',
    queryTerms: ['tool', 'tools', 'stack', 'software', 'systems'],
    recordTerms: ['tools in use', 'current tools'],
  },
  {
    key: 'location',
    queryTerms: ['location', 'located', 'based', 'city', 'country'],
    recordTerms: ['location', 'reported location'],
  },
  {
    key: 'timezone',
    queryTerms: ['timezone', 'time-zone', 'zone'],
    recordTerms: ['timezone'],
  },
  {
    key: 'workflow',
    queryTerms: ['workflow', 'process', 'plan', 'start', 'commitment', 'decision'],
    recordTerms: ['workflow', 'commitment', 'requirement', 'start with'],
  },
];

const BROAD_QUERY_PATTERNS = [
  /\bwhat (?:do|does) (?:we|the (?:team|memory|record)) know\b/,
  /\bcurrent (?:state|context|record)\b/,
  /\b(?:summarize|summary|overview|remember)\b/,
  /\b(?:show|list) (?:the )?(?:memory|evidence|provenance|sources)\b/,
];

const HISTORY_QUERY_PATTERN = /\b(chang(?:e|ed|es)|history|historical|original|previous|prior|supersed(?:e|ed)|before|then|old)\b/;
const REFLECTION_QUERY_PATTERN = /\b(reflection|lesson|insight|pattern|why)\b/;
const SUMMARY_QUERY_PATTERN = /\b(summary|summarize|overview|context)\b/;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function stringId(value) {
  return value === null || value === undefined ? null : String(value);
}

function stringArray(value) {
  return asArray(value).map(String).filter(Boolean);
}

function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asIso(value) {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function compactText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function truncate(value, maxCharacters) {
  const text = compactText(value);
  if (text.length <= maxCharacters) return text;
  return `${text.slice(0, Math.max(0, maxCharacters - 3)).trimEnd()}...`;
}

function tokenize(value) {
  return [...new Set(
    compactText(value)
      .toLowerCase()
      .split(/[^a-z0-9+.#/_-]+/)
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
  )];
}

function publicTurn(row) {
  return {
    source_turn_id: row.source_turn_id,
    actor_role: row.actor_role,
    actor_key: row.actor_key || null,
    turn_kind: row.turn_kind,
    sent_at: asIso(row.sent_at),
    text: truncate(row.text, 1000),
  };
}

function factReference(row, reason = null) {
  if (!row) return null;
  return {
    fact_key: row.fact_key,
    predicate: row.predicate,
    object_value: row.object_value,
    valid_from: asIso(row.valid_from),
    valid_to: asIso(row.valid_to),
    is_current: Boolean(row.is_current),
    ...(reason ? { reason } : {}),
  };
}

export function buildPublicSnapshot(rawSnapshot) {
  const rawTurns = asArray(rawSnapshot?.turns);
  const turns = rawTurns.map(publicTurn);
  const turnsBySourceId = new Map(turns.map((turn) => [turn.source_turn_id, turn]));

  const rawObservations = asArray(rawSnapshot?.observations);
  const observationsById = new Map();
  const observations = rawObservations.map((row) => {
    const observation = {
      observation_key: row.observation_key,
      observation_kind: row.observation_kind,
      subject_key: row.subject_key || null,
      actor_key: row.actor_key || null,
      observed_at: asIso(row.observed_at),
      salience: asNumber(row.salience),
      confidence: asNumber(row.confidence),
      text: truncate(row.observation_text, 1200),
      review_status: row.review_status,
      source_turns: stringArray(row.source_turn_ids)
        .map((sourceTurnId) => turnsBySourceId.get(sourceTurnId))
        .filter(Boolean),
    };
    observationsById.set(stringId(row.id), observation);
    return observation;
  });

  const rawFacts = asArray(rawSnapshot?.facts);
  const rawFactsById = new Map(rawFacts.map((row) => [stringId(row.id), row]));
  const supersessionByPrevious = new Map();
  const supersessionsByNew = new Map();

  for (const event of asArray(rawSnapshot?.supersessions)) {
    const previousId = stringId(event.previous_fact_id);
    const newId = stringId(event.new_fact_id);
    supersessionByPrevious.set(previousId, event);
    if (!supersessionsByNew.has(newId)) supersessionsByNew.set(newId, []);
    supersessionsByNew.get(newId).push(event);
  }

  const facts = rawFacts.map((row) => {
    const rowId = stringId(row.id);
    const supersession = supersessionByPrevious.get(rowId);
    const supersededById = stringId(row.superseded_by_fact_id) || stringId(supersession?.new_fact_id);
    const sourceObservations = stringArray(row.source_observation_ids)
      .map((observationId) => observationsById.get(observationId))
      .filter(Boolean);
    const sourceTurns = stringArray(row.source_turn_ids)
      .map((sourceTurnId) => turnsBySourceId.get(sourceTurnId))
      .filter(Boolean);
    const previousEvents = supersessionsByNew.get(rowId) || [];

    return {
      fact_key: row.fact_key,
      subject_key: row.subject_key,
      predicate: row.predicate,
      object_value: row.object_value,
      object_payload: asObject(row.object_payload),
      confidence: asNumber(row.confidence),
      review_status: row.review_status,
      valid_from: asIso(row.valid_from),
      valid_to: asIso(row.valid_to),
      is_current: Boolean(row.is_current),
      temporal_status: row.is_current ? 'current' : 'superseded',
      supersession: {
        superseded_by: factReference(rawFactsById.get(supersededById), supersession?.reason),
        supersedes: previousEvents
          .map((event) => factReference(rawFactsById.get(stringId(event.previous_fact_id)), event.reason))
          .filter(Boolean),
      },
      provenance: {
        kind: row.provenance_kind,
        observations: sourceObservations,
        source_turns: sourceTurns,
      },
    };
  });

  const factsById = new Map(rawFacts.map((row, index) => [stringId(row.id), facts[index]]));
  const summaries = asArray(rawSnapshot?.summaries).map((row) => ({
    summary_key: row.summary_key,
    summary_scope: row.summary_scope,
    text: truncate(row.summary_text, 4000),
    turn_count: Number.isInteger(row.turn_count) ? row.turn_count : Number(row.turn_count || 0),
    quality_label: row.quality_label,
    review_status: row.review_status,
    updated_at: asIso(row.updated_at),
    source_turns: stringArray(row.source_turn_ids)
      .map((sourceTurnId) => turnsBySourceId.get(sourceTurnId))
      .filter(Boolean),
  }));

  const reflections = asArray(rawSnapshot?.reflections).map((row) => ({
    reflection_key: row.reflection_key,
    reflection_scope: row.reflection_scope,
    text: truncate(row.reflection_text, 4000),
    confidence: asNumber(row.confidence),
    review_status: row.review_status,
    updated_at: asIso(row.updated_at),
    supporting_observations: stringArray(row.supporting_observation_ids)
      .map((observationId) => observationsById.get(observationId))
      .filter(Boolean),
    supporting_facts: stringArray(row.supporting_fact_ids)
      .map((factId) => factsById.get(factId))
      .filter(Boolean)
      .map((fact) => ({
        fact_key: fact.fact_key,
        predicate: fact.predicate,
        object_value: fact.object_value,
        valid_from: fact.valid_from,
        valid_to: fact.valid_to,
        is_current: fact.is_current,
      })),
  }));

  const thread = rawSnapshot.thread;
  return {
    thread: {
      thread_key: thread.thread_key,
      title: thread.title,
      scope_kind: thread.scope_kind,
      source_system: thread.source_system,
      language_code: thread.language_code,
      description: thread.description || null,
      review_status: thread.review_status || null,
      source_classification: thread.source_classification || 'public_safe',
      created_at: asIso(thread.created_at),
      updated_at: asIso(thread.updated_at),
    },
    turns,
    observations,
    facts,
    summaries,
    reflections,
    supersessionCount: asArray(rawSnapshot.supersessions).length,
  };
}

function recordText(record) {
  if (record.fact_key) {
    return compactText([
      record.predicate.replaceAll('_', ' '),
      record.object_value,
      ...record.provenance.observations.map((item) => item.text),
      ...record.provenance.source_turns.map((item) => item.text),
    ].join(' ')).toLowerCase();
  }
  return compactText([
    record.observation_kind?.replaceAll('_', ' '),
    record.text,
    ...asArray(record.source_turns).map((item) => item.text),
  ].join(' ')).toLowerCase();
}

function detectedConcepts(normalizedQuery) {
  const concepts = CONCEPTS.filter((concept) =>
    concept.queryTerms.some((term) => normalizedQuery.includes(term)),
  );
  const hasDeadline = concepts.some((concept) => concept.key === 'deadline');
  const deliveryIsOnlyModifier = hasDeadline
    && !/\b(remote|onsite|on-site|hardware|shipping|delivery model)\b/.test(normalizedQuery);
  return deliveryIsOnlyModifier
    ? concepts.filter((concept) => concept.key !== 'delivery')
    : concepts;
}

function scoreRecord(record, queryTokens, concepts) {
  const haystack = recordText(record);
  const matchedTerms = queryTokens.filter((token) => haystack.includes(token));
  let score = matchedTerms.length;

  for (const concept of concepts) {
    if (concept.recordTerms.some((term) => haystack.includes(term))) score += 4;
  }

  return { score, matchedTerms };
}

function compareRanked(left, right) {
  if (right.score !== left.score) return right.score - left.score;
  const currentDifference = Number(Boolean(right.record.is_current)) - Number(Boolean(left.record.is_current));
  if (currentDifference) return currentDifference;
  const leftKey = left.record.fact_key || left.record.observation_key || '';
  const rightKey = right.record.fact_key || right.record.observation_key || '';
  return leftKey.localeCompare(rightKey);
}

function buildAnswer(facts, observations, summaries, reflections) {
  const currentFacts = facts.filter((fact) => fact.is_current);
  const historicalFacts = facts.filter((fact) => !fact.is_current);

  if (currentFacts.length) {
    const current = currentFacts
      .map((fact) => `${fact.predicate.replaceAll('_', ' ')} is ${fact.object_value}`)
      .join('; ');
    const history = historicalFacts.length
      ? ` Retained history: ${historicalFacts
          .map((fact) => `${fact.predicate.replaceAll('_', ' ')} was ${fact.object_value} until ${fact.valid_to || 'it was superseded'}`)
          .join('; ')}.`
      : '';
    return truncate(`The current public record says ${current}.${history}`, 1800);
  }

  if (observations.length) {
    return truncate(`Grounded observations: ${observations.map((item) => item.text).join(' ')}`, 1800);
  }
  if (summaries.length) return truncate(summaries[0].text, 1800);
  if (reflections.length) return truncate(reflections[0].text, 1800);
  return 'No grounded public memory matched that query.';
}

export function retrievePublicMemory(snapshot, queryText) {
  const normalizedQuery = compactText(queryText);
  const normalizedLower = normalizedQuery.toLowerCase();
  const queryTokens = tokenize(normalizedLower);
  const concepts = detectedConcepts(normalizedLower);
  const broadQuery = BROAD_QUERY_PATTERNS.some((pattern) => pattern.test(normalizedLower));
  const wantsHistory = HISTORY_QUERY_PATTERN.test(normalizedLower);

  const rankedFacts = snapshot.facts
    .map((record) => ({ record, ...scoreRecord(record, queryTokens, concepts) }))
    .filter((item) =>
      item.score > 0
      || (broadQuery && item.record.is_current)
      || (
        wantsHistory
        && concepts.length === 0
        && (item.record.supersession.superseded_by || item.record.supersession.supersedes.length)
      )
    )
    .map((item) => ({ ...item, score: item.score || 1 }))
    .sort(compareRanked);

  const directlyMatchedPredicates = new Set(rankedFacts.map((item) => item.record.predicate));
  const factCandidates = new Map(rankedFacts.map((item) => [item.record.fact_key, item]));

  for (const fact of snapshot.facts) {
    if (directlyMatchedPredicates.has(fact.predicate) && !factCandidates.has(fact.fact_key)) {
      factCandidates.set(fact.fact_key, { record: fact, score: 1, matchedTerms: [] });
    }
  }

  const selectedFactRanks = [...factCandidates.values()].sort(compareRanked).slice(0, 10);
  const facts = selectedFactRanks.map((item) => item.record);

  const rankedObservations = snapshot.observations
    .map((record) => ({ record, ...scoreRecord(record, queryTokens, concepts) }))
    .filter((item) => item.score > 0)
    .sort(compareRanked);

  const observationCandidates = new Map();
  for (const fact of facts) {
    for (const observation of fact.provenance.observations) {
      observationCandidates.set(observation.observation_key, observation);
    }
  }
  for (const item of rankedObservations) {
    if (observationCandidates.size >= 8) break;
    observationCandidates.set(item.record.observation_key, item.record);
  }
  const observations = [...observationCandidates.values()].slice(0, 8);

  const summaries = broadQuery || SUMMARY_QUERY_PATTERN.test(normalizedLower)
    ? snapshot.summaries.slice(0, 1)
    : [];
  const reflections = broadQuery || REFLECTION_QUERY_PATTERN.test(normalizedLower)
    ? snapshot.reflections.slice(0, 1)
    : [];

  const matchedTerms = [...new Set([
    ...selectedFactRanks.flatMap((item) => item.matchedTerms),
    ...rankedObservations.slice(0, 8).flatMap((item) => item.matchedTerms),
    ...concepts.map((concept) => concept.key),
  ])].sort();
  const grounded = facts.length > 0 || observations.length > 0 || summaries.length > 0 || reflections.length > 0;
  const answer = buildAnswer(facts, observations, summaries, reflections);
  const assembledText = truncate([
    ...facts.map((fact) => `${fact.predicate.replaceAll('_', ' ')}=${fact.object_value} [${fact.temporal_status}]`),
    ...observations.map((observation) => observation.text),
    ...summaries.map((summary) => summary.text),
    ...reflections.map((reflection) => reflection.text),
  ].join(' | '), 5000);

  return {
    scope: publicScopeResponse(),
    query: normalizedQuery,
    status: grounded ? 'grounded' : 'no_grounded_memory',
    answer,
    retrieval: {
      strategy: 'postgres_deterministic_lexical',
      matched_terms: matchedTerms,
      semantic: { status: 'unavailable' },
    },
    retrieved_context: {
      facts,
      observations,
      summaries,
      reflections,
      assembled_text: assembledText,
    },
  };
}

export const EVIDENCE_TYPES = Object.freeze([
  'all',
  'thread',
  'turn',
  'observation',
  'fact',
  'summary',
  'reflection',
]);

export function buildEvidence(snapshot, type = 'all') {
  const groups = {
    thread: [snapshot.thread],
    turn: snapshot.turns,
    observation: snapshot.observations,
    fact: snapshot.facts,
    summary: snapshot.summaries,
    reflection: snapshot.reflections,
  };
  const selectedTypes = type === 'all' ? EVIDENCE_TYPES.slice(1) : [type];
  const items = selectedTypes.flatMap((itemType) =>
    groups[itemType].map((item) => ({ type: itemType, ...item })),
  );

  return {
    scope: publicScopeResponse(),
    filter: { type },
    count: items.length,
    items,
  };
}

export function createPublicMemoryService(repository, options = {}) {
  const onAuditError = options.onAuditError || (() => {});

  async function snapshot() {
    const rawSnapshot = await repository.readSnapshot();
    if (!rawSnapshot) throw publicCorpusUnavailableError();
    return buildPublicSnapshot(rawSnapshot);
  }

  return {
    async readiness() {
      const available = await repository.readiness();
      return {
        ready: available,
        checks: {
          database: 'available',
          public_corpus: available ? 'available' : 'unavailable',
        },
      };
    },

    async corpus() {
      const data = await snapshot();
      const currentFacts = data.facts.filter((fact) => fact.is_current).length;
      return {
        scope: publicScopeResponse(),
        corpus: data.thread,
        counts: {
          turns: data.turns.length,
          observations: data.observations.length,
          facts: data.facts.length,
          current_facts: currentFacts,
          superseded_facts: data.facts.length - currentFacts,
          summaries: data.summaries.length,
          reflections: data.reflections.length,
        },
        temporal_truth: {
          supersession_count: data.supersessionCount,
          has_history: data.supersessionCount > 0,
        },
        retrieval: {
          exact: { status: 'available', strategy: 'postgres_deterministic_lexical' },
          semantic: { status: 'unavailable' },
        },
        sample_queries: [
          'What changed about the budget?',
          'What is the current delivery deadline?',
          'Which tools and communication preferences are recorded?',
          'Show the evidence for the remote delivery model.',
        ],
      };
    },

    async query(queryText) {
      const data = await snapshot();
      const result = retrievePublicMemory(data, queryText);
      try {
        await repository.recordRetrieval(queryText, {
          status: result.status,
          fact_count: result.retrieved_context.facts.length,
          observation_count: result.retrieved_context.observations.length,
          summary_count: result.retrieved_context.summaries.length,
          reflection_count: result.retrieved_context.reflections.length,
        });
      } catch (error) {
        onAuditError(error);
      }
      return result;
    },

    async evidence(type) {
      return buildEvidence(await snapshot(), type);
    },
  };
}
