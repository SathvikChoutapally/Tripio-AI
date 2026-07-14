import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Compass, Mail, Lock, User, LogIn, ArrowRight } from 'lucide-react';

export default function Auth() {
  const navigate = useNavigate();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // If user is already authenticated, redirect to dashboard
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) navigate('/dashboard');
    });
  }, [navigate]);

  const handleAuth = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setLoading(true);

    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName,
            },
          },
        });
        if (error) throw error;
        alert('Verification email sent! Check your inbox.');
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        navigate('/dashboard');
      }
    } catch (err) {
      setErrorMsg(err.message || 'An error occurred during authentication');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/dashboard`,
        },
      });
      if (error) throw error;
    } catch (err) {
      setErrorMsg(err.message || 'Google Auth failed');
    }
  };

  return (
    <div className="min-h-[85vh] flex items-center justify-center px-4 relative">
      {/* Background glow orbs */}
      <div className="glow-orb w-96 h-96 bg-brand-500/10 top-1/4 left-1/4" />
      <div className="glow-orb w-96 h-96 bg-teal-500/10 bottom-1/4 right-1/4" />

      <div className="w-full max-w-md glass-card p-8 border-white/5 relative z-10">
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-gradient-brand flex items-center justify-center shadow-brand mb-3">
            <Compass className="w-6 h-6 text-white" />
          </div>
          <h2 className="font-display font-extrabold text-2xl tracking-tight text-white">
            {isSignUp ? 'Create your account' : 'Welcome back'}
          </h2>
          <p className="text-xs text-white/40 mt-1">
            {isSignUp ? 'Get started with AI travel planning' : 'Log in to access your agent itineraries'}
          </p>
        </div>

        {errorMsg && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs px-4 py-3 rounded-xl mb-4 font-medium flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleAuth} className="space-y-4">
          {isSignUp && (
            <div>
              <label className="text-xs font-semibold text-white/50 block mb-1">Full Name</label>
              <div className="relative">
                <User className="absolute left-4 top-3.5 w-4 h-4 text-white/40" />
                <input
                  type="text"
                  required
                  placeholder="e.g. John Doe"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="input-glass pl-11 pr-4"
                />
              </div>
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-white/50 block mb-1">Email Address</label>
            <div className="relative">
              <Mail className="absolute left-4 top-3.5 w-4 h-4 text-white/40" />
              <input
                type="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-glass pl-11 pr-4"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-white/50 block mb-1">Password</label>
            <div className="relative">
              <Lock className="absolute left-4 top-3.5 w-4 h-4 text-white/40" />
              <input
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-glass pl-11 pr-4"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full btn-brand py-3.5 rounded-xl font-bold font-display uppercase tracking-wider text-xs shadow-brand flex items-center justify-center gap-2 mt-6 active:scale-95 disabled:opacity-50"
          >
            {loading ? 'Authenticating...' : isSignUp ? 'Sign Up' : 'Sign In'}
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <div className="relative my-6 flex items-center justify-center">
          <div className="absolute inset-0 w-full h-[1px] bg-white/5" />
          <span className="relative bg-[#0a0a20] px-3 text-[10px] text-white/35 font-bold uppercase tracking-wider">
            Or continue with
          </span>
        </div>

        {/* Google OAuth Button */}
        <button
          onClick={handleGoogleLogin}
          type="button"
          className="w-full py-3 px-4 rounded-xl border border-white/10 hover:bg-white/5 text-white/80 hover:text-white transition-all text-xs font-semibold flex items-center justify-center gap-2"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" width="24" height="24">
            <path
              fill="currentColor"
              d="M21.35,11.1H12v2.7h5.38c-0.24,1.28 -0.96,2.37 -2.05,3.1v2.58h3.32c1.94,-1.78 3.05,-4.4 3.05,-7.4 0,-0.69 -0.06,-1.35 -0.18,-1.98z"
            />
            <path
              fill="currentColor"
              d="M12,20.7c2.61,0 4.8,-0.87 6.4,-2.37l-3.32,-2.58c-0.92,0.62 -2.1,0.98 -3.08,0.98 -2.37,0 -4.38,-1.6 -5.1,-3.75H1.47v2.66c1.6,3.18 4.91,5.36 8.53,5.36z"
            />
            <path
              fill="currentColor"
              d="M6.9,13.05c-0.18,-0.54 -0.28,-1.11 -0.28,-1.7s0.1,-1.16 0.28,-1.7V6.99H1.47C0.53,8.87 0,10.97 0,13.15c0,2.18 0.53,4.28 1.47,6.16l5.43,-4.26z"
            />
            <path
              fill="currentColor"
              d="M12,5.3c1.42,0 2.7,0.49 3.7,1.44l2.77,-2.77C16.8,2.38 14.61,1.5 12,1.5 8.37,1.5 5.06,3.68 3.47,6.86l5.43,4.26c0.72,-2.15 2.73,-3.82 5.1,-3.82z"
            />
          </svg>
          <span>Sign In with Google</span>
        </button>

        <div className="text-center mt-6">
          <button
            onClick={() => setIsSignUp(!isSignUp)}
            className="text-xs text-brand-400 hover:text-brand-300 font-semibold"
          >
            {isSignUp ? 'Already have an account? Sign In' : "Don't have an account? Sign Up"}
          </button>
        </div>
      </div>
    </div>
  );
}
