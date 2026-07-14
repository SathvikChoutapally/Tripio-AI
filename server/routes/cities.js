import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import supabase from '../lib/supabase.js';
import { resolveCity } from '../services/aiProxy.js';

const router = Router();

const searchSchema = z.object({
  q: z.string().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

/**
 * GET /api/cities/search?q=mum&limit=10
 * Full-text search on cities_cache for autocomplete
 */
router.get('/search', validate(searchSchema, 'query'), async (req, res) => {
  try {
    const { q, limit } = req.query;
    
    // Call the Python AI service city resolver
    const resolution = await resolveCity(q);
    
    if (resolution.resolved && resolution.matches) {
      // Map to frontend expected schema
      const mapped = resolution.matches.map(m => ({
        city_name: m.name,
        country: m.country_name || m.iata_country_code,
        country_code: m.iata_country_code,
        iata_code: m.iata_city_code || m.iata_code,
        latitude: m.latitude || 0,
        longitude: m.longitude || 0,
        region: null,
        is_major: m.type === 'city'
      }));
      res.json({ cities: mapped.slice(0, limit) });
    } else {
      res.json({ cities: [] });
    }
  } catch (err) {
    console.error('[Cities Search] Fallback to DB due to error:', err.message);
    try {
      const { data, error } = await supabase
        .from('cities_cache')
        .select('city_name, country, country_code, iata_code, liteapi_city_id, latitude, longitude, region, is_major')
        .or(`city_name.ilike.%${q}%,iata_code.ilike.%${q}%,country.ilike.%${q}%`)
        .order('is_major', { ascending: false })
        .order('city_name', { ascending: true })
        .limit(Number(limit));
      
      if (error) throw error;
      res.json({ cities: data });
    } catch (dbErr) {
      res.status(500).json({ error: dbErr.message });
    }
  }
});

/**
 * GET /api/cities
 * Get major cities (for initial dropdown or globe markers)
 */
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('cities_cache')
      .select('city_name, country, iata_code, latitude, longitude, region')
      .eq('is_major', true)
      .order('city_name', { ascending: true });
    
    if (error) throw error;
    res.json({ cities: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
