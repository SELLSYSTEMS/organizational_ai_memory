function searchableText(principal = {}) {
  return `${principal.display_name || ''} ${principal.principal_key || ''}`.toLowerCase();
}

export function isProofFixture(record = {}) {
  const value = [
    record.display_name,
    record.principal_key,
    record.title,
    record.candidate_key,
    record.original_name,
  ].filter(Boolean).join(' ').toLowerCase();
  return value.includes('identity proof') || value.includes('proofisolated');
}

export function isOperationalPrincipal(principal = {}) {
  return !isProofFixture(principal) && ['active', 'draft'].includes(principal.status);
}

export function filterPrincipals(principals = [], filter = 'operational', search = '') {
  const query = String(search || '').trim().toLowerCase();
  return principals.filter((principal) => {
    const operational = isOperationalPrincipal(principal);
    const matchesFilter = filter === 'all'
      || (filter === 'operational' && operational)
      || (filter === 'human' && operational && principal.principal_kind === 'human')
      || (filter === 'agent' && operational && principal.principal_kind === 'agent')
      || (filter === 'suspended' && principal.status === 'suspended')
      || (filter === 'proof_fixtures' && isProofFixture(principal));
    return matchesFilter && (!query || searchableText(principal).includes(query));
  });
}

export function principalFilterCounts(principals = []) {
  const operational = principals.filter(isOperationalPrincipal);
  return {
    operational: operational.length,
    human: operational.filter((principal) => principal.principal_kind === 'human').length,
    agent: operational.filter((principal) => principal.principal_kind === 'agent').length,
    all: principals.length,
    suspended: principals.filter((principal) => principal.status === 'suspended').length,
    proof_fixtures: principals.filter(isProofFixture).length,
  };
}
