const RESOURCES='(?:areas|inspections|issues|inventories|head_office_checks)';
const ID='(?:[0-9]+|[0-9a-fA-F-]{36})';
const FILE_ID='(?:[a-f0-9]{64}|[0-9a-fA-F-]{36})';
const READ=new RegExp(`^(?:session|operations/${RESOURCES}(?:/${ID})?|summary|files(?:/${FILE_ID}/download)?|legacy-files(?:/${RESOURCES}/${ID}/[0-9]{1,2}/download)?)$`);
const WRITE=new RegExp(`^(?:operations/${RESOURCES}(?:/${ID})?|files)$`);
function fail(res,status,message){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify({error:message}));}
function configured(value){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw new Error('origin');return u;}
module.exports=async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store, max-age=0');res.setHeader('X-Content-Type-Options','nosniff');
 if(!['GET','POST','PATCH'].includes(req.method))return fail(res,405,'이 작업은 허용되지 않습니다.');
 let target;
 try{
  if(process.env.LEGACY_INTEGRATION_ENABLED!=='true')throw new Error('disabled');
  const production=process.env.VERCEL_ENV==='production',selected=process.env[production?'API_ORIGIN_PRODUCTION':'API_ORIGIN_STAGING'],other=process.env[production?'API_ORIGIN_STAGING':'API_ORIGIN_PRODUCTION'];
  if(!selected)throw new Error('missing');target=configured(selected);if(other&&configured(other).origin===target.origin)throw new Error('isolation');
 }catch{return fail(res,503,'기존 관리자 통합 연결 설정을 확인해 주세요.');}
 const q=new URL(req.url||'/','https://local.invalid').searchParams,path=q.get('path')||'';
 if(!(req.method==='GET'?READ:WRITE).test(path)||[...q.keys()].some(k=>!['path','start','end','search','status','limit','offset','resource','recordId'].includes(k)||q.getAll(k).length!==1))return fail(res,400,'요청 경로를 확인해 주세요.');
 const auth=req.headers.authorization;
 if(typeof auth!=='string'||!/^Bearer [A-Za-z0-9_.-]+$/.test(auth)||auth.length>12000)return fail(res,401,'기존 관리자 로그인이 필요합니다.');
 const local=process.env.VERCEL_ENV!=='production'&&/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host||'');
 if(req.method!=='GET'&&(!String(req.headers['content-type']||'').startsWith('application/json')||req.headers.origin!==`${local?'http':'https'}://${req.headers.host}`))return fail(res,403,'요청 출처를 확인해 주세요.');
 target.pathname=`/api/integration/legacy/${path}`;
 for(const [k,v]of q)if(k!=='path')target.searchParams.set(k,v);
 try{
  let size=0;const chunks=[];
  for await(const chunk of req){const bytes=Buffer.from(chunk);size+=bytes.length;if(size>1024*1024)return fail(res,413,'요청 용량을 줄여 주세요.');chunks.push(bytes);}
  const headers={Authorization:auth,Accept:'application/json,image/jpeg,image/png,image/webp,image/gif,application/pdf'};
  if(req.headers.origin)headers.Origin=req.headers.origin;
  if(req.method!=='GET')headers['Content-Type']='application/json';
  const upstream=await fetch(target,{method:req.method,headers,body:req.method==='GET'?undefined:Buffer.concat(chunks),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(25000)});
  const response=[];size=0;for await(const part of upstream.body){size+=part.length;if(size>12*1024*1024)throw new Error('response size');response.push(Buffer.from(part));}
  res.statusCode=upstream.status;
  for(const k of ['content-type','content-disposition','retry-after']){const v=upstream.headers.get(k);if(v)res.setHeader(k,v);}
  res.end(Buffer.concat(response));
 }catch{return fail(res,502,'관리 서버에 연결할 수 없습니다. 저장 상태를 확인한 뒤 같은 내용으로 재시도해 주세요.');}
};
