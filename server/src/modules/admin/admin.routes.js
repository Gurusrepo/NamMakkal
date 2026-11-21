import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './admin.controller.js';
import * as dashboardController from './dashboard.controller.js';
import {
  assignOfficerSchema, issueIdSchema, issueListQuerySchema, duplicateListQuerySchema, duplicateIdSchema,
  approveDuplicateSchema, rejectDuplicateSchema, wardIdSchema, memberParamsSchema, wardListQuerySchema,
  teamListQuerySchema, membershipListQuerySchema, createWardSchema, updateWardSchema,
  createTeamSchema, updateTeamSchema, addTeamMemberSchema, teamRoutingSchema,
  disputeIssueIdSchema, disputeListQuerySchema, disputeReviewSchema,
  officerIdSchema, officerListQuerySchema, createOfficerSchema, updateOfficerStatusSchema,
  citizenIdSchema, citizenListQuerySchema, citizenStatusSchema,
  reportedProblemListQuerySchema, reportedProblemReferenceSchema, updateReportedProblemStatusSchema,
  suggestionListQuerySchema, suggestionReferenceSchema, updateSuggestionStatusSchema
} from './admin.validation.js';
import * as duplicateController from './duplicate.controller.js';
import * as objectStorage from '../../services/objectStorage.js';
import { createDisputeReviewController } from './admin.controller.js';
import { createReportedProblemController } from './reported-problem.controller.js';
import * as suggestionController from './suggestion.controller.js';
import { createOfficerManagementController } from './officer-management.controller.js';
import * as citizenController from './citizen-management.controller.js';
import { sendVerificationCode } from '../auth/verification.service.js';

export function createAdminRouter(storageAdapter = objectStorage, verificationSender = sendVerificationCode) {
  const router = Router();
  const issueController = controller.createIssueController(storageAdapter);
  const officerController = createOfficerManagementController(verificationSender);
  const disputeController = createDisputeReviewController(storageAdapter);
  const problemController = createReportedProblemController(storageAdapter);
  router.use(authenticate, authorize('ADMIN'));
  router.get('/dashboard', dashboardController.getDashboard);
  router.get('/reported-problems', validate(reportedProblemListQuerySchema, 'query'), problemController.list);
  router.get('/reported-problems/:referenceId', validate(reportedProblemReferenceSchema, 'params'), problemController.get);
  router.patch('/reported-problems/:referenceId/status', validate(reportedProblemReferenceSchema, 'params'), validate(updateReportedProblemStatusSchema), problemController.update);
  router.get('/suggestions', validate(suggestionListQuerySchema, 'query'), suggestionController.listSuggestions);
  router.get('/suggestions/:referenceId', validate(suggestionReferenceSchema, 'params'), suggestionController.getSuggestion);
  router.patch('/suggestions/:referenceId/status', validate(suggestionReferenceSchema, 'params'), validate(updateSuggestionStatusSchema), suggestionController.updateSuggestion);
  router.get('/civic-issues', validate(issueListQuerySchema, 'query'), controller.listIssues);
  router.get('/civic-issues/:id', validate(issueIdSchema, 'params'), issueController);
  router.post('/civic-issues/:id/assignments', validate(issueIdSchema, 'params'), validate(assignOfficerSchema), controller.assignOfficer);
  router.post('/civic-issues/:id/assignments/reassign', validate(issueIdSchema, 'params'), validate(assignOfficerSchema), controller.reassignOfficer);
  router.post('/civic-issues/:id/assignments/unassign', validate(issueIdSchema, 'params'), controller.unassignOfficer);
  router.post('/civic-issues/:id/team-assignments', validate(issueIdSchema, 'params'), validate(teamRoutingSchema), controller.assignIssueTeam);
  router.post('/civic-issues/:id/team-assignments/reassign', validate(issueIdSchema, 'params'), validate(teamRoutingSchema), controller.reassignIssueTeam);
  router.post('/civic-issues/:id/team-assignments/unassign', validate(issueIdSchema, 'params'), controller.unassignIssueTeam);
  router.get('/wards', validate(wardListQuerySchema, 'query'), controller.listWards);
  router.post('/wards', validate(createWardSchema), controller.createWard);
  router.get('/wards/:id', validate(wardIdSchema, 'params'), controller.getWard);
  router.patch('/wards/:id', validate(wardIdSchema, 'params'), validate(updateWardSchema), controller.updateWard);
  router.delete('/wards/:id', validate(wardIdSchema, 'params'), controller.deleteWard);
  router.get('/ward-teams', validate(teamListQuerySchema, 'query'), controller.listTeams);
  router.post('/ward-teams', validate(createTeamSchema), controller.createTeam);
  router.get('/ward-teams/:id/members', validate(wardIdSchema, 'params'), validate(membershipListQuerySchema, 'query'), controller.listTeamMembers);
  router.post('/ward-teams/:id/members', validate(wardIdSchema, 'params'), validate(addTeamMemberSchema), controller.addTeamMember);
  router.delete('/ward-teams/:id/members/:userId', validate(memberParamsSchema, 'params'), controller.removeTeamMember);
  router.get('/ward-teams/:id', validate(wardIdSchema, 'params'), controller.getTeam);
  router.patch('/ward-teams/:id', validate(wardIdSchema, 'params'), validate(updateTeamSchema), controller.updateTeam);
  router.get('/duplicate-candidates', validate(duplicateListQuerySchema, 'query'), duplicateController.list);
  router.post('/duplicate-candidates/:id/assess', validate(duplicateIdSchema, 'params'), duplicateController.assess);
  router.post('/duplicate-candidates/:id/approve', validate(duplicateIdSchema, 'params'), validate(approveDuplicateSchema), duplicateController.approve);
  router.post('/duplicate-candidates/:id/reject', validate(duplicateIdSchema, 'params'), validate(rejectDuplicateSchema), duplicateController.reject);
  router.get('/disputes', validate(disputeListQuerySchema, 'query'), disputeController.list);
  router.get('/disputes/:issueId', validate(disputeIssueIdSchema, 'params'), disputeController.get);
  router.post('/disputes/:issueId/review', validate(disputeIssueIdSchema, 'params'), validate(disputeReviewSchema), disputeController.review);
  router.get('/officers', validate(officerListQuerySchema, 'query'), officerController.list);
  router.post('/officers', validate(createOfficerSchema), officerController.create);
  router.get('/officers/:id', validate(officerIdSchema, 'params'), officerController.get);
  router.patch('/officers/:id/status', validate(officerIdSchema, 'params'), validate(updateOfficerStatusSchema), officerController.updateStatus);
  router.post('/officers/:id/invitation', validate(officerIdSchema, 'params'), officerController.resendInvitation);
  router.delete('/officers/:id', validate(officerIdSchema, 'params'), officerController.delete);
  router.get('/citizens', validate(citizenListQuerySchema, 'query'), citizenController.list);
  router.get('/citizens/:id', validate(citizenIdSchema, 'params'), citizenController.get);
  router.patch('/citizens/:id/status', validate(citizenIdSchema, 'params'), validate(citizenStatusSchema), citizenController.updateStatus);
  router.delete('/citizens/:id', validate(citizenIdSchema, 'params'), citizenController.remove);
  return router;
}

export default createAdminRouter();
