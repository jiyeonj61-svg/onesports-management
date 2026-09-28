import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import qrcode from '../assets/vendor/qrcode.mjs';
import jsQR from 'jsqr';

test('personal routes and authorized responses never enter service-worker cache', async()=>{
  const source=await fs.readFile('sw.js','utf8');
  const handlers={};const cacheWrites=[];const network=[];
  const sandbox={self:{location:{origin:'https://onesports-management.vercel.app'},addEventListener:(n,f)=>handlers[n]=f},URL,
    caches:{open:async()=>({put:(...v)=>cacheWrites.push(v)}),match:async()=>undefined},
    fetch:async(request,options)=>{network.push({request,options});return {ok:true,clone(){return this}};}};
  vm.runInNewContext(source,sandbox);
  for(const route of ['/members','/members/my','/members/renew','/members/requests','/admin','/admin.html','/members.html','/assets/member-client.js']){
    let response;
    handlers.fetch({request:new Request('https://onesports-management.vercel.app'+route),respondWith:p=>response=p});
    assert.ok(response,route);await response;
  }
  assert.equal(cacheWrites.length,0);assert.equal(network.length,8);
  assert.ok(network.every(item=>item.options.cache==='no-store'));
});

test('failed personal request does not fall back to a cached public page',async()=>{
  const handlers={};let matched=false;let response;
  vm.runInNewContext(await fs.readFile('sw.js','utf8'),{self:{location:{origin:'https://onesports-management.vercel.app'},addEventListener:(n,f)=>handlers[n]=f},URL,
    caches:{match:()=>{matched=true}},fetch:()=>Promise.reject(new Error('offline'))});
  handlers.fetch({request:new Request('https://onesports-management.vercel.app/members/my'),respondWith:p=>response=p});
  await assert.rejects(response,/offline/);assert.equal(matched,false);
});

test('common QR decodes to the fixed production member page without personal data',()=>{
  const url='https://onesports-management.vercel.app/members';
  const qr=qrcode(0,'M');qr.addData(url);qr.make();
  const modules=qr.getModuleCount(),scale=7,quiet=4,width=(modules+quiet*2)*scale;
  const pixels=new Uint8ClampedArray(width*width*4).fill(255);
  for(let y=0;y<modules;y++)for(let x=0;x<modules;x++)if(qr.isDark(y,x))for(let dy=0;dy<scale;dy++)for(let dx=0;dx<scale;dx++){
    const offset=(((y+quiet)*scale+dy)*width+(x+quiet)*scale+dx)*4;
    pixels[offset]=pixels[offset+1]=pixels[offset+2]=0;
  }
  const decoded=jsQR(pixels,width,width);assert.equal(decoded?.data,url);
});
