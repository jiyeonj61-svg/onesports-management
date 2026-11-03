const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESOURCES = new Set(['areas','inspections','issues','inventories','head_office_checks']);
const MAX_RESPONSE = 12 * 1024 * 1024;
function reply(res, status, error) { res.statusCode=status; res.setHeader('Content-Type','application/json; charset=utf-8'); res.end(JSON.stringify({error})); }
function origin(value) {
  const url=new URL(value);
  if(url.protocol!=='https:' || url.username || url.password || url.pathname!=='/' || url.search || url.hash) throw new Error('origin');
  return url;
}

// This is a read-only, fixed-site public relay. It never forwards credentials,
// cookies, caller-controlled site scope, role headers or arbitrary upstream URLs.
module.exports=async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store, max-age=0');
  res.setHeader('CDN-Cache-Control','no-store');
  res.setHeader('Vercel-CDN-Cache-Control','no-store');
  res.setHeader('Pragma','no-cache');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(!['GET','HEAD'].includes(req.method)) { res.setHeader('Allow','GET, HEAD'); return reply(res,405,'읽기 전용 주소입니다.'); }
  let target;
  try {
    const production=process.env.VERCEL_ENV==='production';
    const selected=process.env[production?'API_ORIGIN_PRODUCTION':'API_ORIGIN_STAGING'];
    const other=process.env[production?'API_ORIGIN_STAGING':'API_ORIGIN_PRODUCTION'];
    if(process.env.LEGACY_INTEGRATION_ENABLED!=='true' || !UUID.test(process.env.LEGACY_SITE_ID || '') || !selected) throw new Error('configuration');
    target=origin(selected);
    if(other && origin(other).origin===target.origin) throw new Error('environment separation');
  } catch { return reply(res,503,'기존 단지의 통합 연결 설정을 확인해 주세요.'); }
  const query=new URL(req.url || '/', 'https://local.invalid').searchParams;
  const allowed=['resource','start','end','search','status','limit','offset','recordId','photoIndex','fileId'];
  if([...query.keys()].some(key=>!allowed.includes(key) || query.getAll(key).length!==1)) return reply(res,400,'조회 조건을 확인해 주세요.');
  const resource=query.get('resource');
  if(!RESOURCES.has(resource)) return reply(res,400,'관리 기능을 확인해 주세요.');
  const photo=query.has('recordId') || query.has('photoIndex') || query.has('fileId');
  target.pathname=`/api/integration/public/sites/${process.env.LEGACY_SITE_ID}/${resource}`;
  if(photo) {
    const legacy=query.has('photoIndex'),file=query.has('fileId');
    if(resource==='areas' || !UUID.test(query.get('recordId')||'') || legacy===file || (legacy&&!/^\d{1,2}$/.test(query.get('photoIndex')||'')) || (file&&!/^[a-f0-9]{64}$/.test(query.get('fileId')||'')) || [...query.keys()].some(key=>!['resource','recordId','photoIndex','fileId'].includes(key))) return reply(res,400,'사진 정보를 확인해 주세요.');
    target.pathname+=file?`/${query.get('recordId')}/files/${query.get('fileId')}`:`/${query.get('recordId')}/photos/${query.get('photoIndex')}`;
  } else {
    for(const key of ['start','end','search','status','limit','offset']) if(query.has(key))target.searchParams.set(key,query.get(key));
  }
  try {
    const upstream=await fetch(target,{method:'GET',headers:{Accept:photo?'image/jpeg,image/png,image/webp,image/gif':'application/json'},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});
    if(!upstream.ok) return reply(res,[400,403,404].includes(upstream.status)?upstream.status:502,'관리현황을 불러오지 못했습니다.');
    const mime=(upstream.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
    if(photo?!(query.has('fileId')?['image/jpeg','image/png','image/webp']:['image/jpeg','image/png','image/webp','image/gif']).includes(mime):mime!=='application/json') return reply(res,502,'응답 형식을 확인하지 못했습니다.');
    if(Number(upstream.headers.get('content-length')||0)>MAX_RESPONSE) return reply(res,502,'응답 크기를 확인해 주세요.');
    let size=0; const chunks=[];
    for await(const chunk of upstream.body) { size+=chunk.length; if(size>MAX_RESPONSE) throw new Error('oversize'); chunks.push(Buffer.from(chunk)); }
    res.statusCode=200;res.setHeader('Content-Type',photo?mime:'application/json; charset=utf-8');
    if(photo)res.setHeader('Content-Disposition','inline');
    res.end(req.method==='HEAD'?undefined:Buffer.concat(chunks));
  } catch { return reply(res,502,'관리현황 서버에 연결할 수 없습니다. 잠시 후 새로고침해 주세요.'); }
};
