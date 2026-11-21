import apiClient from './client.js';

const body = (request) => request.then(({ data }) => data);
const get = (path, params) => body(apiClient.get(path, { params }));
const post = (path, payload) => body(apiClient.post(path, payload));
const patch = (path, payload) => body(apiClient.patch(path, payload));
const remove = (path) => body(apiClient.delete(path));
export const getAdminDashboard = () => get('/admin/dashboard');
const issue = (id) => `/admin/civic-issues/${id}`;
const ward = (id) => `/admin/wards/${id}`;
const team = (id) => `/admin/ward-teams/${id}`;

export const listCivicIssues = (params = {}) => get('/admin/civic-issues', params);
export const getCivicIssue = (id) => get(issue(id));
export const assignOfficer = (id, payload) => post(`${issue(id)}/assignments`, payload);
export const reassignOfficer = (id, payload) => post(`${issue(id)}/assignments/reassign`, payload);
export const unassignOfficer = (id) => post(`${issue(id)}/assignments/unassign`);
export const assignIssueTeam = (id, payload) => post(`${issue(id)}/team-assignments`, payload);
export const reassignIssueTeam = (id, payload) => post(`${issue(id)}/team-assignments/reassign`, payload);
export const unassignIssueTeam = (id) => post(`${issue(id)}/team-assignments/unassign`);

export const listWards = (params = {}) => get('/admin/wards', params);
export const getWard = (id) => get(ward(id));
export const createWard = (payload) => post('/admin/wards', payload);
export const updateWard = (id, payload) => patch(ward(id), payload);
export const deleteWard = (id) => remove(ward(id));
export const listTeams = (params = {}) => get('/admin/ward-teams', params);
export const getTeam = (id) => get(team(id));
export const createTeam = (payload) => post('/admin/ward-teams', payload);
export const updateTeam = (id, payload) => patch(team(id), payload);
export const listTeamMembers = (id, params = {}) => get(`${team(id)}/members`, params);
export const addTeamMember = (id, payload) => post(`${team(id)}/members`, payload);
export const removeTeamMember = (id, userId) => remove(`${team(id)}/members/${userId}`);

export const listDuplicateCandidates = (params = {}) => get('/admin/duplicate-candidates', params);
export const assessDuplicate = (id) => post(`/admin/duplicate-candidates/${id}/assess`);
export const approveDuplicate = (id, payload) => post(`/admin/duplicate-candidates/${id}/approve`, payload);
export const rejectDuplicate = (id, payload) => post(`/admin/duplicate-candidates/${id}/reject`, payload);
export const listDisputes = (params = {}) => get('/admin/disputes', params);
export const getDispute = (issueId) => get(`/admin/disputes/${issueId}`);
export const reviewDispute = (issueId, payload) => post(`/admin/disputes/${issueId}/review`, payload);

export const listOfficers = (params = {}) => get('/admin/officers', params);
export const getOfficer = (id) => get(`/admin/officers/${id}`);
export const createOfficer = (payload) => post('/admin/officers', payload);
export const resendOfficerInvitation = (id) => post(`/admin/officers/${id}/invitation`);
export const updateOfficerStatus = (id, payload) => patch(`/admin/officers/${id}/status`, payload);
export const deleteOfficer = (id) => remove(`/admin/officers/${id}`);

export const listCitizens = (params = {}) => get('/admin/citizens', params);
export const getCitizen = (id) => get(`/admin/citizens/${id}`);
export const updateCitizenStatus = (id, payload) => patch(`/admin/citizens/${id}/status`, payload);
export const deleteCitizen = (id) => remove(`/admin/citizens/${id}`);

export const listReportedProblems = (params = {}) => get('/admin/reported-problems', params);
export const getReportedProblem = (referenceId) => get(`/admin/reported-problems/${referenceId}`);
export const updateReportedProblemStatus = (referenceId, payload) => patch(`/admin/reported-problems/${referenceId}/status`, payload);

export const listSuggestions = (params = {}) => get('/admin/suggestions', params);
export const getSuggestion = (referenceId) => get(`/admin/suggestions/${referenceId}`);
export const updateSuggestionStatus = (referenceId, payload) => patch(`/admin/suggestions/${referenceId}/status`, payload);
