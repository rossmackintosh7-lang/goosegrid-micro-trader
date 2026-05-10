export default {
  async scheduled(event, env, ctx) {
    if (!env.SCAN_URL) {
      console.log('SCAN_URL missing. Set it to https://YOUR-SITE.pages.dev/api/scan');
      return;
    }
    ctx.waitUntil(fetch(env.SCAN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    }));
  }
};
