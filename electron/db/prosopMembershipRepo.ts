import { v4 as uuid } from 'uuid';
import type {
  ProsopCohort,
  ProsopCohortInput,
  ProsopMembershipAssessment,
  ProsopMembershipInput,
  ProsopMembershipWorkspace,
  ProsopPopulationMembership,
} from '@shared/prosopography';
import { evaluateProsopFilter, validateProsopFilter } from '@shared/prosopographyFilters';
import { getDb } from './database';
import { ensureProsopStudy } from './prosopStudyRepo';

const now=()=>new Date().toISOString(); const id=(prefix:string)=>`${prefix}_${uuid()}`;
function assessment(row:Record<string,unknown>):ProsopMembershipAssessment{return{assessmentId:String(row.assessment_id),membershipId:String(row.membership_id),criterionId:String(row.criterion_id),result:row.result as ProsopMembershipAssessment['result'],factoidId:row.factoid_id==null?null:String(row.factoid_id),note:String(row.note??''),createdAt:String(row.created_at)};}
function membership(row:Record<string,unknown>):ProsopPopulationMembership{const membershipId=String(row.membership_id);return{membershipId,personId:String(row.person_id),methodologyVersionId:String(row.methodology_version_id),status:row.status as ProsopPopulationMembership['status'],decision:String(row.decision??''),rationale:String(row.rationale??''),decidedBy:row.decided_by==null?null:String(row.decided_by),decidedAt:row.decided_at==null?null:String(row.decided_at),assessments:(getDb().prepare('SELECT * FROM prosop_membership_assessments WHERE membership_id=? ORDER BY created_at').all(membershipId) as Record<string,unknown>[]).map(assessment),createdAt:String(row.created_at),updatedAt:String(row.updated_at)};}
function cohort(row:Record<string,unknown>):ProsopCohort{const cohortId=String(row.cohort_id);return{cohortId,studyId:String(row.study_id),name:String(row.name),description:String(row.description??''),kind:row.kind as ProsopCohort['kind'],filter:JSON.parse(String(row.filter_json)),methodologyVersionId:String(row.methodology_version_id),questionnaireVersionId:String(row.questionnaire_version_id),memberIds:(getDb().prepare('SELECT person_id FROM prosop_cohort_members WHERE cohort_id=? ORDER BY person_id').all(cohortId) as Array<{person_id:string}>).map((item)=>item.person_id),createdAt:String(row.created_at),updatedAt:String(row.updated_at),frozenAt:row.frozen_at==null?null:String(row.frozen_at)};}

export function getProsopMembershipWorkspace():ProsopMembershipWorkspace{
  const db=getDb();const memberships=(db.prepare('SELECT * FROM prosop_population_memberships ORDER BY updated_at DESC').all() as Record<string,unknown>[]).map(membership);
  const count=(sql:string)=>Number((db.prepare(sql).get() as {c:number}).c);
  return{memberships,cohorts:(db.prepare('SELECT * FROM prosop_cohorts ORDER BY name').all() as Record<string,unknown>[]).map(cohort),coverage:{totalPersons:count('SELECT COUNT(*) AS c FROM prosop_person_profiles'),included:memberships.filter((item)=>item.status==='included').length,excluded:memberships.filter((item)=>item.status==='excluded').length,candidate:memberships.filter((item)=>item.status==='candidate').length,uncertain:memberships.filter((item)=>item.status==='uncertain').length,reviewedStatements:count("SELECT COUNT(*) AS c FROM prosop_statements WHERE status='reviewed'"),missingValues:count("SELECT COUNT(*) AS c FROM prosop_missing_values WHERE status='active'")}};
}

