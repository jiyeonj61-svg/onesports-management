import EmbeddedPostgres from 'embedded-postgres';
import path from 'node:path';
import fs from 'node:fs/promises';

export async function testDatabase() {
  const directory = path.resolve('work', `pg-test-${Date.now()}`);
  await fs.mkdir(directory, { recursive: true });
  const server = new EmbeddedPostgres({
    databaseDir: directory, user: 'postgres', password: 'local-test-only',
    port: 55439, persistent: true, initdbFlags: ['--encoding=UTF8', '--locale=C'],
    postgresFlags: ['-c', 'listen_addresses=127.0.0.1'],
    onLog: () => {}, onError: message => { if (/fatal|error/i.test(String(message))) console.error(String(message)); },
  });
  await server.initialise();
  await server.start();
  const client = server.getPgClient('postgres');
  await client.connect();
  await client.query(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA extensions;
    CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
    CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb default '{}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    GRANT USAGE ON SCHEMA auth,storage TO anon,authenticated;
    CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);
    CREATE TABLE storage.objects(id uuid PRIMARY KEY default gen_random_uuid(),bucket_id text REFERENCES storage.buckets(id),name text,owner uuid,owner_id text,metadata jsonb,created_at timestamptz default now());
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO anon,authenticated;
    CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
    CREATE FUNCTION storage.extension(name text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT regexp_replace(name,'^.*\\.','') $$;
    CREATE TABLE public.app_admins(user_id uuid PRIMARY KEY REFERENCES auth.users(id),display_name text NOT NULL,active boolean default true,created_at timestamptz default now());
    ALTER TABLE public.app_admins ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION public.is_app_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM public.app_admins WHERE user_id=auth.uid() AND active) $$;
    GRANT EXECUTE ON FUNCTION public.is_app_admin() TO anon,authenticated;
    GRANT USAGE ON SCHEMA public TO anon,authenticated;
  `);
  return { server,client, async close(){await client.end();await server.stop();},directory };
}

if (process.argv[1]?.endsWith('db-harness.mjs')) {
  const db = await testDatabase();
  console.log((await db.client.query('select version()')).rows[0].version);
  await db.close();
}
