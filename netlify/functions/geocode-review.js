// geocode-review.js
// Called after a review is approved to geocode the city + region
// Uses OpenStreetMap Nominatim — free, no API key needed

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function geocode(city, region) {
  const query = encodeURIComponent(`${city}, ${region}`);
  const url = `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'PizzaOfficial/1.0 (pizzaofficial.biz)' }
  });
  const data = await res.json();
  if (!data?.[0]) return null;
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let review_id;
  try { review_id = JSON.parse(event.body).review_id; }
  catch { return { statusCode: 400, body: 'Bad JSON' }; }

  if (!review_id) return { statusCode: 400, body: 'Missing review_id' };

  const { data: review } = await supabase
    .from('pizza_reviews')
    .select('id, city, location, lat, lng')
    .eq('id', review_id)
    .maybeSingle();

  if (!review) return { statusCode: 404, body: 'Review not found' };
  if (review.lat && review.lng) return { statusCode: 200, body: 'Already geocoded' };

  // Parse city from location if city column is empty
  const city = review.city || review.location?.split(',')[0]?.trim();
  const region = review.location?.split(',')[1]?.trim() || '';

  if (!city) return { statusCode: 400, body: 'No city to geocode' };

  const coords = await geocode(city, region);
  if (!coords) return { statusCode: 404, body: 'Could not geocode: ' + city };

  await supabase
    .from('pizza_reviews')
    .update({ lat: coords.lat, lng: coords.lng })
    .eq('id', review_id);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true, ...coords }),
  };
};