export function saveProsopMembership(input:ProsopMembershipInput):ProsopPopulationMembership{
  if(!input.methodologyVersionId)throw new Error('La pertenencia necesita una versión metodológica.');
  if(!input.rationale.trim())throw new Error('La decisión de pertenencia necesita una justificación.');
  const db=getDb();const ts=now();const existing=db.prepare('SELECT membership_id,created_at FROM prosop_population_memberships WHERE person_id=? AND methodology_version_id=?').get(input.personId,input.methodologyVersionId) as {membership_id:string;created_at:string}|undefined;const membershipId=existing?.membership_id??id('pmm');
  const criteria=new Set((db.prepare('SELECT criterion_id FROM prosop_population_criteria WHERE methodology_version_id=?').all(input.methodologyVersionId) as Array<{criterion_id:string}>).map((item)=>item.criterion_id));
  if(input.assessments.some((item)=>!criteria.has(item.criterionId)))throw new Error('Una evaluación usa un criterio de otra versión.');
  const run=db.transaction(()=>{db.prepare(`INSERT INTO prosop_population_memberships (membership_id,person_id,methodology_version_id,status,decision,rationale,decided_by,decided_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(person_id,methodology_version_id) DO UPDATE SET status=excluded.status,decision=excluded.decision,rationale=excluded.rationale,decided_by=excluded.decided_by,decided_at=excluded.decided_at,updated_at=excluded.updated_at`).run(membershipId,input.personId,input.methodologyVersionId,input.status,input.decision,input.rationale,input.decidedBy??'human',ts,existing?.created_at??ts,ts);db.prepare('DELETE FROM prosop_membership_assessments WHERE membership_id=?').run(membershipId);const insert=db.prepare('INSERT INTO prosop_membership_assessments (assessment_id,membership_id,criterion_id,result,factoid_id,note,created_at) VALUES (?,?,?,?,?,?,?)');input.assessments.forEach((item)=>insert.run(id('pma'),membershipId,item.criterionId,item.result,item.factoidId??null,item.note??'',ts));});
  run();return getProsopMembershipWorkspace().memberships.find((item)=>item.membershipId===membershipId)!;
}

function dynamicMembers(filter:ProsopCohortInput['filter']):string[]{
  const db=getDb();const rows=db.prepare(`SELECT p.person_id,p.display_name,x.identity_status,m.status AS membership_status FROM persons p JOIN prosop_person_profiles x ON x.person_id=p.person_id LEFT JOIN prosop_population_memberships m ON m.person_id=p.person_id`).all() as Record<string,unknown>[];
  return rows.filter((row)=>evaluateProsopFilter({personId:row.person_id,displayName:row.display_name,identityStatus:row.identity_status,membershipStatus:row.membership_status},filter)).map((row)=>String(row.person_id));
}
export function saveProsopCohort(input:ProsopCohortInput):ProsopCohort{
  if(!input.name.trim())throw new Error('La cohorte necesita un nombre.');
  const errors=validateProsopFilter(input.filter,new Set(['personId','displayName','identityStatus','membershipStatus']));if(errors.length)throw new Error(errors.join(' '));
  const db=getDb();const study=ensureProsopStudy();const ts=now();const cohortId=input.cohortId??id('pco');const existing=db.prepare('SELECT kind,frozen_at,created_at FROM prosop_cohorts WHERE cohort_id=?').get(cohortId) as {kind:string;frozen_at:string|null;created_at:string}|undefined;
  if(existing?.kind==='frozen'&&existing.frozen_at)throw new Error('Una cohorte congelada es inmutable.');
  const members=input.memberIds??dynamicMembers(input.filter);const frozenAt=input.kind==='frozen'?ts:null;
  const run=db.transaction(()=>{db.prepare(`INSERT INTO prosop_cohorts (cohort_id,study_id,name,description,kind,filter_json,methodology_version_id,questionnaire_version_id,created_at,updated_at,frozen_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(cohort_id) DO UPDATE SET name=excluded.name,description=excluded.description,kind=excluded.kind,filter_json=excluded.filter_json,methodology_version_id=excluded.methodology_version_id,questionnaire_version_id=excluded.questionnaire_version_id,updated_at=excluded.updated_at,frozen_at=excluded.frozen_at`).run(cohortId,study.studyId,input.name.trim(),input.description??'',input.kind,JSON.stringify(input.filter),input.methodologyVersionId,input.questionnaireVersionId,existing?.created_at??ts,ts,frozenAt);db.prepare('DELETE FROM prosop_cohort_members WHERE cohort_id=?').run(cohortId);const insert=db.prepare('INSERT INTO prosop_cohort_members (cohort_id,person_id,membership_snapshot_json,created_at) VALUES (?,?,?,?)');members.forEach((personId)=>insert.run(cohortId,personId,JSON.stringify({filter:input.filter,methodologyVersionId:input.methodologyVersionId,questionnaireVersionId:input.questionnaireVersionId}),ts));});
  run();return getProsopMembershipWorkspace().cohorts.find((item)=>item.cohortId===cohortId)!;
}
export function refreshProsopDynamicCohort(cohortId:string):ProsopCohort{const current=getProsopMembershipWorkspace().cohorts.find((item)=>item.cohortId===cohortId);if(!current)throw new Error('Cohorte no encontrada.');if(current.kind!=='dynamic')throw new Error('Una cohorte congelada no se recalcula.');return saveProsopCohort({...current,memberIds:dynamicMembers(current.filter)});}
