import fs from 'node:fs/promises';
import { APPLICATION_DOCUMENTS } from '../assets/application-documents.js';

const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const statements = [
  '-- Source: center-supplied fitness/golf and GX DOCX forms, 2026-09-29.',
  '-- Apply after program-forms.sql. Idempotent; never updates operator edits or collection switches.',
  '-- Terms remain drafts because retention and GX operational values require administrator setup.',
  'begin;',
];
let i = 1;
for (const [program, doc] of Object.entries(APPLICATION_DOCUMENTS)) {
  const id = suffix => `d0290929-0000-4000-8000-${String(suffix).padStart(12,'0')}`;
  statements.push(`insert into public.ms_forms(id,program,title,fields,signature_mode,active,version)
select ${literal(id(i++))}::uuid,${literal(program)},${literal(doc.title)},'[]'::jsonb,'always',true,1
where not exists(select 1 from public.ms_forms where program=${literal(program)})
on conflict(id) do nothing;`);
  const terms = [
    {kind:'rules',title:`${doc.title} 이용규정`,body:doc.sections.map(s=>`${s.title}\n${s.body}`).join('\n\n')},
    {kind:'privacy',title:`${doc.title} 개인정보 수집·이용`,body:doc.privacy.body},
  ];
  for (const term of terms) {
    statements.push(`insert into public.ms_terms(id,program,kind,title,body,required,approved,active,version)
select ${literal(id(i++))}::uuid,${literal(program)},${literal(term.kind)},${literal(term.title)},${literal(term.body)},true,false,false,
coalesce((select max(version)+1 from public.ms_terms where program=${literal(program)} and kind=${literal(term.kind)} and title=${literal(term.title)}),1)
where not exists(select 1 from public.ms_terms where program=${literal(program)} and kind=${literal(term.kind)})
on conflict(id) do nothing;`);
  }
}
statements.push('commit;');
await fs.writeFile(new URL('../supabase/program-form-content.sql',import.meta.url),statements.join('\n\n')+'\n','utf8');
console.log('Generated supabase/program-form-content.sql (2 forms, 4 draft terms; no switch changes).');
