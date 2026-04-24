const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, body: 'Bad JSON' }; }

  const { did, signature_name, writing_sample, auto_approve } = body;

  if (!did || !signature_name) {
    return { statusCode: 400, body: 'did and signature_name required' };
  }

  // Verify user exists
  const { data: user } = await supabase
    .from('users').select('did, role').eq('did', did).single();
  if (!user) return { statusCode: 404, body: 'User not found — sign in first' };

  // Already a contributor or admin
  if (user.role === 'contributor' || user.role === 'admin') {
    return { statusCode: 409, body: 'Already a contributor' };
  }

  // Get pizza-official product id
  const { data: product } = await supabase
    .from('products').select('id').eq('slug', 'pizza-official').single();
  if (!product) return { statusCode: 500, body: 'Product not found' };

  // Check for existing pending application
  const { data: existing } = await supabase
    .from('contributor_applications')
    .select('id, status')
    .eq('user_did', did)
    .in('status', ['pending', 'approved'])
    .single();

  if (existing?.status === 'approved') {
    return { statusCode: 409, body: 'Already approved' };
  }

  // Determine status — auto_approve: true means instant contributor
  const status = auto_approve ? 'approved' : 'pending';

  // Insert application
  const { data: app, error } = await supabase
    .from('contributor_applications')
    .upsert({
      user_did:        did,
      product_id:      product.id,
      city:            body.city || '',
      favorite_style:  body.favorite_style || '',
      writing_sample:  writing_sample || 'Agreed to code of conduct.',
      signature_name:  signature_name,
      status:          status,
      reviewed_at:     auto_approve ? new Date().toISOString() : null,
    }, { onConflict: 'user_did,product_id' })
    .select('id')
    .single();

  if (error) return { statusCode: 500, body: 'Database error: ' + error.message };

  // If auto-approving, promote the user to contributor immediately
  if (auto_approve) {
    await supabase
      .from('users')
      .update({ role: 'contributor' })
      .eq('did', did);

    await supabase
      .from('contributor_profiles')
      .upsert({
        user_did:    did,
        product_id:  product.id,
        status:      'approved',
        approved_at: new Date().toISOString(),
      }, { onConflict: 'user_did,product_id' });
  }

  // Log event
  await supabase.from('events_log').insert({
    event_type:   auto_approve ? 'application_approved' : 'application_submitted',
    user_did:     did,
    product_id:   product.id,
    reference_id: app.id,
    metadata:     { signature_name, auto_approve: !!auto_approve },
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true, id: app.id, status }),
  };
};
