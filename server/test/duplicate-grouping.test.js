import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import jwt from 'jsonwebtoken';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'civicpulse-duplicates-'));
Object.assign(process.env,{NODE_ENV:'test',DATABASE_PATH:path.join(dir,'db.sqlite'),JWT_SECRET:'duplicate-test-secret-long-enough-for-validation',CORS_ORIGINS:'http://localhost:3000',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'test-key',GEMINI_API_KEY:'test-key',GEMINI_MODEL:'gemini-3.5-flash-lite'});
const {db,closeDatabase}=await import('../src/config/database.js'); const {migrateDatabase}=await import('../src/database/migrate.js'); migrateDatabase(db);
const duplicate=await import('../src/modules/admin/duplicate.service.js'); const {default:app}=await import('../src/app.js');
let server,baseUrl; let ids={};
function user(id,role){db.prepare("INSERT INTO users(id,display_name,email,password_hash,role,email_verified) VALUES(?,?,?,'hash',?,?)").run(id,`User ${id}`,`user${id}@test.local`,role,role==='CITIZEN'?1:0);}
function issue(status='OPEN',target=null){return Number(db.prepare('INSERT INTO civic_issues(status,merged_into_issue_id) VALUES(?,?)').run(status,target).lastInsertRowid);}
function complaint(uid,iid,lat=12.3,lon=45.6,date='2026-11-01T12:00:00.000Z',title='Road damage',description='A pothole in the road by the crossing.'){
 return Number(db.prepare('INSERT INTO complaints(user_id,civic_issue_id,title,description,latitude,longitude,created_at) VALUES(?,?,?,?,?,?,?)').run(uid,iid,title,description,lat,lon,date).lastInsertRowid);
}
function suggestion(a,b){const [x,y]=[a,b].sort((p,q)=>p-q);return Number(db.prepare("INSERT INTO civic_issue_duplicate_suggestions(issue_a_id,issue_b_id,deterministic_score,signals_json) VALUES(?,?,.8,'{}')").run(x,y).lastInsertRowid);}
function addLegacyIndividualAssignment(issueId,officerId){
 db.exec('DROP TRIGGER civic_issue_individual_assignment_deprecated');
 db.prepare('UPDATE civic_issues SET assigned_officer_id=? WHERE id=?').run(officerId,issueId);
 db.exec(`CREATE TRIGGER civic_issue_individual_assignment_deprecated BEFORE UPDATE OF assigned_officer_id ON civic_issues
   WHEN NEW.assigned_officer_id IS NOT NULL AND NEW.assigned_officer_id IS NOT OLD.assigned_officer_id
   BEGIN SELECT RAISE(ABORT,'new individual assignments are disabled'); END`);
}
function token(id){return jwt.sign({},process.env.JWT_SECRET,{algorithm:'HS256',subject:String(id),issuer:'civicpulse-api',audience:'civicpulse-client'});}
async function req(uri,{id=1,method='GET',body}={}){const headers={cookie:`civicpulse_token=${token(id)}`};if(body!==undefined)headers['content-type']='application/json';return fetch(`${baseUrl}${uri}`,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});}
before(async()=>{user(1,'ADMIN');user(2,'CITIZEN');user(3,'OFFICER');user(4,'OFFICER');
 ids.a=issue();ids.b=issue();ids.ca=complaint(2,ids.a);ids.cb=complaint(2,ids.b,12.3001,45.6,'2026-11-02T12:00:00.000Z');
 for(const cid of [ids.ca,ids.cb])db.prepare("INSERT INTO complaint_ai_assessments(complaint_id,status,category,department,severity,risk_factors,confidence,human_review_required) VALUES(?,'SUCCEEDED','ROAD_DAMAGE','Roads & Infrastructure','LOW','[]',.9,0)").run(cid);
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));baseUrl=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{if(server)await new Promise(r=>server.close(r));closeDatabase();fs.rmSync(dir,{recursive:true,force:true});});

test('duplicate AI provider returns validated results and maps failures safely', async()=>{
 const { assessDuplicatePair }=await import('../src/services/geminiProvider.js');
 const successClient={models:{async generateContent(){return {text:JSON.stringify({result:'LIKELY_DUPLICATE',confidence:0.91,rationale:'The reports describe the same road defect.'})};}}};
 const success=await assessDuplicatePair([{title:'Pothole',description:'A road pothole'}],successClient);
 assert.equal(success.result,'LIKELY_DUPLICATE');
 const failureClient={models:{async generateContent(){throw Object.assign(new Error('secret provider text'),{status:429});}}};
 await assert.rejects(()=>assessDuplicatePair([{title:'Pothole',description:'A road pothole'}],failureClient),
   (error)=>error.code==='PROVIDER_RATE_LIMITED');
});

