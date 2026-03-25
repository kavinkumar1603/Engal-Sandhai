// src/components/LoginPage.tsx
import React, { useEffect, useState } from 'react';
import Button from './ui/Button.tsx';
import { XCircleIcon, EyeIcon, EyeSlashIcon } from './ui/Icon.tsx';
import { loginWithEmployeeID } from '../services/authService';
import { useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { auth } from '../services/authService';
interface LoginPageProps {
  error?: string | null;
  clearError: () => void;
  currentUser?: { id: string; name: string; role: string; email?: string } | null;
  onLogin?: (employeeID: string, phone: string) => Promise<void>;
}

const LoginPage: React.FC<LoginPageProps> = ({ error, clearError, currentUser, onLogin }) => {
  const [employeeID, setEmployeeID] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();

  // reCAPTCHA - TEMPORARILY DISABLED
  /*
  useEffect(() => {
    if ((window as any).grecaptcha && !document.getElementById('recaptcha-container-rendered')) {
      (window as any).grecaptcha.render('recaptcha-container', {
        sitekey: '6LeCQ88rAAAAAJS8alTA0099YgvVMV3jGFVwsvLU', // replace with your site key
        theme: 'light',
      });
      document.getElementById('recaptcha-container')?.setAttribute('id', 'recaptcha-container-rendered');
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://www.google.com/recaptcha/api.js';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (!document.getElementById('recaptcha-container-rendered')) {
        (window as any).grecaptcha.render('recaptcha-container', {
          sitekey: '6LeCQ88rAAAAAJS8alTA0099YgvVMV3jGFVwsvLU',
          theme: 'light',
        });
        document.getElementById('recaptcha-container')?.setAttribute('id', 'recaptcha-container-rendered');
      }
    };
    document.body.appendChild(script);
  }, []);
  */

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setLoading(true);

    try {
      // Use the onLogin callback from App.tsx instead of handling login here
      if (onLogin) {
        await onLogin(employeeID, phone);
      } else {
        // Fallback to original login logic if no callback provided
        const userCredential = await loginWithEmployeeID(employeeID, phone);
      }
    } catch (err: any) {
      console.error('Login error:', err);
      // Error handling is done in App.tsx now
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-100 font-sans">
      <div className="w-full max-w-sm p-8 space-y-6 bg-white rounded-2xl shadow-xl">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-primary-900">🥬 Engal Santhai</h1>
          <p className="mt-2 text-slate-500">
            {currentUser ? `Welcome back, ${currentUser.name}!` : 'Sign in to your account'}
          </p>
        </div>
        
        {currentUser ? (
          <div className="space-y-4">
            <div className="text-center p-4 bg-green-50 rounded-lg">
              <XCircleIcon className="h-8 w-8 text-green-500 mx-auto mb-2" />
              <p className="text-green-700 font-medium">Login Successful!</p>
              <p className="text-sm text-green-600">You are logged in as {currentUser.role}</p>
            </div>
            <div className="space-y-3">
              {currentUser.role === 'admin' ? (
                <Button 
                  onClick={() => navigate('/admin-choice')} 
                  className="w-full" 
                  size="lg"
                >
                  Go to Admin Dashboard
                </Button>
              ) : (
                <Button 
                  onClick={() => navigate('/dashboard')} 
                  className="w-full" 
                  size="lg"
                >
                  Go to User Dashboard
                </Button>
              )}
              <Button 
                onClick={() => {
                  auth.signOut();
                  window.location.reload();
                }} 
                className="w-full"
              >
                Logout
              </Button>
            </div>
          </div>
        ) : (
          <form className="mt-8 space-y-6" onSubmit={handleLogin}>
          <div>
            <label htmlFor="employeeID" className="block text-sm font-medium text-slate-700 mb-1">
              Employee ID
            </label>
            <input
              id="employeeID"
              name="employeeID"
              type="text"
              autoComplete="username"
              required
              className="block w-full px-3 py-2 bg-white border border-slate-300 placeholder-slate-400 text-slate-900 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
              placeholder="Enter your Employee ID"
              value={employeeID}
              onChange={(e) => setEmployeeID(e.target.value.toUpperCase())}
            />
          </div>
          <div>
            <label htmlFor="phone" className="block text-sm font-medium text-slate-700 mb-1">
              Password
            </label>
            <div className="relative">
              <input
                id="phone"
                name="phone"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                className="block w-full px-3 py-2 pr-10 bg-white border border-slate-300 placeholder-slate-400 text-slate-900 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                placeholder="Enter your Password"
                value={phone}
                onChange={(e) => setPhone(e.target.value.toUpperCase())}
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 flex items-center pr-3 cursor-pointer"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? (
                  <EyeSlashIcon className="h-5 w-5 text-slate-400 hover:text-slate-600" />
                ) : (
                  <EyeIcon className="h-5 w-5 text-slate-400 hover:text-slate-600" />
                )}
              </button>
            </div>
          </div>
          {/* Google reCAPTCHA - TEMPORARILY DISABLED */}
          {/* <div id="recaptcha-container" className="my-4"></div> */}

          <div>
            <Button type="submit" className="w-full" size="lg" disabled={loading}>
              {loading ? 'Logging in...' : 'Sign in'}
            </Button>
            {error && (
              <div role="alert" className="flex items-center p-3 mt-4 text-sm text-red-700 bg-red-100 rounded-lg">
                <XCircleIcon className="h-5 w-5 mr-2 flex-shrink-0" />
                <div>
                  <span className="font-medium">{error}</span>
                </div>
              </div>
            )}
          </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default LoginPage;
