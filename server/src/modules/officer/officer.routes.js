import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import * as objectStorage from '../../services/objectStorage.js';
import { createOfficerController } from './officer.controller.js';
import { createOfficerService } from './officer.service.js';
import {
  actionPlanSchema, inspectionSchema, issueIdSchema, issueListQuerySchema, progressUpdateSchema,
  repairEvidenceSchema, resolutionSchema
} from './officer.validation.js';
import { repairEvidenceUpload } from './repairEvidenceUpload.js';

export function createOfficerRouter(storageAdapter = objectStorage) {
  const router = Router();
  const controller = createOfficerController(createOfficerService(storageAdapter));
  router.use(authenticate, authorize('OFFICER'));
  router.get('/profile', controller.profile);
  router.get('/dashboard', controller.dashboard);
  router.get('/civic-issues', validate(issueListQuerySchema, 'query'), controller.list);
  router.get('/civic-issues/:id/timeline', validate(issueIdSchema, 'params'), controller.timeline);
  router.get('/civic-issues/:id', validate(issueIdSchema, 'params'), controller.get);
  router.post('/civic-issues/:id/inspections', validate(issueIdSchema, 'params'),
    validate(inspectionSchema), controller.inspect);
  router.post('/civic-issues/:id/action-plans', validate(issueIdSchema, 'params'),
    validate(actionPlanSchema), controller.actionPlan);
  router.post('/civic-issues/:id/progress-updates', validate(issueIdSchema, 'params'),
    validate(progressUpdateSchema), controller.progress);
  router.post('/civic-issues/:id/start', validate(issueIdSchema, 'params'), controller.start);
  router.post('/civic-issues/:id/repair-evidence', validate(issueIdSchema, 'params'), repairEvidenceUpload,
    validate(repairEvidenceSchema), controller.upload);
  router.get('/civic-issues/:id/repair-evidence', validate(issueIdSchema, 'params'), controller.evidence);
  router.post('/civic-issues/:id/complete', validate(issueIdSchema, 'params'),
    validate(resolutionSchema), controller.complete);
  return router;
}

export default createOfficerRouter();
