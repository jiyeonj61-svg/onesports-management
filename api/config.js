module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabasePublishableKey:
      process.env.SUPABASE_PUBLISHABLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      '',
    integration: {
      enabled: process.env.LEGACY_INTEGRATION_ENABLED === 'true',
      siteId: process.env.LEGACY_SITE_ID || '',
      hqOrigin: process.env.INTEGRATION_HQ_ORIGIN || '',
    },
  });
};
