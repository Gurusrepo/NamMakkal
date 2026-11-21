import * as service from './officer-management.service.js';

export function createOfficerManagementController(verificationSender) {
  return {
    list(req, res, next) {
      try { res.json(service.listOfficers(req.validatedQuery)); } catch (error) { next(error); }
    },
    get(req, res, next) {
      try {
        const officer = service.getOfficer(req.params.id);
        if (!officer) return res.status(404).json({ error: 'Officer not found' });
        res.json({ officer });
      } catch (error) { next(error); }
    },
    async create(req, res, next) {
      try {
        res.status(201).json({ ...(await service.createOfficer(req.body, req.user.id)) });
      } catch (error) { next(error); }
    },
    async resendInvitation(req, res, next) {
      try {
        res.json({ invitation: await service.resendOfficerInvitation(req.params.id, req.user.id, verificationSender) });
      } catch (error) { next(error); }
    },
    updateStatus(req, res, next) {
      try {
        res.json({ officer: service.updateOfficerStatus(req.params.id, req.body.status, req.user.id) });
      } catch (error) { next(error); }
    },
    delete(req, res, next) {
      try {
        res.json({ ...service.deleteOfficer(req.params.id, req.user.id) });
      } catch (error) { next(error); }
    }
  };
}
