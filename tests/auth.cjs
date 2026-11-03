const {chromium}=require('playwright');
const fs=require('fs');
const assert=require('assert/strict');
const path=require('path');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 const context=await browser.newContext();
 await context.route('https://**/*',r=>r.fulfill({body:'',contentType:'application/javascript'}));
 await context.addInitScript(()=>{
  window.calls=[]; window.mode='out'; window.readError=false; window.writeError=false;
  window.localStorage.setItem('scoli_patients','[{"name":"old health data"}]');
  window.supabase={createClient:(url,key,options)=>{
   window.authOptions=options;
   const result=()=>({data:{user:window.mode==='out'?null:{id:'shared-test-id',email:window.mode==='wrong'?'other@example.com':'2079700358@qq.com',email_confirmed_at:'2026-01-01'}},error:null});
   return {
    auth:{getUser:async()=>result(),onAuthStateChange:fn=>{window.authCallback=fn;},
      signInWithPassword:async({password})=>{window.calls.push('login'); if(password==='invalid')return {error:{message:'invalid'}}; window.mode='shared'; options.auth.storage.setItem('scoli-auth-v1','test-token'); return {error:null};},
      signOut:async()=>{window.calls.push('logout'); options.auth.storage.removeItem('scoli-auth-v1'); return {error:null};}},
    from:table=>{
     const query={select:()=>{window.calls.push('read:'+table);return query;},eq:()=>query,
      upsert:()=>{window.calls.push('write:'+table); return Promise.resolve({error:window.writeError?{message:'denied'}:null});},
      delete:()=>{window.calls.push('delete:'+table);return query;},
      then:(resolve,reject)=>Promise.resolve({error:window.readError?{message:'denied'}:null,data:table==='patients'?[{id:'1',data:{id:1,name:'<img src=x onerror="window.pwned=1">',age:12,gender:'女',date:'2026-01-01',cobb:5}}]:table==='roster'?[{id:1,data:[{name:'A\'"<test>',class:'<img src=x onerror="window.pwned=1">'}]}]:[]}).then(resolve,reject)};return query;
    },storage:{from:()=>({createSignedUrl:async path=>{window.calls.push('signed'); return {data:{signedUrl:'https://example.invalid/'+path},error:null};},upload:async()=>({error:null}),remove:async()=>({error:null})})}
   };
  }};
 });
 const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('file:///'+path.resolve(__dirname,'../scoliosis-screening-2.html').replaceAll('\\','/'));
 await page.waitForFunction(()=>document.getElementById('authMessage').textContent.includes('请使用'));
 assert.equal(await page.locator('.sidebar').isVisible(),false);
 assert.deepEqual(await page.evaluate(()=>calls),[]);
 assert.equal(await page.evaluate(()=>localStorage.getItem('scoli_patients')),null);
 await page.evaluate(()=>{backupAll(); exportData(); submitForm('f_'); loadFromCloud().catch(()=>{});});
 assert.deepEqual(await page.evaluate(()=>calls),[]);
 await page.locator('#authPassword').fill('invalid');await page.locator('#authSubmit').click();
 await page.waitForFunction(()=>document.getElementById('authMessage').textContent.includes('登录失败'));
 assert.equal(await page.locator('.sidebar').isVisible(),false);
 await page.locator('#authRemember').uncheck();
 await page.locator('#authPassword').fill('fixture-password');await page.locator('#authSubmit').click();
 await page.waitForFunction(()=>!document.body.classList.contains('auth-locked'));
 assert.equal(await page.evaluate(()=>sessionStorage.getItem('scoli-auth-v1')),'test-token');
 assert.equal(await page.evaluate(()=>localStorage.getItem('scoli-auth-v1')),null);
 assert.equal(await page.locator('#authPassword').inputValue(),'');
 await page.evaluate(()=>{renderPatients();renderRosterPanel();renderRosterMain();});
 assert.equal(await page.evaluate(()=>window.pwned),undefined);
 assert.equal(await page.locator('#patientTable img').count(),0);
 await page.evaluate(()=>{window.writeError=true;});
 assert.equal(await page.evaluate(()=>saveData()),false);
 await page.screenshot({path:'login-authenticated-test.png',fullPage:true});
 await page.evaluate(()=>{window.mode='wrong';return verifyAndOpen();});
 assert.equal(await page.locator('.sidebar').isVisible(),false);
 assert.equal(await page.locator('#patientTable').textContent(),'');
 await page.evaluate(()=>{window.mode='shared';window.readError=true;return verifyAndOpen();});
 assert.equal(await page.locator('.sidebar').isVisible(),false);
 await page.screenshot({path:'login-screen-test.png'});
 assert.deepEqual(errors,[]);
 await page.evaluate(()=>{window.readError=false;return verifyAndOpen();});
 await page.waitForFunction(()=>!document.body.classList.contains('auth-locked'));
 await page.locator('button', {hasText:'退出登录'}).click();
 await page.waitForLoadState('load');
 await page.waitForFunction(()=>document.body.classList.contains('auth-locked'));
 assert.equal(await page.evaluate(()=>sessionStorage.getItem('scoli-auth-v1')),null);
 await context.close(); await browser.close();
 console.log('PASS: no anonymous reads/exports; login rejection/success; session-only storage; password clearing; HTML escaping; failed writes; wrong-user and read-failure lock; logout. Mocked Supabase, no live patient access.');
})().catch(e=>{console.error(e);process.exit(1)});
