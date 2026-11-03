import {residentArguments,relayResidentPhoto} from './resident-service.js';

const resources = new Set(['areas', 'inspections', 'issues', 'inventories', 'head_office_checks']);
const actions = new Set(['list', 'get', 'public_list', 'summary', 'create', 'update']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
const decode = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

// Authenticates the trusted Worker, not a browser-provided actor/site header.
// The service key stays in Supabase's built-in Edge Function environment.
export function createHandler({ supabaseUrl, serviceKey, publicKey, environment, fetcher = fetch, now = Date.now }) {
  const origin = new URL(supabaseUrl).origin;
  const projectRef = new URL(origin).hostname.split('.')[0];
  const key = crypto.subtle.importKey('jwk', publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const headers = { 'Content-Type': 'application/json', apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const request = (path, init = {}) => fetcher(origin + path, { ...init, redirect: 'error', signal: AbortSignal.timeout(10000) });
  const rpc = (siteId, resource, action, payload) => request('/rest/v1/rpc/integration_operations', { method: 'POST', headers, body: JSON.stringify({ p_site_id: siteId, p_resource: resource, p_action: action, p_payload: payload }) });
  return async req => {
    try {
      if (req.method !== 'POST') return json({ code: 'method_not_allowed' }, 405);
      const raw = await req.text();
      if (raw.length > 1050000) return json({ code: 'too_large' }, 413);
      const outer = JSON.parse(raw);
      if (typeof outer.message !== 'string' || typeof outer.signature !== 'string' || outer.signature.length > 128) return json({ code: 'unauthorized' }, 401);
      if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, await key, decode(outer.signature), new TextEncoder().encode(outer.message))) return json({ code: 'unauthorized' }, 401);
      const msg = JSON.parse(outer.message), current = now();
      if (msg.version !== 1 || msg.projectRef !== projectRef || msg.environment !== environment || !Number.isSafeInteger(msg.issuedAt) || !Number.isSafeInteger(msg.expiresAt) || msg.issuedAt > current + 5000 || msg.expiresAt < current || msg.expiresAt - msg.issuedAt > 60000 || msg.expiresAt <= msg.issuedAt || !uuid.test(msg.nonce || '')) return json({ code: 'unauthorized' }, 401);
      const p = msg.payload;
      if (!p || typeof p !== 'object' || Array.isArray(p)) return json({ code: 'invalid_request' }, 400);
      if (msg.action === 'health') return json({ ok: true, projectRef, environment });
      if (msg.action === 'legacyIdentity') {
        if (typeof p.accessToken !== 'string' || p.accessToken.length > 8192 || p.accessToken.length < 20) return json({ code: 'unauthorized' }, 401);
        const identity = await request('/auth/v1/user', { headers: { apikey: serviceKey, Authorization: `Bearer ${p.accessToken}` } });
        if (!identity.ok) return json({ code: 'unauthorized' }, 401);
        const user = await identity.json();
        if (!uuid.test(user.id || '')) return json({ code: 'unauthorized' }, 401);
        const admins = await request(`/rest/v1/app_admins?select=user_id,active&user_id=eq.${user.id}&active=eq.true&limit=1`, { headers });
        if (!admins.ok || !(await admins.json()).some(a => a.user_id === user.id && a.active === true)) return json({ code: 'forbidden' }, 403);
        return json({ id: user.id, email: user.email });
      }
      if (msg.action === 'residentService') {
        const args=residentArguments(p);
        if(!args)return json({code:'invalid_request'},400);
        const response=await request('/rest/v1/rpc/osi_staff_resident_service',{method:'POST',headers,body:JSON.stringify(args)});
        const data=await response.json();
        return json(response.ok?await relayResidentPhoto(p,data,request,headers):{code:data.code||'storage_error'},response.status);
      }
      if (!uuid.test(p.siteId || '') || !resources.has(p.resource)) return json({ code: 'invalid_request' }, 400);
      if (msg.action === 'rpc') {
        if (!actions.has(p.action) || !p.payload || typeof p.payload !== 'object' || Array.isArray(p.payload)) return json({ code: 'invalid_request' }, 400);
        const response = await rpc(p.siteId, p.resource, p.action, p.payload);
        const data = await response.json();
        // PostgreSQL detail/message may contain data. Only expose a machine code on failure.
        return json(response.ok ? data : { code: data.code || 'storage_error' }, response.status);
      }
      if (msg.action === 'legacyPhoto') {
        if (typeof p.recordId !== 'string' || !Number.isInteger(p.index) || p.index < 0 || p.index > 99 || typeof p.publicOnly !== 'boolean') return json({ code: 'invalid_request' }, 400);
        const record = await rpc(p.siteId, p.resource, 'get', { id: p.recordId });
        if (!record.ok) return json({ code: 'P0002' }, 404);
        const { item } = await record.json();
        if (!item?.integration_legacy_record || (p.publicOnly && item.is_public !== true)) return json({ code: 'P0002' }, 404);
        const path = item.photo_paths?.[p.index];
        if (typeof path !== 'string' || path.length > 1024 || path.includes('\\') || path.split('/').some(s => !s || s === '.' || s === '..') || /[\x00-\x1f]/.test(path)) return json({ code: 'P0002' }, 404);
        const object = await request('/storage/v1/object/authenticated/management-photos/' + path.split('/').map(encodeURIComponent).join('/'), { headers });
        if (!object.ok) return json({ code: 'P0002' }, 404);
        const type = object.headers.get('content-type')?.split(';')[0];
        if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'].includes(type)) return json({ code: 'unsupported_media' }, 415);
        if (Number(object.headers.get('content-length') || 0) > 20 * 1024 * 1024) return json({ code: 'too_large' }, 413);
        return new Response(object.body, { headers: { 'Content-Type': type, 'Content-Disposition': 'attachment', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
      }
      return json({ code: 'invalid_request' }, 400);
    } catch { return json({ code: 'gateway_unavailable' }, 503); }
  };
}
