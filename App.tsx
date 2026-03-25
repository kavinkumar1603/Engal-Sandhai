import React, { useState, useEffect } from 'react';
import { Routes, Route, useNavigate, Navigate, useParams } from 'react-router-dom';
import LoginPage from './src/components/LoginPage';
import AdminDashboard from './src/components/AdminDashboard';
import OrderPage from './src/components/OrderPage';
import AdminChoicePage from './src/components/AdminChoicePage';
import ProtectedRoute from './src/components/ProtectedRoute';
import Dashboard from './src/components/Dashboard';
import Inventory from './src/components/Inventory';
import Orders from './src/components/Orders';
import Reports from './src/components/Reports';
import WeeklyInventory from './src/components/WeeklyInventory';
import Settings from './src/components/Settings';
import CreateBill from './src/components/CreateBill';
import Sidebar from './src/components/Sidebar';
import AdminHeader from './src/components/AdminHeader';
import UserOrders from './src/components/UserOrders';
import { useBillingData } from './hooks/useBillingData';
import { usePageTracking } from './hooks/usePageTracking';
import type { User } from './types/types';
import { loginWithEmployeeID, auth, observeUser } from './src/services/authService';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './src/firebase.ts';
import { updateUserNameInDb, updateOrderStatus } from './src/services/dbService';

// Map Firebase/Auth errors to user-friendly messages
function mapAuthErrorToMessage(error: any): string {
  const code: string | undefined = error?.code || (typeof error?.message === 'string' && (error.message.match(/\((auth\/[a-zA-Z0-9-]+)\)/)?.[1]));
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
      return 'Invalid Employee ID or Password';
    case 'auth/user-not-found':
      return 'Invalid Employee ID or Password';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.';
    case 'auth/network-request-failed':
      return 'Network issue. Check your internet connection and try again.';
    case 'auth/invalid-email':
      return 'Invalid Employee ID or Password';
    case 'auth/user-disabled':
      return 'No account found for this Employee ID.';
    case 'auth/operation-not-allowed':
      return 'No account found for this Employee ID.';
    case 'auth/popup-closed-by-user':
      return 'Please try again.';
    case 'permission-denied':
    case 'start/permission-denied':
      return 'Closed';
    default:
      return 'Sign-in failed. Please check your credentials and try again.';
  }
}

