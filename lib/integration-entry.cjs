function staffLoginTarget(env) {
  if (env.LEGACY_INTEGRATION_ENABLED !== 'true') return null;
  // Scoped to the deployment environment; no production fallback for preview.
  const origin = new URL(env.INTEGRATION_HQ_ORIGIN || '');
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Invalid integrated application origin');
  return `${origin.origin}/staff/login`;
}
module.exports = { staffLoginTarget };
