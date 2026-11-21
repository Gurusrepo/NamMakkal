import * as service from './citizen-management.service.js';

export function list(req, res, next) {
  try { res.json(service.listCitizens(req.validatedQuery)); } catch (error) { next(error); }
}

export function get(req, res, next) {
  try {
    const result = service.getCitizen(req.params.id);
    if (!result) return res.status(404).json({ error: 'Citizen not found' });
    res.json(result);
  } catch (error) { next(error); }
}

export function updateStatus(req, res, next) {
  try { res.json({ citizen: service.updateCitizenStatus(req.params.id, req.body.status, req.user.id) }); }
  catch (error) { next(error); }
}

export function deleteCitizen(req, res, next) {
  try { res.json(service.deleteCitizen(req.params.id, req.user.id)); }
  catch (error) { next(error); }
}

export { deleteCitizen as remove };
