import { db } from '../../config/database.js';
import { redactPersonalDetails, assessDuplicatePair } from '../../services/geminiProvider.js';

export const DUPLICATE_CONFIG = Object.freeze({
  maxDistanceMeters: 100, maxTimeDifferenceDays: 30, maxRecentComplaints: 500,
  maxSuggestionsPerComplaint: 20,
  // Distance contributes up to 0.50, time up to 0.30, and aggregate category evidence up to 0.20.
  // Minimum distance/time signal gates prevent a category-only pair from being proposed.
  weights: Object.freeze({ distance: 0.50, time: 0.30, category: 0.20 }),
  minimumScore: 0.55, minimumDistanceSignal: 0.25, minimumTimeSignal: 0.25
});

export class DuplicateError extends Error {
  constructor(message, status=409) { super(message); this.status=status; this.expose=status>=400&&status<600; }
}
const haversine = (a,b) => {
  const rad = (n) => n * Math.PI / 180, dLat=rad(b.latitude-a.latitude), dLon=rad(b.longitude-a.longitude);
  const h=Math.sin(dLat/2)**2+Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(dLon/2)**2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1-h));
};
function categorySummary(issueId) {
  const rows=db.prepare(`WITH latest_success AS (
    SELECT a.complaint_id,a.category FROM complaint_ai_assessments a
    WHERE a.status='SUCCEEDED' AND a.category IS NOT NULL AND a.id=(SELECT latest.id FROM complaint_ai_assessments latest
      WHERE latest.complaint_id=a.complaint_id AND latest.status='SUCCEEDED' ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1)
  ) SELECT a.category,COUNT(*) AS count FROM complaints c JOIN latest_success a ON a.complaint_id=c.id
    WHERE c.civic_issue_id=? GROUP BY a.category ORDER BY count DESC,a.category`).all(issueId);
  const total=rows.reduce((n,r)=>n+r.count,0);
  if(!total) return {status:'UNKNOWN', categories:[], dominant:null, confidence:0};
  const confidence=rows[0].count/total;
  return {status:rows.length===1?'CONSISTENT':confidence>=0.7?'DOMINANT':'MIXED', categories:rows.map(r=>({category:r.category,count:r.count})), dominant:confidence>=0.7?rows[0].category:null, confidence};
}
function activeRoot(issueId) {
  return db.prepare(`WITH RECURSIVE chain(id,status,merged_into_issue_id,path,cycle) AS (
    SELECT id,status,merged_into_issue_id,printf('/%d/',id),0 FROM civic_issues WHERE id=?
    UNION ALL SELECT n.id,n.status,n.merged_into_issue_id,chain.path||n.id||'/',instr(chain.path,printf('/%d/',n.id))>0
    FROM civic_issues n JOIN chain ON n.id=chain.merged_into_issue_id WHERE chain.cycle=0
  ) SELECT id,status,merged_into_issue_id,cycle FROM chain ORDER BY length(path) DESC LIMIT 1`).get(issueId);
}
export function generateCandidatesForComplaint(complaintId) {
  const complaint=db.prepare(`SELECT c.id,c.civic_issue_id,c.latitude,c.longitude,c.created_at FROM complaints c WHERE c.id=?`).get(complaintId);
  if(!complaint) return 0;
  const latDelta=DUPLICATE_CONFIG.maxDistanceMeters/111000;
  const lonDelta=latDelta/Math.max(0.01,Math.cos(complaint.latitude*Math.PI/180));
  const minLon=complaint.longitude-lonDelta, maxLon=complaint.longitude+lonDelta;
  const longitudeClause=minLon < -180 || maxLon > 180
    ? '(c.longitude >= ? OR c.longitude <= ?)'
    : 'c.longitude BETWEEN ? AND ?';
  const longitudeParams=minLon < -180 ? [minLon+360,maxLon] : maxLon > 180 ? [minLon,maxLon-360] : [minLon,maxLon];
  const timestamp=Date.parse(complaint.created_at);
  const fromTime=new Date(timestamp-DUPLICATE_CONFIG.maxTimeDifferenceDays*86400000).toISOString();
  const toTime=new Date(timestamp+DUPLICATE_CONFIG.maxTimeDifferenceDays*86400000).toISOString();
  const candidates=db.prepare(`SELECT c.id,c.civic_issue_id,c.latitude,c.longitude,c.created_at
    FROM complaints c JOIN civic_issues i ON i.id=c.civic_issue_id
    WHERE c.civic_issue_id<>? AND i.status<>'MERGED' AND i.merged_into_issue_id IS NULL
      AND c.latitude BETWEEN ? AND ? AND ${longitudeClause}
      AND c.created_at BETWEEN ? AND ?
    ORDER BY c.created_at DESC,c.id DESC LIMIT ?`).all(complaint.civic_issue_id,
      Math.max(-90,complaint.latitude-latDelta),Math.min(90,complaint.latitude+latDelta),
      ...longitudeParams,
      fromTime,toTime,DUPLICATE_CONFIG.maxRecentComplaints);
  const originCat=categorySummary(complaint.civic_issue_id), pairs=new Map();
  for(const other of candidates){
    const root=activeRoot(other.civic_issue_id); if(!root||root.cycle||root.status==='MERGED'||root.id===complaint.civic_issue_id) continue;
    const distance=haversine(complaint,other); if(distance>DUPLICATE_CONFIG.maxDistanceMeters) continue;
    const hours=Math.abs(Date.parse(complaint.created_at)-Date.parse(other.created_at))/3600000;
    if(!Number.isFinite(hours)||hours>DUPLICATE_CONFIG.maxTimeDifferenceDays*24) continue;
    const d=1-distance/DUPLICATE_CONFIG.maxDistanceMeters, t=1-hours/(DUPLICATE_CONFIG.maxTimeDifferenceDays*24);
    const otherCat=categorySummary(root.id);
    const category=originCat.dominant&&otherCat.dominant?(originCat.dominant===otherCat.dominant?1:0):0.35;
    const score=d*DUPLICATE_CONFIG.weights.distance+t*DUPLICATE_CONFIG.weights.time+category*DUPLICATE_CONFIG.weights.category;
    if(d<DUPLICATE_CONFIG.minimumDistanceSignal||t<DUPLICATE_CONFIG.minimumTimeSignal||score<DUPLICATE_CONFIG.minimumScore) continue;
    const [a,b]=[complaint.civic_issue_id,root.id].sort((x,y)=>x-y), key=`${a}:${b}`;
    if(pairs.has(key)) continue;
    pairs.set(key,{a,b,score,signals:{distanceMeters:Math.round(distance),timeDifferenceHours:Math.round(hours),categoryStatus:originCat.status==='UNKNOWN'||otherCat.status==='UNKNOWN'?'UNCERTAIN':originCat.dominant===otherCat.dominant?'MATCH':'CONFLICT',categoryA:originCat,categoryB:otherCat}});
  }
  const insert=db.prepare(`INSERT INTO civic_issue_duplicate_suggestions(issue_a_id,issue_b_id,deterministic_score,signals_json)
    VALUES(?,?,?,?) ON CONFLICT(issue_a_id,issue_b_id) DO NOTHING`);
  let created=0;
  for(const pair of [...pairs.values()].sort((x,y)=>y.score-x.score).slice(0,DUPLICATE_CONFIG.maxSuggestionsPerComplaint))
    created+=insert.run(pair.a,pair.b,pair.score,JSON.stringify(pair.signals)).changes;
  return created;
}
export function listDuplicateCandidates({limit,offset,status='PENDING'}) {
  if(status==='PENDING') {
    const pending=db.prepare("SELECT id,issue_a_id,issue_b_id FROM civic_issue_duplicate_suggestions WHERE status='PENDING'").all();
    for(const row of pending) markStaleIfInvalid(row);
  }
  const rows=db.prepare(`SELECT * FROM civic_issue_duplicate_suggestions WHERE status=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`).all(status,limit+1,offset);
  const hasMore=rows.length>limit;
  const items=rows.slice(0,limit).map(row=>{
    const a=db.prepare('SELECT status FROM civic_issues WHERE id=?').get(row.issue_a_id), b=db.prepare('SELECT status FROM civic_issues WHERE id=?').get(row.issue_b_id);
    return {suggestionId:row.id,status:row.status,score:row.deterministic_score,signals:JSON.parse(row.signals_json),
      issueA:{id:row.issue_a_id,status:a?.status,categorySummary:categorySummary(row.issue_a_id)},
      issueB:{id:row.issue_b_id,status:b?.status,categorySummary:categorySummary(row.issue_b_id)},
      suggestedCanonicalIssueId:row.issue_a_id,aiAssessment:row.ai_result?{result:row.ai_result,confidence:row.ai_confidence,rationale:row.ai_rationale}:null};
  });
  return {items,pagination:{limit,offset,hasMore}};
}
const adminExists=id=>db.prepare("SELECT 1 FROM users WHERE id=? AND role='ADMIN'").get(id);
const activeDuplicateAssessments = new Set();
export async function assessDuplicate(id,adminId) {
  if(!adminExists(adminId)) throw new DuplicateError('Admin authorization is required',403);
  const row=db.prepare("SELECT * FROM civic_issue_duplicate_suggestions WHERE id=? AND status='PENDING'").get(id);
  if(!row) throw new DuplicateError('Pending suggestion not found',404);
  if(activeDuplicateAssessments.has(String(id))) throw new DuplicateError('AI assessment is already in progress',409);
  activeDuplicateAssessments.add(String(id));
  try {
  const texts=db.prepare(`SELECT c.title,c.description FROM complaints c WHERE c.civic_issue_id IN (?,?) ORDER BY c.created_at DESC LIMIT 6`).all(row.issue_a_id,row.issue_b_id)
    .map(x=>({title:redactPersonalDetails(x.title).slice(0,160),description:redactPersonalDetails(x.description).slice(0,500)}));
  if(texts.length===0) throw new DuplicateError('No complaint text is available for assessment',409);
  let result;
  try { result=await assessDuplicatePair(texts); }
  catch(error){
    const status=error?.code==='PROVIDER_UNCONFIGURED'?503:502;
    throw new DuplicateError(error?.message || 'AI assessment is temporarily unavailable',status);
  }
  db.prepare(`UPDATE civic_issue_duplicate_suggestions SET ai_result=?,ai_confidence=?,ai_rationale=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='PENDING'`)
    .run(result.result,result.confidence,result.rationale,id);
  return {id,status:'PENDING',aiAssessment:result};
  } finally { activeDuplicateAssessments.delete(String(id)); }
}
function markStaleIfInvalid(row) {
  const a=activeRoot(row.issue_a_id),b=activeRoot(row.issue_b_id);
  if(!a||!b||a.cycle||b.cycle||a.status==='MERGED'||b.status==='MERGED'||a.id!==row.issue_a_id||b.id!==row.issue_b_id){
    db.prepare("UPDATE civic_issue_duplicate_suggestions SET status='STALE',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='PENDING'").run(row.id); return true;
  }
  return false;
}
const reviewReject=db.transaction((id,reason,adminId)=>{
  if(!adminExists(adminId)) throw new DuplicateError('Admin authorization is required',403);
  const row=db.prepare('SELECT * FROM civic_issue_duplicate_suggestions WHERE id=?').get(id);
  if(!row) throw new DuplicateError('Suggestion not found',404);
  if(row.status!=='PENDING') throw new DuplicateError(row.status==='STALE'?'Stale suggestions cannot be reviewed':'Suggestion has already been reviewed');
  if(markStaleIfInvalid(row)) return { stale: true };
  const result=db.prepare("UPDATE civic_issue_duplicate_suggestions SET status='REJECTED',reviewer_admin_id=?,reviewed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),rejection_reason=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='PENDING'").run(adminId,reason,id);
  if(result.changes!==1) throw new DuplicateError('Suggestion has already been reviewed');
  return {id,status:'REJECTED'};
});
const rejectDuplicateTx=reviewReject.immediate.bind(reviewReject);
export function rejectDuplicate(...args) { const result=rejectDuplicateTx(...args); if(result.stale) throw new DuplicateError('Suggestion is stale'); return result; }
const approveTx=db.transaction((id,canonicalId,adminId)=>{
  if(!adminExists(adminId)) throw new DuplicateError('Admin authorization is required',403);
  const row=db.prepare('SELECT * FROM civic_issue_duplicate_suggestions WHERE id=?').get(id);
  if(!row) throw new DuplicateError('Suggestion not found',404);
  if(row.status!=='PENDING') throw new DuplicateError(row.status==='STALE'?'Stale suggestions cannot be approved':'Suggestion has already been reviewed');
  if(markStaleIfInvalid(row)) return { stale: true };
  if(![row.issue_a_id,row.issue_b_id].includes(canonicalId)) throw new DuplicateError('Canonical issue must be part of the suggestion',400);
  const sourceId=canonicalId===row.issue_a_id?row.issue_b_id:row.issue_a_id;
  const descendantsOf=(root)=>db.prepare(`WITH RECURSIVE descendants(id) AS (SELECT ? UNION SELECT i.id FROM civic_issues i JOIN descendants d ON i.merged_into_issue_id=d.id) SELECT id FROM descendants`).all(root).map(x=>x.id);
  const tree=descendantsOf(sourceId), targetTree=descendantsOf(canonicalId);
  const allIds=[...new Set([...tree,...targetTree])];
  const placeholders=allIds.map(()=>'?').join(',');
  const verified=db.prepare(`SELECT civic_issue_id FROM civic_issue_resolution_verifications
    WHERE civic_issue_id IN (${placeholders}) UNION ALL
    SELECT civic_issue_id FROM civic_issue_dispute_reviews
    WHERE civic_issue_id IN (${placeholders}) LIMIT 1`).get(...allIds,...allIds);
  if(verified) throw new DuplicateError('Issues with resolution verification or dispute review history cannot be grouped',409);
  const assigned=db.prepare(`SELECT id FROM civic_issues WHERE id IN (${placeholders})
    AND (assigned_officer_id IS NOT NULL OR assigned_team_id IS NOT NULL)`).all(...allIds);
  if(assigned.length) throw new DuplicateError('Unassign officers and ward teams from all grouped issues before approval');
  const targetChain=db.prepare(`WITH RECURSIVE chain(id,merged_into_issue_id,path,cycle) AS (SELECT id,merged_into_issue_id,printf('/%d/',id),0 FROM civic_issues WHERE id=? UNION ALL SELECT i.id,i.merged_into_issue_id,chain.path||i.id||'/',instr(chain.path,printf('/%d/',i.id))>0 FROM civic_issues i JOIN chain ON i.id=chain.merged_into_issue_id WHERE chain.cycle=0) SELECT * FROM chain`).all(canonicalId);
  if(targetChain.some(x=>x.cycle)||targetChain.some(x=>x.id===sourceId)) throw new DuplicateError('Grouping would create a circular merge');
  db.prepare(`UPDATE complaints SET civic_issue_id=? WHERE civic_issue_id IN (${tree.map(()=>'?').join(',')})`).run(canonicalId,...tree);
  db.prepare(`UPDATE civic_issues SET status='MERGED',merged_into_issue_id=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).run(canonicalId,sourceId);
  db.prepare(`UPDATE civic_issues SET merged_into_issue_id=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id IN (${tree.filter(x=>x!==sourceId).map(()=>'?').join(',')})`).run(canonicalId,...tree.filter(x=>x!==sourceId));
  const reviewed=db.prepare("UPDATE civic_issue_duplicate_suggestions SET status='APPROVED',reviewer_admin_id=?,reviewed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='PENDING'").run(adminId,id);
  if(reviewed.changes!==1) throw new DuplicateError('Suggestion has already been reviewed');
  db.prepare('INSERT INTO civic_issue_grouping_events(suggestion_id,source_issue_id,canonical_issue_id,admin_user_id) VALUES(?,?,?,?)').run(id,sourceId,canonicalId,adminId);
  return {suggestionId:id,sourceIssueId:sourceId,canonicalIssueId:canonicalId,status:'APPROVED'};
});
const approveDuplicateTx=approveTx.immediate.bind(approveTx);
export function approveDuplicate(...args) { const result=approveDuplicateTx(...args); if(result.stale) throw new DuplicateError('Suggestion is stale'); return result; }

export function markStaleSuggestionsForIssue(issueId) {
  const rows=db.prepare("SELECT id,issue_a_id,issue_b_id FROM civic_issue_duplicate_suggestions WHERE status='PENDING' AND (issue_a_id=? OR issue_b_id=?)").all(issueId,issueId);
  for(const row of rows) markStaleIfInvalid(row);
}
