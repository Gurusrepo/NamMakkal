import apiClient from './client.js';

const body = (request) => request.then(({ data }) => data);

export function listComplaints(params = {}) { return body(apiClient.get('/complaints', { params })); }
export function getComplaintSummary() { return body(apiClient.get('/complaints/summary')); }
export function getComplaint(id) { return body(apiClient.get(`/complaints/${id}`)); }
export function getComplaintTimeline(id) { return body(apiClient.get(`/complaints/${id}/timeline`)); }
export function getAiAssessment(id) { return body(apiClient.get(`/complaints/${id}/ai-assessment`)); }
export function getResolution(id) { return body(apiClient.get(`/complaints/${id}/resolution`)); }
export function submitResolutionVerification(id, payload) {
  return body(apiClient.post(`/complaints/${id}/resolution-verification`, payload));
}
export function createComplaint({ photo, onUploadProgress, ...fields }) {
  const form = new FormData();
  Object.entries(fields).forEach(([key, value]) => {
    if (value !== undefined && value !== null) form.append(key, String(value));
  });
  if (photo) form.append('photo', photo);
  return body(apiClient.post('/complaints', form, onUploadProgress ? { onUploadProgress } : undefined));
}
