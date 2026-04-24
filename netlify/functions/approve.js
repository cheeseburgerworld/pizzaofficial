const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ADMIN_DID = process.env.ADMIN_DID;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, body: 'Bad JSON' }; }

  const { admin_did, type, id, action } = body;
  // type: 'review' or 'application'
  // action: 'approve' or 'reject'

  if (admin_did !== ADMIN_DID) return { statusCode: 403, body: 'Admin only' };
  if (!['review','application'].includes(type)) return { statusCode: 400, body: 'Invalid type' };
  if (!['approve','reject'].includes(action)) return { statusCode: 400, body: 'Invalid action' };

  const status = action === 'approve' ? 'approved' : 'rejected';

  if (type === 'review') {
    const { error } = await supabase
      .from('pizza_reviews')
      .update({ status, approved_by: admin_did, approved_at: new Date().toISOString() })
      .eq('id', id);
    if (error) return { statusCode: 500, body: error.message };

    if (action === 'approve') {
      // Get the review to log the event
      const { data: review } = await supabase.from('pizza_reviews').select('contributor_did, product_id').eq('id', id).single();
      if (review) {
        await supabase.from('events_log').insert({
          event_type: 'review_approved',
          user_did: review.contributor_did,
          product_id: review.product_id,
          reference_id: id,
        });
        // Update user rank
        await updateRank(review.contributor_did, review.product_id);
      }
    }
  }

  if (type === 'application') {
    const { data: app } = await supabase
      .from('contributor_applications')
      .update({ status, reviewer_did: admin_did, reviewed_at: new Date().toISOString() })
      .eq('id', id)
      .select('user_did, product_id')
      .single();

    if (action === 'approve' && app) {
      // Promote user to contributor
      await supabase.from('users').update({ role: 'contributor' }).eq('did', app.user_did);

      // Create contributor profile
      await supabase.from('contributor_profiles').upsert({
        user_did: app.user_did,
        product_id: app.product_id,
        status: 'approved',
        approved_at: new Date().toISOString(),
        approved_by: admin_did,
      }, { onConflict: 'user_did,product_id' });

      await supabase.from('events_log').insert({
        event_type: 'application_approved',
        user_did: app.user_did,
        product_id: app.product_id,
        reference_id: id,
      });
    }
  }

  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true }) };
};

async function updateRank(user_did, product_id) {
  // Count approved reviews for this user + product
  const { count } = await supabase
    .from('pizza_reviews')
    .select('*', { count: 'exact', head: true })
    .eq('contributor_did', user_did)
    .eq('product_id', product_id)
    .eq('status', 'approved');

  // Find the highest rank they qualify for
  const { data: ranks } = await supabase
    .from('rank_definitions')
    .select('id, min_reviews')
    .eq('product_id', product_id)
    .lte('min_reviews', count)
    .order('min_reviews', { ascending: false })
    .limit(1);

  if (ranks?.[0]) {
    await supabase.from('user_ranks').upsert({
      user_did, product_id, rank_id: ranks[0].id, earned_at: new Date().toISOString()
    }, { onConflict: 'user_did,product_id' });
  }
}
