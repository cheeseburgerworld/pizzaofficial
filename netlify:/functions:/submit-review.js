const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, body: 'Bad JSON' }; }

  const { did, name, location, city, region, country_code,
          rating, style, crust, char_level, sauce, cheese,
          notes, image_url, image_path } = body;

  if (!did || !name || !location || !city || rating === undefined || !style || !notes) {
    return { statusCode: 400, body: 'Required fields missing' };
  }
  if (notes.length > 400) return { statusCode: 400, body: 'Notes exceed 400 characters' };

  // Verify contributor or admin role
  const { data: user } = await supabase.from('users').select('role').eq('did', did).single();
  if (!user) return { statusCode: 404, body: 'User not found' };
  if (!['contributor', 'admin'].includes(user.role)) {
    return { statusCode: 403, body: 'Contributor role required' };
  }

  const { data: product } = await supabase.from('products').select('id').eq('slug', 'pizza-official').single();

  const { data, error } = await supabase
    .from('pizza_reviews')
    .insert({
      contributor_did: did,
      product_id: product.id,
      name, location, city,
      region: region || null,
      country_code: country_code || 'US',
      rating: Number(rating),
      style, crust, char_level, sauce, cheese, notes,
      image_url: image_url || null,
      image_path: image_path || null,
      status: 'pending',
    })
    .select('id')
    .single();

  if (error) return { statusCode: 500, body: 'Database error: ' + error.message };

  await supabase.from('events_log').insert({
    event_type: 'review_submitted',
    user_did: did,
    product_id: product.id,
    reference_id: data.id,
    metadata: { name, city, style, rating },
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true, id: data.id }),
  };
};
