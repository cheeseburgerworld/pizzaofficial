const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, body: 'Bad JSON' }; }

  const { did, city, favorite_style, writing_sample, signature_name } = body;
  if (!did || !city || !favorite_style || !writing_sample || !signature_name) {
    return { statusCode: 400, body: 'All fields required' };
  }

  // Verify user exists
  const { data: user } = await supabase.from('users').select('did, role').eq('did', did).single();
  if (!user) return { statusCode: 404, body: 'User not found — sign in first' };
  if (['contributor', 'admin'].includes(user.role)) {
    return { statusCode: 409, body: 'Already a contributor' };
  }

  // Check for existing pending application
  const { data: existing } = await supabase
    .from('contributor_applications')
    .select('id, status')
    .eq('user_did', did)
    .eq('status', 'pending')
    .single();
  if (existing) return { statusCode: 409, body: 'Application already pending' };

  // Get pizza-official product id
  const { data: product } = await supabase.from('products').select('id').eq('slug', 'pizza-official').single();

  const { data, error } = await supabase
    .from('contributor_applications')
    .insert({
      user_did: did,
      product_id: product.id,
      city,
      favorite_style,
      writing_sample,
      signature_name,
      status: 'pending',
    })
    .select('id')
    .single();

  if (error) return { statusCode: 500, body: 'Database error: ' + error.message };

  // Log event
  await supabase.from('events_log').insert({
    event_type: 'application_submitted',
    user_did: did,
    product_id: product.id,
    reference_id: data.id,
    metadata: { city, favorite_style },
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true, id: data.id }),
  };
};
