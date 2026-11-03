import { next } from '@vercel/functions';
import entry from './lib/integration-entry.cjs';

export function adminEntryResponse(request, env) {
  const path = new URL(request.url).pathname;
  if (!/^\/admin(?:\.html)?(?:\/|$)/.test(path)) return null;
  const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
  try {
    const destination = entry.staffLoginTarget(env);
    if (!destination) return null;
    // Discard any old login POST body and query data instead of forwarding it.
    return new Response(null, { status: 303, headers: { ...headers, Location: destination } });
  } catch {
    return new Response('통합 로그인 주소 설정을 확인해 주세요. 기존 관리자 로그인은 중지되었습니다.', { status: 503, headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}
export default function adminRouting(request) {
  return adminEntryResponse(request, process.env) || next();
}
