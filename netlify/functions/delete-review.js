const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let did, review_id;
  try {
    const body = JSON.parse(event.body || '{}');
    did = body.did;
    review_id = body.review_id;
  } catch {
    return { statusCode: 400, body: 'Bad JSON' };
  }

  if (!did) return { statusCode: 400, body: 'Missing DID' };
  if (!review_id) return { statusCode: 400, body: 'Missing review_id' };

  // Check review exists and belongs to this DID
  const { data: review, error: fetchErr } = await supabase
    .from('pizza_reviews')
    .select('contributor_did, name, status')
    .eq('id', review_id)
    .maybeSingle();

  if (fetchErr) {
    console.error('fetch error:', fetchErr);
    return { statusCode: 500, body: 'Database error: ' + fetchErr.message };
  }
  if (!review) return { statusCode: 404, body: 'Review not found' };
  if (review.contributor_did !== did) return { statusCode: 403, body: 'Not your review' };

  // Delete
  const { error: delErr } = await supabase
    .from('pizza_reviews')
    .delete()
    .eq('id', review_id)
    .eq('contributor_did', did); // double safety

  if (delErr) {
    console.error('delete error:', delErr);
    return { statusCode: 500, body: 'Delete failed: ' + delErr.message };
  }

  // Log (non-fatal)
  supabase.from('events_log').insert({
    event_type: 'review_deleted',
    user_did: did,
    metadata: { review_id, name: review.name, prior_status: review.status },
  }).catch(e => console.warn('events_log insert failed:', e.message));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true }),
  };
};
