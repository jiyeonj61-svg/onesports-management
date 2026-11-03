const RESOURCES = new Set(['areas','inspections','issues','inventories','head_office_checks']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PREFIX = '/api/integration-public';

export function integrationSettings(config) {
  if (!config?.enabled) return { enabled: false };
  if (!UUID.test(config.siteId || '')) throw new Error('기존 단지 연결 설정을 확인해 주세요.');
  let origin;
  try { origin = new URL(config.hqOrigin); } catch { throw new Error('통합 업무 화면 주소를 확인해 주세요.'); }
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('통합 업무 화면 주소를 확인해 주세요.');
  return { enabled: true, siteId: config.siteId, hqUrl: `${origin.origin}/hq/sites/${config.siteId}`, staffUrl: `${origin.origin}/staff/login` };
}

export function createPublicIntegrationAdapter(config, fetcher = fetch) {
  const settings = integrationSettings(config);
  if (!settings.enabled) return null;
  return {
    settings,
    async list(resource, filters = {}) {
      if (!RESOURCES.has(resource)) throw new Error('지원하지 않는 관리 기능입니다.');
      const collected = []; let offset = 0; let previousTotal = null;
      for (;;) {
        const query = new URLSearchParams({ resource, limit: '200', offset: String(offset) });
        for (const key of ['start','end','search','status']) if (filters[key]) query.set(key,String(filters[key]));
        const response = await fetcher(`${PREFIX}?${query}`, { cache:'no-store', credentials:'omit', redirect:'error', signal:AbortSignal.timeout(25000) });
        const body = await response.json().catch(() => null);
        if (!response.ok || !body || body.ok !== true || !Array.isArray(body.items) || !Number.isSafeInteger(body.total) || body.total < 0) {
          throw new Error(response.status === 404 ? '이 단지의 공개 열람이 현재 제공되지 않습니다.' : '관리현황을 불러오지 못했습니다. 잠시 후 새로고침해 주세요.');
        }
        if (previousTotal !== null && previousTotal !== body.total) throw new Error('조회 중 기록이 변경되었습니다. 새로고침해 주세요.');
        previousTotal = body.total;
        for (const row of body.items) {
          if (!row || typeof row !== 'object' || row.id === undefined) throw new Error('관리현황 응답을 확인하지 못했습니다.');
          const count = Number(row.legacy_photo_count || 0);
          if (!Number.isSafeInteger(count) || count < 0 || count > 100) throw new Error('사진 연결 정보를 확인하지 못했습니다.');
          const photo_paths = Array.from({ length: count }, (_, index) => `${PREFIX}?${new URLSearchParams({ resource, recordId:String(row.id), photoIndex:String(index) })}`);
          const files=row.photo_file_ids===undefined?[]:row.photo_file_ids;
          if(!Array.isArray(files)||files.some(id=>typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))||new Set(files).size!==files.length)throw new Error('사진 연결 정보를 확인하지 못했습니다.');
          for(const fileId of files)photo_paths.push(`${PREFIX}?${new URLSearchParams({resource,recordId:String(row.id),fileId})}`);
          collected.push({ ...row, photo_paths });
        }
        offset += body.items.length;
        if (offset >= body.total) break;
        if (!body.items.length || offset > 100000) throw new Error('전체 기록을 불러오지 못했습니다. 조회 기간을 줄여 주세요.');
      }
      if (collected.length !== previousTotal || new Set(collected.map(row => String(row.id))).size !== collected.length) throw new Error('조회 중 기록이 변경되었습니다. 새로고침해 주세요.');
      return collected;
    },
    photoUrl(value) {
      if (typeof value !== 'string' || !value.startsWith(`${PREFIX}?`)) return '';
      const url = new URL(value,'https://local.invalid');
      const allowed = ['resource','recordId','photoIndex','fileId'];
      const legacy=url.searchParams.has('photoIndex'),file=url.searchParams.has('fileId');
      if ([...url.searchParams.keys()].some(key=>!allowed.includes(key)||url.searchParams.getAll(key).length!==1) || !RESOURCES.has(url.searchParams.get('resource')) || url.searchParams.get('resource')==='areas' || !UUID.test(url.searchParams.get('recordId') || '') || legacy===file || (legacy&&!/^\d{1,2}$/.test(url.searchParams.get('photoIndex')||'')) || (file&&!/^[a-f0-9]{64}$/.test(url.searchParams.get('fileId')||''))) return '';
      return url.pathname + url.search;
    },
  };
}
