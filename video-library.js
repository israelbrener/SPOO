/* Account-owned original videos. Native controls load media only after a user click. */
(() => {
  'use strict';

  const MAX_BYTES = 25 * 1024 * 1024;
  const REVISION_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const REQUEST_TIMEOUT = 8500;
  const UPLOAD_TIMEOUT = 120000;
  const HOSTED_URL = 'https://vexyro-sport-demo.securitize-6959.chatgpt.site';
  const SIGN_IN_PATH = '/signin-with-chatgpt?return_to=%2F';
  const mounts = new Set();
  const byContainer = new WeakMap();
  const requests = new Set();
  let catalog = [];
  let exercises = new Map();
  let videos = new Map();
  let onChange = null;
  let phase = 'idle';
  let failure = '';
  let authenticated = false;
  let loading = false;
  let uploading = false;
  let refreshPromise = null;
  let initialized = false;
  let mountNumber = 0;
  let generation = 0;
  let ownerId = null;

  function node(tag, className = '', value = '') {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value) element.textContent = value;
    return element;
  }

  function icon(kind) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'vl-icon');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', {
      video: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm5 0v14M3 9h6M3 15h6m5-6 4 3-4 3V9Z',
      upload: 'M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5',
      lock: 'M7 11V7a5 5 0 0 1 10 0v4M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Zm6 4v2',
      refresh: 'M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 2M5 16a8 8 0 0 0 13 2',
      play: 'm9 6 9 6-9 6V6Z',
      check: 'm5 12 4 4L19 6',
      arrow: 'M19 12H5m7-7-7 7 7 7',
    }[kind] || 'M12 3v12m0 4v1');
    svg.append(path);
    return svg;
  }

  function button(label, className, action) {
    const result = node('button', className, label);
    result.type = 'button';
    if (action) result.addEventListener('click', action);
    return result;
  }

  function error(message, kind = 'request', status = 0) {
    const result = new Error(message);
    result.kind = kind;
    result.status = status;
    return result;
  }

  function isHostedContext() { return ['https:', 'http:'].includes(window.location.protocol); }
  function signInUrl() { return isHostedContext() ? SIGN_IN_PATH : `${HOSTED_URL}${SIGN_IN_PATH}`; }
  function signature(value) { return value ? JSON.stringify([value.exerciseId, value.title, value.mime, value.size, value.updatedAt, value.revision, value.url]) : ''; }
  function sizeText(bytes) {
    const mib = bytes / (1024 * 1024);
    return `${mib < 0.1 ? mib.toFixed(2) : mib.toFixed(1)} MiB`;
  }
  function getStatus() {
    return Object.freeze({ status: phase, phase, authenticated, userId: ownerId, loading, uploading, count: videos.size, error: failure || null, accountChanged: phase === 'account-changed' });
  }
  function get(exerciseId) { return authenticated ? videos.get(exerciseId) : undefined; }

  function metadata(value) {
    if (!value || typeof value !== 'object' || !exercises.has(value.exerciseId)
      || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 120
      || !['video/mp4', 'video/webm'].includes(value.mime)
      || !Number.isInteger(value.size) || value.size <= 0 || value.size > MAX_BYTES
      || typeof value.updatedAt !== 'string' || value.updatedAt.length > 40 || !Number.isFinite(Date.parse(value.updatedAt))
      || typeof value.revision !== 'string' || !REVISION_PATTERN.test(value.revision)
      || value.url !== `/api/videos/${encodeURIComponent(value.exerciseId)}/content?revision=${value.revision}`) return null;
    return Object.freeze({ exerciseId: value.exerciseId, title: value.title, mime: value.mime, size: value.size, updatedAt: value.updatedAt, revision: value.revision, url: value.url });
  }

  async function requestJson(path, options = {}, timeout = REQUEST_TIMEOUT, token = generation) {
    if (token !== generation) throw error('החיבור התחלף.', 'stale');
    const controller = new AbortController();
    requests.add(controller);
    let expired = false;
    const timer = window.setTimeout(() => { expired = true; controller.abort(); }, timeout);
    try {
      const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options, signal: controller.signal });
      if (token !== generation) throw error('החיבור התחלף.', 'stale');
      if (response.status === 401) throw error('כדי להעלות ולצפות בסרטונים האישיים צריך להתחבר לחשבון.', 'auth', 401);
      const contentType = response.headers.get('Content-Type') || '';
      if (!contentType.toLowerCase().includes('application/json')) {
        if (response.redirected || response.status === 200 || response.status === 403) {
          throw error('החיבור לחשבון דורש כניסה לאתר. אפשר להמשיך להשתמש באפליקציה במכשיר הזה.', 'auth', response.status);
        }
        throw error('ספריית הסרטונים אינה זמינה כרגע. אפשר לנסות לרענן את הרשימה.', 'request', response.status);
      }
      let body;
      try { body = await response.json(); }
      catch (_) { throw error('השרת לא החזיר רשימת סרטונים תקינה. אפשר לנסות שוב.', 'request', response.status); }
      if (token !== generation) throw error('החיבור התחלף.', 'stale');
      if (!response.ok) {
        const message = typeof body?.error?.message === 'string' ? body.error.message.slice(0, 500) : 'הבקשה לא הושלמה. אפשר לנסות שוב.';
        const kind = body?.error?.code === 'account_changed' ? 'account' : response.status === 409 ? 'conflict' : 'request';
        const issue = error(message, kind, response.status);
        issue.body = body;
        throw issue;
      }
      return body;
    } catch (issue) {
      if (token !== generation) throw error('החיבור התחלף.', 'stale');
      if (issue?.kind) throw issue;
      throw error(expired ? 'החיבור לשרת ארך יותר מהצפוי. אפשר לרענן ולנסות שוב.' : 'לא הצלחנו להתחבר לשרת. בדקו את החיבור לאינטרנט ונסו שוב.', expired ? 'timeout' : 'network');
    } finally { window.clearTimeout(timer); requests.delete(controller); }
  }

  async function fetchVideos(expectedOwner = ownerId, token = generation, timeout = REQUEST_TIMEOUT) {
    if (!expectedOwner) throw error('יש להתחבר לחשבון כדי לטעון את הסרטונים.', 'auth', 401);
    const body = await requestJson('/api/videos', { headers: { 'X-Vexyro-Account-Id': expectedOwner } }, timeout, token);
    if (!body || !Array.isArray(body.videos) || body.videos.length > catalog.length) throw error('רשימת הסרטונים שהתקבלה אינה תקינה. המידע לא הוחלף.');
    const next = new Map();
    for (const item of body.videos) {
      const value = metadata(item);
      if (!value || next.has(value.exerciseId)) throw error('רשימת הסרטונים שהתקבלה אינה תקינה. המידע לא הוחלף.');
      next.set(value.exerciseId, value);
    }
    return next;
  }

  function notifyChange() {
    if (typeof onChange === 'function') {
      try { onChange(getStatus()); } catch (_) { /* A host redraw must not interrupt a completed upload. */ }
    }
  }

  function replaceVideos(next) {
    const previous = Array.from(videos.values(), signature).sort().join('|');
    const following = Array.from(next.values(), signature).sort().join('|');
    videos = next;
    if (previous !== following) notifyChange();
  }

  function updateAll() {
    for (const mount of mounts) {
      if (!mount.container.contains(mount.root)) { mounts.delete(mount); continue; }
      updateMount(mount);
    }
  }

  function markFailure(issue) {
    failure = issue.message || 'לא ניתן לטעון את הספרייה כרגע.';
    phase = issue.kind === 'account' ? 'account-changed' : issue.kind === 'auth' ? 'signed-out' : 'error';
    authenticated = false;
    if (issue.kind === 'account' || issue.kind === 'auth') {
      ownerId = null;
      resetFormsAndPlayers();
    }
    replaceVideos(new Map());
  }

  function resetFormsAndPlayers() {
    for (const mount of mounts) {
      for (const player of mount.root.querySelectorAll('video')) {
        try { player.pause(); player.removeAttribute('src'); player.load(); } catch (_) { /* Detached player. */ }
      }
      mount.select.value = '';
      mount.title.value = '';
      mount.file.value = '';
      mount.autoTitle = '';
      mount.listKey = '';
      closeConfirmation(mount);
      clearFormNotice(mount);
    }
  }

  function clear() {
    generation += 1;
    for (const request of requests) request.abort();
    requests.clear();
    refreshPromise = null;
    loading = false;
    uploading = false;
    authenticated = false;
    ownerId = null;
    failure = '';
    phase = isHostedContext() ? 'signed-out' : 'local';
    resetFormsAndPlayers();
    replaceVideos(new Map());
    updateAll();
    return getStatus();
  }

  async function refresh() {
    if (refreshPromise) return refreshPromise;
    if (uploading) return getStatus();
    if (!isHostedContext()) {
      phase = 'local';
      authenticated = false;
      failure = '';
      loading = false;
      updateAll();
      return getStatus();
    }
    loading = true;
    phase = 'loading';
    failure = '';
    updateAll();
    const token = ++generation;
    const previousOwner = ownerId;
    const deadline = Date.now() + REQUEST_TIMEOUT;
    refreshPromise = (async () => {
      try {
        const identity = await requestJson('/api/account', {}, Math.max(1, deadline - Date.now()), token);
        const userId = identity?.user?.id;
        if (typeof userId !== 'string' || !userId.trim() || userId.length > 256) throw error('לא התקבל אישור תקין לחיבור החשבון.', 'auth');
        if (token !== generation) return getStatus();
        if (previousOwner && previousOwner !== userId) {
          authenticated = false;
          resetFormsAndPlayers();
          replaceVideos(new Map());
        }
        ownerId = userId;
        const next = await fetchVideos(userId, token, Math.max(1, deadline - Date.now()));
        if (token !== generation) return getStatus();
        authenticated = true;
        phase = 'ready';
        replaceVideos(next);
      } catch (issue) { if (token === generation && issue.kind !== 'stale') markFailure(issue); }
      finally {
        if (token === generation) { loading = false; refreshPromise = null; updateAll(); }
      }
      return getStatus();
    })();
    return refreshPromise;
  }

  async function init(options = {}) {
    if (Array.isArray(options.catalog)) {
      catalog = options.catalog.filter(item => item && typeof item.id === 'string' && typeof item.name === 'string');
      exercises = new Map(catalog.map(item => [item.id, item]));
    }
    if (typeof options.onChange === 'function') onChange = options.onChange;
    if (initialized) return getStatus();
    initialized = true;
    return refresh();
  }

  function signInLink() {
    const link = node('a', 'vl-signin', 'כניסה לחשבון');
    link.href = signInUrl();
    link.target = '_top';
    link.append(icon('arrow'));
    return link;
  }

  function renderStatus(mount) {
    const key = `${phase}|${loading}|${authenticated}|${failure}`;
    if (mount.statusKey === key) return;
    mount.statusKey = key;
    const box = mount.status;
    box.replaceChildren();
    box.className = `vl-connection is-${phase}`;
    const symbol = node('span', 'vl-connection-symbol');
    symbol.append(icon(loading ? 'refresh' : authenticated ? 'check' : 'lock'));
    const copy = node('div', 'vl-connection-copy');
    let title;
    let description;
    if (loading) {
      title = 'טוענים את הסרטונים שלך';
      description = 'רק הסרטונים השמורים בחשבון המחובר יופיעו כאן.';
    } else if (authenticated) {
      title = 'הספרייה הפרטית שלך';
      description = 'הסרטונים נשמרים בחשבון שלך וזמינים לאחר התחברות.';
    } else if (phase === 'local') {
      title = 'מעלים סרטונים דרך החשבון';
      description = 'בתצוגה המקומית אפשר להמשיך להשתמש באפליקציה. להעלאה ולשמירה בענן, פתחו את האתר והתחברו.';
    } else if (phase === 'signed-out' || phase === 'account-changed') {
      title = 'נכנסים לחשבון, ומתחילים להעלות';
      description = failure || 'העלאה וצפייה בסרטונים האישיים זמינות לאחר התחברות.';
    } else {
      title = 'הספרייה עדיין לא נטענה';
      description = failure || 'אפשר לרענן את החיבור ולהמשיך כשהשרת זמין.';
    }
    copy.append(node('strong', '', title), node('p', '', description));
    box.append(symbol, copy);
    if (!authenticated && !loading) {
      const actions = node('div', 'vl-connection-actions');
      if (phase === 'local' || phase === 'signed-out' || phase === 'error') actions.append(signInLink());
      if (isHostedContext()) actions.append(button('ניסיון נוסף', 'vl-text-button', () => { void refresh(); }));
      box.append(actions);
    }
  }

  function field(mount, name, labelText, element, hintText = '') {
    const wrapper = node('div', 'vl-field');
    const id = `${mount.prefix}-${name}`;
    element.id = id;
    element.name = name;
    const label = node('label', '', labelText);
    label.htmlFor = id;
    wrapper.append(label, element);
    if (hintText) {
      const hint = node('p', 'vl-hint', hintText);
      hint.id = `${id}-hint`;
      element.setAttribute('aria-describedby', hint.id);
      wrapper.append(hint);
    }
    return wrapper;
  }

  function clearFormNotice(mount) {
    mount.error.textContent = '';
    mount.error.hidden = true;
    mount.success.textContent = '';
    mount.success.hidden = true;
    for (const field of [mount.select, mount.title, mount.file]) field.removeAttribute('aria-invalid');
  }

  function closeConfirmation(mount) {
    mount.confirming = false;
    mount.confirmVersion = '';
    mount.confirm.hidden = true;
  }

  function showFormError(mount, message, control = null) {
    mount.error.textContent = message;
    mount.error.hidden = false;
    mount.success.hidden = true;
    if (control) {
      control.setAttribute('aria-invalid', 'true');
      control.focus();
    }
  }

  function validateForm(mount) {
    clearFormNotice(mount);
    const exerciseId = mount.select.value;
    const title = mount.title.value.trim();
    const file = mount.file.files?.[0];
    if (!exercises.has(exerciseId)) { showFormError(mount, 'בחרו את התרגיל שאליו הסרטון שייך.', mount.select); return null; }
    if (!title || title.length > 120 || /[\u0000-\u001f\u007f]/.test(title)) { showFormError(mount, 'כתבו כותרת לסרטון, עד 120 תווים.', mount.title); return null; }
    if (!file) { showFormError(mount, 'בחרו קובץ סרטון מהמכשיר.', mount.file); return null; }
    if (!file.size || file.size > MAX_BYTES) { showFormError(mount, file.size ? 'הקובץ גדול מדי. אפשר להעלות עד 25 MiB.' : 'הקובץ שנבחר ריק. בחרו סרטון אחר.', mount.file); return null; }
    const extension = file.name.toLowerCase().split('.').pop();
    if (!((extension === 'mp4' && file.type.toLowerCase() === 'video/mp4') || (extension === 'webm' && file.type.toLowerCase() === 'video/webm'))) {
      showFormError(mount, 'בחרו סרטון MP4 או WebM עם סיומת וסוג קובץ תואמים.', mount.file); return null;
    }
    if (file.name.length > 180 || /[\u0000-\u001f\u007f/\\]/.test(file.name)) {
      showFormError(mount, 'שם הקובץ ארוך מדי או כולל תווים שאינם נתמכים. שנו את שמו ובחרו אותו שוב.', mount.file); return null;
    }
    return { exerciseId, title, file };
  }

  function updateForm(mount) {
    const existing = videos.get(mount.select.value);
    const selectedFile = mount.file.files?.[0];
    const disabled = uploading;
    mount.form.setAttribute('aria-busy', uploading ? 'true' : 'false');
    mount.select.disabled = disabled;
    mount.title.disabled = disabled;
    mount.file.disabled = disabled;
    mount.submit.disabled = !authenticated || loading || uploading;
    mount.submitLabel.textContent = uploading ? 'מעלים את הסרטון…' : existing ? 'החלפת הסרטון' : 'העלאת הסרטון';
    mount.titleCount.textContent = `${mount.title.value.length}/120`;
    mount.fileInfo.replaceChildren();
    mount.fileInfo.hidden = !selectedFile;
    if (selectedFile) {
      const filename = node('bdi', 'vl-filename', selectedFile.name);
      filename.dir = 'auto';
      const size = node('bdi', 'vl-file-size', sizeText(selectedFile.size));
      size.dir = 'ltr';
      mount.fileInfo.append(filename, size);
    }
    mount.replaceNote.hidden = !existing;
    mount.replaceNote.textContent = existing ? `כבר שמור לתרגיל הזה הסרטון ״${existing.title}״. העלאה חדשה תחליף אותו בחשבון שלך.` : '';
    if (mount.confirming && signature(existing) !== mount.confirmVersion) closeConfirmation(mount);
    mount.confirmButton.disabled = uploading || !authenticated;
    mount.cancelButton.disabled = uploading;
    mount.submit.hidden = mount.confirming;
    mount.progress.hidden = !uploading;
    mount.uploadHint.textContent = authenticated ? 'הסרטון יחליף את ההדגמה של התרגיל בחשבון שלך בלבד.' : 'כפתור ההעלאה יהיה זמין אחרי חיבור לחשבון.';
  }

  async function performUpload(mount, input, expectedVersion) {
    if (uploading || loading || !authenticated) return;
    const token = generation;
    const expectedOwner = ownerId;
    const expectedRevision = videos.get(input.exerciseId)?.revision || '';
    uploading = true;
    phase = 'uploading';
    failure = '';
    clearFormNotice(mount);
    updateAll();
    try {
      // Check the visible replacement choice against the latest list before sending a large file.
      const fresh = await fetchVideos(expectedOwner, token);
      if (token !== generation) return;
      replaceVideos(fresh);
      if (signature(fresh.get(input.exerciseId)) !== expectedVersion) {
        throw error('הספרייה התעדכנה מאז הבחירה. הקובץ נשאר בטופס; בדקו את הסרטון הנוכחי ולחצו שוב כדי לאשר החלפה.', 'conflict', 409);
      }
      const body = new FormData();
      body.append('file', input.file);
      body.append('title', input.title);
      body.append('expectedRevision', expectedRevision);
      const response = await requestJson(`/api/videos/${encodeURIComponent(input.exerciseId)}`, { method: 'POST', body, headers: { 'X-Vexyro-Account-Id': expectedOwner } }, UPLOAD_TIMEOUT, token);
      if (token !== generation) return;
      const saved = metadata(response?.video);
      if (!saved || saved.exerciseId !== input.exerciseId) throw error('לא התקבל אישור תקין לשמירת הסרטון. רעננו את הרשימה לפני ניסיון נוסף.');
      const next = new Map(videos);
      next.set(saved.exerciseId, saved);
      authenticated = true;
      phase = 'ready';
      replaceVideos(next);
      mount.file.value = '';
      mount.title.value = saved.title;
      closeConfirmation(mount);
      mount.success.textContent = 'הסרטון נשמר בחשבון ושויך לתרגיל. אפשר לצפות בו בספרייה ובאימון.';
      mount.success.hidden = false;
    } catch (issue) {
      if (token !== generation || issue.kind === 'stale') return;
      if (issue.kind === 'auth' || issue.kind === 'account') markFailure(issue);
      else {
        phase = 'ready';
        if (issue.kind === 'conflict') {
          try {
            const fresh = await fetchVideos(expectedOwner, token);
            if (token === generation) replaceVideos(fresh);
          } catch (refreshIssue) {
            if (token === generation && ['auth', 'account'].includes(refreshIssue.kind)) markFailure(refreshIssue);
          }
        }
      }
      if (token !== generation) return;
      closeConfirmation(mount);
      const message = issue.kind === 'timeout' || issue.kind === 'network'
        ? `${issue.message} השמירה עדיין לא אושרה. הקובץ נשאר בטופס; רעננו את הרשימה לפני ניסיון נוסף.`
        : `${issue.message}${issue.kind === 'conflict' && !issue.message.includes('הקובץ נשאר') ? ' הקובץ נשאר בטופס ואפשר לבחור שוב אם להחליף.' : ''}`;
      showFormError(mount, message);
    } finally {
      if (token === generation) { uploading = false; updateAll(); }
    }
  }

  function submit(mount) {
    if (!authenticated || loading || uploading) return;
    const input = validateForm(mount);
    if (!input) return;
    const current = videos.get(input.exerciseId);
    if (current) {
      mount.confirming = true;
      mount.confirmVersion = signature(current);
      mount.confirmCopy.textContent = `להחליף את ״${current.title}״ בסרטון שבחרתם? הסרטון הקודם יוחלף בחשבון שלכם.`;
      mount.confirm.hidden = false;
      updateForm(mount);
      mount.confirmButton.focus();
      return;
    }
    void performUpload(mount, input, '');
  }

  function buildForm(mount) {
    const form = node('form', 'vl-upload-card');
    form.noValidate = true;
    mount.form = form;
    const header = node('div', 'vl-card-heading');
    const symbol = node('span', 'vl-card-symbol');
    symbol.append(icon('upload'));
    const heading = node('div');
    heading.append(node('h2', '', 'מוסיפים את ההדגמה שלך'), node('p', '', 'תרגיל אחד. הסרטון שצילמתם.'));
    header.append(symbol, heading);
    form.append(header);
    mount.select = node('select', 'vl-control');
    mount.select.required = true;
    const empty = node('option', '', 'בחירת תרגיל');
    empty.value = '';
    mount.select.append(empty);
    for (const exercise of catalog) {
      const option = node('option', '', exercise.name);
      option.value = exercise.id;
      mount.select.append(option);
    }
    form.append(field(mount, 'exercise', 'לאיזה תרגיל הסרטון שייך?', mount.select));
    mount.title = node('input', 'vl-control');
    mount.title.type = 'text';
    mount.title.required = true;
    mount.title.maxLength = 120;
    mount.title.autocomplete = 'off';
    mount.title.placeholder = 'למשל, הסקוואט שלי מהאימון';
    const titleField = field(mount, 'title', 'כותרת לסרטון', mount.title);
    mount.titleCount = node('bdi', 'vl-title-count', '0/120');
    mount.titleCount.dir = 'ltr';
    mount.titleCount.id = `${mount.prefix}-title-count`;
    mount.title.setAttribute('aria-describedby', mount.titleCount.id);
    titleField.append(mount.titleCount);
    form.append(titleField);
    mount.file = node('input', 'vl-control vl-file-input');
    mount.file.type = 'file';
    mount.file.accept = '.mp4,.webm,video/mp4,video/webm';
    mount.file.required = true;
    form.append(field(mount, 'file', 'בחירת סרטון מהמכשיר', mount.file, 'קובץ MP4 או WebM, עד 25 MiB. הסרטון נשמר בחשבון שלך.'));
    mount.fileInfo = node('div', 'vl-file-info');
    mount.fileInfo.hidden = true;
    form.append(mount.fileInfo);
    mount.replaceNote = node('p', 'vl-replace-note');
    mount.replaceNote.hidden = true;
    form.append(mount.replaceNote);
    mount.error = node('p', 'vl-form-error');
    mount.error.id = `${mount.prefix}-error`;
    mount.error.setAttribute('role', 'alert');
    mount.error.hidden = true;
    mount.success = node('p', 'vl-success');
    mount.success.setAttribute('role', 'status');
    mount.success.hidden = true;
    form.append(mount.error, mount.success);
    for (const control of [mount.select, mount.title, mount.file]) {
      const describedBy = control.getAttribute('aria-describedby');
      control.setAttribute('aria-describedby', [describedBy, mount.error.id].filter(Boolean).join(' '));
    }
    mount.confirm = node('div', 'vl-confirm');
    mount.confirm.hidden = true;
    mount.confirm.setAttribute('role', 'group');
    mount.confirm.setAttribute('aria-label', 'אישור החלפת סרטון');
    mount.confirmCopy = node('p');
    const confirmActions = node('div', 'vl-confirm-actions');
    mount.confirmButton = button('כן, להחליף ולהעלות', 'vl-confirm-button', () => {
      if (!mount.confirming) return;
      const input = validateForm(mount);
      if (input) void performUpload(mount, input, mount.confirmVersion);
    });
    mount.cancelButton = button('ביטול', 'vl-text-button', () => { closeConfirmation(mount); updateForm(mount); mount.submit.focus(); });
    confirmActions.append(mount.confirmButton, mount.cancelButton);
    mount.confirm.append(mount.confirmCopy, confirmActions);
    form.append(mount.confirm);
    mount.submit = node('button', 'button button-primary vl-submit');
    mount.submit.type = 'submit';
    mount.submitLabel = node('span', '', 'העלאת הסרטון');
    mount.submit.append(mount.submitLabel, icon('upload'));
    mount.progress = node('div', 'vl-upload-progress');
    mount.progress.hidden = true;
    mount.progress.setAttribute('role', 'status');
    mount.progress.append(node('span', 'vl-progress-line'), node('p', '', 'מעלים ושומרים בחשבון. השאירו את המסך פתוח עד לקבלת אישור.'));
    mount.uploadHint = node('p', 'vl-upload-hint');
    form.append(mount.submit, mount.progress, mount.uploadHint);
    mount.select.addEventListener('change', () => {
      clearFormNotice(mount);
      closeConfirmation(mount);
      const exercise = exercises.get(mount.select.value);
      if (!mount.title.value || mount.title.value === mount.autoTitle) {
        mount.autoTitle = exercise ? `הדגמה: ${exercise.name}`.slice(0, 120) : '';
        mount.title.value = mount.autoTitle;
      }
      updateForm(mount);
    });
    mount.title.addEventListener('input', () => { clearFormNotice(mount); closeConfirmation(mount); updateForm(mount); });
    mount.file.addEventListener('change', () => { clearFormNotice(mount); closeConfirmation(mount); updateForm(mount); });
    form.addEventListener('submit', event => { event.preventDefault(); submit(mount); });
    return form;
  }

  function pickReplacement(mount, item) {
    if (uploading) return;
    clearFormNotice(mount);
    closeConfirmation(mount);
    mount.select.value = item.exerciseId;
    mount.title.value = item.title;
    mount.autoTitle = '';
    updateForm(mount);
    mount.form.scrollIntoView({ block: 'start', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    mount.file.focus({ preventScroll: true });
  }

  function videoCard(mount, item) {
    const exercise = exercises.get(item.exerciseId);
    const card = node('article', 'vl-video-card');
    const header = node('div', 'vl-video-heading');
    const copy = node('div');
    copy.append(node('h3', '', item.title), node('p', '', exercise?.name || item.exerciseId));
    const badge = node('span', 'vl-owner-badge', 'הסרטון שלי');
    header.append(copy, badge);
    const facts = node('div', 'vl-video-facts');
    const format = node('bdi', '', item.mime === 'video/mp4' ? 'MP4' : 'WebM');
    format.dir = 'ltr';
    const size = node('bdi', '', sizeText(item.size));
    size.dir = 'ltr';
    const updated = node('time', '', new Date(item.updatedAt).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' }));
    updated.dateTime = item.updatedAt;
    facts.append(format, size, updated);
    const media = node('div', 'vl-media');
    const launch = button('', 'vl-play-button');
    launch.append(icon('play'), node('span', '', 'צפייה בסרטון'));
    launch.setAttribute('aria-label', `צפייה בסרטון שלך: ${item.title}`);
    launch.addEventListener('click', () => {
      for (const current of document.querySelectorAll('video')) { try { current.pause(); } catch (_) { /* Native player unavailable. */ } }
      const video = node('video', 'vl-native-video');
      video.src = item.url;
      video.controls = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.setAttribute('aria-label', item.title);
      const warning = node('p', 'vl-playback-error', 'הסרטון לא נטען. בדקו את החיבור לחשבון ורעננו את הרשימה.');
      warning.hidden = true;
      warning.setAttribute('role', 'status');
      video.addEventListener('error', () => { warning.hidden = false; });
      const close = button('סגירת הנגן', 'vl-text-button vl-close-player', () => {
        video.pause();
        video.removeAttribute('src');
        video.load();
        media.replaceChildren(launch);
        launch.focus();
      });
      media.replaceChildren(video, warning, close);
    });
    media.append(launch);
    const replace = button('החלפת הסרטון', 'vl-text-button vl-replace-button', () => pickReplacement(mount, item));
    replace.disabled = uploading;
    card.append(header, facts, media, replace);
    return card;
  }

  function renderList(mount) {
    const key = `${authenticated}|${phase === 'loading'}|${Array.from(videos.values(), signature).sort().join('|')}`;
    if (mount.listKey === key) {
      for (const control of mount.list.querySelectorAll('.vl-replace-button')) control.disabled = uploading;
      return;
    }
    mount.listKey = key;
    for (const player of mount.list.querySelectorAll('video')) { try { player.pause(); } catch (_) { /* Ignore a detached player. */ } }
    mount.list.replaceChildren();
    mount.count.textContent = String(videos.size);
    if (!authenticated || videos.size === 0) {
      const empty = node('div', 'vl-empty');
      const mark = node('span', 'vl-empty-mark');
      mark.append(icon('video'));
      empty.append(mark, node('h3', '', authenticated ? 'מקום לסרטון הראשון שלך' : 'הסרטונים שלך יופיעו כאן'));
      empty.append(node('p', '', authenticated
        ? 'עדיין לא העליתם סרטונים. בחרו תרגיל וקובץ למעלה, וההדגמה שלכם תצטרף לאימון.'
        : 'אחרי חיבור לחשבון וטעינת הספרייה, אפשר לצפות בסרטונים ולהוסיף הדגמות משלכם.'));
      mount.list.append(empty);
      return;
    }
    const sorted = Array.from(videos.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    for (const item of sorted) mount.list.append(videoCard(mount, item));
  }

  function updateMount(mount) {
    renderStatus(mount);
    updateForm(mount);
    renderList(mount);
    mount.refreshButton.disabled = loading || uploading || !isHostedContext();
    mount.refreshButton.setAttribute('aria-busy', loading ? 'true' : 'false');
  }

  function render(container) {
    if (!container || typeof container.replaceChildren !== 'function') return;
    let mount = byContainer.get(container);
    if (mount && container.contains(mount.root)) { updateMount(mount); return; }
    mount = { container, root: node('div', 'vl-library'), prefix: `vl-${++mountNumber}`, confirming: false, confirmVersion: '', autoTitle: '', statusKey: '', listKey: '' };
    mount.root.dir = 'rtl';
    mount.status = node('section', 'vl-connection');
    mount.status.setAttribute('role', 'status');
    mount.status.setAttribute('aria-live', 'polite');
    mount.root.append(mount.status, buildForm(mount));
    const saved = node('section', 'vl-saved');
    const header = node('div', 'vl-list-heading');
    const title = node('h2', '', 'בספרייה שלי');
    mount.count = node('bdi', 'vl-count', '0');
    mount.count.dir = 'ltr';
    title.append(mount.count);
    mount.refreshButton = button('רענון', 'vl-text-button vl-refresh', () => { void refresh(); });
    mount.refreshButton.prepend(icon('refresh'));
    header.append(title, mount.refreshButton);
    mount.list = node('div', 'vl-list');
    saved.append(header, mount.list);
    mount.root.append(saved);
    container.replaceChildren(mount.root);
    byContainer.set(container, mount);
    mounts.add(mount);
    updateMount(mount);
  }

  window.VEXYRO_VIDEO_LIBRARY = Object.freeze({ init, render, get, refresh, getStatus, clear });
})();
