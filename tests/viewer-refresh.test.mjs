import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SourceTextModule} from 'node:vm';
import {createLiveRefresh,loadViewerSnapshot,viewerSelectionKey} from '../assets/viewer-refresh.js';

test('browser entry and refresh modules parse with browser module semantics',()=>{
  for(const file of ['viewer.js','viewer-refresh.js','integration-public.js']){
    assert.doesNotThrow(()=>new SourceTextModule(readFileSync(new URL('../assets/'+file,import.meta.url),'utf8'),{identifier:file}));
  }
});

const flush=()=>new Promise(resolve=>setImmediate(resolve));
function harness(refresh){
  const win=new EventTarget(),doc=new EventTarget(),timers=new Map(),states=[];doc.visibilityState='visible';
  let online=true,clock=100,id=0;
  const control=createLiveRefresh({refresh,onState:s=>states.push(s),windowTarget:win,documentTarget:doc,isOnline:()=>online,now:()=>clock,
    setTimer:(fn,delay)=>{timers.set(++id,{fn,delay});return id;},clearTimer:id=>timers.delete(id)});
  return {control,win,doc,timers,states,setOnline:value=>online=value,setClock:value=>clock=value};
}
test('visible viewer checks every five seconds and lifecycle events refresh immediately',async()=>{
  let calls=0;const h=harness(async()=>{calls++;return true;});await h.control.start();
  assert.equal(calls,1);assert.equal([...h.timers.values()][0].delay,5000);
  for(const event of ['focus','online','pageshow']){h.win.dispatchEvent(new Event(event));await flush();}
  assert.equal(calls,4);
  h.doc.visibilityState='hidden';h.doc.dispatchEvent(new Event('visibilitychange'));assert.equal(h.timers.size,0);
  await h.control.request();assert.equal(calls,4);assert.equal(h.states.at(-1).status,'paused');
  h.doc.visibilityState='visible';h.doc.dispatchEvent(new Event('visibilitychange'));await flush();assert.equal(calls,5);
  h.control.stop();h.win.dispatchEvent(new Event('focus'));await flush();assert.equal(calls,5);
});
test('slow requests never overlap and multiple triggers coalesce into one follow-up',async()=>{
  let calls=0,active=0,maxActive=0,release;
  const h=harness(async()=>{calls++;active++;maxActive=Math.max(maxActive,active);if(calls===1)await new Promise(resolve=>release=resolve);active--;return true;});
  const initial=h.control.start();await flush();
  h.win.dispatchEvent(new Event('focus'));h.win.dispatchEvent(new Event('online'));h.control.request();assert.equal(calls,1);
  release();await initial;await flush();assert.equal(calls,2);assert.equal(maxActive,1);h.control.stop();
});
test('failed and offline refreshes keep the last success time and recover without reload',async()=>{
  let fail=false;const h=harness(async()=>{if(fail)throw new Error('temporary');return true;});
  await h.control.start();fail=true;h.setClock(200);await h.control.request();
  assert.equal(h.states.at(-1).status,'error');assert.equal(h.states.at(-1).lastSuccess,100);
  h.setOnline(false);h.win.dispatchEvent(new Event('offline'));assert.equal(h.timers.size,0);assert.equal(h.states.at(-1).status,'offline');
  fail=false;h.setOnline(true);h.setClock(300);h.win.dispatchEvent(new Event('online'));await flush();
  assert.equal(h.states.at(-1).status,'fresh');assert.equal(h.states.at(-1).lastSuccess,300);h.control.stop();
});
test('discarded navigation response cannot be marked fresh and back-forward restoration resumes',async()=>{
  let applied=false,calls=0;const h=harness(async()=>{calls++;return applied;});await h.control.start();
  assert.ok(h.states.every(s=>s.lastSuccess===null));
  h.win.dispatchEvent(new Event('pagehide'));assert.equal(h.timers.size,0);
  applied=true;h.win.dispatchEvent(new Event('pageshow'));await flush();assert.equal(calls,2);assert.equal(h.states.at(-1).status,'fresh');h.control.stop();
});
const selection={activeTab:'today',selectedDate:'2026-11-04',calendarMonth:'2026-10',reportMonth:'2026-09',today:'2026-11-04'};
test('each view reloads its scoped period and area definitions without reading all inspections',async()=>{
  for(const view of ['today','calendar','report','issues','inventory','head-office']){
    const calls=[];const data=Object.fromEntries(['getAreas','getIssues','getInspections','getInventories','getHeadOfficeChecks'].map(method=>[method,async range=>{calls.push({method,range});return [];} ]));
    await loadViewerSnapshot(data,{...selection,activeTab:view});
    assert.equal(calls.filter(c=>c.method==='getAreas').length,1);
    const inspection=calls.find(c=>c.method==='getInspections');
    if(view==='today')assert.deepEqual(inspection.range,{start:'2026-11-04',end:'2026-11-04'});
    if(view==='calendar')assert.deepEqual(inspection.range,{start:'2026-10-01',end:'2026-10-31'});
    if(view==='report')assert.deepEqual(inspection.range,{start:'2026-09-01',end:'2026-09-30'});
    if(['issues','inventory','head-office'].includes(view))assert.equal(inspection,undefined);
  }
});
test('partial source failure rejects the complete view rather than manufacturing empty records',async()=>{
  const data={getAreas:async()=>[{id:1}],getIssues:async()=>[],getInspections:async()=>[{id:'saved'}],getHeadOfficeChecks:async()=>{throw new Error('unavailable');}};
  await assert.rejects(loadViewerSnapshot(data,selection),/unavailable/);
  assert.notEqual(viewerSelectionKey(selection),viewerSelectionKey({...selection,selectedDate:'2026-11-03'}));
  assert.notEqual(viewerSelectionKey(selection),viewerSelectionKey({...selection,activeTab:'report'}));
});
