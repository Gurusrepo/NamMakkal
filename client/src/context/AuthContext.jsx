import { createContext, useContext, useEffect, useRef, useState } from 'react';
import * as authApi from '../api/auth.js';
import { SESSION_EXPIRED_EVENT } from '../api/client.js';
import { advanceSessionEpoch } from '../api/sessionEpoch.js';

const AuthContext = createContext(null);

// Provides the backend-managed user session to the application.
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionError, setSessionError] = useState(null);
  const [logoutWarning, setLogoutWarning] = useState(false);
  const authVersion = useRef(0);
  const [restoreAttempt, setRestoreAttempt] = useState(0);

  useEffect(() => {
    function handleExpiredSession() {
      authVersion.current += 1;
      setUser(null);
      setSessionError(null);
      setIsLoading(false);
    }

    window.addEventListener(SESSION_EXPIRED_EVENT, handleExpiredSession);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleExpiredSession);
  }, []);

  useEffect(
    // Restores the existing cookie session and ignores stale responses after auth actions.
    () => {
      let isMounted = true;
      const requestVersion = authVersion.current;

      // Stores the user returned by the current-session endpoint.
      function applyRestoredUser(restoredUser) {
        if (!isMounted || authVersion.current !== requestVersion) return;
        setUser(restoredUser);
        setSessionError(null);
      }

      // Treats only HTTP 401 as a missing session and surfaces other failures.
      function handleRestoreFailure(error) {
        if (!isMounted || authVersion.current !== requestVersion) return;
        if (error.response?.status === 401) {
          setUser(null);
          setSessionError(null);
          return;
        }
        setSessionError(error);
      }

      // Ends the loading state after the session request settles.
      function finishRestoringSession() {
        if (isMounted && authVersion.current === requestVersion) setIsLoading(false);
      }

      authApi.getCurrentUser()
        .then(applyRestoredUser)
        .catch(handleRestoreFailure)
        .finally(finishRestoringSession);

      // Prevents updates from this effect after its provider instance unmounts.
      function stopSessionUpdates() {
        isMounted = false;
      }

      return stopSessionUpdates;
    },
    [restoreAttempt]
  );

  function retrySession() {
    setSessionError(null);
    setIsLoading(true);
    setRestoreAttempt((attempt) => attempt + 1);
  }

  // Starts registration without adopting an authenticated session.
  async function register(credentials) {
    return authApi.register(credentials);
  }

  async function completeRegistrationEmail(credentials) {
    return authApi.completeRegistrationEmail(credentials);
  }

  async function resendRegistrationEmail(credentials) {
    return authApi.resendRegistrationEmail(credentials);
  }

  // Adopts a user only after the backend has issued a complete session.
  async function login(credentials) {
    const result = await authApi.login(credentials);
    if (result.requiresOtpVerification || result.requiresEmailVerification) return result;
    authVersion.current += 1;
    advanceSessionEpoch();
    setUser(result.user);
    setIsLoading(false);
    setSessionError(null);
    setLogoutWarning(false);
    return result;
  }

  async function completeLoginOtp(credentials) {
    const result = await authApi.completeLoginOtp(credentials);
    authVersion.current += 1;
    advanceSessionEpoch();
    setUser(result.user);
    setIsLoading(false);
    setSessionError(null);
    setLogoutWarning(false);
    return result.user;
  }

  async function resendLoginOtp(credentials) {
    return authApi.resendLoginOtp(credentials);
  }

  async function requestPasswordReset(credentials) {
    return authApi.requestPasswordReset(credentials);
  }

  async function completePasswordReset(credentials) {
    const result = await authApi.completePasswordReset(credentials);
    authVersion.current += 1;
    setUser(null);
    setSessionError(null);
    setIsLoading(false);
    setLogoutWarning(false);
    return result;
  }

  async function deactivateAccount(credentials) {
    const result = await authApi.deactivateAccount(credentials);
    authVersion.current += 1;
    setUser(null);
    setSessionError(null);
    setIsLoading(false);
    setLogoutWarning(false);
    return result;
  }

  // Adopts the public user returned after a profile update.
  async function updateProfile(profile) {
    const updatedUser = await authApi.updateProfile(profile);
    authVersion.current += 1;
    setUser(user?.role === 'CITIZEN' && updatedUser.phoneNumber !== user.phoneNumber ? null : updatedUser);
    setIsLoading(false);
    setSessionError(null);
    return updatedUser;
  }

  async function sendEmailVerificationCode() {
    return authApi.sendEmailVerificationCode();
  }

  async function verifyEmailCode(code) {
    const result = await authApi.verifyEmailCode(code);
    authVersion.current += 1;
    setUser(result.user);
    return result;
  }

  async function uploadProfileImage(file, onUploadProgress) {
    const result = await authApi.uploadProfileImage(file, onUploadProgress);
    authVersion.current += 1;
    setUser(result.user);
    setIsLoading(false);
    setSessionError(null);
    return result.profileImageUrl;
  }

  async function removeProfileImage() {
    const updatedUser = await authApi.removeProfileImage();
    authVersion.current += 1;
    setUser(updatedUser);
    setIsLoading(false);
    setSessionError(null);
    return updatedUser;
  }

  // Clears local auth state even when the backend logout request fails.
  async function logout() {
    authVersion.current += 1;
    setLogoutWarning(false);
    try {
      await authApi.logout();
    } catch (error) {
      setLogoutWarning(true);
      throw error;
    } finally {
      setUser(null);
      setSessionError(null);
      setIsLoading(false);
    }
  }

  const value = {
    user,
    isAuthenticated: Boolean(user),
    isLoading,
    sessionError,
    logoutWarning,
    register,
    completeRegistrationEmail,
    resendRegistrationEmail,
    login,
    completeLoginOtp,
    resendLoginOtp,
    requestPasswordReset,
    completePasswordReset,
    deactivateAccount,
    updateProfile,
    sendEmailVerificationCode,
    verifyEmailCode,
    uploadProfileImage,
    removeProfileImage,
    logout,
    retrySession
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Reads the shared authentication context from a component.
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
