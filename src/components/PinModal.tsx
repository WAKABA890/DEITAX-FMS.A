import React, { useState } from 'react';
import { Lock, Check, X, ShieldAlert, KeyRound } from 'lucide-react';
import { User } from '../types';

interface PinModalProps {
  isOpen: boolean;
  title?: string;
  description?: string;
  requiredRoles?: string[];
  currentUser?: User | null;
  users: User[];
  onSuccess: (verifiedUser: User) => void;
  onCancel: () => void;
}

export const PinModal: React.FC<PinModalProps> = ({
  isOpen,
  title = 'PIN Verification Required',
  description = 'Enter your 4-digit security PIN to authorize this operation.',
  requiredRoles,
  currentUser,
  users = [],
  onSuccess,
  onCancel,
}) => {
  const [pin, setPin] = useState('');
  const [selectedUser, setSelectedUser] = useState<User | null>(
    currentUser || ((users || []).length > 0 ? users[0] : null)
  );
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleKeyPress = (num: string) => {
    if (pin.length < 6) {
      setPin((prev) => prev + num);
      setError(null);
    }
  };

  const handleBackspace = () => {
    setPin((prev) => prev.slice(0, -1));
    setError(null);
  };

  const handleClear = () => {
    setPin('');
    setError(null);
  };

  const handleSubmit = () => {
    if (!selectedUser) {
      setError('Please select a staff member.');
      return;
    }
    if (!pin) {
      setError('Please enter your 4-6 digit PIN.');
      return;
    }

    if (selectedUser.pin !== pin) {
      setError('Incorrect security PIN. Please try again.');
      setPin('');
      return;
    }

    if (
      requiredRoles &&
      requiredRoles.length > 0 &&
      !requiredRoles.includes(selectedUser.role)
    ) {
      setError(
        `Authorized role required: ${requiredRoles.join(' or ')}. (${selectedUser.name} is ${selectedUser.role})`
      );
      setPin('');
      return;
    }

    onSuccess(selectedUser);
    setPin('');
    setError(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden text-slate-100">
        {/* Header */}
        <div className="bg-slate-950 px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg border border-emerald-500/20">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-100 text-base">{title}</h3>
              <p className="text-xs text-slate-400">{description}</p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Staff Member Selector */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">
              Authorize As Staff Member
            </label>
            <select
              value={selectedUser?.id || ''}
              onChange={(e) => {
                const u = users.find((x) => x.id === e.target.value);
                if (u) setSelectedUser(u);
                setError(null);
              }}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} — {u.role}
                </option>
              ))}
            </select>
          </div>

          {/* PIN Display */}
          <div className="text-center">
            <div className="flex justify-center gap-3 my-2">
              {[0, 1, 2, 3].map((idx) => {
                const filled = pin.length > idx;
                return (
                  <div
                    key={idx}
                    className={`w-12 h-14 rounded-xl border flex items-center justify-center text-2xl font-bold transition-all ${
                      filled
                        ? 'border-emerald-500 bg-emerald-950/30 text-emerald-400 shadow-sm shadow-emerald-500/10'
                        : 'border-slate-800 bg-slate-950/60 text-slate-600'
                    }`}
                  >
                    {filled ? '●' : ''}
                  </div>
                );
              })}
            </div>
            {error && (
              <div className="mt-2 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 py-2 px-3 rounded-lg flex items-center justify-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Keypad */}
          <div className="grid grid-cols-3 gap-2.5 max-w-xs mx-auto">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
              <button
                key={num}
                onClick={() => handleKeyPress(num)}
                className="h-12 bg-slate-800/80 hover:bg-slate-700/80 text-slate-100 font-semibold text-lg rounded-xl transition-all active:scale-95 border border-slate-700/50"
              >
                {num}
              </button>
            ))}
            <button
              onClick={handleClear}
              className="h-12 bg-slate-800/40 hover:bg-slate-800 text-slate-400 font-medium text-xs rounded-xl transition-all"
            >
              CLEAR
            </button>
            <button
              onClick={() => handleKeyPress('0')}
              className="h-12 bg-slate-800/80 hover:bg-slate-700/80 text-slate-100 font-semibold text-lg rounded-xl transition-all active:scale-95 border border-slate-700/50"
            >
              0
            </button>
            <button
              onClick={handleBackspace}
              className="h-12 bg-slate-800/40 hover:bg-slate-800 text-slate-400 font-medium text-xs rounded-xl transition-all"
            >
              ⌫ DEL
            </button>
          </div>

          {/* Submit Action */}
          <button
            onClick={handleSubmit}
            disabled={pin.length === 0}
            className={`w-full py-3 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-all shadow-lg ${
              pin.length >= 4
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
            }`}
          >
            <Check className="w-4 h-4" />
            Confirm PIN & Authorize
          </button>
        </div>
      </div>
    </div>
  );
};
