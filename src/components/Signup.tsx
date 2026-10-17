import React, { useState } from 'react';
import { Fuel, User, Lock, Mail, Phone, AlertTriangle, Eye, EyeOff, ArrowLeft } from 'lucide-react';
import { User as UserType, Role } from '../types';
import logo from '../assets/deities-logo.svg';
import { ThemeToggle } from './ThemeToggle';

interface SignupProps {
  onSignupSuccess: () => void | Promise<void>;
  onBackToLogin: () => void;
  isFirstUser?: boolean;
}

const ROLES: Role[] = ['Admin', 'Station Manager', 'Fuel Attendant', 'Shop Attendant', 'Cashier', 'Auditor'];

export const Signup: React.FC<SignupProps> = ({ onSignupSuccess, onBackToLogin, isFirstUser = false }) => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    role: 'Admin' as Role,
    pin: '',
    confirmPin: '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showPin, setShowPin] = useState(false);
  const [showConfirmPin, setShowConfirmPin] = useState(false);
  const [loading, setLoading] = useState(false);

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Name is required';
    }

    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Invalid email format';
    }

    if (!formData.phone.trim()) {
      newErrors.phone = 'Phone number is required';
    }

    if (!formData.pin) {
      newErrors.pin = 'PIN is required';
    } else if (formData.pin.length < 4 || formData.pin.length > 6) {
      newErrors.pin = 'PIN must be 4-6 digits';
    } else if (!/^\d+$/.test(formData.pin)) {
      newErrors.pin = 'PIN must contain only numbers';
    }

    if (formData.pin !== formData.confirmPin) {
      newErrors.confirmPin = 'PINs do not match';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setLoading(true);

    try {
      const newUser: UserType = {
        id: 'usr-' + Date.now(),
        name: formData.name,
        email: formData.email,
        phone: formData.phone,
        role: isFirstUser ? 'Super Admin' : formData.role,
        pin: formData.pin,
        active: true,
      };

      // Send to server to save in database
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newUser),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.message || 'Failed to create account');
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
      await onSignupSuccess();
    } catch (error) {
      setErrors({
        submit: error instanceof Error ? error.message : 'Failed to create account. Please try again.',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: name === 'phone' ? value.replace(/\D/g, '') : value,
    }));
    // Clear error for this field when user starts typing
    if (errors[name]) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }
  };

  const handlePinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const numericValue = value.replace(/\D/g, '').slice(0, 6);
    setFormData((prev) => ({
      ...prev,
      [name]: numericValue,
    }));
    if (errors[name]) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }
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
              alt="DEITAX FMS.A"
              className="block h-14 w-14 object-contain"
            />
            <div className="leading-none text-left">
              <div className="text-[28px] font-black tracking-tight text-slate-100">DEITAX</div>
              <div className="text-[12px] font-semibold tracking-[0.25em] text-slate-300 uppercase">FMS.A</div>
            </div>
          </div>
          <p className="text-slate-400 text-sm">Create a new account to get started.</p>
        </div>

        {/* Signup card */}
        <div className="bg-slate-900/80 backdrop-blur border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
          {/* Header accent */}
          <div className="h-1 bg-gradient-to-r from-emerald-500 via-blue-500 to-emerald-500"></div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {/* Full Name */}
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-slate-300 mb-2">
                Full Name
              </label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                  <User className="w-5 h-5" />
                </div>
                <input
                  id="name"
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  placeholder="John Doe"
                  className={`w-full bg-slate-950/50 border rounded-xl px-4 py-3 pl-11 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 transition-all ${
                    errors.name ? 'border-rose-500 focus:ring-rose-500/50' : 'border-slate-800 focus:ring-emerald-500/50'
                  }`}
                  disabled={loading}
                />
              </div>
              {errors.name && <p className="text-xs text-rose-400 mt-1">{errors.name}</p>}
            </div>

            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-300 mb-2">
                Email Address
              </label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                  <Mail className="w-5 h-5" />
                </div>
                <input
                  id="email"
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  placeholder="john@example.com"
                  className={`w-full bg-slate-950/50 border rounded-xl px-4 py-3 pl-11 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 transition-all ${
                    errors.email ? 'border-rose-500 focus:ring-rose-500/50' : 'border-slate-800 focus:ring-emerald-500/50'
                  }`}
                  disabled={loading}
                />
              </div>
              {errors.email && <p className="text-xs text-rose-400 mt-1">{errors.email}</p>}
            </div>

            {/* Phone */}
            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-slate-300 mb-2">
                Phone Number
              </label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                  <Phone className="w-5 h-5" />
                </div>
                <input
                  id="phone"
                  type="tel"
                  name="phone"
                  value={formData.phone}
                  onChange={handleInputChange}
                  placeholder="+254712345678"
                  className={`w-full bg-slate-950/50 border rounded-xl px-4 py-3 pl-11 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 transition-all ${
                    errors.phone ? 'border-rose-500 focus:ring-rose-500/50' : 'border-slate-800 focus:ring-emerald-500/50'
                  }`}
                  disabled={loading}
                />
              </div>
              {errors.phone && <p className="text-xs text-rose-400 mt-1">{errors.phone}</p>}
            </div>

            {!isFirstUser && (
              <div>
                <label htmlFor="role" className="block text-sm font-medium text-slate-300 mb-2">
                  Position/Role
                </label>
                <select
                  id="role"
                  name="role"
                  value={formData.role}
                  onChange={handleInputChange}
                  className="w-full bg-slate-950/50 border border-slate-800 rounded-xl px-4 py-3 text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                  disabled={loading}
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role} className="bg-slate-900">
                      {role}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {isFirstUser && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
                First account is always created as the Super Admin. You will sign in with these details after setup.
              </div>
            )}

            {/* PIN */}
            <div>
              <label htmlFor="pin" className="block text-sm font-medium text-slate-300 mb-2">
                Security PIN (4-6 digits)
              </label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                  <Lock className="w-5 h-5" />
                </div>
                <input
                  id="pin"
                  type={showPin ? 'text' : 'password'}
                  name="pin"
                  value={formData.pin}
                  onChange={handlePinChange}
                  placeholder="••••"
                  maxLength={6}
                  className={`w-full bg-slate-950/50 border rounded-xl px-4 py-3 pl-11 pr-11 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 transition-all tracking-widest ${
                    errors.pin ? 'border-rose-500 focus:ring-rose-500/50' : 'border-slate-800 focus:ring-emerald-500/50'
                  }`}
                  disabled={loading}
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
              {errors.pin && <p className="text-xs text-rose-400 mt-1">{errors.pin}</p>}
            </div>

            {/* Confirm PIN */}
            <div>
              <label htmlFor="confirmPin" className="block text-sm font-medium text-slate-300 mb-2">
                Confirm PIN
              </label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                  <Lock className="w-5 h-5" />
                </div>
                <input
                  id="confirmPin"
                  type={showConfirmPin ? 'text' : 'password'}
                  name="confirmPin"
                  value={formData.confirmPin}
                  onChange={handlePinChange}
                  placeholder="••••"
                  maxLength={6}
                  className={`w-full bg-slate-950/50 border rounded-xl px-4 py-3 pl-11 pr-11 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 transition-all tracking-widest ${
                    errors.confirmPin ? 'border-rose-500 focus:ring-rose-500/50' : 'border-slate-800 focus:ring-emerald-500/50'
                  }`}
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPin(!showConfirmPin)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300 transition-colors"
                  disabled={loading}
                >
                  {showConfirmPin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              {errors.confirmPin && <p className="text-xs text-rose-400 mt-1">{errors.confirmPin}</p>}
            </div>

            {/* Error message */}
            {errors.submit && (
              <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-rose-300">{errors.submit}</p>
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
                  <span>Creating Account...</span>
                </>
              ) : (
                <span>Create Account</span>
              )}
            </button>

            {/* Back to login */}
            <button
              type="button"
              onClick={onBackToLogin}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 text-slate-400 hover:text-slate-300 font-medium py-2 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Login
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-slate-500 mt-6">
          © 2026 DeitIies Technologies LTD. All rights reserved.
        </p>
      </div>
    </div>
  );
};
