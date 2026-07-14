import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Compass, LogOut, LayoutDashboard, User, Shield } from 'lucide-react';

export default function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/auth');
  };

  const isActive = (path) => location.pathname === path;

  return (
    <nav className="sticky top-0 z-50 navbar-glass px-4 py-3 md:px-8 flex items-center justify-between">
      {/* Brand Logo */}
      <Link to="/" className="flex items-center gap-2 group">
        <div className="w-10 h-10 rounded-xl bg-gradient-brand flex items-center justify-center shadow-brand transition-transform group-hover:scale-105">
          <Compass className="w-6 h-6 text-white animate-pulse-slow" />
        </div>
        <div className="flex flex-col">
          <span className="font-display font-extrabold text-lg tracking-tight leading-none">
            TRIPIO<span className="text-teal-400">AI</span>
          </span>
          <span className="text-[10px] text-white/40 tracking-wider">AGENTIC TRAVEL</span>
        </div>
      </Link>

      {/* Navigation Links */}
      <div className="flex items-center gap-4">
        {user ? (
          <>
            <Link
              to="/dashboard"
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium transition-all ${
                isActive('/dashboard')
                  ? 'bg-brand-500/10 text-brand-400 border border-brand-500/20'
                  : 'text-white/60 hover:text-white hover:bg-white/5 border border-transparent'
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              <span>Dashboard</span>
            </Link>

            {/* Admin metrics dashboard link */}
            {user.email === 'admin@tripio.ai' || user.email === 'chout.studio@gmail.com' ? (
              <Link
                to="/admin"
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium transition-all ${
                  isActive('/admin')
                    ? 'bg-teal-500/10 text-teal-400 border border-teal-500/20'
                    : 'text-white/60 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
              >
                <Shield className="w-4 h-4" />
                <span>Admin metrics</span>
              </Link>
            ) : null}

            {/* Profile Dropdown / Simple Sign-Out */}
            <div className="flex items-center gap-3 pl-2 border-l border-white/10">
              <div className="hidden sm:flex flex-col text-right">
                <span className="text-xs text-white/80 font-medium">
                  {user.user_metadata?.full_name || user.email.split('@')[0]}
                </span>
                <span className="text-[10px] text-white/40">{user.email}</span>
              </div>
              
              {user.user_metadata?.avatar_url ? (
                <img
                  src={user.user_metadata.avatar_url}
                  alt="Profile"
                  className="w-8 h-8 rounded-full border border-white/20 object-cover"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-glass-light border border-white/10 flex items-center justify-center text-white/70">
                  <User className="w-4 h-4" />
                </div>
              )}

              <button
                onClick={handleLogout}
                className="p-2 rounded-xl text-white/50 hover:text-red-400 hover:bg-red-500/10 transition-all"
                title="Log out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </>
        ) : (
          <Link
            to="/auth"
            className="px-5 py-2 rounded-xl text-sm font-semibold bg-brand-500 hover:bg-brand-600 text-white shadow-brand transition-all"
          >
            Sign In
          </Link>
        )}
      </div>
    </nav>
  );
}
