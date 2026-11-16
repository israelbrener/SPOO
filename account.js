/* Account-scoped, explicit cloud sync. Identity comes only from the protected API. */
(() => {
  'use strict';
  const META_KEY = 'vexyro.cloud-sync.v1';
  const SIGN_IN = '/signin-with-chatgpt?return_to=%2F';
  const PRODUCTION = 'https://vexyro-sport-demo.securitize-6959.chatgpt.site';
  const FIELDS = ['profile', 'plan', 'activeWorkout', 'history', 'trainingContext', 'membership'];
  const SYNCABLE = ['connected', 'synced', 'pending', 'syncing', 'offline'];
  const views = new Map();
  let hooks = null, user = null, remote = null, bootstrapped = false, accountChanged = false;
  let phase = 'local', detail = '', applying = false, inFlight = false, actionBusy = false;
  let storageFailed = false, localVersion = 0, generation = 0, firstDirtyAt = null;
  let timer = null, retryTimer = null, failures = 0, bootstrapPromise = null, identityPromise = null;
  let meta = readMeta();
  let authBlocked = Boolean(meta.userId), identityQueued = false;

  function readMeta() {
    const clean = { schemaVersion: 1, userId: null, revision: 0, enabled: false, dirty: false, lastSyncedAt: null };
    try {
      const value = JSON.parse(localStorage.getItem(META_KEY));
      if (value?.schemaVersion !== 1 || typeof value.userId !== 'string' || !value.userId
        || !Number.isSafeInteger(value.revision) || value.revision < 0) return clean;
      return { ...clean, userId: value.userId, revision: value.revision, enabled: value.enabled === true,
        dirty: value.dirty === true, lastSyncedAt: validTimestamp(value.lastSyncedAt) ? value.lastSyncedAt : null };
    } catch (_) { return clean; }
  }

  function persistMeta() {
    try { localStorage.setItem(META_KEY, JSON.stringify(meta)); storageFailed = false; }
    catch (_) { storageFailed = true; }
  }

  function validTimestamp(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
  function mismatch() { return Boolean(user && meta.userId && meta.userId !== user.id); }
  function emptySnapshot() { return { schemaVersion: 1, profile: null, plan: null, activeWorkout: null, history: { schemaVersion: 1, records: [] }, trainingContext: null, membership: null }; }

  function copySnapshot(value) {
    if (!value || value.schemaVersion !== 1 || FIELDS.some(key => !Object.hasOwn(value, key))
      || FIELDS.some(key => value[key] !== null && (typeof value[key] !== 'object' || Array.isArray(value[key])))
      || value.history !== null && (value.history.schemaVersion !== 1 || !Array.isArray(value.history.records))) {
      throw new Error('נתוני האפליקציה אינם מוכנים לסנכרון. העותק המקומי לא השתנה.');
    }
    return JSON.parse(JSON.stringify(value));
  }

  function localSnapshot() { return copySnapshot(hooks.readLocal()); }
  function hasData(data) {
    return Boolean(data.profile || data.plan || data.activeWorkout || data.membership || data.history?.records?.length
      || data.trainingContext?.screening || data.trainingContext?.injuryAreas?.length);
  }

  function serverState(value) {
    if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Object.hasOwn(value, 'data')
      || value.updatedAt !== null && !validTimestamp(value.updatedAt)) throw new Error('שירות הענן החזיר תשובה שלא ניתן לקרוא.');
    return { revision: value.revision, data: value.data === null ? null : copySnapshot(value.data), updatedAt: value.updatedAt };
  }

  async function request(path, options, signal) {
    const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options,
      headers: { Accept: 'application/json', ...(options?.headers || {}) }, signal });
    let value;
    try { value = JSON.parse(await response.text()); }
    catch (_) { const error = new Error('שירות הענן אינו זמין בכתובת הזו כרגע.'); error.status = response.status; error.nonJson = true; throw error; }
    if (!response.ok) {
      const error = new Error(typeof value?.error?.message === 'string' ? value.error.message : 'לא ניתן להשלים כרגע את הבקשה לענן.');
      error.status = response.status; error.payload = value; throw error;
    }
    return value;
  }

  async function network(work) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    try { return await work(controller.signal); }
    finally { clearTimeout(timeout); }
  }

  async function identity(signal) {
    const result = await request('/api/account', {}, signal);
    if (!result?.user || typeof result.user.id !== 'string' || !result.user.id) throw new Error('לא ניתן לאמת את החשבון המחובר.');
    return { id: result.user.id,
      displayName: typeof result.user.displayName === 'string' ? result.user.displayName : '',
      email: typeof result.user.email === 'string' ? result.user.email : '' };
  }

  function message() {
    if (detail) return detail;
    if (identityPromise || identityQueued) return 'מאמתים מחדש את החשבון לפני המשך העבודה…';
    if (phase === 'signed-out' && meta.userId) return 'יש בדפדפן נתונים המשויכים לחשבון. יש להתחבר שוב כדי להציג אותם ולהמשיך בסנכרון.';
    return {
      local: 'הנתונים נשמרים בדפדפן הזה. אפשר להתחבר כדי להפעיל שמירה בחשבון.',
      checking: 'בודקים את החשבון ואת הגרסה האחרונה בענן…',
      'signed-out': 'לא זוהה חשבון מחובר. השינויים נשארים מקומיים ולא נשלחים לענן.',
      unavailable: 'שירות הענן אינו זמין כרגע. אפשר להמשיך לעבוד במצב מקומי.',
      ready: 'החשבון מחובר. שמירה בענן תתחיל רק לאחר הפעלה שלך.',
      import: 'יש נתונים בדפדפן שעדיין לא שויכו לחשבון. הייבוא יתחיל רק לאחר בחירה שלך.',
      choice: 'יש נתונים בדפדפן וגם בחשבון. בוחרים איזו גרסה לשמור לפני שמפעילים סנכרון.',
      connected: 'השמירה בחשבון פעילה. הנתונים הבאים שתשמרו באפליקציה יישלחו לענן.',
      synced: 'הגרסה האחרונה אושרה ונשמרה בחשבון.',
      pending: 'יש שינויים מקומיים שממתינים לאישור שמירה בענן.',
      syncing: 'שומרים את השינויים בחשבון…',
      offline: 'השינויים המקומיים ממתינים. ננסה שוב כששירות הענן יהיה זמין.',
      conflict: 'בחשבון נשמרה גרסה אחרת. הסנכרון נעצר עד לבחירה שלך.',
      'account-mismatch': 'הנתונים בדפדפן משויכים לחשבון אחר. הם לא יישלחו לחשבון המחובר.',
      applying: 'טוענים את הנתונים שנבחרו…',
      error: 'הסנכרון נעצר. הנתונים המקומיים לא נשלחו מחדש.',
    }[phase] || 'השמירה זמינה בדפדפן הזה.';
  }

  function getStatus() {
    return Object.freeze({ phase, user: user ? { ...user } : null, revision: meta.revision,
      enabled: Boolean(!authBlocked && !accountChanged && bootstrapped && user?.id === meta.userId && meta.enabled && SYNCABLE.includes(phase)),
      dirty: meta.dirty, blocked: authBlocked || accountChanged || mismatch(), busy: Boolean(bootstrapPromise || identityPromise || inFlight || actionBusy || applying),
      lastSyncedAt: meta.lastSyncedAt, storageFailed, message: message() });
  }

  function emit() {
    for (const container of views.keys()) if (container.isConnected !== false) paint(container);
    try { hooks?.onChange?.(getStatus()); } catch (_) { /* Host rendering must not interrupt the sync state machine. */ }
  }

  function cancelTimers() { clearTimeout(timer); clearTimeout(retryTimer); timer = retryTimer = null; firstDirtyAt = null; }

  function schedule() {
    if (authBlocked || accountChanged || !bootstrapped || mismatch() || !meta.enabled || !meta.dirty || !SYNCABLE.includes(phase)) return;
    if (firstDirtyAt === null) firstDirtyAt = Date.now();
    if (inFlight) return;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void flush(); }, Math.max(0, Math.min(1500, 5000 - (Date.now() - firstDirtyAt))));
  }

  function retryLater(error) {
    if (error?.nonJson || error?.status && error.status < 500) return;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { retryTimer = null; void retry(); }, Math.min(30000, 5000 * 2 ** Math.min(failures++, 3)));
  }

  async function adopt(value, ownerId = user.id) {
    phase = 'applying'; detail = ''; applying = true; emit();
    try {
      await hooks.applyRemote(copySnapshot(value.data || emptySnapshot()));
      meta = { schemaVersion: 1, userId: ownerId, revision: value.revision, enabled: true, dirty: false, lastSyncedAt: value.updatedAt };
      remote = value; bootstrapped = true; firstDirtyAt = null; failures = 0; persistMeta();
      authBlocked = user?.id !== ownerId;
      phase = authBlocked ? 'account-mismatch' : value.revision > 0 ? 'synced' : 'connected';
    } finally { applying = false; }
  }

  async function bootstrap() {
    if (!hooks) return getStatus();
    if (bootstrapPromise) return bootstrapPromise;
    if (identityPromise) { await identityPromise; return getStatus(); }
    if (inFlight || actionBusy) return getStatus();
    const token = ++generation;
    cancelTimers(); bootstrapped = false; authBlocked = Boolean(meta.userId); phase = 'checking'; detail = '';
    const task = (async () => {
      try {
        await network(async signal => {
          const authenticated = await identity(signal);
          if (token !== generation) return;
          user = authenticated;
          authBlocked = mismatch();
          if (mismatch()) { phase = 'account-mismatch'; emit(); }
          const value = serverState(await request('/api/state', { headers: { 'X-Vexyro-Account-Id': user.id } }, signal));
          if (token !== generation) return;
          remote = value; bootstrapped = true; accountChanged = false;
          if (mismatch()) { phase = 'account-mismatch'; return; }
          const local = localSnapshot();
          if (meta.userId === user.id && meta.enabled) {
            if (meta.dirty) {
              phase = meta.revision === value.revision ? 'pending' : 'conflict';
            } else if (value.revision < meta.revision || value.data === null && hasData(local)) {
              phase = 'conflict'; meta.dirty = true; persistMeta();
            } else await adopt(value, authenticated.id);
          } else if (hasData(local)) phase = value.data ? 'choice' : 'import';
          else if (value.data) await adopt(value, authenticated.id);
          else phase = 'ready';
        });
      } catch (error) {
        bootstrapped = false;
        if (error.payload?.error?.code === 'account_changed') { accountChanged = true; authBlocked = Boolean(meta.userId); phase = 'account-mismatch'; detail = error.message; }
        else if (error.status === 401) { user = null; authBlocked = Boolean(meta.userId); phase = 'signed-out'; }
        else if (mismatch()) { phase = 'account-mismatch'; detail = 'הנתונים בדפדפן משויכים לחשבון אחר. לא נטענו עדיין נתוני החשבון המחובר; אפשר לנסות שוב.'; }
        else { phase = 'unavailable'; detail = ''; if (meta.dirty && meta.enabled) retryLater(error); }
      } finally {
        bootstrapPromise = null; emit(); schedule();
      }
      return getStatus();
    })();
    bootstrapPromise = task; emit(); return task;
  }

  async function flush() {
    if (!hooks || authBlocked || accountChanged || !bootstrapped || !meta.enabled || !meta.dirty || mismatch() || inFlight || actionBusy || !SYNCABLE.includes(phase)) return getStatus();
    clearTimeout(timer); timer = null; firstDirtyAt = null;
    inFlight = true; phase = 'syncing'; detail = ''; emit();
    const version = localVersion, owner = meta.userId, expectedRevision = meta.revision;
    try {
      const data = localSnapshot();
      await network(async signal => {
        const authenticated = await identity(signal);
        user = authenticated;
        if (user.id !== owner) { authBlocked = true; bootstrapped = false; phase = 'account-mismatch'; return; }
        const result = await request('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Vexyro-Account-Id': owner }, body: JSON.stringify({ expectedRevision, data }) }, signal);
        if (!Number.isSafeInteger(result?.revision) || result.revision <= expectedRevision || !validTimestamp(result.updatedAt)) throw new Error('לא התקבל אישור שמירה תקין מהענן.');
        meta.revision = result.revision; meta.lastSyncedAt = result.updatedAt;
        meta.dirty = localVersion !== version; persistMeta(); failures = 0;
        remote = { revision: result.revision, data, updatedAt: result.updatedAt };
        phase = meta.dirty ? 'pending' : 'synced';
      });
    } catch (error) {
      if (error.payload?.error?.code === 'account_changed') {
        accountChanged = true; authBlocked = true; bootstrapped = false; phase = 'account-mismatch'; detail = error.message;
      } else if (error.status === 409) {
        try { remote = serverState(error.payload); phase = 'conflict'; }
        catch (_) { phase = 'error'; detail = 'יש גרסה אחרת בענן, אך לא ניתן לקרוא אותה כרגע. יש לנסות שוב לפני בחירה.'; }
      } else if (error.status === 401) { user = null; authBlocked = true; bootstrapped = false; phase = 'signed-out'; }
      else if (error.status && error.status >= 400 && error.status < 500) { phase = 'error'; detail = error.message; }
      else { phase = 'offline'; detail = ''; retryLater(error); }
    } finally { inFlight = false; if (identityQueued) { identityQueued = false; void checkIdentity(); } emit(); if (phase === 'pending') schedule(); }
    return getStatus();
  }

  function changed() {
    if (!hooks || applying) return;
    localVersion += 1;
    if (meta.userId && meta.enabled) { meta.dirty = true; persistMeta(); }
    if (bootstrapped && !mismatch() && meta.enabled && meta.userId === user?.id && SYNCABLE.includes(phase)) {
      if (!inFlight && phase !== 'offline') phase = 'pending'; schedule();
    } else if (phase === 'ready') {
      try { if (hasData(localSnapshot())) phase = 'import'; } catch (_) { /* The app will surface invalid local state when an import is requested. */ }
    }
    emit();
  }

  async function enable() {
    if (bootstrapPromise) await bootstrapPromise;
    if (!bootstrapped) await bootstrap();
    if (!user || !bootstrapped || mismatch() || ['conflict', 'choice', 'import', 'error'].includes(phase)) return getStatus();
    if (getStatus().enabled) return getStatus();
    try {
      if (hasData(localSnapshot())) { phase = remote?.data ? 'choice' : 'import'; emit(); return getStatus(); }
      meta = { schemaVersion: 1, userId: user.id, revision: remote?.revision || 0, enabled: true, dirty: false, lastSyncedAt: remote?.updatedAt || null };
      persistMeta(); phase = 'connected'; detail = ''; emit();
    } catch (error) { phase = 'error'; detail = error.message; emit(); }
    return getStatus();
  }

  async function resolve(choice) {
    if (!hooks || !user || inFlight || actionBusy || bootstrapPromise || !['local', 'remote'].includes(choice)) return getStatus();
    if (choice === 'local' && (mismatch() || !bootstrapped || !remote || !['import', 'choice', 'conflict'].includes(phase))) return getStatus();
    if (choice === 'remote' && !['choice', 'conflict', 'account-mismatch'].includes(phase)) return getStatus();
    actionBusy = true; detail = ''; emit();
    let upload = false;
    try {
      if (choice === 'local') {
        localSnapshot();
        meta = { schemaVersion: 1, userId: user.id, revision: remote.revision, enabled: true, dirty: true, lastSyncedAt: null };
        persistMeta(); localVersion += 1; phase = 'pending'; upload = true;
      } else {
        await network(async signal => {
          const expectedUser = user.id;
          const authenticated = await identity(signal); user = authenticated;
          if (user.id !== expectedUser) { bootstrapped = false; phase = mismatch() ? 'account-mismatch' : 'checking'; throw new Error('החשבון השתנה. יש לבדוק שוב את החיבור לפני טעינת נתונים.'); }
          const value = serverState(await request('/api/state', { headers: { 'X-Vexyro-Account-Id': user.id } }, signal));
          accountChanged = false;
          await adopt(value);
        });
      }
    } catch (error) {
      if (error.payload?.error?.code === 'account_changed') { accountChanged = true; authBlocked = Boolean(meta.userId); bootstrapped = false; phase = 'account-mismatch'; detail = error.message; }
      else if (error.status === 401) { user = null; authBlocked = Boolean(meta.userId); bootstrapped = false; phase = 'signed-out'; }
      else { phase = mismatch() ? 'account-mismatch' : 'error'; detail = error.message || 'לא ניתן להשלים את הבחירה כרגע.'; }
    } finally { actionBusy = false; emit(); }
    if (upload) await flush();
    return getStatus();
  }

  async function retry() {
    if (inFlight || actionBusy) return getStatus();
    await bootstrap();
    if (phase === 'pending') return flush();
    return getStatus();
  }

  async function init(options) {
    if (!options || typeof options.readLocal !== 'function' || typeof options.applyRemote !== 'function') throw new TypeError('Account sync requires readLocal and applyRemote callbacks.');
    hooks = options;
    return bootstrap();
  }

  async function checkIdentity() {
    if (!hooks || !meta.userId || bootstrapPromise || identityPromise || actionBusy) return;
    authBlocked = true;
    if (inFlight) { identityQueued = true; emit(); return; }
    identityPromise = (async () => {
      let refresh = false;
      try {
        const authenticated = await network(signal => identity(signal));
        user = authenticated;
        authBlocked = mismatch();
        if (mismatch()) { cancelTimers(); bootstrapped = false; phase = 'account-mismatch'; detail = ''; }
        else if (!bootstrapped || phase === 'signed-out') refresh = true;
      } catch (error) {
        if (error.status === 401) { cancelTimers(); user = null; bootstrapped = false; phase = 'signed-out'; detail = ''; }
        else { bootstrapped = false; phase = 'unavailable'; detail = 'לא ניתן לאמת כרגע את החשבון. הנתונים המשויכים נשארים בדפדפן ויוצגו אחרי בדיקת החיבור.'; }
      } finally { identityPromise = null; emit(); schedule(); }
      if (refresh) await retry();
    })();
    emit();
    return identityPromise;
  }

  function summary(data) {
    if (!data) return 'אין עדיין נתונים שמורים';
    const records = data.history?.records?.length || 0;
    return `${data.profile ? 'פרופיל שמור' : 'ללא פרופיל'} · ${records === 1 ? 'אימון שמור אחד' : `${records} אימונים שמורים`}${data.activeWorkout ? ' · אימון פתוח' : ''}`;
  }

  function paint(container) {
    const document = container.ownerDocument;
    const el = (tag, className = '', text) => { const node = document.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node; };
    const status = getStatus();
    const root = el('div', 'account-module'); root.dir = 'rtl';
    const hero = el('section', `account-card account-status-card is-${status.phase}`);
    const names = { synced: 'נשמר בחשבון', syncing: 'שמירה בתהליך', pending: 'ממתין לשמירה', connected: 'השמירה בחשבון פעילה', checking: 'בודקים את החיבור', conflict: 'צריך לבחור גרסה', 'account-mismatch': 'החשבון השתנה', offline: 'ממתין לחיבור' };
    hero.append(el('span', 'account-status-badge', names[phase] || (user ? 'החשבון שלך' : 'שמירה בדפדפן')));
    const statusCopy = el('p', 'account-status-copy', status.message); statusCopy.setAttribute('role', 'status'); hero.append(statusCopy);
    if (user) {
      const identity = el('div', 'account-identity'); identity.append(el('strong', '', user.displayName || 'חשבון מחובר'));
      if (user.email) { const email = el('bdi', '', user.email); email.dir = 'ltr'; identity.append(email); }
      hero.append(identity);
    }
    if (meta.lastSyncedAt && user?.id === meta.userId && !mismatch()) hero.append(el('p', 'account-sync-time', `אישור אחרון מהענן: ${new Intl.DateTimeFormat('he-IL', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Jerusalem' }).format(new Date(meta.lastSyncedAt))}`));
    root.append(hero);
    const actions = el('section', 'account-card account-actions');
    const action = (text, key, secondary = false) => { const node = el('button', `account-button${secondary ? ' is-secondary' : ''}`, text); node.type = 'button'; node.dataset.accountAction = key; node.disabled = status.busy; actions.append(node); };
    const signIn = () => { const link = el('a', 'account-button', 'כניסה עם ChatGPT'); link.href = (window.location?.protocol === 'file:' ? PRODUCTION : '') + SIGN_IN; link.target = '_top'; actions.append(link); };
    if (authBlocked && !mismatch() && !accountChanged) {
      actions.append(el('h2', '', 'חוזרים לחשבון שלך'), el('p', '', 'הנתונים המשויכים לחשבון אינם מוצגים כרגע. כניסה מחדש תאפשר לבדוק את החשבון לפני שממשיכים.'));
      signIn(); action('בדיקת החיבור מחדש', 'retry', true);
    } else if (phase === 'account-mismatch' || mismatch()) {
      actions.append(el('h2', '', 'ממשיכים עם החשבון המחובר'), el('p', '', 'טעינת החשבון תחליף את העותק שבדפדפן. נתוני החשבון הקודם לא יועלו לחשבון הזה; שינויים מקומיים שלא סונכרנו יוחלפו.'));
      action('טעינת נתוני החשבון המחובר', 'remote'); action('בדיקת החיבור מחדש', 'retry', true);
    } else if (['choice', 'conflict', 'import'].includes(phase)) {
      const compare = el('div', 'account-version-list'); let local = null;
      try { local = localSnapshot(); } catch (_) { /* A later explicit action reports the validation problem. */ }
      for (const [name, data] of [['בדפדפן הזה', local], ['בחשבון', remote?.data]]) { const card = el('div', 'account-version'); card.append(el('strong', '', name), el('p', '', summary(data))); compare.append(card); }
      actions.append(compare, el('p', '', phase === 'import' ? 'הייבוא ישמור בחשבון המחובר את הפרופיל, התוכנית, האימונים וההתאמות שבדפדפן הזה.' : 'בחירת הגרסה שבדפדפן תחליף את נתוני החשבון. בחירת גרסת החשבון תחליף את העותק המקומי.'));
      if (phase !== 'import') action('טעינת הגרסה שבחשבון', 'remote');
      action(phase === 'import' ? 'ייבוא הנתונים שבדפדפן לחשבון' : 'החלפת נתוני החשבון בגרסה שבדפדפן', 'local', phase !== 'import');
    } else if (phase === 'ready') {
      actions.append(el('h2', '', 'הנתונים שלך, גם בחשבון'), el('p', '', 'לאחר ההפעלה, הפרופיל, התוכנית, האימונים וההתאמות שתשמרו באפליקציה יישמרו בחשבון המחובר.'));
      action('הפעלת שמירה בחשבון', 'enable');
    } else if (status.enabled) {
      actions.append(el('h2', '', 'מקומי וענן'), el('p', '', status.dirty ? 'יש שינויים שעדיין לא קיבלו אישור מהשרת. אפשר להמשיך להשתמש באפליקציה ולנסות שוב.' : 'השינויים הבאים יישלחו אוטומטית. אפשר לבדוק אם יש עדכון ממכשיר אחר.'));
      action('בדיקת סנכרון עכשיו', 'retry');
    } else {
      actions.append(el('h2', '', 'אפשר להמשיך בדפדפן'), el('p', '', 'כניסה לחשבון והפעלת השמירה מאפשרות לחזור לנתונים גם ממכשיר אחר.'));
      if (!user) signIn();
      action('בדיקת החיבור מחדש', 'retry', true);
    }
    if (storageFailed) actions.append(el('p', 'account-storage-warning', 'הדפדפן לא הצליח לשמור את מצב הסנכרון. לאחר רענון ייתכן שתידרש בחירת גרסה מחדש.'));
    if (window.location?.protocol === 'file:') actions.append(el('p', 'account-note', 'הקובץ המקומי פועל במצב מקומי. הכניסה לחשבון תפתח את האתר המקוון; הנתונים בקובץ אינם עוברים אליו אוטומטית.'));
    root.append(actions); container.replaceChildren(root);
  }

  function render(container) {
    if (!container || typeof container.replaceChildren !== 'function') return;
    if (!views.has(container)) {
      const listener = event => {
        const button = event.target.closest?.('[data-account-action]');
        if (!button || !container.contains(button) || button.disabled) return;
        const key = button.dataset.accountAction;
        if (key === 'enable') void enable();
        else if (key === 'retry') void retry();
        else void resolve(key);
      };
      container.addEventListener('click', listener); views.set(container, listener);
    }
    paint(container);
  }

  window.addEventListener('online', () => { if (hooks && (meta.dirty || ['offline', 'unavailable'].includes(phase))) void retry(); });
  window.addEventListener('focus', () => { void checkIdentity(); });
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (!document.hidden) void checkIdentity(); });
  window.VEXYRO_ACCOUNT = Object.freeze({ init, changed, render, getStatus, enable, retry, resolve });
})();
