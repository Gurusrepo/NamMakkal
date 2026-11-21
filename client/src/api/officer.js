import apiClient from './client.js';

const body = (request) => request.then(({ data }) => data);
const issuePath = (id) => `/officer/civic-issues/${id}`;

export function getOfficerDashboard() { return body(apiClient.get('/officer/dashboard')); }
export function getOfficerProfile() { return body(apiClient.get('/officer/profile')); }
export function listCivicIssues(params = {}) { return body(apiClient.get('/officer/civic-issues', { params })); }
export function getCivicIssue(id) { return body(apiClient.get(issuePath(id))); }
export function getCivicIssueTimeline(id) { return body(apiClient.get(`${issuePath(id)}/timeline`)); }
export function recordInspection(id, findings) {
  return body(apiClient.post(`${issuePath(id)}/inspections`, { findings }));
}
export function submitActionPlan(id, { description, steps }) {
  return body(apiClient.post(`${issuePath(id)}/action-plans`, { description, steps }));
}
export function recordProgressUpdate(id, message) {
  return body(apiClient.post(`${issuePath(id)}/progress-updates`, { message }));
}
export function startWork(id) { return body(apiClient.post(`${issuePath(id)}/start`)); }
export function listRepairEvidence(id) { return body(apiClient.get(`${issuePath(id)}/repair-evidence`)); }
export function uploadRepairEvidence(id, { photo, stage }) {
  const form = new FormData();
  form.append('photo', photo);
  form.append('stage', stage);
  return body(apiClient.post(`${issuePath(id)}/repair-evidence`, form));
}
export function completeWork(id, summary) {
  return body(apiClient.post(`${issuePath(id)}/complete`, { summary }));
}
