import { APP_START_DATE, monthRange } from './common.js';

export function viewerSelectionKey(selection) {
  return JSON.stringify([selection.activeTab, selection.selectedDate, selection.calendarMonth, selection.reportMonth, selection.today]);
}

// Read the complete selected view before publishing any of it. A failed source
// must not silently become an empty section or replace the last good snapshot.
export async function loadViewerSnapshot(data, selection) {
  const {activeTab, selectedDate, calendarMonth, reportMonth, today} = selection;
  const all = {start:APP_START_DATE, end:today};
  const range = month => {
    const value=monthRange(month);
    return {start:value.start<APP_START_DATE?APP_START_DATE:value.start,end:value.end>today?today:value.end};
  };
  const period = activeTab==='today' ? {start:selectedDate,end:selectedDate} : range(activeTab==='calendar'?calendarMonth:reportMonth);
  const [areas, issues, inspections, inventories, headOfficeChecks] = await Promise.all([
    data.getAreas(), data.getIssues(all),
    ['today','calendar','report'].includes(activeTab)?data.getInspections(period):[],
    activeTab==='inventory'?data.getInventories(all):activeTab==='report'?data.getInventories(period):[],
    activeTab==='head-office'?data.getHeadOfficeChecks(all):['today','report'].includes(activeTab)?data.getHeadOfficeChecks(period):[],
  ]);
  return {selection,areas,issues:issues.filter(item=>item.is_public!==false),inspections,
    inventories:inventories.filter(item=>item.is_public!==false),headOfficeChecks};
}

export function createLiveRefresh({refresh,onState=()=>{},windowTarget=window,documentTarget=document,
  isOnline=()=>navigator.onLine!==false,now=()=>Date.now(),intervalMs=5000,
  setTimer=(fn,delay)=>windowTarget.setTimeout(fn,delay),clearTimer=id=>windowTarget.clearTimeout(id)}) {
  let timer=null, running=null, pending=false, stopped=true, pageHidden=false, lastSuccess=null;
  const visible=()=>!pageHidden&&documentTarget.visibilityState!=='hidden';
  const clear=()=>{if(timer!==null)clearTimer(timer);timer=null;};
  const emit=(status,error)=>onState({status:!isOnline()?'offline':!visible()?'paused':status,lastSuccess,error});
  function schedule(){clear();if(!stopped&&visible()&&isOnline())timer=setTimer(()=>request(),intervalMs);}
  function request(){
    if(stopped)return Promise.resolve();
    clear();
    if(!visible()||!isOnline()){emit('paused');return Promise.resolve();}
    if(running){pending=true;return running;}
    emit('loading');
    running=Promise.resolve().then(refresh).then(applied=>{
      if(stopped)return;
      if(applied!==false){lastSuccess=now();emit('fresh');}
    }).catch(error=>{if(!stopped)emit('error',error);}).finally(()=>{
      running=null;
      if(stopped)return;
      if(pending){pending=false;request();}else schedule();
    });
    return running;
  }
  const resume=()=>{pageHidden=false;request();};
  const visibility=()=>{if(visible())request();else{clear();emit('paused');}};
  const offline=()=>{clear();emit('offline');};
  const pagehide=()=>{pageHidden=true;clear();emit('paused');};
  const listeners=[
    [windowTarget,'focus',resume],[windowTarget,'online',resume],[windowTarget,'offline',offline],
    [windowTarget,'pageshow',resume],[windowTarget,'pagehide',pagehide],
    [documentTarget,'visibilitychange',visibility],
  ];
  return {
    request,
    start(){if(!stopped)return;stopped=false;for(const [target,event,handler]of listeners)target.addEventListener(event,handler);return request();},
    stop(){stopped=true;pending=false;clear();for(const [target,event,handler]of listeners)target.removeEventListener(event,handler);},
  };
}
