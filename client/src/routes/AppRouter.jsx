import { createBrowserRouter, Navigate } from 'react-router-dom';
import PlaceholderPage from '../pages/PlaceholderPage.jsx';
import Login from '../pages/auth/Login.jsx';
import Register from '../pages/auth/Register.jsx';
import ForgotPassword from '../pages/auth/ForgotPassword.jsx';
import ProtectedRoute from './ProtectedRoute.jsx';
import RoleRoute from './RoleRoute.jsx';
import NotFoundPage from '../pages/NotFoundPage.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { LoadingState } from '../components/AsyncState.jsx';
import CitizenLayout from '../layouts/CitizenLayout.jsx';
import CitizenDashboard from '../pages/citizen/CitizenDashboard.jsx';
import MyComplaints from '../pages/citizen/MyComplaints.jsx';
import ReportComplaint from '../pages/citizen/ReportComplaint.jsx';
import ComplaintDetails from '../pages/citizen/ComplaintDetails.jsx';
import Announcements from '../pages/citizen/Announcements.jsx';
import AnnouncementDetails from '../pages/citizen/AnnouncementDetails.jsx';
import Profile from '../pages/citizen/Profile.jsx';
import HelpSupport from '../pages/citizen/HelpSupport.jsx';
import Notifications from '../pages/citizen/Notifications.jsx';
import ManageAnnouncements from '../pages/admin/ManageAnnouncements.jsx';
import ReportedProblems from '../pages/admin/ReportedProblems.jsx';
import Suggestions from '../pages/admin/Suggestions.jsx';
import AdminLayout from '../layouts/AdminLayout.jsx';
import AdminOverview from '../pages/admin/AdminOverview.jsx';
import AdminSectionPlaceholder from '../pages/admin/AdminSectionPlaceholder.jsx';
import Complaints from '../pages/admin/Complaints.jsx';
import DuplicateReviews from '../pages/admin/DuplicateReviews.jsx';
import Disputes from '../pages/admin/Disputes.jsx';
import Officers from '../pages/admin/Officers.jsx';
import Wards from '../pages/admin/Wards.jsx';
import Teams from '../pages/admin/Teams.jsx';
import OfficerLayout from '../layouts/OfficerLayout.jsx';
import OfficerDashboard from '../pages/officer/OfficerDashboard.jsx';
import OfficerIssues from '../pages/officer/OfficerIssues.jsx';
import OfficerIssueDetails from '../pages/officer/OfficerIssueDetails.jsx';
import OfficerTeams from '../pages/officer/OfficerTeams.jsx';
import OfficerNotifications from '../pages/officer/OfficerNotifications.jsx';
import OfficerProfile from '../pages/officer/OfficerProfile.jsx';

function HomeRoute() {
  const { user, isLoading } = useAuth();
  const roleRoute = { CITIZEN: '/citizen', OFFICER: '/officer', ADMIN: '/admin' }[user?.role];
  if (isLoading) return <main className="grid min-h-screen place-items-center bg-[#f7f6ef] p-6"><LoadingState>Checking your session...</LoadingState></main>;
  return roleRoute
  ? <Navigate to={roleRoute} replace />
  : user
    ? <PlaceholderPage />
    : <Navigate to="/login" replace />;}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <HomeRoute />
  },
  {
    path: '/login',
    element: <Login />
  },
  {
    path: '/register',
    element: <Register />
  },
  {
    path: '/forgot-password',
    element: <ForgotPassword />
  },
  {
    path: '/citizen',
    element: <ProtectedRoute><RoleRoute allowedRoles={['CITIZEN']}><CitizenLayout /></RoleRoute></ProtectedRoute>,
    children: [
      { index: true, element: <CitizenDashboard /> },
      { path: 'complaints', element: <MyComplaints /> },
      { path: 'complaints/new', element: <ReportComplaint /> },
      { path: 'complaints/:id', element: <ComplaintDetails /> },
      { path: 'announcements', element: <Announcements /> },
      { path: 'announcements/:id', element: <AnnouncementDetails /> },
      { path: 'notifications', element: <Notifications /> },
      { path: 'profile', element: <Profile /> },
      { path: 'help', element: <HelpSupport /> }
    ]
  },
  {
    path: '/officer',
    element: (
      <ProtectedRoute>
        <RoleRoute allowedRoles={['OFFICER']}>
          <OfficerLayout />
        </RoleRoute>
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <OfficerDashboard /> },
      { path: 'issues', element: <OfficerIssues /> },
      { path: 'issues/:id', element: <OfficerIssueDetails /> },
      { path: 'teams', element: <OfficerTeams /> },
      { path: 'notifications', element: <OfficerNotifications /> },
      { path: 'profile', element: <OfficerProfile /> }
    ]
  },
  {
    path: '/admin',
    element: (
      <ProtectedRoute>
        <RoleRoute allowedRoles={['ADMIN']}>
          <AdminLayout />
        </RoleRoute>
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <AdminOverview /> },
      { path: 'reported-problems', element: <ReportedProblems /> },
      { path: 'suggestions', element: <Suggestions /> },
      { path: 'announcements', element: <ManageAnnouncements /> },
      { path: 'complaints', element: <Complaints /> },
      { path: 'duplicate-reviews', element: <DuplicateReviews /> },
      { path: 'disputes', element: <Disputes /> },
      { path: 'officers', element: <Officers /> },
      { path: 'wards', element: <Wards /> },
      { path: 'teams', element: <Teams /> },
      { path: ':section', element: <AdminSectionPlaceholder /> }
    ]
  },
  {
    path: '*',
    element: <NotFoundPage />
  }
]);
