import React, { useState } from 'react';
import { Fuel, Lock, User, AlertTriangle, Eye, EyeOff } from 'lucide-react';
import { User as UserType } from '../types';
import { api } from '../services/api';
import logo from '../assets/deities-logo.svg';
import { ThemeToggle } from './ThemeToggle';

interface LoginProps {
  users: UserType[];
  onLoginSuccess: (user: UserType) => void;
  onSignupClick: () => void;
  canSignUp?: boolean;
}

export const Login: React.FC<LoginProps> = ({ users, onLoginSuccess, onSignupClick, canSignUp = false }) => {
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showPin, setShowPin] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const normalizedUsername = username.trim();

    // Validate inputs
    if (!normalizedUsername) {
      setError('Please enter a username');
      setLoading(false);
      return;
    }

    if (!pin) {
      setError('Please enter your PIN');
      setLoading(false);
      return;
    }

    try {
      const result = await api.verifyPin(normalizedUsername, pin);
      onLoginSuccess(result.user);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Unable to establish a secure session.');
      setPin('');
    } finally {
      setLoading(false);
    }
  };

  const handleUsernameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUsername(e.target.value);
    setError(null);
  };

  const handlePinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 6);
    setPin(value);
    setError(null);
  };

  return (
    <div className="fms-app-shell flex min-h-screen items-center justify-center p-4"><div className="fixed right-4 top-4"><ThemeToggle/></div>
      {/* Background decorative elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 right-20 w-72 h-72 bg-emerald-500/5 rounded-full blur-3xl"></div>
        <div className="absolute bottom-20 left-20 w-72 h-72 bg-blue-500/5 rounded-full blur-3xl"></div>
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Logo and branding */}
        <div className="mb-8 flex flex-col items-start w-full">
          <div className="flex items-center justify-start gap-3 mb-3 w-fit">
            <img
              src={logo}
              alt="Deitax FMS 2.0"
              className="block h-14 w-14 object-contain"
            />
            <div className="leading-none text-left">
              <div className="text-[28px] font-black tracking-tight text-slate-100">Deitax</div>
              <div className="text-[12px] font-semibold tracking-[0.25em] text-slate-300 uppercase">FMS 2.0</div>
            </div>
          </div>
          <p className="text-slate-400 text-sm">Welcome back. Please login to continue.</p>
        </div>

        {/* Login card */}
        <div className="bg-slate-900/80 backdrop-blur border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
          {/* Header accent */}
          <div className="h-1 bg-gradient-to-r from-emerald-500 via-blue-500 to-emerald-500"></div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {/* Username field */}
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-slate-300 mb-2">
                Username or Email
              </label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                  <User className="w-5 h-5" />
                </div>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={handleUsernameChange}
                  placeholder="Enter your name or email"
                  className="w-full bg-slate-950/50 border border-slate-800 rounded-xl px-4 py-3 pl-11 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                  disabled={loading}
                  autoComplete="username"
                />
              </div>
            </div>

            {/* PIN field */}
            <div>
              <label htmlFor="pin" className="block text-sm font-medium text-slate-300 mb-2">
                PIN
              </label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                  <Lock className="w-5 h-5" />
                </div>
                <input
                  id="pin"
                  type={showPin ? 'text' : 'password'}
                  value={pin}
                  onChange={handlePinChange}
                  placeholder="Enter your 4-6 digit PIN"
                  maxLength={6}
                  className="w-full bg-slate-950/50 border border-slate-800 rounded-xl px-4 py-3 pl-11 pr-11 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all tracking-widest"
                  disabled={loading}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPin(!showPin)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300 transition-colors"
                  disabled={loading}
                >
                  {showPin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* Error message */}
            {error && (
              <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-rose-300">{error}</p>
              </div>
            )}

            {/* Submit button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 disabled:from-slate-700 disabled:to-slate-700 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-all duration-200 transform hover:scale-105 active:scale-95 disabled:scale-100 shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>Logging in...</span>
                </>
              ) : (
                <>
                  <Lock className="w-5 h-5" />
                  <span>Login</span>
                </>
              )}
            </button>

            {/* Signup section */}
            {canSignUp && <div className="mt-4 pt-4 border-t border-slate-800 text-center">
              <p className="text-xs text-slate-400 mb-3">Don't have an account?</p>
              <button
                type="button"
                onClick={onSignupClick}
                disabled={loading}
                className="w-full bg-slate-800/50 hover:bg-slate-700/50 disabled:bg-slate-800 text-emerald-400 hover:text-emerald-300 font-semibold py-2.5 rounded-xl transition-all duration-200 border border-slate-700 hover:border-emerald-500/30"
              >
                Create New Account
              </button>
            </div>}
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-slate-500 mt-6">
          © 2026 Deitax Fms 2.0. All rights reserved.
        </p>
      </div>
    </div>
  );
};
