const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowed = {
  guest: new Set(['admin_list','admin_detail','admin_create_member','admin_match','admin_convert','admin_action','admin_update_request','admin_upload_photo','photo']),
  member: new Set(['status','admin_list','admin_detail','admin_action','admin_save','photo','admin_upload_photo']),
};

// Authentication is completed by the signed Worker envelope before this runs.
// The database additionally binds the legacy single-center data to one site.
export function residentArguments(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key=>!['siteId','actorId','service','action','payload'].includes(key))
    || !uuid.test(input.siteId || '') || !uuid.test(input.actorId || '')
    || !Object.hasOwn(allowed,input.service) || !allowed[input.service].has(input.action)
    || !input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)
    || input.service==='member'&&input.action==='admin_save'&&input.payload.entity!=='posts') return null;
  return {p_site_id:input.siteId,p_actor_id:input.actorId,p_service:input.service,p_action:input.action,p_payload:input.payload};
}

const imageTypes = new Set(['image/jpeg','image/png','image/webp']);
const photoPath = /^(requests|applications|posts)\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$/i;
const privateBucket = 'member-service-files';
const encodedPath = path => path.split('/').map(encodeURIComponent).join('/');
const decodePhoto = base64 => {
  if(typeof base64!=='string'||base64.length>700000||!base64.length||! /^[A-Za-z0-9+/]+={0,2}$/.test(base64))throw Error('photo data');
  const bytes=Uint8Array.from(atob(base64),value=>value.charCodeAt(0));
  if(!bytes.length||bytes.length>524288)throw Error('photo size');
  return bytes;
};
function hasImageSignature(bytes,mime){
  if(mime==='image/jpeg')return bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  if(mime==='image/png')return [137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v);
  return mime==='image/webp'&&new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP';
}

// Only paths authorized by the scoped database RPC reach private Storage.
export async function relayResidentPhoto(input,data,request,headers){
  if(input.service!=='member'||!['photo','admin_upload_photo'].includes(input.action)||data.ok!==true)return data;
  const photo=data.photo;
  if(!photo||photo.bucket!==privateBucket||typeof photo.path!=='string'||!photoPath.test(photo.path)
    ||photo.path.split('/').slice(1).some((part,index)=>!uuid.test(index===0?part:part.split('.')[0])))throw Error('photo path');
  if(input.action==='admin_upload_photo'){
    const entity=input.payload.entity||'requests',mime=input.payload.mime;
    if(data.upload!==true||!['requests','posts'].includes(entity)||!uuid.test(input.payload.id||'')
      ||photo.path.split('/')[0]!==entity||photo.path.split('/')[1]!==input.payload.id
      ||!imageTypes.has(mime)||photo.mime!==mime)throw Error('upload scope');
    const bytes=decodePhoto(input.payload.base64);
    const extension=mime==='image/jpeg'?'jpg':mime==='image/png'?'png':'webp';
    if(photo.bytes!==bytes.length||!photo.path.endsWith('.'+extension)||!hasImageSignature(bytes,mime))throw Error('upload format');
    const uploaded=await request(`/storage/v1/object/${privateBucket}/${encodedPath(photo.path)}`,{
      method:'POST',headers:{...headers,'Content-Type':mime,'Cache-Control':'no-store','x-upsert':'true'},body:bytes,
    });
    if(!uploaded.ok)throw Error('upload unavailable');
    // This private reference is accepted only for its staged parent when saving.
    return {ok:true,photo:{path:photo.path,mime,bytes:bytes.length}};
  }
  const image=await request(`/storage/v1/object/authenticated/${privateBucket}/${encodedPath(photo.path)}`,{headers});
  if(!image.ok)throw Error('photo unavailable');
  const mime=(image.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
  const maximum=8*1024*1024;
  if(!imageTypes.has(mime)||Number(image.headers.get('content-length')||0)>maximum)throw Error('photo format');
  const parts=[];let length=0;
  for await(const part of image.body){length+=part.length;if(length>maximum)throw Error('photo size');parts.push(part);}
  const bytes=new Uint8Array(length);let offset=0;
  for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  if(!hasImageSignature(bytes,mime))throw Error('photo signature');
  let binary='';for(let index=0;index<bytes.length;index+=32768)binary+=String.fromCharCode(...bytes.subarray(index,index+32768));
  return {ok:true,photo:{mime,base64:btoa(binary)}};
}
