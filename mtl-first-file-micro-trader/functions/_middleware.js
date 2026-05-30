function timingSafeEqual(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (!a || a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}

function json(data, status) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/api/')) return next();

  const adminAuthorised = timingSafeEqual(request.headers.get('x-bot-token'), env.BOT_ADMIN_TOKEN);
  const schedulerAuthorised = path === '/api/scan'
    && request.method === 'POST'
    && timingSafeEqual(request.headers.get('x-scheduler-token'), env.SCHEDULER_TOKEN);

  if (!adminAuthorised && !schedulerAuthorised) {
    return json({ ok: false, error: 'Private bot access token required.' }, 401);
  }

  return next();
}
