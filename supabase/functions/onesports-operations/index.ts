import { createHandler } from './handler.js';
import config from './public-key.json' with { type: 'json' };

Deno.serve(createHandler({
  supabaseUrl: Deno.env.get('SUPABASE_URL')!,
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  publicKey: config.publicKey,
  environment: config.environment,
}));
