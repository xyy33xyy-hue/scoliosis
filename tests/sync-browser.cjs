const {chromium}=require('playwright');
const http=require('http');const fs=require('fs');const assert=require('assert/strict');
const createFixture=require('./sync-fixture.cjs');
(async()=>{
 const {db,asRole,SHARED}=await createFixture();
 const html=fs.readFileSync(require('path').join(__dirname,'../scoliosis-screening-2.html'));
 const listeners=new Set();let queue=Promise.resolve();
 const serial=fn=>{const job=queue.then(fn);queue=job.catch(()=>{});return job;};
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/events') {res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});res.write(': connected\n\n');listeners.add(res);req.on('close',()=>listeners.delete(res));return;}
  if(req.url==='/') {res.writeHead(200,{'content-type':'text/html'});res.end(html);return;}
  let body='';for await(const chunk of req)body+=chunk;
  try {
   const input=body?JSON.parse(body):{};
   const result=await serial(()=>asRole('authenticated',SHARED,async()=>{
    if(req.url==='/state')return (await db.query('select version::int as version from public.scoli_sync_state')).rows[0];
    if(input.name==='scoli_snapshot')return (await db.query('select public.scoli_snapshot() as data')).rows[0].data;
    if(input.name==='scoli_commit')return (await db.query('select public.scoli_commit($1::jsonb,$2::bigint) as data',[JSON.stringify(input.args.p_changes),input.args.p_expected_revision??null])).rows[0].data;
    throw Error('Unexpected RPC');
   }));
   if(input.name==='scoli_commit' && result.applied)for(const client of listeners)client.write('data: revision\n\n');
   res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:result,error:null}));
  }catch(e){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:null,error:{code:e.code||'network',message:e.message}}));}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({channel:'msedge',headless:true});
 async function device(options={}){
  const context=await browser.newContext();
  await context.route('https://**/*',route=>route.fulfill({body:'',contentType:'application/javascript'}));
  await context.addInitScript(({signedOut})=>{
   if(signedOut)sessionStorage.setItem('fixture-out','yes');
   window.rpcCalls=0;window.updateError=false;
   window.pauseRealtime=false;window.offlineFixture=false;window.dropResponseOnce=false;
   const request=async(url,body)=>{
    if(url==='/rpc')window.rpcCalls++;
    if(window.offlineFixture)return {data:null,error:{code:'network',message:'offline'}};
    const response=await fetch(url,{method:'POST',body:JSON.stringify(body),headers:{'content-type':'application/json'}});
    const data=await response.json();
    if(url==='/rpc' && body.name==='scoli_commit' && window.dropResponseOnce){window.dropResponseOnce=false;return {data:null,error:{code:'network',message:'response lost'}};}
    return data;
   };
   window.supabase={createClient:()=>({
    auth:{getUser:async()=>({data:{user:sessionStorage.getItem('fixture-out')?null:{id:'fixture',email:'2079700358@qq.com',email_confirmed_at:'2026-01-01'}},error:null}),
     onAuthStateChange:cb=>{window.authCallback=cb;},signInWithPassword:async({password})=>{if(password==='invalid')return {error:{message:'invalid'}};sessionStorage.removeItem('fixture-out');return {error:null};},updateUser:async()=>({error:window.updateError?{code:'weak_password'}:null}),signOut:async()=>{sessionStorage.setItem('fixture-out','yes');window.authCallback?.('SIGNED_OUT',null);return {error:null};}},
    rpc:(name,args)=>request('/rpc',{name,args}),
    from:table=>{if(table!=='scoli_sync_state')throw Error('Direct write/read is forbidden in the new client');const q={select:()=>q,eq:()=>q,single:()=>request('/state',{})};return q;},
    storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:'data:image/png;base64,AA=='},error:null}),upload:async()=>({data:{},error:null}),remove:async()=>({data:{},error:null})})},
    channel:()=>{let onChange;let stream;const q={on:(kind,filter,cb)=>{if(filter.table!=='scoli_sync_state')throw Error('Clinical rows must not be broadcast');onChange=cb;return q;},subscribe:cb=>{stream=new EventSource('/events');stream.onopen=()=>cb('SUBSCRIBED');stream.onmessage=()=>{if(!window.pauseRealtime && !window.offlineFixture)onChange();};q.close=()=>stream.close();return q;}};return q;},removeChannel:q=>q.close()
   })};
  },options);
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.goto(origin);if(options.signedOut)await page.waitForFunction(()=>document.getElementById('authMessage').textContent.includes('请使用'));else await page.waitForFunction(()=>authReady && syncRevision>0);
  return {page,context,errors};
 }
 const a=await device(),b=await device();const A=a.page,B=b.page;
 const c=await device({signedOut:true});
 assert.equal(await c.page.evaluate(()=>rpcCalls),0);
 await c.page.evaluate(()=>{backupAll();exportData();});
 assert.equal(await c.page.evaluate(()=>rpcCalls),0);
 await c.page.locator('#authPassword').fill('invalid');await c.page.getByRole('button',{name:'登录',exact:true}).click();
 await c.page.waitForFunction(()=>document.getElementById('authMessage').textContent.includes('登录失败'));
 assert.equal(await c.page.evaluate(()=>authReady),false);await c.context.close();
 await B.evaluate(()=>{switchPage('add');document.getElementById('f_name').value='设备B正在填写';document.getElementById('f_note').value='不能丢失的输入';});
 await A.evaluate(()=>saveRows('patients',[{id:'auto-add',data:{id:'auto-add',name:'自动更新测试',age:12,gender:'女',date:'2026-11-03',cobb:5}}]));
 await B.waitForFunction(()=>patients.some(p=>p.id==='auto-add'));
 assert.equal(await B.locator('#f_name').inputValue(),'设备B正在填写');
 assert.equal(await B.locator('#f_note').inputValue(),'不能丢失的输入');
 assert.equal(await A.evaluate(()=>patients.filter(p=>p.id==='auto-add').length),1);
 // A real form submission creates one row and does not duplicate it locally after refresh.
 await A.evaluate(()=>{switchPage('add');for(const [id,value] of Object.entries({f_name:'表单新增',f_age:'12',f_gender:'女',f_date:'2026-11-03',f_cobb:'5'}))document.getElementById(id).value=value;});
 assert.equal(await A.evaluate(()=>submitForm('f_')),true);
 assert.equal(await A.evaluate(()=>patients.filter(p=>p.name==='表单新增').length),1);
 await B.waitForFunction(()=>patients.some(p=>p.name==='表单新增'));
 // Both devices start from the same revision and submit different edits together.
 await Promise.all([A.evaluate(()=>{pauseRealtime=true;return refreshFromCloud();}),B.evaluate(()=>{pauseRealtime=true;return refreshFromCloud();})]);
 const results=await Promise.all([A.evaluate(()=>commitChanges([putChange('patients','p1',{...snapshotRow('patients','p1').data,name:'设备A修改'})])),B.evaluate(()=>commitChanges([putChange('patients','p1',{...snapshotRow('patients','p1').data,name:'设备B修改'})]))]);
 assert.equal(results.filter(Boolean).length,1);
 const loser=results[0]?B:A,winner=results[0]?A:B;
 assert.equal(await loser.locator('#syncDraftBanner').isVisible(),true);
 assert.equal(await loser.evaluate(()=>pendingSyncDraft.changes.length),1);
 await loser.evaluate(()=>inspectSyncDraft());
 // A second remote edit after comparison must reject the retry, not silently rebase it.
 await winner.evaluate(()=>saveRows('patients',[{id:'review-race',data:{id:'review-race',name:'核对期间新增'}}]));
 await loser.evaluate(()=>retrySyncDraft());
 assert.equal(await loser.evaluate(()=>!!pendingSyncDraft),true);
 await loser.evaluate(()=>inspectSyncDraft());
 await loser.evaluate(()=>retrySyncDraft());
 assert.equal(await loser.evaluate(()=>pendingSyncDraft),null);
 // A stale full import cannot partially create rows; its original preview/input remains.
 await A.evaluate(()=>refreshFromCloud());
 await A.evaluate(()=>{pendingImportData=[{name:'批量1',age:12,gender:'女',date:'2026-11-03',cobb:5},{name:'批量2',age:12,gender:'男',date:'2026-11-03',cobb:5}];pendingImportRevision=syncRevision;});
 await B.evaluate(()=>refreshFromCloud());
 await B.evaluate(()=>saveRows('patients',[{id:'before-batch',data:{id:'before-batch',name:'另一设备新增'}}]));
 await A.evaluate(()=>confirmFullImport());
 assert.equal(await A.evaluate(()=>pendingImportData.length),2);
 assert.equal(await A.evaluate(()=>patients.some(p=>p.name==='批量1')),false);
 await A.evaluate(()=>discardSyncDraft());
 await A.evaluate(()=>{pendingImportRevision=syncRevision;return confirmFullImport();});
 assert.equal(await A.evaluate(()=>patients.filter(p=>/^批量[12]$/.test(p.name)).length),2);
 // Offline save retains a draft; reconnection loads missed cloud rows without clearing fields.
 await B.evaluate(()=>{offlineFixture=true;pauseRealtime=false;});
 assert.equal(await B.evaluate(()=>saveRows('patients',[{id:'offline-new',data:{id:'offline-new',name:'离线草稿'}}])),false);
 await A.evaluate(()=>saveRows('patients',[{id:'while-offline',data:{id:'while-offline',name:'离线期间云端新增'}}]));
 await B.evaluate(()=>{offlineFixture=false;window.dispatchEvent(new Event('online'));});
 await B.waitForFunction(()=>patients.some(p=>p.id==='while-offline'));
 assert.equal(await B.locator('#f_note').inputValue(),'不能丢失的输入');
 assert.equal(await B.evaluate(()=>!!pendingSyncDraft),true);
 await B.evaluate(()=>inspectSyncDraft());await B.evaluate(()=>retrySyncDraft());
 assert.equal(await B.evaluate(()=>patients.filter(p=>p.id==='offline-new').length),1);
 // Server committed but response was lost: review/retry is idempotent, not another insert.
 await A.evaluate(()=>{dropResponseOnce=true;return saveRows('patients',[{id:'lost-response',data:{id:'lost-response',name:'响应丢失测试'}}]);});
 assert.equal(await A.evaluate(()=>!!pendingSyncDraft),true);
 await A.evaluate(()=>inspectSyncDraft());await A.evaluate(()=>retrySyncDraft());
 assert.equal(await A.evaluate(()=>patients.filter(p=>p.id==='lost-response').length),1);
 assert.equal(await A.evaluate(()=>pendingSyncDraft),null);
 await A.evaluate(()=>{switchPage('add');for(const [id,value] of Object.entries({f_name:'响应丢失表单',f_age:'12',f_gender:'女',f_date:'2026-11-03',f_cobb:'5'}))document.getElementById(id).value=value;dropResponseOnce=true;});
 assert.equal(await A.evaluate(()=>submitForm('f_')),false);
 assert.equal(await A.locator('#f_name').inputValue(),'响应丢失表单');
 await A.evaluate(()=>inspectSyncDraft());await A.evaluate(()=>retrySyncDraft());
 assert.equal(await A.locator('#f_name').inputValue(),'');
 assert.equal(await A.evaluate(()=>patients.filter(p=>p.name==='响应丢失表单').length),1);
 await A.screenshot({path:'sync-two-device-test.png'});
 assert.deepEqual(a.errors,[]);assert.deepEqual(b.errors,[]);
 await B.evaluate(()=>logout());await B.waitForFunction(()=>!authReady && document.body.classList.contains('auth-locked'));
 assert.equal(await B.evaluate(()=>syncChannel===null && pendingSyncDraft===null),true);
 await A.getByRole('button',{name:'修改密码',exact:true}).click();
 for(const [id,value] of [['currentPassword','invalid'],['newPassword','fixture-next-password'],['confirmPassword','fixture-next-password']])await A.locator('#'+id).fill(value);
 await A.getByRole('button',{name:'确认修改并重新登录'}).click();
 await A.waitForFunction(()=>document.getElementById('passwordChangeMessage').textContent.includes('当前密码验证失败'));
 assert.equal(await A.locator('#newPassword').inputValue(),'');
 for(const [id,value] of [['currentPassword','fixture-current-password'],['newPassword','fixture-next-password'],['confirmPassword','fixture-next-password']])await A.locator('#'+id).fill(value);
 await A.getByRole('button',{name:'确认修改并重新登录'}).click();
 await A.waitForFunction(()=>!authReady && document.getElementById('authMessage').textContent.includes('密码已修改'));
 await a.context.close();await b.context.close();await browser.close();
 for(const client of listeners)client.end();await new Promise(r=>server.close(r));await db.close();
 console.log('PASS two browsers + isolated PostgreSQL: automatic updates; preserved form fields; simultaneous row conflict; comparison-race rejection; atomic stale batch; successful batch; offline/reconnect draft; lost-response idempotence; UUID inserts. No live data or credentials used.');
})().catch(e=>{console.error(e);process.exit(1)});