test('deterministic matching uses distance, time and aggregate categories; category alone is insufficient',()=>{
 const made=duplicate.generateCandidatesForComplaint(ids.cb); assert.equal(made,1);
 assert.equal(duplicate.listDuplicateCandidates({limit:20,offset:0,status:'PENDING'}).items.length,1);
 const far=issue();const fc=complaint(2,far,12.304,45.6,'2026-11-02T12:00:00.000Z');
 db.prepare("INSERT INTO complaint_ai_assessments(complaint_id,status,category) VALUES(?,'SUCCEEDED','ROAD_DAMAGE')").run(fc);
 assert.equal(duplicate.generateCandidatesForComplaint(fc),0);
});

test('admin endpoints reject citizens and officers and listing omits private report data and coordinates',async()=>{
 const id=db.prepare('SELECT id FROM civic_issue_duplicate_suggestions WHERE issue_a_id=? AND issue_b_id=?').get(Math.min(ids.a,ids.b),Math.max(ids.a,ids.b)).id;
 for(const roleId of [2,3])assert.equal((await req('/api/admin/duplicate-candidates',{id:roleId})).status,403);
 const response=await req('/api/admin/duplicate-candidates');assert.equal(response.status,200);const text=await response.text();
 assert.match(text,/suggestionId/);assert.doesNotMatch(text,/pothole in the road|latitude|longitude|user_id|test\.local/);
 assert.ok(id>0);
});

test('grouping preserves canonical assignment and complaints while flattening source descendants',()=>{
 const root=issue(),source=issue(),desc=issue('MERGED',source);complaint(2,source);complaint(2,desc);
 const sid=suggestion(root,source);const result=duplicate.approveDuplicate(sid,root,1);
 assert.equal(result.sourceIssueId,source);
 assert.equal(db.prepare('SELECT status,merged_into_issue_id FROM civic_issues WHERE id=?').get(source).status,'MERGED');
 assert.equal(db.prepare('SELECT merged_into_issue_id FROM civic_issues WHERE id=?').get(desc).merged_into_issue_id,root);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM complaints WHERE civic_issue_id=?').get(root).n,2);
 assert.equal(db.prepare('SELECT assigned_officer_id FROM civic_issues WHERE id=?').get(root).assigned_officer_id,null);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM civic_issue_grouping_events WHERE suggestion_id=?').get(sid).n,1);
});

test('assignment conflict, stale suggestions, and circular chains reject approval',()=>{
 const a=issue(),b=issue(),sid=suggestion(a,b);addLegacyIndividualAssignment(b,4);
 assert.throws(()=>duplicate.approveDuplicate(sid,a,1),{status:409});
 db.prepare('UPDATE civic_issues SET assigned_officer_id=NULL WHERE id=?').run(b);
 addLegacyIndividualAssignment(a,3);
 assert.throws(()=>duplicate.approveDuplicate(sid,a,1),{status:409});
 assert.equal(db.prepare('SELECT assigned_officer_id FROM civic_issues WHERE id=?').get(a).assigned_officer_id,3);
 db.prepare('UPDATE civic_issues SET assigned_officer_id=NULL WHERE id=?').run(a);
 db.prepare("UPDATE civic_issues SET status='MERGED',merged_into_issue_id=? WHERE id=?").run(a,b);
 assert.throws(()=>duplicate.approveDuplicate(sid,a,1),{status:409});
 assert.equal(db.prepare('SELECT status FROM civic_issue_duplicate_suggestions WHERE id=?').get(sid).status,'STALE');
 const x=issue(),y=issue();db.prepare("UPDATE civic_issues SET status='MERGED',merged_into_issue_id=? WHERE id=?").run(y,x);
 assert.throws(()=>db.prepare('UPDATE civic_issues SET merged_into_issue_id=? WHERE id=?').run(x,y));
 const cycle=suggestion(x,y);assert.throws(()=>duplicate.approveDuplicate(cycle,y,1),{status:409});
});

