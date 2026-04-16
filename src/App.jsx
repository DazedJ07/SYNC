import React, { useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import LandingPage from './LandingPage.jsx';
import LoginPage from './LoginPage.jsx';
import Dashboard from './Dashboard.jsx';

function ProtectedRoute({ children }) {
  const { currentUser } = useAuth();
  if (!currentUser) return <Navigate to="/login" replace />;
  return children;
}

function AuthRedirect({ children }) {
  const { currentUser } = useAuth();
  if (currentUser) return <Navigate to="/dashboard" replace />;
  return children;
}

export default function App() {
  const { currentUser, pendingCheckin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Redirect to login if QR checkin is pending
  useEffect(() => {
    if (pendingCheckin && !pendingCheckin.expired && !currentUser && location.pathname !== '/login') {
      navigate('/login', { replace: true });
    }
  }, [pendingCheckin, currentUser, location.pathname, navigate]);

  // After login, redirect to dashboard
  useEffect(() => {
    if (currentUser && (location.pathname === '/login' || location.pathname === '/')) {
      navigate('/dashboard', { replace: true });
    }
  }, [currentUser, location.pathname, navigate]);

  return (
    <div className="min-h-screen bg-background text-foreground antialiased transition-colors duration-300">
      <Routes>
        <Route path="/" element={<AuthRedirect><LandingPage /></AuthRedirect>} />
        <Route path="/login" element={<AuthRedirect><LoginPage /></AuthRedirect>} />
        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
