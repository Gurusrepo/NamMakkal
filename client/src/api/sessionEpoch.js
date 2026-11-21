let currentSessionEpoch = 0;

export function getCurrentSessionEpoch() {
  return currentSessionEpoch;
}

export function advanceSessionEpoch() {
  currentSessionEpoch += 1;
}

export function shouldDispatchSessionExpired(requestEpoch, status) {
  return status === 401 && requestEpoch === currentSessionEpoch;
}
