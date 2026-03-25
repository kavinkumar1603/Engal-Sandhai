import React, { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { User } from '../../types/types';

interface ProtectedRouteProps {
  user: User | null;
  loading?: boolean;
  requiredRole?: string;
  children: React.ReactNode;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ 
  user, 
  loading = false, 
  requiredRole, 
  children 
}) => {
  const location = useLocation();


  // Show loading spinner while authentication is being checked
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-4 text-slate-600">Checking authentication...</p>
        </div>
      </div>
    );
  }

  // Redirect to login if no user is authenticated
  if (!user) {
    return <Navigate to="/" state={{ from: location }} replace />;
  }

  // Check role-based access
  if (requiredRole && user.role !== requiredRole) {
    
    // Redirect based on user's actual role
    if (user.role === 'admin') {
      return <Navigate to="/admin-choice" replace />;
    } else {
      return <Navigate to="/dashboard" replace />;
    }
  }

  // Log successful access
  
  return <>{children}</>;
};

export default ProtectedRoute;