const App: React.FC = () => {
  // Google Analytics page tracking
  usePageTracking();

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [sessionTimeout, setSessionTimeout] = useState<NodeJS.Timeout | null>(null);
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [initialBillId, setInitialBillId] = useState<string | null>(null);
  const billingData = useBillingData({ selectedDate, currentUser });
  const navigate = useNavigate();

  // Force logout on app startup to require authentication every time
  useEffect(() => {
    const forceLogout = async () => {
      try {
        // Only sign out if there's an existing session to prevent interference with fresh logins
        if (auth.currentUser) {
          await auth.signOut();
        }
      } catch (error) {
      }
      setCurrentUser(null);
    };

    forceLogout();
  }, []);

  // Disable browser cache for security
  useEffect(() => {
    // Prevent page caching
    window.history.replaceState(null, '', window.location.href);

    // Add cache control headers via meta tags
    const metaTag = document.createElement('meta');
    metaTag.httpEquiv = 'Cache-Control';
    metaTag.content = 'no-cache, no-store, must-revalidate';
    document.head.appendChild(metaTag);

    const pragmaTag = document.createElement('meta');
    pragmaTag.httpEquiv = 'Pragma';
    pragmaTag.content = 'no-cache';
    document.head.appendChild(pragmaTag);

    const expiresTag = document.createElement('meta');
    expiresTag.httpEquiv = 'Expires';
    expiresTag.content = '0';
    document.head.appendChild(expiresTag);

    return () => {
      document.head.removeChild(metaTag);
      document.head.removeChild(pragmaTag);
      document.head.removeChild(expiresTag);
    };
  }, []);

  // Modified Firebase auth state observer - allows login but no persistence across browser restarts
  useEffect(() => {
    const unsubscribe = observeUser(async (firebaseUser) => {
      try {
        if (firebaseUser) {
          const docRef = doc(db, 'users', firebaseUser.uid);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            setCurrentUser({ ...docSnap.data(), id: firebaseUser.uid } as User);
          } else {
            const defaultUser: User = {
              id: firebaseUser.uid,
              name: firebaseUser.email || '',
              role: 'user',
            };
            await setDoc(docRef, {
              name: firebaseUser.email || '',
              role: 'user',
              createdAt: new Date(),
            });
            setCurrentUser(defaultUser);
          }
        } else {
          setCurrentUser(null);
          // Ensure we're on login page when no user
          const currentPath = window.location.pathname;
          if (currentPath !== '/') {
            navigate('/', { replace: true });
          }
        }
        setLoading(false);
      } catch (err: any) {
        console.error('Error in observeUser:', err);
        setLoginError(mapAuthErrorToMessage(err));
        setCurrentUser(null);
        navigate('/', { replace: true });
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [navigate]);

  // Session timeout management - logout after inactivity
  useEffect(() => {
    let timeoutId: NodeJS.Timeout;

    const resetTimeout = () => {
      if (timeoutId) clearTimeout(timeoutId);

      if (currentUser) {
        // Auto logout after 30 minutes of inactivity
        timeoutId = setTimeout(async () => {
          await handleLogout();
        }, 30 * 60 * 1000); // 30 minutes
      }
    };

    const handleActivity = () => {
      resetTimeout();
    };

    // Reset timeout on user activity
    if (currentUser) {
      resetTimeout();

      // Listen for user activity
      const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
      events.forEach(event => {
        document.addEventListener(event, handleActivity, { passive: true });
      });

      return () => {
        if (timeoutId) clearTimeout(timeoutId);
        events.forEach(event => {
          document.removeEventListener(event, handleActivity);
        });
      };
    }
  }, [currentUser]);

  // Enhanced security: Force redirect to login for any protected route access
  useEffect(() => {
    const currentPath = window.location.pathname;

    // If user is not authenticated and trying to access protected routes
    if (!currentUser && !loading && currentPath !== '/') {
      navigate('/', { replace: true });
    }
  }, [currentUser, loading, navigate]);

  // Enhanced security: Check auth state when window gains focus
  useEffect(() => {
    const handleFocus = async () => {
      if (currentUser) {
        try {
          // Verify user is still authenticated
          const user = auth.currentUser;
          if (!user) {
            setCurrentUser(null);
            navigate('/', { replace: true });
          }
        } catch (err) {
          console.error('Focus check error:', err);
          setCurrentUser(null);
          navigate('/', { replace: true });
        }
      }
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [currentUser, navigate]);

  // Enhanced browser navigation protection
  useEffect(() => {
    const handlePopstate = async (event: PopStateEvent) => {
      event.preventDefault();

      if (!currentUser) {
        navigate('/', { replace: true });
        return;
      }

      const targetPath = window.location.pathname;

      // Check if user has access to the target path
      if (targetPath.startsWith('/admin') && currentUser.role !== 'admin') {
        navigate('/dashboard', { replace: true });
        return;
      }

    };

    // Add beforeunload protection
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (currentUser) {
        event.preventDefault();
        event.returnValue = 'Are you sure you want to leave? You will be logged out.';
        return event.returnValue;
      }
    };

    window.addEventListener('popstate', handlePopstate);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('popstate', handlePopstate);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [currentUser, navigate]);

  // Handle login from LoginPage
  const handleLogin = async (employeeID: string, phone: string) => {
    try {
      setLoading(true);
      const userCredential = await loginWithEmployeeID(employeeID, phone);
      const docRef = doc(db, 'users', userCredential.user.uid);
      const docSnap = await getDoc(docRef);
      let role: string;
      if (!docSnap.exists()) {
        role = 'faculty';
        await setDoc(docRef, {
          name: employeeID, // Store the actual employee ID instead of email
          role,
          createdAt: new Date(),
          employee: {
            employeeId: employeeID,
            email: userCredential.user.email
          }
        });
      } else {
        const data = docSnap.data();
        role = data.role;
      }
      const loggedUser: User = {
        id: userCredential.user.uid,
        name: employeeID, // Use the actual employee ID instead of email
        role: (role as 'admin' | 'user'),
        email: userCredential.user.email, // Store email separately for reference
      };
      setCurrentUser(loggedUser);
      setLoginError(null);

      // Pre-fetch data before navigation to ensure it's available immediately
      try {
        if ((billingData as any).refreshData) {
          await (billingData as any).refreshData();
        }
      } catch (e) {
        console.warn('Preload refreshData failed, continuing navigation');
      }

      // Role-based navigation
      if (role === 'admin') {
        navigate('/admin-choice', { replace: true });
      } else if (role === 'faculty') {
        navigate('/dashboard', { replace: true });
      } else {
        console.error('Invalid role assigned:', role);
        alert('Invalid role assigned.');
        await auth.signOut();
        setCurrentUser(null);
        navigate('/', { replace: true });
      }
    } catch (err: any) {
      console.error('Login error:', err);
      setLoginError(mapAuthErrorToMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateUser = (updatedUser: User) => {
    setCurrentUser(updatedUser);
  };

  const handleLogout = async () => {
    try {
      await auth.signOut();
      setCurrentUser(null);
      setLoginError(null);

      // Clear browser history to prevent back button access
      window.history.replaceState(null, '', '/');
      navigate('/', { replace: true });
    } catch (err: any) {
      console.error('Logout error:', err);
      setLoginError(mapAuthErrorToMessage(err));
    }
  };

  const handleDateSelectionChange = (date: Date | null) => {
    setSelectedDate(date);
  };

  const handleViewOrder = (billId: string) => {
    setInitialBillId(billId);
    navigate('/admin/orders');
  };

  const handleUpdateProfile = async (profile: { name: string; email: string }) => {
    try {
      await updateUserNameInDb(currentUser!.id, profile.name);
      const updatedUser: User = {
        ...currentUser!,
        name: profile.name,
        email: profile.email
      };
      handleUpdateUser(updatedUser);
    } catch (error) {
      console.error('Error updating profile:', error);
    }
  };

  const handleChangePassword = (passwords: { currentPassword: string; newPassword: string; confirmPassword: string }) => {
    const uppercasePasswords = {
      currentPassword: passwords.currentPassword.toUpperCase(),
      newPassword: passwords.newPassword.toUpperCase(),
      confirmPassword: passwords.confirmPassword.toUpperCase()
    };
  };

  const handleUpdateBillStatus = async (billId: string, status: 'pending' | 'packed' | 'delivered' | 'inprogress' | 'bill_sent') => {
    billingData.updateBill(billId, { status });
    try {
      const success = await updateOrderStatus(billId, status, currentUser!.id, selectedDate);
      if (!success) {
        console.warn('Order status update failed - order not found in recent collections:', billId);
      }
    } catch (error) {
      console.error('Failed to update order status in Firestore:', error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-4 text-lg text-slate-600">Loading application...</p>
        </div>
      </div>
    );
  }

  // Local route component to render admin view of a specific user's orders
  const AdminUserOrdersRoute: React.FC = () => {
    const { userId } = useParams();
    return (
      <ProtectedRoute user={currentUser} loading={loading} requiredRole="admin">
        <div className="flex h-screen bg-slate-100 font-sans">
          <Sidebar
            user={currentUser!}
            onLogout={handleLogout}
            currentPage="dashboard"
            setCurrentPage={(page) => {
              setSidebarOpen(false);
              navigate(`/admin/${page}`);
            }}
            isOpen={isSidebarOpen}
            setIsOpen={setSidebarOpen}
          />
          <div className="flex-1 flex flex-col overflow-hidden">
            <AdminHeader onMenuClick={() => setSidebarOpen(true)} title="User Orders" user={currentUser!} />
            <main className="flex-1 overflow-x-hidden overflow-y-auto bg-slate-100 p-4 sm:p-6">
              <UserOrders user={currentUser!} onLogout={handleLogout} targetUserId={userId as string} />
            </main>
          </div>
        </div>
      </ProtectedRoute>
    );
  };

  return (
    <Routes>
      <Route
        path="/"
        element={
          currentUser ? (
            // If user is already authenticated, redirect to appropriate dashboard
            currentUser.role === 'admin' ? (
              <Navigate to="/admin-choice" replace />
            ) : (
              <Navigate to="/dashboard" replace />
            )
          ) : (
            <LoginPage
              error={loginError}
              clearError={() => setLoginError(null)}
              onLogin={handleLogin}
            />
          )
        }
      />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute user={currentUser} loading={loading}>
            <OrderPage
              user={currentUser}
              vegetables={billingData.vegetables}
              availableStock={billingData.availableStock}
              addBill={billingData.addBill}
              onLogout={handleLogout}
              onUpdateUser={handleUpdateUser}
              loading={(billingData as any).loading}
              onRefresh={(billingData as any).refreshData}
            />
          </ProtectedRoute>
        }
      />

      {/* User: Your Orders */}
      <Route
        path="/my-orders"
        element={
          <ProtectedRoute user={currentUser} loading={loading}>
            <UserOrders user={currentUser!} onLogout={handleLogout} />
          </ProtectedRoute>
        }
      />

      {/* Admin Routes with Sidebar Layout */}
      <Route
        path="/admin/dashboard"
        element={
          <ProtectedRoute user={currentUser} loading={loading} requiredRole="admin">
            <div className="flex h-screen bg-slate-100 font-sans">
              <Sidebar
                user={currentUser!}
                onLogout={handleLogout}
                currentPage="dashboard"
                setCurrentPage={(page) => {
                  setSidebarOpen(false);
                  navigate(`/admin/${page}`);
                }}
                isOpen={isSidebarOpen}
                setIsOpen={setSidebarOpen}
              />
              <div className="flex-1 flex flex-col overflow-hidden">
                <AdminHeader onMenuClick={() => setSidebarOpen(true)} title="Dashboard" user={currentUser!} />
                <main className="flex-1 overflow-x-hidden overflow-y-auto bg-slate-100 p-4 sm:p-6">
                  <Dashboard
                    bills={billingData.bills}
                    vegetables={billingData.vegetables}
                    onViewOrder={handleViewOrder}
                    onUpdateBillStatus={handleUpdateBillStatus}
                    onUpdateBill={billingData.updateBill}
                    onDateSelectionChange={handleDateSelectionChange}
                  />
                </main>
              </div>
            </div>
          </ProtectedRoute>
        }
      />

      <Route
        path="/admin/inventory"
        element={
          <ProtectedRoute user={currentUser} loading={loading} requiredRole="admin">
            <div className="flex h-screen bg-slate-100 font-sans">
              <Sidebar
                user={currentUser!}
                onLogout={handleLogout}
                currentPage="inventory"
                setCurrentPage={(page) => {
                  setSidebarOpen(false);
                  navigate(`/admin/${page}`);
                }}
                isOpen={isSidebarOpen}
                setIsOpen={setSidebarOpen}
              />
              <div className="flex-1 flex flex-col overflow-hidden">
                <AdminHeader onMenuClick={() => setSidebarOpen(true)} title="Inventory" user={currentUser!} />
                <main className="flex-1 overflow-x-hidden overflow-y-auto bg-slate-100 p-4 sm:p-6">
                  <Inventory
                    vegetables={billingData.vegetables}
                    bills={billingData.bills}
                    availableStock={billingData.availableStock}
                    addVegetable={billingData.addVegetable}
                    updateVegetable={billingData.updateVegetable}
                    deleteVegetable={billingData.deleteVegetable}
                    selectedDate={selectedDate}
                    onDateChange={handleDateSelectionChange}
                    onRefresh={(billingData as any).refreshData}
                    loading={(billingData as any).loading}
                  />
                </main>
              </div>
            </div>
          </ProtectedRoute>
        }
      />

      <Route
        path="/admin/orders"
        element={
          <ProtectedRoute user={currentUser} loading={loading} requiredRole="admin">
            <div className="flex h-screen bg-slate-100 font-sans">
              <Sidebar
                user={currentUser!}
                onLogout={handleLogout}
                currentPage="orders"
                setCurrentPage={(page) => {
                  setSidebarOpen(false);
                  navigate(`/admin/${page}`);
                }}
                isOpen={isSidebarOpen}
                setIsOpen={setSidebarOpen}
              />
              <div className="flex-1 flex flex-col overflow-hidden">
                <AdminHeader onMenuClick={() => setSidebarOpen(true)} title="Order History" user={currentUser!} />
                <main className="flex-1 overflow-x-hidden overflow-y-auto bg-slate-100 p-4 sm:p-6">
                  <Orders
                    bills={billingData.bills}
                    vegetables={billingData.vegetables}
                    initialBillId={initialBillId}
                    onClearInitialBill={() => setInitialBillId(null)}
                    onUpdateBillStatus={handleUpdateBillStatus}
                    onUpdateBill={billingData.updateBill}
                    currentUser={currentUser!}
                    onDateSelectionChange={handleDateSelectionChange}
                  />
                </main>
              </div>
            </div>
          </ProtectedRoute>
        }
      />

      {/* Admin: Per-user orders */}
      <Route path="/admin/user-orders/:userId" element={<AdminUserOrdersRoute />} />

      <Route
        path="/admin/reports"
        element={
          <ProtectedRoute user={currentUser} loading={loading} requiredRole="admin">
            <div className="flex h-screen bg-slate-100 font-sans">
              <Sidebar
                user={currentUser!}
                onLogout={handleLogout}
                currentPage="reports"
                setCurrentPage={(page) => {
                  setSidebarOpen(false);
                  navigate(`/admin/${page}`);
                }}
                isOpen={isSidebarOpen}
                setIsOpen={setSidebarOpen}
              />
              <div className="flex-1 flex flex-col overflow-hidden">
                <AdminHeader onMenuClick={() => setSidebarOpen(true)} title="Reports" user={currentUser!} />
                <main className="flex-1 overflow-x-hidden overflow-y-auto bg-slate-100 p-4 sm:p-6">
                  <Reports />
                </main>
              </div>
            </div>
          </ProtectedRoute>
        }
      />

      <Route
        path="/admin/weekly-stock"
        element={
          <ProtectedRoute user={currentUser} loading={loading} requiredRole="admin">
            <div className="flex h-screen bg-slate-100 font-sans">
              <Sidebar
                user={currentUser!}
                onLogout={handleLogout}
                currentPage="weekly-stock"
                setCurrentPage={(page) => {
                  setSidebarOpen(false);
                  navigate(`/admin/${page}`);
                }}
                isOpen={isSidebarOpen}
                setIsOpen={setSidebarOpen}
              />
              <div className="flex-1 flex flex-col overflow-hidden">
                <AdminHeader onMenuClick={() => setSidebarOpen(true)} title="Weekly Stock Report" user={currentUser!} />
                <main className="flex-1 overflow-x-hidden overflow-y-auto bg-slate-100 p-4 sm:p-6">
                  <WeeklyInventory
                    vegetables={billingData.vegetables}
                    bills={billingData.bills}
                    user={currentUser!}
                  />
                </main>
              </div>
            </div>
          </ProtectedRoute>
        }
      />

      <Route
        path="/admin/create-bill"
        element={
          <ProtectedRoute user={currentUser} loading={loading} requiredRole="admin">
            <div className="flex h-screen bg-slate-100 font-sans">
              <Sidebar
                user={currentUser!}
                onLogout={handleLogout}
                currentPage="create-bill"
                setCurrentPage={(page) => {
                  setSidebarOpen(false);
                  navigate(`/admin/${page}`);
                }}
                isOpen={isSidebarOpen}
                setIsOpen={setSidebarOpen}
              />
              <div className="flex-1 flex flex-col overflow-hidden">
                <AdminHeader onMenuClick={() => setSidebarOpen(true)} title="Create Bill" user={currentUser!} />
                <main className="flex-1 overflow-x-hidden overflow-y-auto bg-slate-100 p-4 sm:p-6">
                  <CreateBill
                    user={currentUser!}
                    vegetables={billingData.vegetables}
                    bills={billingData.bills}
                    addBill={billingData.addBill}
                    availableStock={billingData.availableStock}
                  />
                </main>
              </div>
            </div>
          </ProtectedRoute>
        }
      />

      <Route
        path="/admin/settings"
        element={
          <ProtectedRoute user={currentUser} loading={loading} requiredRole="admin">
            <div className="flex h-screen bg-slate-100 font-sans">
              <Sidebar
                user={currentUser!}
                onLogout={handleLogout}
                currentPage="settings"
                setCurrentPage={(page) => {
                  setSidebarOpen(false);
                  navigate(`/admin/${page}`);
                }}
                isOpen={isSidebarOpen}
                setIsOpen={setSidebarOpen}
              />
              <div className="flex-1 flex flex-col overflow-hidden">
                <AdminHeader onMenuClick={() => setSidebarOpen(true)} title="Settings" user={currentUser!} />
                <main className="flex-1 overflow-x-hidden overflow-y-auto bg-slate-100 p-4 sm:p-6">
                  <Settings
                    user={currentUser!}
                    onUpdateProfile={handleUpdateProfile}
                    onChangePassword={handleChangePassword}
                  />
                </main>
              </div>
            </div>
          </ProtectedRoute>
        }
      />

      <Route
        path="/admindashboard"
        element={<Navigate to="/admin/dashboard" replace />}
      />

      <Route
        path="/admin-choice"
        element={
          <ProtectedRoute user={currentUser} loading={loading} requiredRole="admin">
            <AdminChoicePage />
          </ProtectedRoute>
        }
      />
      {/* Catch-all route - redirect any unknown paths to login */}
      <Route
        path="*"
        element={<Navigate to="/" replace />}
      />
    </Routes>
  );
};

export default App;