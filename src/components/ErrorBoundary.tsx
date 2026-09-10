import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-950 text-white p-6 flex items-center justify-center">
          <div className="max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
            <h2 className="text-2xl font-bold text-rose-400 mb-4">Something went wrong</h2>
            <details className="bg-slate-950 p-4 rounded-xl border border-slate-700 overflow-auto max-h-96">
              <summary className="cursor-pointer text-emerald-400 font-semibold">Show error details</summary>
              <pre className="mt-3 text-xs text-slate-300 whitespace-pre-wrap break-all">
                {this.state.error?.stack || this.state.error?.message || 'Unknown error'}
              </pre>
            </details>
            <button
              onClick={() => window.location.reload()}
              className="mt-6 px-6 py-3 bg-emerald-600 hover:bg-emerald-500 rounded-xl text-sm font-bold transition-colors"
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}