test('duplicate grouping rejects issues with an active ward team assignment',()=>{
 const source=issue(),target=issue(),sid=suggestion(source,target);
 const ward=Number(db.prepare("INSERT INTO wards(code,name) VALUES('GROUP-WARD','Grouping Ward')").run().lastInsertRowid);
 const team=Number(db.prepare("INSERT INTO ward_teams(ward_id,name,department) VALUES(?,'Grouping Team','Roads & Infrastructure')").run(ward).lastInsertRowid);
 db.prepare('INSERT INTO ward_team_memberships(team_id,officer_user_id,added_by_admin_id) VALUES(?,?,1)').run(team,3);
 db.prepare("UPDATE civic_issues SET assigned_team_id=?,routing_department='Roads & Infrastructure' WHERE id=?").run(team,source);
 assert.throws(()=>duplicate.approveDuplicate(sid,target,1),{status:409});
 assert.equal(db.prepare('SELECT status FROM civic_issue_duplicate_suggestions WHERE id=?').get(sid).status,'PENDING');
 assert.equal(db.prepare('SELECT status FROM civic_issues WHERE id=?').get(source).status,'OPEN');
});

test('duplicate grouping rejects verification and final dispute-review history on either issue tree',async()=>{
 const verified=issue('RESOLVED'),target=issue(),verifiedComplaint=complaint(2,verified);
 db.prepare(`INSERT INTO civic_issue_resolution_verifications
   (civic_issue_id,complaint_id,citizen_user_id,decision) VALUES(?,?,2,'CONFIRM')`).run(verified,verifiedComplaint);
 const verifiedSuggestion=suggestion(verified,target);
 assert.throws(()=>duplicate.approveDuplicate(verifiedSuggestion,target,1),{status:409});
 assert.equal(db.prepare('SELECT status FROM civic_issues WHERE id=?').get(verified).status,'RESOLVED');
 assert.equal(db.prepare('SELECT status FROM civic_issue_duplicate_suggestions WHERE id=?').get(verifiedSuggestion).status,'PENDING');

 const reviewed=issue('RESOLVED'),other=issue(),reviewedComplaint=complaint(2,reviewed);
 db.prepare(`INSERT INTO civic_issue_resolution_verifications
   (civic_issue_id,complaint_id,citizen_user_id,decision,reason) VALUES(?,?,2,'DISPUTE','Still unresolved')`)
   .run(reviewed,reviewedComplaint);
 const { createDisputeReviewService }=await import('../src/modules/admin/dispute-review.service.js');
 createDisputeReviewService().reviewDispute(reviewed,1,{decision:'REJECT',reason:'Repair was adequate'});
 const reviewedSuggestion=suggestion(other,reviewed);
 assert.throws(()=>duplicate.approveDuplicate(reviewedSuggestion,other,1),{status:409});
 assert.equal(db.prepare('SELECT decision FROM civic_issue_dispute_reviews WHERE civic_issue_id=?').get(reviewed).decision,'REJECTED');
 assert.equal(db.prepare('SELECT status FROM civic_issue_duplicate_suggestions WHERE id=?').get(reviewedSuggestion).status,'PENDING');
});

test('late grouping failure rolls back links, merge state, review and audit; repeated review conflicts',()=>{
 const a=issue(),b=issue();complaint(2,b);const sid=suggestion(a,b);
 db.exec(`CREATE TRIGGER fail_group_test BEFORE INSERT ON civic_issue_grouping_events WHEN NEW.suggestion_id=${sid} BEGIN SELECT RAISE(ABORT,'forced'); END`);
 assert.throws(()=>duplicate.approveDuplicate(sid,a,1));
 assert.equal(db.prepare('SELECT status FROM civic_issues WHERE id=?').get(b).status,'OPEN');
 assert.equal(db.prepare('SELECT civic_issue_id FROM complaints WHERE civic_issue_id=?').get(b).civic_issue_id,b);
 assert.equal(db.prepare('SELECT status FROM civic_issue_duplicate_suggestions WHERE id=?').get(sid).status,'PENDING');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM civic_issue_grouping_events WHERE suggestion_id=?').get(sid).n,0);db.exec('DROP TRIGGER fail_group_test');
 duplicate.approveDuplicate(sid,a,1);assert.throws(()=>duplicate.approveDuplicate(sid,a,1),{status:409});
});

test('rejection is retained and normalized pair cannot be recreated; concurrent reviews commit once',async()=>{
 const a=issue(),b=issue(),sid=suggestion(a,b);
 const rejected=await req(`/api/admin/duplicate-candidates/${sid}/reject`,{method:'POST',body:{reason:'Not the same issue'}});assert.equal(rejected.status,200);
 assert.throws(()=>suggestion(b,a));
 const c=issue(),d=issue(),review=suggestion(c,d);
 const results=await Promise.all([req(`/api/admin/duplicate-candidates/${review}/approve`,{method:'POST',body:{canonicalIssueId:c}}),req(`/api/admin/duplicate-candidates/${review}/reject`,{method:'POST',body:{reason:'Different'}})]);
 assert.equal(results.filter(x=>x.status===200).length,1);assert.equal(results.filter(x=>x.status===409).length,1);
});
