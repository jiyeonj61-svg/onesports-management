import { integrationSettings } from './integration-public.js';

export async function redirectLegacyAdmin(fetcher = fetch, redirect = url => location.replace(url)) {
  const response = await fetcher('/api/config', { cache: 'no-store', credentials: 'omit', redirect: 'error' });
  const config = await response.json().catch(() => null);
  if (!response.ok || typeof config?.integration?.enabled !== 'boolean') throw new Error('로그인 연결 설정을 확인하지 못했습니다. 새로고침해 주세요.');
  const integration = integrationSettings(config.integration);
  if (!integration.enabled) return false;
  redirect(integration.staffUrl);
  return true;
}
