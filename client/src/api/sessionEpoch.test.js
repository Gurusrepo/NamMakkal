import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceSessionEpoch,
  getCurrentSessionEpoch,
  shouldDispatchSessionExpired
} from './sessionEpoch.js';

test('a stale initial current-user 401 cannot expire a session established by OTP login', () => {
  const initialMeRequest = {
    url: '/auth/me',
    epoch: getCurrentSessionEpoch()
  };
  advanceSessionEpoch();

  let user = { role: 'CITIZEN' };
  const oldMeResponse = { request: initialMeRequest, status: 401 };
  const shouldExpire = shouldDispatchSessionExpired(oldMeResponse.request.epoch, oldMeResponse.status);
  if (shouldExpire) user = null;

  assert.equal(shouldExpire, false);
  assert.deepEqual(user, { role: 'CITIZEN' });
});

test('a 401 from the current authenticated session still expires it', () => {
  const authenticatedRequest = {
    url: '/auth/preferences',
    epoch: getCurrentSessionEpoch()
  };
  let user = { role: 'CITIZEN' };

  const response = { request: authenticatedRequest, status: 401 };
  const shouldExpire = shouldDispatchSessionExpired(response.request.epoch, response.status);
  if (shouldExpire) user = null;

  assert.equal(shouldExpire, true);
  assert.equal(user, null);
});
