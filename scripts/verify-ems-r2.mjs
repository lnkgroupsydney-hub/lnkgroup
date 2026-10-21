// Synthetic-only EMS R2 browser acceptance. APIs, cookies and documents stay
// inside verify-esn-ui-fixture.mjs; this runner refuses other origins/markers.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as pause } from 'node:timers/promises'

const args = process.argv.slice(2), option = name => args[args.indexOf(name) + 1]
const base = new URL(args.includes('--base') ? option('--base') : 'http://127.0.0.1:3031')
if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('R2 browser QA requires a loopback synthetic fixture.')
const { chromium } = args.includes('--playwright') ? await import(pathToFileURL(option('--playwright')).href) : await import('playwright')
async function control(value) {
  const response = await fetch(new URL('/__fixture/control', base), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) })
  assert.equal(response.ok, true); assert.equal((await response.json()).synthetic, true, 'Synthetic control marker is required before browser launch.')
}
async function state() { const value = await (await fetch(new URL('/__fixture/state', base))).json(); assert.equal(value.synthetic, true); return value }
async function eventually(predicate) { for (let i = 0; i < 100; i++) { const value = await state(); if (predicate(value)) return value; await pause(50) } throw new Error('Timed out waiting for synthetic state.') }
const screenshots = new URL('file:///tmp/lk-ems-r2-assets/'); mkdirSync(screenshots, { recursive: true })
const count = (value, path, id) => value.requests.filter(request => request.path === path && (!id || request.requestId === id)).length
const outcomes = [], skipped = [], external = [], pageErrors = [], unexpectedResources = [], consoles = []
await control({ reset: true })
const browser = await chromium.launch({ headless: true, ...(args.includes('--channel') ? { channel: option('--channel') } : {}) })
async function scenario(name, run, expectedFailures = []) {
  if (args.includes('--only') && !name.includes(option('--only'))) { skipped.push(name); return }
  await control({ reset: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin !== base.origin && !['data:', 'blob:'].includes(url.protocol)) { external.push({ name, path: url.origin + url.pathname }); return route.abort('blockedbyclient') }
    return route.continue()
  })
  const page = await context.newPage(); page.setDefaultTimeout(15000)
  page.on('pageerror', error => pageErrors.push({ name, message: error.message }))
  page.on('console', message => { if (['error','warning'].includes(message.type())) consoles.push({ name, type: message.type(), text: message.text() }) })
  page.on('response', response => { if (response.status() >= 400 && !expectedFailures.some(([path,status]) => (path.includes('*') ? new RegExp('^' + path.replaceAll('*','[^/]+') + '$').test(new URL(response.url()).pathname) : new URL(response.url()).pathname === path) && response.status() === status)) unexpectedResources.push({ name, path: new URL(response.url()).pathname, status: response.status() }) })
  try { const evidence = await run(page, context); outcomes.push({ name, evidence, result: 'passed' }); process.stdout.write(`PASS ${name}: ${JSON.stringify(evidence)}\n`) }
  catch (cause) { process.stderr.write(JSON.stringify({ external, pageErrors, unexpectedResources, consoles }, null, 2) + '\n'); process.stderr.write(`FAIL ${name} at ${page.url()}\n${(await page.locator('body').innerText().catch(() => '')).slice(0,8000)}\n`); await page.screenshot({ path: '/tmp/lk-ems-r2-failure.png', fullPage: true }).catch(() => {}); throw cause }
  finally { await context.close() }
}
const goto = (page, path) => page.goto(new URL(path, base).href)
const shell = async page => { await page.locator('nav a[href="/admin"]').first().waitFor({ state: 'attached' }); assert.equal(await page.locator('main').count(), 1); assert.equal(await page.locator('h1').count(), 1) }
const tab = (page, name) => page.getByRole('tab', { name, exact: true })
async function addClient(page, name) { await page.getByRole('button', { name: 'Add client', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Create customer', exact: true }); await dialog.waitFor(); if (name) await dialog.locator('#customer-name').fill(name); return dialog }

const button = (page, name) => page.getByRole('button', { name, exact: true })
async function openClient(page, id) { await goto(page, `/admin/customers/${id}`); await shell(page); await page.locator('#customer-detail-heading').waitFor(); await button(page, 'Edit client').waitFor() }
async function propertyForm(page, { unit = '1', label = 'Synthetic Unit 1', address = 'Synthetic 1 QA Lane' } = {}) {
  await tab(page, 'Properties').click(); await button(page, 'Add property').click()
  for (const [name,value] of [['Property name',label],['Street address',address],['Unit/apartment (optional)',unit],['Suburb','Synthetic suburb'],['State','NSW'],['Postcode','2000'],['Reason','Synthetic separate job location']]) await page.getByLabel(name, { exact: true }).fill(value)
}
async function saved(page) { await page.getByRole('status').filter({ hasText: /Changes saved|existing property was reused/ }).waitFor() }
async function cancelDraft(page) { await button(page, 'Cancel').click(); await button(page, 'Discard and continue').click() }
async function sourceSnapshot() { const data = await state(); return { records: data.records, requests: data.liveRequests, analysis: data.liveAnalysis, bookings: data.liveBookings } }
const crmSnapshot = value => ({ customers: value.customers, properties: value.properties, relations: value.crmRelations, audits: value.audits, receipts: value.attemptCount })
const resolveAttempts = value => value.commandAttempts.filter(command => command.path === '/api/admin/customers/resolve').map(command => command.input)
async function startQuotePropertyReview(page) {
  await control({ seedQuotePropertyReview: true })
  const initial = await state(), request = initial.liveRequests[0], customer = initial.customers[1]
  await goto(page, `/admin/quotes/${request.id}`); await shell(page); await tab(page, 'Client & property').click(); await button(page, 'Save client relation').waitFor()
  await page.getByLabel('Find another existing client', { exact: true }).fill(customer.name); await button(page, 'Find existing client').click(); await page.getByLabel('Existing client', { exact: true }).selectOption(customer.id)
  await page.getByLabel('Review reason (required)', { exact: true }).fill('Synthetic client identity reviewed')
  await page.getByLabel('Property', { exact: true }).selectOption('new')
  for (const [name, value] of [['Property label', 'Synthetic entered review site'], ['Street address', '10 Synthetic Review Street'], ['Unit / apartment', ''], ['Suburb', 'Synthetic suburb'], ['State', 'NSW'], ['Postcode', '2000']]) await page.getByLabel(name, { exact: true }).fill(value)
  const original = await sourceSnapshot()
  await button(page, 'Save client relation').click(); await page.getByRole('heading', { name: 'Nothing was saved yet: check the property', exact: true }).waitFor()
  assert.deepEqual(crmSnapshot(await state()), crmSnapshot(initial), 'Candidate review must not write CRM data or a receipt')
  return { initial, request, customer, original, candidates: initial.properties.filter(p => p.customerId === customer.id).sort((a, b) => a.id.localeCompare(b.id)) }
}
try {
  await scenario('Client candidates block insert and existing selection reuses a customer', async page => {
    const before = await state(), existing = before.customers[1]
    await goto(page, '/admin/customers'); await shell(page)
    const dialog = await addClient(page, existing.name); await dialog.locator('#customer-email').fill(existing.email)
    await button(dialog, 'Create customer').click(); await dialog.getByRole('heading', { name: 'Review possible matches', exact: true }).waitFor()
    assert.equal((await state()).customers.length, before.customers.length); assert.equal((await state()).attemptCount, 0)
    await dialog.getByLabel('Client review reason', { exact: true }).fill('Synthetic existing person checked')
    await button(dialog, 'Use existing client').click(); await dialog.waitFor({ state: 'hidden' })
    const after = await state(); assert.equal(after.customers.length, before.customers.length)
    assert.equal(after.commandAttempts.at(-1).input.decision.customerId, existing.id)
    return { candidateInsertCount: 0, reusedId: existing.id, finalClients: after.customers.length }
  }, [['/api/admin/customers/resolve',409]])
  await scenario('Archived duplicate candidate opens restoration without creating another client', async page => {
    const before = await state(), existing = before.customers[1]
    const archived = await fetch(new URL(`/api/admin/customers/${existing.id}/archive`,base), { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ expectedRevision:existing.revision, reason:'Synthetic archived candidate setup', idempotencyKey:'synthetic-archived-candidate' }) }); assert.equal(archived.status,200)
    await goto(page,'/admin/customers'); await shell(page); const dialog=await addClient(page,existing.name); await dialog.locator('#customer-email').fill(existing.email); await button(dialog,'Review matches').click(); await button(dialog,'Review and restore customer').waitFor(); await button(dialog,'Review and restore customer').click(); await button(page,'Discard and continue').click()
    await page.waitForURL(url=>url.pathname===`/admin/customers/${existing.id}`); await button(page,'Restore client').click(); await page.getByLabel('Reason',{exact:true}).fill('Synthetic same archived person reviewed and restored'); await button(page,'Confirm restore').click(); await saved(page)
    const after=await state(); assert.equal(after.customers.length,before.customers.length); assert.equal(after.customers.find(v=>v.id===existing.id).status,'active'); assert.equal(after.commandAttempts.some(v=>v.path==='/api/admin/customers/resolve'),false)
    return { archivedCandidateFound:true, existingClientRestored:true, duplicateClientCount:0 }
  })
  await scenario('Shared contact creates a separate reviewed person with recorded reason', async page => {
    const before = await state(); await goto(page, '/admin/customers'); await shell(page)
    const dialog = await addClient(page, 'Synthetic distinct shared contact person'); await dialog.locator('#customer-email').fill(before.customers[1].email)
    await button(dialog, 'Review matches').click(); await dialog.getByRole('heading', { name: 'Review possible matches', exact: true }).waitFor()
    await dialog.getByLabel('Client review reason', { exact: true }).fill('Synthetic shared family email; separate person verified')
    await dialog.getByLabel('I reviewed every candidate and verified this is a different person or company.', { exact: true }).check()
    await button(dialog, 'Create reviewed different client').click(); await dialog.waitFor({ state: 'hidden' })
    const after = await state(); assert.equal(after.customers.length, before.customers.length + 1)
    assert.equal(after.commandAttempts.at(-1).input.decision.kind, 'different_person'); assert.match(after.commandAttempts.at(-1).input.decision.reason, /separate person verified/)
    return { separateClient: true, sharedEmailPreserved: true, reasonRecorded: true }
  })
  await scenario('Client edit409 keeps input and requires current revision reconfirmation', async page => {
    const c = (await state()).customers[1]; await openClient(page, c.id); await button(page, 'Edit client').click()
    await page.getByLabel('Name', { exact: true }).fill('Synthetic revised name kept after conflict'); await page.getByLabel('Reason', { exact: true }).fill('Synthetic revised billing details')
    await control({ conflictNextMutation: true }); await button(page, 'Save changes').click(); await page.getByText(/This record changed. Your input was kept/).waitFor()
    assert.equal(await page.getByLabel('Name', { exact: true }).inputValue(), 'Synthetic revised name kept after conflict'); assert.equal(await button(page, 'Save changes').isDisabled(), true)
    await button(page, 'I reviewed the latest details; keep my changes').click(); await button(page, 'Save changes').click(); await saved(page)
    const after = await state(); assert.equal(after.customers.find(v => v.id === c.id).name, 'Synthetic revised name kept after conflict'); assert.equal(after.commandAttempts.length, 2)
    return { inputKept: true, explicitReconfirmation: true, freshRevision: after.commandAttempts[1].input.expectedRevision }
  }, [['/api/admin/customers/*',409]])
  await scenario('Same customer same property is reused and unit2 remains distinct', async page => {
    const c = (await state()).customers[1]; await openClient(page, c.id)
    await propertyForm(page); await button(page, 'Save changes').click(); await saved(page)
    await propertyForm(page, { label: 'Synthetic same property spelling', address: '  Synthetic   1 QA Lane  ' }); await button(page, 'Save changes').click(); await page.getByText('The existing property was reused. No duplicate property was created.', { exact: true }).waitFor()
    assert.equal((await state()).properties.length, 1)
    await propertyForm(page, { unit: '2', label: 'Synthetic Unit 2' }); await button(page, 'Save changes').click(); await saved(page)
    const after = await state(); assert.equal(after.properties.length, 2); assert.deepEqual(after.properties.map(p => p.address.unit).sort(), ['1','2'])
    await page.screenshot({ path: fileURLToPath(new URL('ems-r2-properties-desktop.png', screenshots)), fullPage: true })
    return { sameAddressProperties: 1, distinctUnits: ['1','2'], customerCount: after.customers.length }
  })
  await scenario('Property edit archive restore preserve location identity and originals', async page => {
    const c = (await state()).customers[1], beforeSource = await sourceSnapshot(); await openClient(page, c.id); await propertyForm(page); await button(page, 'Save changes').click(); await saved(page)
    const propertyId = (await state()).properties[0].id
    await button(page, 'Edit property').click(); await page.getByLabel('Site notes (optional)', { exact: true }).fill('Synthetic updated site note'); await page.getByLabel('Reason', { exact: true }).fill('Synthetic property note update'); await button(page, 'Save changes').click(); await saved(page)
    const beforeCancel = await state(); await button(page, 'Archive property').click(); await page.getByLabel('Reason', { exact: true }).fill('Synthetic cancelled property archive'); await cancelDraft(page); assert.deepEqual((await state()).commandAttempts, beforeCancel.commandAttempts)
    await button(page, 'Archive property').click(); await page.getByLabel('Reason', { exact: true }).fill('Synthetic property temporarily inactive'); await button(page, 'Confirm archive').click(); await saved(page)
    await page.getByLabel('Property status', { exact: true }).selectOption('archived'); await button(page, 'Restore property').click(); await page.getByLabel('Reason', { exact: true }).fill('Synthetic property active again'); await button(page, 'Confirm restore').click(); await saved(page)
    await page.getByLabel('Property status', { exact: true }).selectOption('active')
    const property = (await state()).properties[0]; assert.equal(property.id, propertyId); assert.equal(property.status, 'active'); assert.equal(property.notes, 'Synthetic updated site note'); assert.deepEqual(await sourceSnapshot(), beforeSource)
    return { propertyId, restored: true, sourceSnapshotsPreserved: true }
  })
  await scenario('Archive Cancel sends no command and client restore preserves links and property', async page => {
    const c = (await state()).customers[1], source = (await state()).records[0]
    await fetch(new URL(`/api/admin/customers/${c.id}/links`,base), { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ idempotencyKey:'synthetic-preserved-link', expectedRevision:c.revision, action:'link', sourceType:source.sourceType,sourceId:source.sourceId,reason:'Synthetic linked record for archive preservation' }) })
    await openClient(page, c.id); await propertyForm(page); await button(page, 'Save changes').click(); await saved(page); await tab(page,'Summary').click()
    const before = await state(), beforeSource = await sourceSnapshot(); await button(page,'Archive client').click(); await page.getByLabel('Reason', {exact:true}).fill('Synthetic cancelled archive'); await cancelDraft(page)
    assert.deepEqual((await state()).commandAttempts, before.commandAttempts)
    await button(page,'Archive client').click(); await page.getByLabel('Reason', {exact:true}).fill('Synthetic archive preserves linked records'); await button(page,'Confirm archive').click(); await saved(page)
    await button(page,'Restore client').click(); await page.getByLabel('Reason', {exact:true}).fill('Synthetic client restored'); await button(page,'Confirm restore').click(); await saved(page)
    const after = await state(); assert.equal(after.customers.find(v=>v.id===c.id).status,'active'); assert.deepEqual(after.links,before.links); assert.deepEqual(after.properties,before.properties); assert.deepEqual(await sourceSnapshot(), beforeSource)
    await tab(page,'Connected records').click(); await page.getByRole('heading',{name:source.reference,exact:true}).waitFor()
    return { cancelledCommands:0, linkedRecordsPreserved:true, propertyPreserved:true, restored:true }
  })
  await scenario('Saved503 client creation retries exactly one immutable request', async page => {
    const before = await state(); await goto(page,'/admin/customers'); await shell(page); const dialog = await addClient(page,'Synthetic R2 lost response client')
    await control({loseNextCreateResponse:true}); await button(dialog,'Create customer').click(); await dialog.getByText(/Synthetic saved mutation response was lost/).waitFor()
    assert.equal(await dialog.locator('#customer-name').isDisabled(),true); await button(dialog,'Retry unchanged create').click(); await dialog.waitFor({state:'hidden'})
    const after = await state(); assert.equal(after.customers.length,before.customers.length+1); assert.deepEqual(after.commandAttempts[0].input,after.commandAttempts[1].input); assert.equal(after.attemptCount,1)
    return {created:1, sameKey:true, samePayload:true}
  }, [['/api/admin/customers/resolve',503]])
  await scenario('Saved503 client edit freezes fields and retries unchanged save', async page => {
    const c=(await state()).customers[1]; await openClient(page,c.id); await button(page,'Edit client').click(); await page.getByLabel('Name',{exact:true}).fill('Synthetic uncertain edit'); await page.getByLabel('Reason',{exact:true}).fill('Synthetic lost response')
    await control({loseNextMutationResponse:true}); await button(page,'Save changes').click(); await page.getByText(/Synthetic saved mutation response was lost/).waitFor(); assert.equal(await page.getByLabel('Name',{exact:true}).isDisabled(),true); assert.equal(await button(page,'Cancel').isDisabled(),true)
    await button(page,'Retry unchanged save').click(); await saved(page); const after=await state(); assert.deepEqual(after.commandAttempts[0].input,after.commandAttempts[1].input); assert.equal(after.customers.find(v=>v.id===c.id).revision,2)
    return {savedRevision:2, immutableRetry:true}
  }, [['/api/admin/customers/*',503]])
  await scenario('Quote CRM creates relation visible in Clients and preserves quote source', async page => {
    const before=await state(), original=await sourceSnapshot(), request=before.liveRequests[0]
    await goto(page,`/admin/quotes/${request.id}`); await shell(page); await tab(page,'Client & property').click(); await button(page,'Save client relation').waitFor(); await page.getByLabel('Property',{exact:true}).selectOption('new')
    for (const [name,value] of [['Property label','Synthetic quote property'],['Street address','Synthetic quote street'],['Unit / apartment','3'],['Suburb','Synthetic suburb'],['State','NSW'],['Postcode','2000']]) await page.getByLabel(name,{exact:true}).fill(value)
    await button(page,'Save client relation').click(); await page.getByText('Client created and linked. The original quote and customer access were preserved.',{exact:true}).waitFor()
    const linked=await state(), relation=linked.crmRelations.find(([id])=>id===request.id)[1]; assert.equal(linked.customers.length,before.customers.length+1); assert.equal(linked.properties.length,1); assert.deepEqual(await sourceSnapshot(),original)
    await page.getByLabel('Review reason (required)',{exact:true}).fill('Synthetic same saved quote fresh relation retry'); await button(page,'Save client relation').click(); await page.getByText('Existing client linked. The original quote and customer access were preserved.',{exact:true}).waitFor(); const replay=await state(); assert.equal(replay.customers.length,linked.customers.length); assert.equal(replay.properties.length,linked.properties.length); assert.deepEqual(await sourceSnapshot(),original)
    await page.screenshot({path:fileURLToPath(new URL('ems-r2-quote-crm.png',screenshots)),fullPage:true})
    await page.getByRole('link',{name:'Open linked client',exact:true}).click(); await button(page,'Edit client').waitFor(); await tab(page,'Connected records').click(); await page.getByRole('heading',{name:request.reference,exact:true}).waitFor(); await tab(page,'Properties').click(); await page.getByRole('heading',{name:'Synthetic quote property',exact:true}).waitFor()
    const writes=linked.requests.filter(v=>v.method!=='GET'&&v.path.startsWith('/api/admin/quote-requests')); assert.deepEqual(writes,[])
    return {crmRevision:relation.crmRevision, linkedClientVisible:true, linkedPropertyVisible:true, quoteSourceWrites:0, sourceSnapshotsPreserved:true}
  })
  await scenario('Quote CRM source refresh preserves draft and requires explicit review restart', async page => {
    const request=(await state()).liveRequests[0]; await goto(page,`/admin/quotes/${request.id}`); await shell(page); await tab(page,'Client & property').click(); await button(page,'Save client relation').waitFor(); await page.getByLabel('Property',{exact:true}).selectOption('new'); await page.getByLabel('Property label',{exact:true}).fill('Synthetic draft tied to revision2'); await page.getByLabel('Street address',{exact:true}).fill('Synthetic old reviewed site');
    await control({mutateLiveQuote:{requestId:request.id}}); await button(page,'Refresh request').click(); await page.getByText('The quote changed after this review began. Your input is preserved; review the latest source before saving.',{exact:true}).waitFor(); assert.equal(await page.getByLabel('Property label',{exact:true}).inputValue(),'Synthetic draft tied to revision2'); assert.equal(await page.getByLabel('Street address',{exact:true}).inputValue(),'Synthetic old reviewed site'); assert.equal(await button(page,'Save client relation').isDisabled(),true); assert.equal((await state()).commandAttempts.length,0)
    await button(page,'Review latest quote and restart linking').click(); await button(page,'Save client relation').waitFor(); await page.getByLabel('Property',{exact:true}).selectOption('new'); assert.equal(await page.getByLabel('Property label',{exact:true}).inputValue(),''); assert.equal(await page.getByLabel('Street address',{exact:true}).inputValue(),'Synthetic changed quote site')
    for(const[name,value]of [['Property label','Synthetic latest source property'],['Suburb','Synthetic suburb'],['State','NSW'],['Postcode','2000']]) await page.getByLabel(name,{exact:true}).fill(value)
    await button(page,'Save client relation').click(); await page.getByText('Client created and linked. The original quote and customer access were preserved.',{exact:true}).waitFor(); const after=await state(); assert.equal(after.commandAttempts[0].input.source.expectedSourceRevision,3); assert.equal(after.commandAttempts[0].input.name,'Synthetic changed quote contact')
    return { originalReview:2, latestReview:3, staleSaveBlocked:true, draftPreservedUntilExplicitRestart:true }
  })
  await scenario('Unknown quote CRM save blocks navigation and retries identical payload and key', async page => {
    const before=await state(), original=await sourceSnapshot(), request=before.liveRequests[0]; await goto(page,`/admin/quotes/${request.id}`); await shell(page); await tab(page,'Client & property').click(); await button(page,'Save client relation').waitFor(); await page.getByLabel('Property',{exact:true}).selectOption('new')
    for(const[name,value]of [['Property label','Synthetic uncertain CRM property'],['Street address','Synthetic uncertain CRM site'],['Suburb','Synthetic suburb'],['State','NSW'],['Postcode','2000']]) await page.getByLabel(name,{exact:true}).fill(value)
    await control({loseNextCrmResponse:true}); await button(page,'Save client relation').click(); await page.getByRole('heading',{name:'Result unknown',exact:true}).waitFor(); assert.equal(await page.getByLabel('Property label',{exact:true}).isDisabled(),true)
    await page.locator('nav a[href="/admin/customers"]').first().click(); await page.getByRole('heading',{name:'A request is still in progress',exact:true}).waitFor(); assert.equal(await button(page,'Discard and continue').isDisabled(),true); await button(page,'Return to form').click(); await button(page,'Retry unchanged client relation').click(); await page.getByText('Client created and linked. The original quote and customer access were preserved.',{exact:true}).waitFor()
    const after=await state(); assert.equal(after.customers.length,before.customers.length+1); assert.equal(after.properties.length,1); assert.deepEqual(after.commandAttempts[0].input,after.commandAttempts[1].input); assert.deepEqual(await sourceSnapshot(),original)
    return { clientCount:1, propertyCount:1, immutableRetry:true, navigationBlocked:true, sourcePreserved:true }
  }, [['/api/admin/customers/resolve',503]])
  await scenario('Quote CRM finds an existing client outside contact candidates', async page => {
    const before=await state(), request=before.liveRequests[0], existing=before.customers[1]; await goto(page,`/admin/quotes/${request.id}`); await shell(page); await tab(page,'Client & property').click(); await button(page,'Save client relation').waitFor(); await page.getByLabel('Find another existing client',{exact:true}).fill(existing.name); await button(page,'Find existing client').click(); await page.getByLabel('Existing client',{exact:true}).selectOption(existing.id); await page.getByLabel('Review reason (required)',{exact:true}).fill('Synthetic existing person has another project contact'); await button(page,'Save client relation').click(); await page.getByText('Existing client linked. The original quote and customer access were preserved.',{exact:true}).waitFor()
    const after=await state(); assert.equal(after.customers.length,before.customers.length); assert.equal(after.crmRelations[0][1].customerId,existing.id); return { selectedOutsideCandidates:true, reusedClientId:existing.id, createdClients:0 }
  })
  await scenario('Quote property review cancel restores input without another POST or CRM write', async page => {
    const f = await startQuotePropertyReview(page), reviewed = await state(), posts = resolveAttempts(reviewed).length
    await button(page, 'Cancel review').click(); await button(page, 'Save client relation').waitFor()
    assert.equal(await page.getByLabel('Property label', { exact: true }).inputValue(), 'Synthetic entered review site')
    assert.equal(await page.getByLabel('Street address', { exact: true }).inputValue(), '10 Synthetic Review Street'); assert.equal(await page.getByLabel('Unit / apartment', { exact: true }).inputValue(), '')
    assert.equal(await page.getByLabel('Existing client', { exact: true }).inputValue(), f.customer.id)
    assert.equal(await page.getByLabel('Review reason (required)', { exact: true }).inputValue(), 'Synthetic client identity reviewed')
    const after = await state(); assert.equal(resolveAttempts(after).length, posts); assert.deepEqual(crmSnapshot(after), crmSnapshot(f.initial)); assert.deepEqual(await sourceSnapshot(), f.original)
    return { reviewPosts: posts, cancelPosts: 0, originalFormRestored: true, noWrites: true, sourcePreserved: true }
  }, [['/api/admin/customers/resolve',409]])
  await scenario('Quote property review existing selection keeps key and every reviewed revision', async page => {
    const f = await startQuotePropertyReview(page), property = f.candidates[0]
    await page.getByRole('button', { name: `Use existing property: ${property.label}, unit ${property.address.unit}`, exact: true }).click()
    await page.getByText('Existing client linked. The original quote and customer access were preserved.', { exact: true }).waitFor()
    const after = await state(), [first, selected] = resolveAttempts(after)
    assert.equal(selected.idempotencyKey, first.idempotencyKey); assert.deepEqual(selected.source, first.source); assert.deepEqual(selected.decision, first.decision)
    assert.equal(selected.propertyId, property.id); assert.equal(selected.expectedPropertyRevision, property.revision); assert.equal('property' in selected, false); assert.equal('propertyDecision' in selected, false)
    assert.equal(after.customers.length, f.initial.customers.length); assert.equal(after.properties.length, f.initial.properties.length); assert.equal(after.crmRelations[0][1].propertyId, property.id); assert.deepEqual(await sourceSnapshot(), f.original)
    return { posts: 2, sameKey: true, sourceAndClientRevisionsPreserved: true, expectedPropertyRevision: property.revision, newProperties: 0 }
  }, [['/api/admin/customers/resolve',409]])
  await scenario('Quote property review confirms a separate site with reason and every candidate revision', async page => {
    const f = await startQuotePropertyReview(page)
    assert.equal(await button(page, 'Confirm separate property').isDisabled(), true)
    await page.getByLabel('Property review reason', { exact: true }).fill('Synthetic separate rear building verified against every saved unit')
    await page.getByLabel('I reviewed every candidate and verified this is a different property.', { exact: true }).check(); await button(page, 'Confirm separate property').click()
    await page.getByText('Existing client linked. The original quote and customer access were preserved.', { exact: true }).waitFor()
    const after = await state(), [first, confirmed] = resolveAttempts(after)
    assert.equal(confirmed.idempotencyKey, first.idempotencyKey); assert.deepEqual(confirmed.source, first.source); assert.deepEqual(confirmed.decision, first.decision); assert.deepEqual(confirmed.property, first.property)
    assert.equal(confirmed.propertyDecision.kind, 'different_property'); assert.equal(confirmed.propertyDecision.reason, 'Synthetic separate rear building verified against every saved unit')
    assert.deepEqual(confirmed.propertyDecision.reviewedProperties, f.candidates.map(p => ({ id: p.id, revision: p.revision }))); assert.equal('propertyId' in confirmed, false); assert.equal('expectedPropertyRevision' in confirmed, false)
    assert.equal(after.properties.length, f.initial.properties.length + 1); assert.equal(after.customers.length, f.initial.customers.length); assert.deepEqual(await sourceSnapshot(), f.original)
    return { sameKey: true, candidatesReviewed: f.candidates.length, reasonRecorded: true, newProperties: 1, sourcePreserved: true }
  }, [['/api/admin/customers/resolve',409]])
  await scenario('Quote property changed in another tab causes property409 comparison and explicit restart', async page => {
    const f = await startQuotePropertyReview(page), property = f.candidates[0]
    await control({ mutateProperty: { propertyId: property.id, address: { unit: '3' } } })
    const changed = await state(); assert.equal(changed.customers.find(c => c.id === f.customer.id).revision, f.customer.revision, 'Keep client revision current to prove the property CAS independently')
    await page.getByRole('button', { name: `Use existing property: ${property.label}, unit ${property.address.unit}`, exact: true }).click()
    await page.getByRole('heading', { name: 'The quote or client relation changed', exact: true }).waitFor()
    const restart = button(page, 'Restart linking from latest'); await restart.waitFor(); await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Restart linking from latest' && !b.disabled))
    assert.equal(await page.getByLabel('Property label', { exact: true }).inputValue(), 'Synthetic entered review site')
    const after = await state(), [first, stale] = resolveAttempts(after); assert.equal(stale.idempotencyKey, first.idempotencyKey); assert.equal(stale.expectedPropertyRevision, property.revision); assert.deepEqual(stale.source, first.source)
    assert.deepEqual(crmSnapshot(after), crmSnapshot(changed)); assert.deepEqual(await sourceSnapshot(), f.original)
    await restart.click(); await button(page, 'Save client relation').waitFor(); assert.equal(await page.getByLabel('Existing client', { exact: true }).inputValue().catch(() => ''), '')
    return { oldPropertyRevision: property.revision, latestPropertyRevision: changed.properties.find(p => p.id === property.id).revision, customerRevisionUnchanged: true, conflictWrites: 0, explicitRestart: true }
  }, [['/api/admin/customers/resolve',409]])
  await scenario('401 removes client dialog draft and rejects late candidate response', async page => {
    await goto(page,'/admin/customers'); await shell(page); const dialog=await addClient(page,'Synthetic secret draft removed after401'); await dialog.locator('#customer-email').fill((await state()).customers[1].email)
    await control({responseDelays:{'/api/admin/customers/candidates':700}}); await button(dialog,'Review matches').click(); await eventually(v=>count(v,'/api/admin/customers/candidates')===1)
    await control({signedOut:true,responseDelays:{}}); await page.evaluate(()=>window.dispatchEvent(new Event('focus'))); await page.locator('#staff-access-content').waitFor(); await pause(850)
    assert.equal(await page.locator('#customer-name').count(),0); assert.equal((await page.locator('body').innerText()).includes('Synthetic secret'),false)
    await control({signedOut:false}); await page.reload(); await shell(page); const fresh=await addClient(page); assert.equal(await fresh.locator('#customer-name').inputValue(),''); assert.equal(await fresh.getByRole('heading',{name:'Review possible matches',exact:true}).count(),0)
    return {draftCleared:true, lateCandidatesCannotRestorePii:true}
  }, [['/api/admin/customers',401],['/api/operations',401]])
  await scenario('401 removes management PII before delayed save returns', async page => {
    const c=(await state()).customers[1]; await openClient(page,c.id); await button(page,'Edit client').click(); await page.getByLabel('Name',{exact:true}).fill('Synthetic secret pending management'); await page.getByLabel('Reason',{exact:true}).fill('Synthetic secret save reason')
    await control({responseDelays:{[`/api/admin/customers/${c.id}`]:700}}); await button(page,'Save changes').click(); await eventually(v=>v.commandAttempts.length===1); await control({signedOut:true,responseDelays:{}})
    await page.evaluate(()=>window.dispatchEvent(new Event('focus'))); await page.locator('#staff-access-content').waitFor(); await pause(850); assert.equal((await page.locator('body').innerText()).includes('Synthetic secret'),false); assert.equal(await page.locator('.customers-console').count(),0)
    await control({signedOut:false}); await page.reload(); await button(page,'Edit client').waitFor(); assert.equal(await page.getByLabel('Reason',{exact:true}).count(),0)
    return {pendingDraftCleared:true, lateSaveCannotRestorePrivateUi:true}
  }, [['/api/admin/customers/*',401],['/api/operations',401]])
  await scenario('Properties and create dialog reflow3203931440 and keyboard focus remains visible', async page => {
    const c=(await state()).customers[1]
    for(const width of [320,393,1440]) {
      await page.setViewportSize({width,height:1000}); await openClient(page,c.id); await propertyForm(page,{label:`Synthetic viewport ${width}`,unit:String(width)})
      await page.getByLabel('Street address',{exact:true}).focus(); await page.keyboard.press('Tab'); assert.equal(await page.getByLabel('Unit/apartment (optional)',{exact:true}).evaluate(el=>document.activeElement===el),true)
      const overflow=await page.evaluate(()=>({actual:document.documentElement.scrollWidth,viewport:innerWidth})); assert.ok(overflow.actual<=overflow.viewport,JSON.stringify(overflow)); if(width===393) await page.screenshot({path:fileURLToPath(new URL('ems-r2-property-mobile.png',screenshots)),fullPage:true})
      await button(page,'Save changes').click(); await saved(page); await goto(page,'/admin/customers'); await shell(page); const dialog=await addClient(page); await page.keyboard.press('Tab'); assert.equal(await dialog.evaluate(el=>el.contains(document.activeElement)),true); const box=await dialog.boundingBox(); assert.ok(box.x>=0&&box.x+box.width<=width); await page.keyboard.press('Escape'); await dialog.waitFor({state:'hidden'}); assert.equal(await button(page,'Add client').evaluate(el=>document.activeElement===el),true)
    }
    return {widths:[320,393,1440],propertyFormNoOverflow:true,dialogFocusRestored:true,keyboardFields:true}
  })
  assert.deepEqual(external, [], 'No browser requests may leave synthetic origin'); assert.deepEqual(pageErrors, [], 'No uncaught browser errors'); assert.deepEqual(unexpectedResources, [], 'Unexpected HTTP failures must be resolved')
  process.stdout.write(JSON.stringify({synthetic:true,passed:outcomes.length,outcomes,skipped,external,pageErrors,unexpectedResources,consoles},null,2)+'\n')
} finally { await browser.close() }
