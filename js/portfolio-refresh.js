/* A manual refresh scans both cabinet wallets; background reads remain read-only. */
(() => {
  const button = document.querySelector('#refreshBtn');
  if (!button) return;
  const notice = document.createElement('div');
  notice.id = 'scanRefreshNotice';
  notice.className = 'freshness-notice';
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');
  notice.hidden = true;
  document.querySelector('.topbar').after(notice);
  const words = {
    start:['Запускаем обновление обоих кошельков…','Starting a scan of both wallets…'],
    running:['Сканируем оба кошелька…','Scanning both wallets…'],
    saving:['Загружаем новый снимок…','Loading the new snapshot…'],
    done:['Оба кошелька обновлены. Новый снимок сохранён.','Both wallets updated. New snapshot saved.'],
    partial:['Обновление завершилось с ошибкой. Не все кошельки обновлены.','Scan finished with an error. Not all wallets updated.'],
    failed:['Не удалось обновить кабинет. Показан последний доступный снимок.','Unable to refresh the cabinet. Showing the latest available snapshot.'],
    config:['Сканирование временно недоступно. Показан последний доступный снимок.','Scanning is temporarily unavailable. Showing the latest available snapshot.'],
    busy:['Обновление уже запускалось недавно. Повторите попытку позже.','A refresh was requested recently. Please try again later.'],
    waiting:['Сканирование ещё выполняется. Нажмите обновить, чтобы проверить результат.','The scan is still running. Click refresh to check its result.']
  };
  let active = false, stopped = false;
  let jobId = null;
  try { jobId = sessionStorage.getItem('publicPortfolio.refreshJob'); } catch {}
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  function show(key, progress) {
    const lang = document.documentElement.lang === 'en' ? 1 : 0;
    notice.textContent = words[key][lang] + (progress ? ` ${progress.completed} / ${progress.total}` : '');
    notice.hidden = false;
    notice.style.borderColor = ['failed','partial','config'].includes(key) ? '#c59b54' : '';
  }
  function saveJob(id) {
    jobId = id;
    try { if (id) sessionStorage.setItem('publicPortfolio.refreshJob',id); else sessionStorage.removeItem('publicPortfolio.refreshJob'); } catch {}
  }
  async function request(method, id) {
    const r = await fetch('/api/public-portfolio/refresh' + (id ? `?jobId=${encodeURIComponent(id)}` : ''), {
      method, cache:'no-store', credentials:'same-origin', signal:AbortSignal.timeout(20000),
      ...(method === 'POST' ? {headers:{'Content-Type':'application/json'}, body:'{}'} : {})
    });
    const body = await r.json();
    if (!r.ok || body.ok !== true) throw new Error(body.error?.code || 'REFRESH_FAILED');
    return body;
  }
  async function refresh() {
    if (active) return;
    active = true;
    button.disabled = true;
    button.setAttribute('aria-busy','true');
    show(jobId ? 'running' : 'start');
    try {
      let result = await request(jobId ? 'GET' : 'POST',jobId);
      saveJob(result.jobId);
      const until = Date.now()+8*60*1000;
      while (['queued','running'].includes(result.status)) {
        show('running',result.wallets);
        if (Date.now() >= until || stopped) {show('waiting'); return;}
        await pause(2500);
        result = await request('GET',jobId);
      }
      if (result.status !== 'completed') {
        saveJob(null);
        show(result.status === 'partial' ? 'partial' : 'failed');
        return;
      }
      show('saving');
      let loaded = false;
      for (let i=0;i<3 && !loaded;i++) {
        loaded = await loadData(result.scannedAt);
        if (!loaded) await pause(1500);
      }
      if (!loaded) throw new Error('SNAPSHOT_NOT_LOADED');
      saveJob(null);
      show('done');
    } catch (error) {
      const code = error.message;
      if (code === 'JOB_NOT_FOUND' || code === 'INVALID_JOB_ID') saveJob(null);
      show(code === 'REFRESH_NOT_CONFIGURED' ? 'config' : code === 'REFRESH_BUSY' ? 'busy' : 'failed');
    } finally {
      active = false;
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  }
  button.addEventListener('click',refresh);
  window.addEventListener('pagehide',()=>{stopped=true;});
  window.addEventListener('pageshow',()=>{stopped=false;});
  if (jobId) void refresh();
})();
