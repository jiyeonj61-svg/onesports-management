import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd();
const port=Number(process.env.PORT || 4173);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://127.0.0.1');
    if(url.pathname==='/api/config'){
      const config=JSON.parse(await fs.readFile('../runtime-public-config.json','utf8'));
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(config));return;
    }
    let relative=url.pathname==='/'?'index.html':url.pathname==='/admin'?'admin.html':/^\/members(?:\/|$)/.test(url.pathname)?'members.html':decodeURIComponent(url.pathname).slice(1);
    if(relative.startsWith('.')||relative.split('/').some(p=>p.startsWith('.'))||/^(supabase|tests|work|node_modules|docs|scripts)\//.test(relative))throw new Error('forbidden');
    const file=path.resolve(root,relative);
    if(!file.startsWith(root+path.sep))throw new Error('forbidden');
    const body=await fs.readFile(file);
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(body);
  }catch{res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end('페이지를 찾을 수 없습니다.');}
}).listen(port,'127.0.0.1',()=>console.log(`Local preview: http://127.0.0.1:${port}`));
