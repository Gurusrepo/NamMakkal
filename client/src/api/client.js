import axios from 'axios';
import { getCurrentSessionEpoch, shouldDispatchSessionExpired } from './sessionEpoch.js';

const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() || '/api';
const apiBaseUrl = configuredBaseUrl.replace(/\/+$/, '').replace(/\/api$/i, '') + '/api';

const apiClient = axios.create({
  baseURL: apiBaseUrl,
  withCredentials: true
});

apiClient.interceptors.request.use((config) => {
  config._authSessionEpoch = getCurrentSessionEpoch();
  return config;
});

export const SESSION_EXPIRED_EVENT = 'civicpulse:session-expired';

apiClient.interceptors.response.use(undefined, (error) => {
  const requestUrl = error.config?.url ?? '';
  const isPublicCredentialRequest = /^\/?auth\/(login|register)\/?$/.test(requestUrl);
  if (
    shouldDispatchSessionExpired(error.config?._authSessionEpoch, error.response?.status) &&
    !isPublicCredentialRequest &&
    typeof window !== 'undefined'
  ) {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }
  return Promise.reject(error);
});

export default apiClient;
