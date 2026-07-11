const STOP_WORDS = new Set([
  'a', 'about', 'after', 'all', 'an', 'and', 'are', 'as', 'at', 'be', 'before',
  'by', 'can', 'do', 'for', 'from', 'get', 'help', 'how', 'i', 'in', 'is', 'it',
  'me', 'my', 'new', 'of', 'on', 'or', 'our', 'please', 'the', 'this', 'to',
  'use', 'we', 'what', 'when', 'where', 'which', 'who', 'why', 'with', 'you',
]);

const TOKEN_ALIASES = Object.freeze({
  prospect: ['lead'],
  prospects: ['lead'],
  contacting: ['outreach'],
  contact: ['outreach'],
  outreach: ['contacting'],
  website: ['site'],
  site: ['website'],
  webpage: ['website'],
  handover: ['handoff'],
  handoff: ['handover'],
  onboarding: ['onboard'],
  onboard: ['onboarding'],
  provisioning: ['onboard'],
  provision: ['onboard'],
  meeting: ['call'],
  call: ['meeting'],
  scoring: ['score'],
  score: ['scoring'],
  safety: ['safe'],
  safe: ['safety'],
  publishing: ['release'],
  publish: ['release'],
  release: ['publish'],
});

export const CAPABILITY_TASK_ALIASES = Object.freeze({
  new_b2b_lead_intake: [
    'lead research',
    'b2b lead research',
    'pre outreach research brief',
    'prospect research brief',
    'nghien cuu khach hang tiem nang b2b',
  ],
  sales_call_follow_up: [
    'sales call follow up',
    'meeting outcome follow up',
    'zoom call scoring',
    'theo doi sau cuoc goi ban hang',
  ],
  website_delivery_handoff: [
    'website delivery handoff',
    'website design to build handoff',
    'portfolio site delivery',
    'ban giao trien khai website',
  ],
  public_demo_release: [
    'public safe demo',
    'public product demo',
    'safe demo release',
    'phat hanh ban demo cong khai an toan',
  ],
  ai_workspace_onboarding: [
    'ai workspace onboarding',
    'onboard ai workspace user',
    'provision ai workspace',
    'huong dan nguoi dung moi vao khong gian lam viec ai',
  ],
});

const TYPE_ORDER = new Map([
  ['prompt', 1],
  ['workflow', 2],
  ['agent', 3],
  ['decision_pattern', 4],
  ['best_practice', 5],
]);

function foldDiacritics(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replaceAll('đ', 'd')
    .replaceAll('Đ', 'D');
}

