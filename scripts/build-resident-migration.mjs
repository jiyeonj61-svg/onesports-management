// Reproducibly preserve the reviewed original business transitions in private
// staff-only executors. Never overwrite the original member/guest RPCs.
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
const file='supabase/migrations/20261103225932_staff_resident_service.sql';
const parts=[];
for(const name of ['member','guest']){
 const source=(await fs.readFile('supabase/'+name+'-service.sql','utf8')).replaceAll('\r\n','\n');
 const start=source.indexOf('create or replace function public.'+name+'_service(');
 const end=source.indexOf('end $$;',start)+7;
 if(start<0||end<7)throw new Error('Missing reviewed source');
 const original=source.slice(start,end);
 const body=original.slice(original.indexOf('as $$')+5,-3);
 const md5=createHash('md5').update(body).digest('hex');
 parts.push(`do $guard$ begin
 if not exists(select 1 from pg_proc where oid='public.${name}_service(text,jsonb)'::regprocedure and md5(replace(prosrc,E'\\r\\n',E'\\n'))='${md5}') then
 raise exception 'Reviewed ${name}_service definition differs; stop and review before migration'; end if;
end $guard$;`);
 let copy=original.replace('public.'+name+'_service(', 'osi_resident_private.'+name+'_core(')
 .replace('u uuid:=auth.uid()', 'u uuid:=null').replace('adm boolean:=public.is_app_admin()', 'adm boolean:=true')
 .replace("if u is null then raise exception '로그인이 필요합니다.'", "if u is null and not adm then raise exception '로그인이 필요합니다.'");
 // Both old request photos and newly staged staff photos are checked by the
 // outer wrapper against the exact parent and current storage object.
 if(name==='member')copy=copy.replace("not public.ms_files_valid(array[path],'requests',u,1)","not osi_resident_private.photo_attached_to(path,'requests',ident)");
 parts.push(copy+`\nrevoke all on function osi_resident_private.${name}_core(text,jsonb) from public,anon,authenticated,service_role;`);
}
const setup=await fs.readFile('supabase/resident-service-setup.sql','utf8');
const wrapper=await fs.readFile('supabase/resident-service-wrapper.sql','utf8');
await fs.writeFile(file,'-- Generated from reviewed current member/guest source and resident setup/wrapper.\n-- CLI-created migration; no automatic site binding or existing data edits.\nbegin;\n'+setup+'\n'+parts.join('\n\n')+'\n'+wrapper+'\ncommit;\n');
console.log(file);
