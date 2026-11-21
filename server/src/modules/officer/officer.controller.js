export function createOfficerController(service) {
  return {
    profile(req, res, next) {
      try { res.json({ profile: service.getProfile(req.user.id) }); } catch (error) { next(error); }
    },
    dashboard(req, res, next) {
      try { res.json(service.getDashboard(req.user.id)); } catch (error) { next(error); }
    },
    list(req, res, next) {
      try { res.json(service.listIssues(req.user.id, req.validatedQuery)); } catch (error) { next(error); }
    },
    async get(req, res, next) {
      try { res.json({ issue: await service.getIssue(req.params.id, req.user.id) }); } catch (error) { next(error); }
    },
    timeline(req, res, next) {
      try { res.json(service.getIssueTimeline(req.params.id, req.user.id)); } catch (error) { next(error); }
    },
    inspect(req, res, next) {
      try { res.status(201).json({ inspection: service.recordInspection(req.params.id, req.user.id, req.body.findings) }); } catch (error) { next(error); }
    },
    actionPlan(req, res, next) {
      try {
        res.status(201).json({
          actionPlan: service.submitActionPlan(req.params.id, req.user.id, req.body.description, req.body.steps)
        });
      } catch (error) { next(error); }
    },
    progress(req, res, next) {
      try { res.status(201).json({ update: service.recordProgressUpdate(req.params.id, req.user.id, req.body.message) }); } catch (error) { next(error); }
    },
    start(req, res, next) {
      try { res.status(200).json({ event: service.startWork(req.params.id, req.user.id) }); } catch (error) { next(error); }
    },
    async upload(req, res, next) {
      try {
        const evidence = await service.uploadEvidence(req.params.id, req.user.id, req.body.stage, req.file);
        res.status(201).json({ evidence });
      } catch (error) { next(error); }
    },
    async evidence(req, res, next) {
      try { res.json({ items: await service.listEvidence(req.params.id, req.user.id) }); } catch (error) { next(error); }
    },
    complete(req, res, next) {
      try { res.json(service.completeWork(req.params.id, req.user.id, req.body.summary)); } catch (error) { next(error); }
    }
  };
}