export function normalizeCapabilityText(value) {
  return foldDiacritics(String(value || '').normalize('NFKC'))
    .toLowerCase()
    .replace(/[_:/-]+/g, ' ')
    .replace(/[^\p{L}\p{N}+#.]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function rawTokens(value) {
  return normalizeCapabilityText(value)
    .split(' ')
    .filter((token) => token.length >= 2 && token.length <= 40);
}

function tokenSet(value) {
  return new Set(rawTokens(value));
}

export function normalizeCapabilityQuery(value) {
  const normalized = normalizeCapabilityText(value);
  const seen = new Set();
  const groups = [];
  for (const token of rawTokens(normalized)) {
    if (STOP_WORDS.has(token) || seen.has(token)) continue;
    seen.add(token);
    const terms = [...new Set([token, ...(TOKEN_ALIASES[token] || [])])];
    groups.push({ token, terms });
    if (groups.length >= 24) break;
  }
  return { normalized, groups };
}

function documentFields(entries) {
  return entries.map(([name, weight, value]) => ({ name, weight, tokens: tokenSet(value) }));
}

function scoreFields(groups, fields) {
  const matches = [];
  const matchedFields = new Set();
  const appliedAliases = [];
  let score = 0;
  for (const group of groups) {
    let best = 0;
    let aliasUsed = null;
    for (const field of fields) {
      const matchingTerm = group.terms.find((term) => field.tokens.has(term));
      if (!matchingTerm) continue;
      if (field.weight > best) {
        best = field.weight;
        aliasUsed = matchingTerm === group.token ? null : matchingTerm;
      }
      matchedFields.add(field.name);
    }
    if (best > 0) {
      score += best;
      matches.push(group.token);
      if (aliasUsed) appliedAliases.push({ from: group.token, to: aliasUsed });
    }
  }
  return {
    score,
    matched_terms: matches,
    matched_fields: [...matchedFields].sort(),
    applied_aliases: appliedAliases,
    coverage: groups.length ? matches.length / groups.length : 0,
  };
}

function containsPhrase(normalizedQuery, phrase) {
  const normalizedPhrase = normalizeCapabilityText(phrase);
  return normalizedPhrase.split(' ').length >= 2
    && (` ${normalizedQuery} `).includes(` ${normalizedPhrase} `);
}

function identityFrequency(assets, tasks) {
  const counts = new Map();
  const addDocument = (values) => {
    const tokens = new Set(values.flatMap((value) => [...tokenSet(value)]));
    for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
  };
  for (const asset of assets) addDocument([asset.asset_key, asset.title, asset.asset_type, asset.capability_area]);
  for (const task of tasks) addDocument([task.task_key, task.task_title, ...(task.aliases || [])]);
  return counts;
}

function eligible(candidate, groups, frequencies) {
  if (candidate.exact || candidate.phrase_match) return true;
  if (candidate.score >= 20 && candidate.matched_terms.length >= 2 && candidate.coverage >= 0.4) return true;
  if (groups.length !== 1 || candidate.score < 14 || !candidate.matched_fields.includes('identity')) return false;
  const group = groups[0];
  return group.token.length >= 6
    && Math.min(...group.terms.map((term) => frequencies.get(term) || Number.POSITIVE_INFINITY)) <= 2;
}

function taskCandidate(task, normalizedQuery, groups, consumerRole) {
  const aliases = CAPABILITY_TASK_ALIASES[task.task_key] || [];
  const scored = scoreFields(groups, documentFields([
    ['identity', 14, `${task.task_key} ${task.task_title}`],
    ['alias', 12, aliases.join(' ')],
    ['reason', 6, task.reason],
  ]));
  const exact = [task.task_key, task.task_title, ...aliases]
    .some((value) => normalizeCapabilityText(value) === normalizedQuery);
  const phraseMatch = aliases.some((alias) => containsPhrase(normalizedQuery, alias));
  const roleMatch = Boolean(consumerRole) && task.assets.some((asset) =>
    Array.isArray(asset.governance?.consumer_roles)
      && asset.governance.consumer_roles.includes(consumerRole));
  return {
    ...scored,
    score: scored.score + (exact ? 100 : phraseMatch ? 40 : 0) + (roleMatch ? 3 : 0),
    exact,
    phrase_match: phraseMatch,
    role_match: roleMatch,
    task,
  };
}

function assetCandidate(asset, normalizedQuery, groups, consumerRole) {
  const governance = asset.governance || {};
  const content = asset.content || {};
  const scored = scoreFields(groups, documentFields([
    ['identity', 14, `${asset.asset_key} ${asset.title}`],
    ['classification', 10, `${asset.asset_type} ${asset.capability_area}`],
    ['content', 8, content.search_text || JSON.stringify(content.body || {})],
    ['problem', 6, asset.problem_solved],
    ['summary', 5, asset.summary],
    ['why', 4, asset.why_it_worked],
    ['consumer_role', 3, (governance.consumer_roles || []).join(' ')],
    ['owner_role', 2, governance.owner_role],
    ['usage', 1, (asset.used_successfully_in || []).join(' ')],
  ]));
  const exact = [asset.asset_key, asset.title]
    .some((value) => normalizeCapabilityText(value) === normalizedQuery);
  const roleMatch = Boolean(consumerRole)
    && Array.isArray(governance.consumer_roles)
    && governance.consumer_roles.includes(consumerRole);
  return {
    ...scored,
    score: scored.score + (exact ? 100 : 0) + (roleMatch ? 3 : 0),
    exact,
    phrase_match: false,
    role_match: roleMatch,
    asset,
  };
}

function reviewOrder(candidate) {
  const status = candidate.asset?.governance?.review_status;
  return status === 'approved' ? 1 : status === 'reviewed' ? 2 : status === 'draft' ? 3 : 4;
}

function compareCandidates(left, right) {
  if (right.score !== left.score) return right.score - left.score;
  if (right.coverage !== left.coverage) return right.coverage - left.coverage;
  if (right.matched_terms.length !== left.matched_terms.length) {
    return right.matched_terms.length - left.matched_terms.length;
  }
  if (reviewOrder(left) !== reviewOrder(right)) return reviewOrder(left) - reviewOrder(right);
  const leftType = TYPE_ORDER.get(left.asset?.asset_type) || 99;
  const rightType = TYPE_ORDER.get(right.asset?.asset_type) || 99;
  if (leftType !== rightType) return leftType - rightType;
  const leftKey = left.task?.task_key || left.asset?.asset_key || '';
  const rightKey = right.task?.task_key || right.asset?.asset_key || '';
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function closeScores(candidates) {
  if (candidates.length < 2 || candidates[0].exact) return false;
  const [first, second] = candidates;
  return first.score - second.score <= 4 && first.score < second.score * 1.2;
}

export function searchCapabilityCatalog({ query, consumerRole = null, assets = [], tasks = [] }) {
  const { normalized, groups } = normalizeCapabilityQuery(query);
  const normalizedRole = consumerRole ? normalizeCapabilityText(consumerRole).replaceAll(' ', '_') : null;
  const normalizedTasks = tasks.map((task) => ({
    ...task,
    aliases: CAPABILITY_TASK_ALIASES[task.task_key] || [],
  }));
  const frequencies = identityFrequency(assets, normalizedTasks);
  const taskCandidates = normalizedTasks
    .map((task) => taskCandidate(task, normalized, groups, normalizedRole))
    .filter((candidate) => eligible(candidate, groups, frequencies))
    .sort(compareCandidates);
  const assetCandidates = assets
    .filter((asset) => !['draft', 'deprecated'].includes(asset.governance?.review_status))
    .map((asset) => assetCandidate(asset, normalized, groups, normalizedRole))
    .filter((candidate) => eligible(candidate, groups, frequencies))
    .sort(compareCandidates);
  const assetToTasks = new Map();
  for (const task of normalizedTasks) {
    for (const asset of task.assets) {
      if (!assetToTasks.has(asset.asset_key)) assetToTasks.set(asset.asset_key, []);
      assetToTasks.get(asset.asset_key).push(task.task_key);
    }
  }

  let status = 'no_match';
  let resolution = { kind: 'none', reason: groups.length ? 'below_threshold' : 'no_search_terms' };
  const exactAsset = assetCandidates.find((candidate) => candidate.exact);
  const exactTask = taskCandidates.find((candidate) => candidate.exact);
  if (exactAsset && !exactTask) {
    status = 'matched';
    resolution = {
      kind: 'asset',
      reason: 'exact_asset_match',
      selected_asset_key: exactAsset.asset.asset_key,
      related_task_keys: assetToTasks.get(exactAsset.asset.asset_key) || [],
    };
  } else if (closeScores(taskCandidates)) {
    status = 'ambiguous';
    resolution = { kind: 'ambiguous', reason: 'close_task_scores' };
  } else if (taskCandidates.length) {
    status = 'matched';
    resolution = {
      kind: 'task',
      reason: taskCandidates[0].exact ? 'exact_task_match' : 'lexical_task_match',
      selected_task_key: taskCandidates[0].task.task_key,
    };
  } else if (closeScores(assetCandidates)) {
    status = 'ambiguous';
    resolution = { kind: 'ambiguous', reason: 'close_asset_scores' };
  } else if (assetCandidates.length) {
    const assetKey = assetCandidates[0].asset.asset_key;
    const relatedTaskKeys = assetToTasks.get(assetKey) || [];
    if (!assetCandidates[0].exact && relatedTaskKeys.length === 1) {
      status = 'matched';
      resolution = {
        kind: 'task',
        reason: 'unique_asset_to_task',
        selected_task_key: relatedTaskKeys[0],
        matched_asset_key: assetKey,
      };
    } else {
      status = 'matched';
      resolution = {
        kind: 'asset',
        reason: 'lexical_asset_match',
        selected_asset_key: assetKey,
        related_task_keys: relatedTaskKeys,
      };
    }
  }

  return {
    normalized,
    consumer_role: normalizedRole,
    status,
    resolution,
    task_candidates: taskCandidates.slice(0, 5),
    asset_candidates: assetCandidates.slice(0, 5),
    applied_aliases: [...new Map(
      [...taskCandidates, ...assetCandidates]
        .flatMap((candidate) => candidate.applied_aliases)
        .map((alias) => [`${alias.from}:${alias.to}`, alias]),
    ).values()].sort((left, right) => `${left.from}:${left.to}`.localeCompare(`${right.from}:${right.to}`)),
  };
}
