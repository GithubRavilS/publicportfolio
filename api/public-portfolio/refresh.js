/** Fixed-cabinet scan proxy. Navigator credentials never reach the browser. */
const STATES = new Set(['queued', 'running', 'completed', 'partial', 'failed']);
const JOB_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const DEFAULT_URL = 'https://cry-maden008.pythonanywhere.com/portfolio-check/api/public/navigator-refresh';

function reply(res, status, body) {
  res.statusCode = status;
  return res.json(body);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return reply(res, 405, {ok:false, error:{code:'METHOD_NOT_ALLOWED'}});
  }
  const origin = req.headers?.origin;
  let allowedOrigin = true;
  try { allowedOrigin = !origin || new URL(origin).host === req.headers.host; } catch { allowedOrigin = false; }
  if (req.headers?.['sec-fetch-site'] === 'cross-site' || !allowedOrigin) {
    return reply(res, 403, {ok:false, error:{code:'ORIGIN_NOT_ALLOWED'}});
  }
  const token = process.env.NAVIGATOR_REFRESH_TOKEN;
  if (!token) return reply(res, 503, {ok:false, error:{code:'REFRESH_NOT_CONFIGURED'}});

  const requestUrl = new URL(req.url || '/', 'https://portfolio.local');
  const jobId = requestUrl.searchParams.get('jobId');
  if (req.method === 'GET' && (!jobId || !JOB_ID.test(jobId))) {
    return reply(res, 400, {ok:false, error:{code:'INVALID_JOB_ID'}});
  }
  let upstream;
  try { upstream = new URL(process.env.NAVIGATOR_REFRESH_URL || DEFAULT_URL); }
  catch { return reply(res, 503, {ok:false, error:{code:'REFRESH_NOT_CONFIGURED'}}); }
  if (upstream.protocol !== 'https:') return reply(res, 503, {ok:false, error:{code:'REFRESH_NOT_CONFIGURED'}});
  if (req.method === 'GET') upstream.searchParams.set('jobId', jobId);
  try {
    const response = await fetch(upstream, {
      method:req.method,
      headers:{Authorization:`Bearer ${token}`, Accept:'application/json', 'Content-Type':'application/json'},
      ...(req.method === 'POST' ? {body:'{}'} : {}),
      cache:'no-store', redirect:'error', signal:AbortSignal.timeout(12000)
    });
    if (!response.ok) {
      if (response.status === 404 && req.method === 'GET') return reply(res, 404, {ok:false, error:{code:'JOB_NOT_FOUND'}});
      const retry = Number(response.headers.get('Retry-After'));
      if (response.status === 429) {
        const seconds = Number.isFinite(retry) && retry > 0 ? Math.min(retry, 600) : 60;
        res.setHeader('Retry-After', String(seconds));
        return reply(res, 429, {ok:false, error:{code:'REFRESH_BUSY'}, retryAfterSeconds:seconds});
      }
      return reply(res, 502, {ok:false, error:{code:'NAVIGATOR_REFRESH_UNAVAILABLE'}});
    }
    const data = await response.json();
    const wallets = data.wallets || {};
    if (data.ok !== true || !JOB_ID.test(String(data.jobId || '')) || !STATES.has(data.status)) {
      return reply(res, 502, {ok:false, error:{code:'INVALID_REFRESH_RESPONSE'}});
    }
    const total = Number(wallets.total), completed = Number(wallets.completed), failed = Number(wallets.failed);
    if (total !== 2 || !Number.isInteger(completed) || !Number.isInteger(failed) || completed < 0 || failed < 0 || completed + failed > total) {
      return reply(res, 502, {ok:false, error:{code:'INVALID_REFRESH_RESPONSE'}});
    }
    if (data.status === 'completed' && (completed !== 2 || failed !== 0 || !Number.isFinite(Date.parse(data.scannedAt)) || !data.snapshotId)) {
      return reply(res, 502, {ok:false, error:{code:'UNCONFIRMED_SCAN'}});
    }
    return reply(res, 200, {
      ok:true, jobId:String(data.jobId), status:data.status,
      wallets:{total, completed, failed},
      scannedAt:data.scannedAt || null, snapshotId:data.snapshotId || null,
      ...(['failed','partial'].includes(data.status) ? {error:{code:'SCAN_INCOMPLETE'}} : {})
    });
  } catch {
    return reply(res, 502, {ok:false, error:{code:'NAVIGATOR_REFRESH_UNAVAILABLE'}});
  }
}
