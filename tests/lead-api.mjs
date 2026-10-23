import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const source=await readFile(new URL('../functions/api/lead.js',import.meta.url),'utf8');
const {onRequest}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const payload={business_name:'QA business',your_name:'QA',email:'qa@example.com',business_type:'Other'};
function request(body,env={}){return onRequest({request:new Request('https://example.com/api/lead',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),env});}
let passed=0;
async function check(name,run){await run();passed++;console.log('PASS '+name);}
await check('missing delivery and storage returns 503, never false success',async()=>{let r=await request(payload);assert.equal(r.status,503);assert.equal((await r.json()).ok,false);});
await check('successful KV storage permits acknowledgement without email',async()=>{let saved;let r=await request(payload,{LEADS_KV:{put:async(k,v)=>{saved=JSON.parse(v);}}});assert.equal((await r.json()).ok,true);assert.equal(saved.business_name,payload.business_name);});
await check('failed KV without email returns failure',async()=>{let r=await request(payload,{LEADS_KV:{put:async()=>{throw Error('offline');}}});assert.equal(r.status,503);});
await check('invalid fields rejected before delivery',async()=>{let r=await request({...payload,email:'bad'});assert.equal(r.status,400);});
await check('honeypot remains silent without storing data',async()=>{let called=false;let r=await request({...payload,website_url:'spam'},{LEADS_KV:{put:async()=>{called=true;}}});assert.equal((await r.json()).ok,true);assert.equal(called,false);});
await check('GET rejected with Allow POST',async()=>{let r=await onRequest({request:new Request('https://example.com/api/lead'),env:{}});assert.equal(r.status,405);assert.equal(r.headers.get('Allow'),'POST');});
const realFetch=globalThis.fetch;
await check('email can succeed when storage fails (mock provider)',async()=>{let sent;globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');sent=JSON.parse(options.body);return new Response('{}',{status:200});};let r=await request(payload,{RESEND_API_KEY:'mock-key',LEADS_KV:{put:async()=>{throw Error('offline');}}});assert.equal((await r.json()).ok,true);assert.equal(sent.reply_to,payload.email);});
await check('provider error remains a visitor-visible failure (mock provider)',async()=>{globalThis.fetch=async()=>new Response('{}',{status:500});let r=await request(payload,{RESEND_API_KEY:'mock-key'});assert.equal(r.status,500);assert.equal((await r.json()).ok,false);});
globalThis.fetch=realFetch;
console.log(`${passed} API checks passed. Provider requests were mocked; no live emails were sent.`);
