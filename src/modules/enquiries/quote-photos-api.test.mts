import test,{after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import sharp from 'sharp';
import {PHOTO_NOTICE_VERSION,type QuotePhotoMutation} from './domain/quote-photos.ts';
Object.assign(process.env,{OPERATIONS_STORE:'supabase',LOCAL_OPERATIONS_ENABLED:'true',APP_BASE_URL:'http://127.0.0.1:3002',NEXT_PUBLIC_SUPABASE_URL:'https://photo-api.invalid',SUPABASE_SECRET_KEY:'synthetic-key',GOOGLE_TOKEN_ENCRYPTION_KEY:'77'.repeat(32)});
const db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role bypassrls');
for(const file of readdirSync(new URL('../../../supabase/migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(`../../../supabase/migrations/${file}`,import.meta.url),'utf8'));
const tables=(await db.query<{tablename:string}>("select tablename from pg_tables where schemaname='public' and tablename like 'lk_%'")).rows.map(x=>x.tablename);
const actualFetch=globalThis.fetch;const objects=new Map<string,Uint8Array>();let publicBucket=false,failAttach=false,failDelete=false,storageCalls=0;let missingCode='404';
globalThis.fetch=async(input,init)=>{
 const req=new Request(input,init),url=new URL(req.url);assert.equal(url.origin,'https://photo-api.invalid','Never contact an external provider');assert.equal(req.headers.get('apikey'),'synthetic-key');
 if(url.pathname.startsWith('/rest/v1/rpc/')){
  const name=url.pathname.split('/').at(-1)!;assert.ok(['lk_operations_command','lk_quote_draft','lk_quote_photo'].includes(name));const body=await req.json() as {command:string;args:Record<string,unknown>};
  if(name==='lk_quote_photo'&&body.command==='attach'&&failAttach)return Response.json({code:'XX001',message:'Synthetic database interruption'},{status:503});
  try{return Response.json((await db.query<{r:unknown}>(`select public.${name}($1,$2::jsonb) r`,[body.command,JSON.stringify(body.args)])).rows[0].r);}catch(e){const error=e as {code:string;message:string};return Response.json(error,{status:400});}
 }
 storageCalls++;
 if(url.pathname==='/storage/v1/bucket/quote-photos')return Response.json({id:'quote-photos',name:'quote-photos',public:publicBucket});
 const path=decodeURIComponent(url.pathname).replace('/storage/v1/object/quote-photos/','');
 if(req.method==='POST'&&url.pathname.startsWith('/storage/v1/object/quote-photos/')){assert.equal(req.headers.get('x-upsert'),'false');if(objects.has(path))return Response.json({statusCode:'409',error:'Duplicate',message:'The resource already exists'},{status:409});objects.set(path,new Uint8Array(await req.arrayBuffer()));return Response.json({Key:`quote-photos/${path}`});}
 if(req.method==='GET'&&url.pathname.startsWith('/storage/v1/object/quote-photos/')){const data=objects.get(path);return data?new Response(data):Response.json({statusCode:missingCode,error:'not_found',message:'Object not found'},{status:404});}
 if(req.method==='DELETE'&&url.pathname==='/storage/v1/object/quote-photos'){if(failDelete)return Response.json({statusCode:'503',message:'Synthetic storage outage'},{status:503});const body=await req.json() as {prefixes:string[]};for(const key of body.prefixes)objects.delete(key);return Response.json([]);}
 throw Error(`Unexpected mock route: ${req.method} ${url.pathname}`);
};
const draft=await import('./infrastructure/quote-draft-api.ts');const api=await import('./infrastructure/quote-photo-api.ts');
beforeEach(async()=>{await db.exec('reset role');await db.exec(`truncate ${tables.map(x=>`public.${x}`).join(',')}`);await db.exec('set role service_role');objects.clear();publicBucket=false;failAttach=false;failDelete=false;storageCalls=0;missingCode='404';});
after(async()=>{globalThis.fetch=actualFetch;await db.close();});
function req(method='GET',cookie='',body?:unknown,origin='http://127.0.0.1:3002'){return new Request('http://127.0.0.1:3002/api/quote/photos',{method,headers:{origin,...(cookie?{cookie}:{}),...(body===undefined?{}:{'content-type':body instanceof Uint8Array?'image/png':'application/json'})},...(body===undefined?{}:{body:body instanceof Uint8Array?new Uint8Array(body):JSON.stringify(body)})});}
async function fixture(){const r=await draft.draftSessionPost(req('POST'));const cookie=r.headers.get('set-cookie')!.split(';')[0];const saved=await draft.draftPut(req('PUT',cookie,{expectedRevision:0,payload:{contact:{name:'Synthetic Photos',email:'company@example.invalid',phone:'',siteAddress:'TEST ONLY',suburb:'Test',postcode:'2000',details:'Synthetic only',consent:true},service:{serviceId:'cabinet-painting',intent:'full-repainting',surfaces:['doors'],doorCount:2,drawerCount:null,material:'',colourPreference:''}}}));assert.equal(saved.status,200);return cookie;}
async function reserve(cookie:string,bytes:Uint8Array,revision=1){const body={expectedRevision:revision,noticeVersion:PHOTO_NOTICE_VERSION,noticeAccepted:true,fileName:'synthetic.png',mimeType:'image/png',inputBytes:bytes.length,sourceHash:createHash('sha256').update(bytes).digest('hex'),idempotencyKey:randomUUID()};const r=await api.photosPost(req('POST',cookie,body));assert.equal(r.status,201,await r.clone().text());return await r.json() as QuotePhotoMutation;}
const image=()=>sharp({create:{width:40,height:20,channels:3,background:'#0094ff'}}).png().toBuffer();

test('private submitted photo allows the local owner only until session expiry or revocation',async()=>{
 const customer=await fixture(),bytes=await image(),reserved=await reserve(customer,bytes);
 assert.equal((await api.photoContentPut(req('PUT',customer,bytes),reserved.photo.id)).status,200);
 const photo=(await db.query<{draft_id:string;content_hash:string;processing_version:string}>('select draft_id,content_hash,processing_version from public.lk_quote_photos where id=$1',[reserved.photo.id])).rows[0];
 const submissionId=randomUUID(),owner=createHash('sha256').update(customer.slice(customer.indexOf('=')+1)).digest('hex');
 const snapshot={photos:[{photoId:reserved.photo.id,contentHash:photo.content_hash,processingVersion:photo.processing_version}]};
 await db.query('insert into public.lk_quote_submissions(id,draft_id,owner_hash,idempotency_key,request_hash,reference,snapshot,snapshot_hash,signature,calendar_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[submissionId,photo.draft_id,owner,randomUUID(),'a'.repeat(64),`DEMO-${submissionId.slice(0,8).toUpperCase()}`,JSON.stringify(snapshot),'b'.repeat(64),'{}','synthetic-calendar']);
 const token=randomUUID(),hash=createHash('sha256').update(token).digest('hex'),cookie=`lk_ops_session=${token}`;
 await db.query('insert into public.lk_sessions(token_hash,mode,account_sub,expires_at) values($1,$2,$3,$4)',[hash,'google','synthetic-admin',Date.now()+60000]);
 const path=`/api/operations/bookings/${submissionId}/photos/${reserved.photo.id}`;
 const adminRequest=(origin='http://127.0.0.1:3002')=>new Request(origin+path,{headers:{cookie}});
 const allowed=await api.adminPhotoGet(adminRequest(),submissionId,reserved.photo.id);
 assert.equal(allowed.status,200);assert.equal(allowed.headers.get('cache-control'),'private, no-store');
 assert.deepEqual(new Uint8Array(await allowed.arrayBuffer()),[...objects.values()][0]);
 assert.equal((await api.adminPhotoGet(adminRequest(),randomUUID(),reserved.photo.id)).status,404);
 const calls=storageCalls;
 assert.equal((await api.adminPhotoGet(adminRequest('https://foreign.invalid'),submissionId,reserved.photo.id)).status,403);
 await db.query('update public.lk_sessions set expires_at=$1 where token_hash=$2',[Date.now()-1,hash]);
 assert.equal((await api.adminPhotoGet(adminRequest(),submissionId,reserved.photo.id)).status,401);
 await db.query('delete from public.lk_sessions where token_hash=$1',[hash]);
 assert.equal((await api.adminPhotoGet(adminRequest(),submissionId,reserved.photo.id)).status,401);
 assert.equal(storageCalls,calls,'denied requests never read private object bytes');
 assert.equal(objects.size,1,'access revocation preserves submitted evidence');
});

test('authenticated reserve/upload/preview/restore/delete pipeline stores only normalized bytes privately',async()=>{const cookie=await fixture(),bytes=await image(),r=await reserve(cookie,bytes);const uploaded=await api.photoContentPut(req('PUT',cookie,bytes),r.photo.id);assert.equal(uploaded.status,200,await uploaded.clone().text());const saved=await uploaded.json() as QuotePhotoMutation;assert.equal(saved.draftRevision,3);assert.equal(saved.photo.status,'attached');assert.equal(objects.size,1);const preview=await api.photoContentGet(req('GET',cookie),r.photo.id);assert.equal(preview.status,200);assert.equal(preview.headers.get('cache-control'),'private, no-store');assert.equal(preview.headers.get('content-type'),'image/jpeg');const metadata=await sharp(Buffer.from(await preview.arrayBuffer())).metadata();assert.equal(metadata.format,'jpeg');assert.equal(metadata.exif,undefined);const restored=await (await api.photosGet(req('GET',cookie))).json();assert.equal(restored.photos.length,1);assert.equal(JSON.stringify(restored).includes('object_path'),false);const deleted=await api.photoDelete(req('DELETE',cookie,{expectedRevision:3}),r.photo.id);assert.equal(deleted.status,200,await deleted.clone().text());assert.equal(objects.size,0);assert.equal((await api.photoContentGet(req('GET',cookie),r.photo.id)).status,404);assert.equal((await db.query<{count:number}>('select count(*)::int count from public.lk_quote_submissions')).rows[0].count,0);});
test('unauthenticated, cross-origin and foreign owners never access image storage',async()=>{const a=await fixture(),b=await fixture(),bytes=await image(),r=await reserve(a,bytes);const before=storageCalls;assert.equal((await api.photoContentGet(req(),r.photo.id)).status,401);assert.equal((await api.adminPhotoGet(req(),randomUUID(),r.photo.id)).status,401);assert.equal((await api.photoContentPut(req('PUT',a,bytes,'https://foreign.invalid'),r.photo.id)).status,403);assert.equal((await api.photoContentPut(req('PUT',b,bytes),r.photo.id)).status,404);assert.equal((await api.photoContentGet(req('GET',b),r.photo.id)).status,404);assert.equal((await api.photoDelete(req('DELETE',b,{expectedRevision:1}),r.photo.id)).status,404);assert.equal(storageCalls,before);});
test('process restart reconciles storage success/database failure without an additional upload',async()=>{const cookie=await fixture(),bytes=await image(),r=await reserve(cookie,bytes);failAttach=true;assert.equal((await api.photoContentPut(req('PUT',cookie,bytes),r.photo.id)).status,503);assert.equal(objects.size,1);failAttach=false;await db.query("update public.lk_quote_photos set lease_until=now()-interval '1 second' where id=$1",[r.photo.id]);assert.deepEqual(await api.recoverQuotePhotos(),{recovered:1,deferred:0});const list=await(await api.photosGet(req('GET',cookie))).json();assert.equal(list.photos[0].status,'attached');assert.equal(objects.size,1);});
test('deletion outage remains private, blocks progression, and worker removes the recorded object later',async()=>{const cookie=await fixture(),bytes=await image(),r=await reserve(cookie,bytes);await api.photoContentPut(req('PUT',cookie,bytes),r.photo.id);failDelete=true;assert.equal((await api.photoDelete(req('DELETE',cookie,{expectedRevision:3}),r.photo.id)).status,202);assert.equal((await api.photoContentGet(req('GET',cookie),r.photo.id)).status,404);assert.equal(objects.size,1);failDelete=false;await db.query("update public.lk_quote_photos set retry_after=now()-interval '1 second' where id=$1",[r.photo.id]);assert.deepEqual(await api.recoverQuotePhotos(),{recovered:1,deferred:0});assert.equal(objects.size,0);});
test('public bucket misconfiguration never uploads private bytes and missing object recovers to retryable',async()=>{const cookie=await fixture(),bytes=await image(),r=await reserve(cookie,bytes);publicBucket=true;assert.equal((await api.photoContentPut(req('PUT',cookie,bytes),r.photo.id)).status,503);assert.equal(objects.size,0);publicBucket=false;missingCode='NoSuchKey';await db.query("update public.lk_quote_photos set lease_until=now()-interval '1 second' where id=$1",[r.photo.id]);assert.deepEqual(await api.recoverQuotePhotos(),{recovered:1,deferred:0});const list=await(await api.photosGet(req('GET',cookie))).json();assert.equal(list.photos[0].status,'retryable_error');assert.equal((await api.photoContentPut(req('PUT',cookie,bytes),r.photo.id)).status,200);});

test('late provider PUT after deletion is reaped from the recorded tombstone after submission with no repeat loop',async()=>{
 const cookie=await fixture(),bytes=await image(),r=await reserve(cookie,bytes);await api.photoContentPut(req('PUT',cookie,bytes),r.photo.id);
 const [path,normalized]=[...objects.entries()][0];assert.equal((await api.photoDelete(req('DELETE',cookie,{expectedRevision:3}),r.photo.id)).status,200);assert.equal(objects.size,0);
 const photo=(await db.query<{draft_id:string}>('select draft_id from public.lk_quote_photos where id=$1',[r.photo.id])).rows[0];const owner=createHash('sha256').update(cookie.slice(cookie.indexOf('=')+1)).digest('hex'),sid=randomUUID();
 await db.query('insert into public.lk_quote_submissions(id,draft_id,owner_hash,idempotency_key,request_hash,reference,snapshot,snapshot_hash,signature,calendar_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[sid,photo.draft_id,owner,randomUUID(),'a'.repeat(64),`DEMO-${sid.slice(0,8).toUpperCase()}`,'{"photos":[]}','b'.repeat(64),'{}','synthetic-calendar']);
 // The remote provider completes its old PUT after the earlier DELETE response.
 objects.set(path,normalized);assert.equal((await api.photoContentGet(req('GET',cookie),r.photo.id)).status,404);assert.deepEqual(await api.recoverQuotePhotos(),{recovered:0,deferred:0});
 await db.query("update public.lk_quote_photos set retry_after=now()-interval '1 second' where id=$1",[r.photo.id]);assert.deepEqual(await api.recoverQuotePhotos(),{recovered:1,deferred:0});assert.equal(objects.size,0);assert.deepEqual(await api.recoverQuotePhotos(),{recovered:0,deferred:0});
 assert.equal((await db.query<{status:string}>('select status from public.lk_quote_photos where id=$1',[r.photo.id])).rows[0].status,'deleted');
});
