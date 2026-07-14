import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatINR } from '../lib/currency';
import { Plane, Calendar, IndianRupee, Eye, Trash2, ShieldAlert, Sparkles, MapPin } from 'lucide-react';

export default function Dashboard() {
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    fetchTrips();
  }, []);

  const fetchTrips = async () => {
    setLoading(true);
    try {
      const { trips: data } = await api.getTrips();
      setTrips(data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id, e) => {
    e.preventDefault(); // prevent navigation
    if (!confirm('Are you sure you want to delete this trip itinerary?')) return;
    setDeletingId(id);
    try {
      await api.deleteTrip(id);
      setTrips(prev => prev.filter(t => t.id !== id));
    } catch (err) {
      console.error(err);
    } finally {
      setDeletingId(null);
    }
  };

  const getStatusBadgeClass = (status) => {
    switch (status) {
      case 'confirmed':
        return 'badge-teal';
      case 'failed':
      case 'cancelled':
        return 'badge-amber bg-red-500/10 text-red-400 border-red-500/20';
      case 'booking':
      case 'pending_payment':
        return 'badge-amber';
      case 'planning':
      case 'searching':
      default:
        return 'badge-brand';
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-8 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black font-display tracking-tight">Your Travel Workspace</h1>
          <p className="text-sm text-white/50">Manage your active trips and autonomous itineraries</p>
        </div>
        <Link
          to="/"
          className="btn-brand font-bold text-xs uppercase tracking-wider py-3 shadow-brand"
        >
          Plan New Trip
        </Link>
      </div>

      {/* Grid of trips */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((n) => (
            <div key={n} className="glass-card h-64 skeleton opacity-60 rounded-2xl" />
          ))}
        </div>
      ) : trips.length === 0 ? (
        <div className="text-center py-16 glass-card border-white/5 flex flex-col items-center max-w-xl mx-auto">
          <Sparkles className="w-10 h-10 text-brand-400 animate-pulse mb-3" />
          <h2 className="font-display font-bold text-lg text-white">No trip plans found</h2>
          <p className="text-xs text-white/40 mt-1 max-w-xs leading-relaxed">
            You haven't planned any trips yet. Enter a destination and budget to spawn your first planning agent network.
          </p>
          <Link
            to="/"
            className="mt-6 px-6 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-xs font-bold text-white shadow-brand transition-all"
          >
            Create your first plan
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {trips.map((trip) => {
            const startDate = new Date(trip.date_start).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
            const endDate = new Date(trip.date_end).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
            
            return (
              <Link
                key={trip.id}
                to={`/planner/${trip.id}`}
                className="glass-card p-5 border-white/5 flex flex-col justify-between h-64 hover:border-brand-500/30 group"
              >
                <div>
                  {/* Status Badge */}
                  <div className="flex items-center justify-between mb-4">
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${getStatusBadgeClass(trip.status)}`}>
                      {trip.status.replace('_', ' ')}
                    </span>
                    <button
                      onClick={(e) => handleDelete(trip.id, e)}
                      disabled={deletingId === trip.id}
                      className="text-white/30 hover:text-red-400 p-1.5 rounded-lg hover:bg-red-500/10 transition-colors"
                      title="Delete trip plan"
                    >
                      {deletingId === trip.id ? (
                        <div className="w-4 h-4 border-2 border-white/20 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  </div>

                  {/* Destination / Route */}
                  <h3 className="font-display font-extrabold text-lg leading-tight tracking-tight text-white group-hover:text-brand-400 transition-colors">
                    {trip.origin_city.split(',')[0]} ✈ {trip.destination_city.split(',')[0]}
                  </h3>
                  
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center gap-2 text-xs text-white/50">
                      <Calendar className="w-4 h-4 text-brand-400" />
                      <span>{startDate} - {endDate}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-white/50">
                      <MapPin className="w-4 h-4 text-teal-400" />
                      <span>Route IATA: {trip.origin_iata} to {trip.destination_iata}</span>
                    </div>
                  </div>
                </div>

                {/* Footer price & CTA */}
                <div className="flex items-center justify-between border-t border-white/5 pt-3.5 mt-4">
                  <div>
                    <span className="text-[9px] text-white/40 uppercase block">Trip Budget</span>
                    <span className="font-bold text-teal-400 text-sm font-mono">{formatINR(trip.budget_inr)}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs font-bold text-brand-400 hover:text-brand-300 transition-colors">
                    <span>Open workspace</span>
                    <Eye className="w-4 h-4" />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
