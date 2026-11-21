import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './notification.controller.js';
import { notificationIdSchema, notificationListQuerySchema } from './notification.validation.js';

const router = Router();
router.use(authenticate, authorize('CITIZEN', 'OFFICER'));
router.get('/unread-count', controller.unreadCount);
router.patch('/read-all', controller.markAllRead);
router.get('/', validate(notificationListQuerySchema, 'query'), controller.list);
router.patch('/:id/read', validate(notificationIdSchema, 'params'), controller.markRead);

export default router;
