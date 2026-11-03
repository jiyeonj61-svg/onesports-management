const RESOURCES=new Set(['areas','inspections','issues','inventories','head_office_checks']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FILE_ID=/^(?:[a-f0-9]{64}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
export function createLegacyIntegrationAdapter(getToken,fetcher=fetch){
 const records=new Map(),requestKeys=new Map(),savedWrites=new Map(),pending=new Map(),urls=new Map();let generation=0;
 async function request(path,{method='GET',body,query={},binary=false}={}){
  const current=generation,token=await getToken();if(!token)throw new Error('관리자 로그인이 필요합니다.');
  const params=new URLSearchParams({path});for(const[k,v]of Object.entries(query))if(v!==undefined&&v!==null&&v!=='')params.set(k,String(v));
  const response=await fetcher(`/api/integration-legacy?${params}`,{method,headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store',credentials:'omit',redirect:'error'});
  if(current!==generation)throw new Error('로그인 상태가 변경되었습니다.');
  if(!response.ok){const result=await response.json().catch(()=>null);throw new Error(result?.error||'단지 관리 요청에 실패했습니다.');}
  if(binary){const mime=(response.headers.get('Content-Type')||'').split(';')[0];if(!['image/jpeg','image/png','image/webp','image/gif','application/pdf'].includes(mime))throw new Error('첨부파일 형식을 확인해 주세요.');return response.blob();}
  const result=await response.json();if(current!==generation)throw new Error('로그인 상태가 변경되었습니다.');if(result?.ok===false)throw new Error(result.error||'단지 관리 요청에 실패했습니다.');return result;
 }
 function decorated(resource,row){
  records.set(`${resource}:${row.id}`,row);
  const paths=Array.isArray(row.photo_paths)&&row.integration_legacy_record?row.photo_paths:[];
  return {...row,photo_paths:paths.map((_,index)=>`legacy:${resource}:${row.id}:${index}`)};
 }
 async function list(resource,filters={}){
  if(!RESOURCES.has(resource))throw new Error('지원하지 않는 관리 기능입니다.');
  const current=generation,items=[];let total=null,offset=0;
  do{
   const page=await request(`operations/${resource}`,{query:{...filters,limit:200,offset}});
   if(current!==generation)throw new Error('로그인 상태가 변경되었습니다.');
   if(!Array.isArray(page.items)||!Number.isSafeInteger(page.total)||page.total<0)throw new Error('관리현황 응답을 확인하지 못했습니다.');
   if(total!==null&&total!==page.total)throw new Error('조회 중 기록이 변경되었습니다. 새로고침해 주세요.');total=page.total;
   items.push(...page.items.map(row=>decorated(resource,row)));offset+=page.items.length;
   if(offset<total&&(!page.items.length||offset>100000))throw new Error('전체 기록을 불러오지 못했습니다. 조회 기간을 줄여 주세요.');
  }while(offset<total);
  if(items.length!==total||new Set(items.map(r=>String(r.id))).size!==items.length)throw new Error('조회 중 기록이 변경되었습니다. 새로고침해 주세요.');
  return items;
 }
 async function save(resource,payload){
  if(!RESOURCES.has(resource))throw new Error('지원하지 않는 관리 기능입니다.');
  const current=generation,photos=Array.isArray(payload.photo_paths)?payload.photo_paths:[],body={...payload};delete body.photo_paths;
  let id=body.id;delete body.id;
  if(resource==='head_office_checks'){delete body.scope;delete body.status;}
  if(resource==='inspections'&&!id){const row=[...records.entries()].find(([key,r])=>key.startsWith('inspections:')&&r.inspection_date===body.inspection_date&&r.period===body.period&&String(r.area_id)===String(body.area_id));id=row?.[1].id;}
  if(id&&!body.expected_updated_at)body.expected_updated_at=records.get(`${resource}:${id}`)?.updated_at;
  const key=JSON.stringify({resource,id,body,photos});let row=savedWrites.get(key);
  if(!row){
   if(!id){if(!requestKeys.has(key))requestKeys.set(key,crypto.randomUUID());body.request_id=requestKeys.get(key);}else delete body.request_id;
   const result=await request(`operations/${resource}${id?`/${id}`:''}`,{method:id?'PATCH':'POST',body});
   if(current!==generation)throw new Error('로그인 상태가 변경되었습니다.');
   if(!result.item?.id)throw new Error('저장 결과를 확인하지 못했습니다. 같은 내용으로 재시도해 주세요.');row=result.item;savedWrites.set(key,row);records.set(`${resource}:${row.id}`,row);
  }
  try{
   for(const ref of photos){if(!String(ref).startsWith('pending:'))continue;const photo=pending.get(ref);if(!photo)throw new Error('사진 선택이 만료되었습니다. 다시 선택해 주세요.');
    if(!photo.uploaded)photo.uploaded=await request('files',{method:'POST',body:{resource,recordId:String(row.id),fileName:photo.fileName,contentType:photo.mime,base64:photo.base64,idempotencyKey:photo.id}});
   }
  }catch(error){throw new Error(`업무 기록은 저장되었지만 사진 첨부가 완료되지 않았습니다. 같은 내용으로 다시 저장해 주세요. ${error.message}`);}
  if(current!==generation)throw new Error('로그인 상태가 변경되었습니다.');return decorated(resource,row);
 }
 async function stagePhotos(files,encoder){
  const current=generation,refs=[];
  for(const file of files){let match=[...pending.entries()].find(([,p])=>p.file===file);if(match){refs.push(match[0]);continue;}
   const encoded=await encoder(file),id=crypto.randomUUID(),ref=`pending:${id}`;
   if(current!==generation)throw new Error('로그인 상태가 변경되었습니다.');
   pending.set(ref,{...encoded,id,file,fileName:`photo-${id}.jpg`});refs.push(ref);
  }
  return refs;
 }
 async function photoReferences(resource,id){
  const row=records.get(`${resource}:${id}`);const legacy=decorated(resource,row||{id}).photo_paths;
  const result=await request('files',{query:{resource,recordId:id}});
  if(!Array.isArray(result.items))throw new Error('첨부파일 목록을 확인하지 못했습니다.');
  return [...legacy,...result.items.filter(f=>String(f.contentType||f.content_type||'').startsWith('image/')).map(f=>`file:${f.id}`)];
 }
 async function photoUrl(ref){
  if(urls.has(ref))return urls.get(ref);
  const current=generation;let blob;
  if(ref.startsWith('pending:')){const p=pending.get(ref);if(!p)throw new Error('사진 선택이 만료되었습니다.');const bytes=Uint8Array.from(atob(p.base64),c=>c.charCodeAt(0));blob=new Blob([bytes],{type:p.mime});}
  else if(ref.startsWith('file:')){const id=ref.slice(5);if(!FILE_ID.test(id))throw new Error('첨부파일 정보 오류');blob=await request(`files/${id}/download`,{binary:true});}
  else{const[,resource,id,index]=ref.split(':');if(!RESOURCES.has(resource)||!UUID.test(id||'')||!/^\d{1,2}$/.test(index||''))throw new Error('사진 정보 오류');blob=await request(`legacy-files/${resource}/${id}/${index}/download`,{binary:true});}
  if(current!==generation)throw new Error('로그인 상태가 변경되었습니다.');const url=URL.createObjectURL(blob);urls.set(ref,url);return url;
 }
 function clear(){generation++;for(const url of urls.values())URL.revokeObjectURL(url);urls.clear();records.clear();requestKeys.clear();savedWrites.clear();pending.clear();}
 return {request,list,save,stagePhotos,photoReferences,photoUrl,clear};
}
