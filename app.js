(function(){
  var STORAGE_KEY = 'docket.state.v1';

  function loadState(){
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if(raw){
        var s = JSON.parse(raw);
        if(s && Array.isArray(s.tasks)) return s;
      }
    } catch(e){}
    return { tasks: [], savedAt: 0 };
  }

  var state = loadState();
  // Tasks saved before sync existed have no updatedAt; give them one so merge can compare.
  state.tasks.forEach(function(t){ if(!t.updatedAt) t.updatedAt = state.savedAt || Date.now(); });
  var storageOk = true;
  var dragCtx = null;
  var editingId = null;
  var renderPending = false;
  var filterTag = '';
  var view = 'active';
  var tickTimer = null;
  var syncPanelOpen = false;

  // ---- Sync (optional; see sync.js) ----
  var SYNC_KEY = 'docket.sync.v1';
  var syncCfg = loadSyncCfg();
  var syncState = { status: syncCfg ? 'idle' : 'off', lastAt: 0, error: '', inflight: false, again: false, timer: null };

  function loadSyncCfg(){
    try { var c = JSON.parse(localStorage.getItem(SYNC_KEY)); return c && c.token ? c : null; } catch(e){ return null; }
  }
  function saveSyncCfg(c){
    syncCfg = c;
    try { if(c) localStorage.setItem(SYNC_KEY, JSON.stringify(c)); else localStorage.removeItem(SYNC_KEY); } catch(e){}
  }
  function touch(t){ t.updatedAt = Date.now(); }

  var TAG_RULES = {
    work: /\b(work|meeting|email|e-mail|project|deadline|client|boss|office|standup|sprint|ticket|jira|slack|invoice|interview|report|presentation|call with|coworker|colleague)\b/i,
    fam: /\b(family|kid|kids|son|daughter|mom|dad|mother|father|sister|brother|husband|wife|spouse|partner|grandma|grandpa|birthday|daycare|school pickup|anniversary)\b/i,
    house: /\b(house|home|laundry|dishes|clean|cleaning|grocery|groceries|repair|plumber|rent|mortgage|trash|garbage|yard|lawn|furniture|vacuum|dishwasher|fridge|fix the|straps|highchair|high chair)\b/i
  };
  function autoTags(text){
    var tags = [];
    Object.keys(TAG_RULES).forEach(function(k){ if(TAG_RULES[k].test(text)) tags.push(k); });
    return tags;
  }

  function uid(){ return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

  function matchesFilter(t){
    if(!filterTag) return true;
    if(filterTag === 'urgent') return !!t.urgent;
    return (t.tags||[]).indexOf(filterTag) !== -1;
  }
  function liveTasks(){ return state.tasks.filter(function(t){ return !t.deleted; }); }
  function activeTasks(){ return liveTasks().filter(function(t){ return !t.done && matchesFilter(t); }).sort(function(a,b){ return a.order - b.order; }); }
  function doneTasks(){ return liveTasks().filter(function(t){ return t.done && matchesFilter(t); }).sort(function(a,b){ return (b.doneAt||0) - (a.doneAt||0); }); }

  function esc(s){ return (s||'').replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

  function linkify(text){
    var re = /(https?:\/\/[^\s<]+)/g;
    var out = '', last = 0, m;
    while((m = re.exec(text))){
      out += esc(text.slice(last, m.index));
      var url = m[0];
      var trail = '';
      var clean = url.replace(/[),.;:!?]+$/, function(t){ trail = t; return ''; });
      out += '<a href="' + esc(clean) + '" target="_blank" rel="noopener noreferrer">' + esc(clean) + '</a>' + esc(trail);
      last = m.index + url.length;
    }
    out += esc(text.slice(last));
    return out;
  }

  function ago(ts, verb, never){
    if(!ts) return never;
    var s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if(s < 45) return verb + ' just now';
    var m = Math.floor(s / 60);
    if(m < 60) return verb + ' ' + m + 'm ago';
    var h = Math.floor(m / 60);
    if(h < 24) return verb + ' ' + h + 'h ago';
    var d = Math.floor(h / 24);
    return verb + ' ' + d + 'd ago';
  }

  function statusText(){
    if(!storageOk) return "can't save on this device";
    if(syncCfg){
      if(syncState.status === 'syncing') return 'syncing…';
      if(!navigator.onLine || syncState.status === 'offline') return 'offline · saved on this device';
      if(syncState.status === 'error') return 'sync failed · saved on this device';
      return ago(syncState.lastAt, 'synced', 'not synced yet');
    }
    return ago(state.savedAt, 'saved', 'not saved yet');
  }

  function statusBad(){
    return !navigator.onLine || (syncCfg && (syncState.status === 'offline' || syncState.status === 'error'));
  }

  function syncErrorText(){
    var e = syncState.error;
    if(e === 'unauthorized') return 'GitHub rejected the token.';
    if(e === 'forbidden') return "The token can't access gists (needs the gist scope).";
    if(e === 'gist missing') return 'The sync gist was deleted; a new one will be created on the next sync.';
    if(/fetch/i.test(e)) return "Couldn't reach GitHub.";
    return 'Sync failed: ' + e;
  }

  function panelMessage(){
    if(!syncCfg) return syncState.error ? syncErrorText() : '';
    if(syncState.status === 'syncing') return 'Syncing…';
    if(syncState.status === 'error') return syncErrorText();
    if(!navigator.onLine) return 'Offline. Changes will sync when you reconnect.';
    return 'Connected to your GitHub gist. ' + ago(syncState.lastAt, 'Last synced', 'Not synced yet') + '.';
  }

  function panelHTML(){
    if(syncCfg){
      return '<p>This list is kept in sync across your devices through a secret gist on your GitHub account.</p>' +
        '<div class="dk-panelrow">' +
          '<button class="dk-btn" id="dk-syncnow">Sync now</button>' +
          '<button class="dk-btn" id="dk-disconnect">Disconnect</button>' +
        '</div>' +
        '<p class="dk-panelmsg" id="dk-syncmsg">' + esc(panelMessage()) + '</p>';
    }
    return '<p>Keep this list in sync across your devices through a secret gist on your GitHub account. ' +
      'Paste a GitHub token that has only the <b>gist</b> scope. It is stored on this device only.</p>' +
      '<div class="dk-panelrow">' +
        '<input type="password" id="dk-token" placeholder="GitHub token" autocomplete="off" autocapitalize="off" spellcheck="false">' +
        '<button class="dk-btn primary" id="dk-connect">Connect</button>' +
      '</div>' +
      '<p class="dk-panelmsg" id="dk-syncmsg">' + esc(panelMessage()) + '</p>';
  }

  function tagChip(t, key, label){
    var on = (t.tags||[]).indexOf(key) !== -1;
    return '<button class="dk-tag' + (on ? ' on' : '') + '" data-tagtoggle="' + t.id + '" data-tagkey="' + key + '">#' + label + '</button>';
  }

  function rowHTML(t){
    var notesOpen = t._notesOpen ? ' open' : '';
    var isEditing = t.id === editingId;
    return '<li class="dk-row' + (t.done ? ' done' : '') + (t.urgent ? ' urgent' : '') + (isEditing ? ' editing' : '') + '" data-id="' + t.id + '">' +
      '<input type="checkbox" class="dk-check" data-toggle="' + t.id + '"' + (t.done ? ' checked' : '') + ' aria-label="Mark complete">' +
      '<div class="dk-body">' +
        '<div class="dk-text" data-edit="' + t.id + '" contenteditable="false" spellcheck="false">' + linkify(t.text) + '</div>' +
        '<div class="dk-extras">' +
          (notesOpen ? '<textarea class="dk-notes" data-notes="' + t.id + '" placeholder="Add a note…">' + esc(t.notes) + '</textarea>'
                     : '<button class="dk-noteflag' + (t.notes ? ' has' : '') + '" data-noteflag="' + t.id + '">' + (t.notes ? '📝 has a note' : '+ note') + '</button>') +
          '<div class="dk-tags">' +
            '<button class="dk-urgent' + (t.urgent ? ' on' : '') + '" data-urgent="' + t.id + '">' + (t.urgent ? '⏰ urgent' : '+ urgent') + '</button>' +
            tagChip(t,'work','work') + tagChip(t,'fam','fam') + tagChip(t,'house','house') +
          '</div>' +
        '</div>' +
      '</div>' +
      '<button class="dk-del" data-del="' + t.id + '" aria-label="Delete task">✕</button>' +
    '</li>';
  }

  function filterBtn(key, label){
    return '<button class="dk-filter' + (filterTag === key ? ' active' : '') + '" data-filter="' + key + '">' + label + '</button>';
  }

  function viewBtn(key, label, count){
    return '<button class="dk-filter' + (view === key ? ' active' : '') + '" data-view="' + key + '">' + label + ' (' + count + ')</button>';
  }

  function filterLabel(){
    return filterTag === 'urgent' ? 'urgent' : '#' + filterTag;
  }

  function render(){
    var active = activeTasks();
    var done = doneTasks();
    var html = '';
    html += '<div class="dk-header">';
    html += '<div class="dk-titlerow"><h1 class="dk-title">To Do List</h1>' +
            '<div class="dk-meta">' +
              '<span class="dk-sync' + (statusBad() ? ' offline' : '') + '" id="dk-sync"><span class="dot"></span><span id="dk-synctime">' + statusText() + '</span></span>' +
            '</div></div>';
    html += '<div class="dk-filterbar">' + viewBtn('active', 'Active', active.length) + viewBtn('done', 'Done', done.length) + '</div>';
    html += '<div class="dk-filterbar">' + filterBtn('', 'All') + filterBtn('urgent', '⏰ urgent') + filterBtn('work', '#work') + filterBtn('fam', '#fam') + filterBtn('house', '#house') + '</div>';
    html += '</div>';
    html += '<div class="dk-add"><input type="text" id="dk-new" placeholder="Add a task…" autocomplete="off"><button id="dk-addbtn">Add</button></div>';
    if(view === 'done'){
      if(done.length === 0){
        html += '<div class="dk-empty">' + (filterTag ? 'Nothing done tagged ' + filterLabel() + '.' : 'Nothing done yet.') + '</div>';
      } else {
        html += '<ul class="dk-list">' + done.map(rowHTML).join('') + '</ul>';
      }
    } else {
      if(active.length === 0){
        html += '<div class="dk-empty">' + (filterTag ? 'Nothing tagged ' + filterLabel() + '.' : 'Nothing on the list yet.') + '</div>';
      } else {
        html += '<ul class="dk-list" id="dk-active">' + active.map(rowHTML).join('') + '</ul>';
      }
    }
    html += '<div class="dk-footer">' +
      '<button class="dk-link" id="dk-export">Export backup</button>' +
      '<span class="dk-sep">·</span>' +
      '<button class="dk-link" id="dk-import">Import backup</button>' +
      '<span class="dk-sep">·</span>' +
      '<button class="dk-link" id="dk-synclink">' + (syncCfg ? 'Sync settings' : 'Set up sync') + '</button>' +
      '<input type="file" id="dk-importfile" accept=".json,application/json" hidden>' +
    '</div>';
    html += '<div class="dk-panel" id="dk-syncpanel"' + (syncPanelOpen ? '' : ' hidden') + '>' + panelHTML() + '</div>';
    document.getElementById('app').innerHTML = html;
    wire();
  }

  function exportBackup(){
    var json = JSON.stringify({ tasks: liveTasks(), exportedAt: Date.now() }, function(k, v){ return k === '_notesOpen' ? undefined : v; }, 1);
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'to-do-list-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  }

  function importBackup(file){
    var reader = new FileReader();
    reader.onload = function(){
      var data;
      try { data = JSON.parse(reader.result); } catch(e){ data = null; }
      var tasks = data && Array.isArray(data.tasks) ? data.tasks : (Array.isArray(data) ? data : null);
      if(!tasks || !tasks.every(function(t){ return t && typeof t.id === 'string' && typeof t.text === 'string'; })){
        alert("That file isn't a To Do List backup.");
        return;
      }
      var current = liveTasks();
      if(current.length && !confirm('Replace the ' + current.length + ' tasks on this device with the ' + tasks.length + ' in the backup?')) return;
      // Import is a replace: everything in the file becomes current, everything
      // not in it is tombstoned so the removal also reaches other devices.
      var now = Date.now();
      var inFile = {};
      tasks.forEach(function(t){ inFile[t.id] = true; t.updatedAt = now; delete t.deleted; });
      var removed = state.tasks.filter(function(t){ return !inFile[t.id]; }).map(function(t){ return { id: t.id, deleted: true, updatedAt: now }; });
      state.tasks = tasks.concat(removed);
      editingId = null;
      render();
      save();
    };
    reader.readAsText(file);
  }

  function refreshStatus(){
    var el = document.getElementById('dk-synctime');
    if(el) el.textContent = statusText();
    var sync = document.getElementById('dk-sync');
    if(sync) sync.classList.toggle('offline', statusBad());
    var msg = document.getElementById('dk-syncmsg');
    if(msg) msg.textContent = panelMessage();
  }

  function saveLocal(){
    state.savedAt = Date.now();
    try {
      // _notesOpen is transient UI state; don't persist it.
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state, function(k, v){ return k === '_notesOpen' ? undefined : v; }));
      storageOk = true;
    } catch(e){
      storageOk = false;
    }
    refreshStatus();
  }

  function save(){
    saveLocal();
    scheduleSync();
  }

  function wire(){
    var addInput = document.getElementById('dk-new');
    var addBtn = document.getElementById('dk-addbtn');
    function doAdd(){
      var v = addInput.value.trim();
      if(!v) return;
      var active = activeTasks();
      var minOrder = active.reduce(function(m,t){ return Math.min(m, t.order||0); }, 0);
      state.tasks.push({ id: uid(), text: v, notes: '', done: false, order: minOrder - 1, doneAt: 0, tags: autoTags(v), urgent: false, updatedAt: Date.now() });
      render();
      save();
      var el = document.getElementById('dk-new');
      if(el) el.focus();
    }
    addBtn.addEventListener('click', doAdd);
    addInput.addEventListener('keydown', function(e){ if(e.key === 'Enter') doAdd(); });

    document.getElementById('dk-export').addEventListener('click', exportBackup);
    var importFile = document.getElementById('dk-importfile');
    document.getElementById('dk-import').addEventListener('click', function(){ importFile.click(); });
    importFile.addEventListener('change', function(){
      if(importFile.files && importFile.files[0]) importBackup(importFile.files[0]);
      importFile.value = '';
    });

    var panel = document.getElementById('dk-syncpanel');
    document.getElementById('dk-synclink').addEventListener('click', function(){
      syncPanelOpen = !syncPanelOpen;
      panel.hidden = !syncPanelOpen;
      var tokenEl = document.getElementById('dk-token');
      if(syncPanelOpen && tokenEl) tokenEl.focus();
    });
    var connectBtn = document.getElementById('dk-connect');
    if(connectBtn){
      var tokenInput = document.getElementById('dk-token');
      var doConnect = function(){ connectSync(tokenInput.value); };
      connectBtn.addEventListener('click', doConnect);
      tokenInput.addEventListener('keydown', function(e){ if(e.key === 'Enter') doConnect(); });
    }
    var syncNowBtn = document.getElementById('dk-syncnow');
    if(syncNowBtn) syncNowBtn.addEventListener('click', function(){ scheduleSync(0); });
    var disconnectBtn = document.getElementById('dk-disconnect');
    if(disconnectBtn) disconnectBtn.addEventListener('click', disconnectSync);

    document.querySelectorAll('[data-filter]').forEach(function(btn){
      btn.addEventListener('click', function(){
        filterTag = btn.getAttribute('data-filter');
        render();
      });
    });

    document.querySelectorAll('[data-view]').forEach(function(btn){
      btn.addEventListener('click', function(){
        view = btn.getAttribute('data-view');
        render();
      });
    });

    document.querySelectorAll('[data-toggle]').forEach(function(cb){
      cb.addEventListener('change', function(){
        var id = cb.getAttribute('data-toggle');
        var t = state.tasks.find(function(x){ return x.id === id; });
        if(!t) return;
        t.done = cb.checked;
        t.doneAt = cb.checked ? Date.now() : 0;
        touch(t);
        render();
        save();
      });
    });

    document.querySelectorAll('[data-edit]').forEach(function(el){
      el.addEventListener('blur', function(){
        el.contentEditable = 'false';
        var id = el.getAttribute('data-edit');
        var t = state.tasks.find(function(x){ return x.id === id; });
        if(!t) return;
        var v = el.textContent.trim();
        if(v && v !== t.text){ t.text = v; touch(t); save(); }
        else if(!v){ el.textContent = t.text; }
      });
      el.addEventListener('keydown', function(e){ if(e.key === 'Enter'){ e.preventDefault(); el.blur(); } });
    });

    document.querySelectorAll('[data-noteflag]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var id = btn.getAttribute('data-noteflag');
        var t = state.tasks.find(function(x){ return x.id === id; });
        if(!t) return;
        t._notesOpen = true;
        render();
        var ta = document.querySelector('[data-notes="' + id + '"]');
        if(ta) ta.focus();
      });
    });

    document.querySelectorAll('[data-notes]').forEach(function(ta){
      ta.addEventListener('blur', function(){
        var id = ta.getAttribute('data-notes');
        var t = state.tasks.find(function(x){ return x.id === id; });
        if(!t) return;
        var v = ta.value;
        var changed = v !== t.notes;
        t.notes = v;
        if(changed) touch(t);
        t._notesOpen = false;
        render();
        if(changed) save();
      });
    });

    document.querySelectorAll('[data-tagtoggle]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var id = btn.getAttribute('data-tagtoggle');
        var key = btn.getAttribute('data-tagkey');
        var t = state.tasks.find(function(x){ return x.id === id; });
        if(!t) return;
        t.tags = t.tags || [];
        var i = t.tags.indexOf(key);
        if(i === -1) t.tags.push(key); else t.tags.splice(i, 1);
        touch(t);
        render();
        save();
      });
    });

    document.querySelectorAll('[data-urgent]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var id = btn.getAttribute('data-urgent');
        var t = state.tasks.find(function(x){ return x.id === id; });
        if(!t) return;
        t.urgent = !t.urgent;
        touch(t);
        render();
        save();
      });
    });

    document.querySelectorAll('[data-del]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var id = btn.getAttribute('data-del');
        var t = state.tasks.find(function(x){ return x.id === id; });
        if(!t) return;
        // Keep a tombstone so the deletion reaches other devices via sync.
        t.deleted = true;
        touch(t);
        render();
        save();
      });
    });

    var LONG_PRESS_MS = 300;
    var MOVE_THRESHOLD = 12;
    var SCROLL_DECIDE_PX = 10;
    function isInteractive(el){
      return !!el.closest('input, button, textarea, a, [contenteditable="true"]');
    }
    document.querySelectorAll('#dk-active .dk-row').forEach(function(row){
      row.addEventListener('pointerdown', function(e){
        if(isInteractive(e.target)) return;
        var id = row.getAttribute('data-id');
        var isMouse = e.pointerType === 'mouse';
        var startX = e.clientX, startY = e.clientY;
        var startTarget = e.target;
        var fired = false;
        var scrolling = false;
        var lastY = startY;
        if(!isMouse){ e.preventDefault(); row.setPointerCapture(e.pointerId); }
        var timer = isMouse ? null : setTimeout(function(){
          fired = true;
          cleanup();
          startDrag(e, id);
        }, LONG_PRESS_MS);
        function onMove(ev){
          if(isMouse){
            var movedPast = Math.abs(ev.clientX - startX) > MOVE_THRESHOLD || Math.abs(ev.clientY - startY) > MOVE_THRESHOLD;
            if(!movedPast) return;
            if(!fired){
              fired = true;
              cleanup();
              startDrag(ev, id);
            }
            return;
          }
          if(fired) return;
          if(scrolling){
            var dy = lastY - ev.clientY;
            if(dy) window.scrollBy(0, dy);
            lastY = ev.clientY;
            return;
          }
          var movedFar = Math.abs(ev.clientX - startX) > SCROLL_DECIDE_PX || Math.abs(ev.clientY - startY) > SCROLL_DECIDE_PX;
          if(!movedFar) return;
          clearTimeout(timer);
          scrolling = true;
          lastY = ev.clientY;
        }
        function onUp(){
          if(timer) clearTimeout(timer);
          cleanup();
          if(!fired && !scrolling){
            var textEl = startTarget.closest('.dk-text');
            if(textEl){
              editingId = id;
              row.classList.add('editing');
              textEl.contentEditable = 'true';
              textEl.focus();
              var range = document.createRange();
              range.selectNodeContents(textEl);
              range.collapse(false);
              var sel = window.getSelection();
              sel.removeAllRanges();
              sel.addRange(range);
            }
          }
        }
        function cleanup(){
          row.removeEventListener('pointermove', onMove);
          row.removeEventListener('pointerup', onUp);
          row.removeEventListener('pointercancel', onUp);
        }
        row.addEventListener('pointermove', onMove);
        row.addEventListener('pointerup', onUp);
        row.addEventListener('pointercancel', onUp);
      });
    });
  }

  function startDrag(e, id){
    e.preventDefault();
    var row = document.querySelector('.dk-row[data-id="' + id + '"]');
    if(!row) return;
    var active = activeTasks();
    var idx = active.findIndex(function(t){ return t.id === id; });
    dragCtx = { id: id, startY: e.clientY, curIdx: idx, newIdx: idx, rowH: (row.offsetHeight + 8), pointerId: e.pointerId, order: active.map(function(t){ return t.id; }) };
    row.classList.add('dragging');
    row.setPointerCapture(e.pointerId);
    row.addEventListener('pointermove', onDragMove);
    row.addEventListener('pointerup', onDragEnd);
    row.addEventListener('pointercancel', onDragEnd);
  }

  function updateGapPreview(){
    var order = dragCtx.order, curIdx = dragCtx.curIdx, newIdx = dragCtx.newIdx;
    order.forEach(function(id, i){
      if(id === dragCtx.id) return;
      var r = document.querySelector('.dk-row[data-id="' + id + '"]');
      if(!r) return;
      var shift = 0;
      if(newIdx > curIdx && i > curIdx && i <= newIdx) shift = -1;
      else if(newIdx < curIdx && i >= newIdx && i < curIdx) shift = 1;
      r.style.transform = shift ? 'translateY(' + (shift * dragCtx.rowH) + 'px)' : '';
    });
  }

  function clearGapPreview(){
    dragCtx.order.forEach(function(id){
      if(id === dragCtx.id) return;
      var r = document.querySelector('.dk-row[data-id="' + id + '"]');
      if(r) r.style.transform = '';
    });
  }

  function onDragMove(e){
    if(!dragCtx) return;
    var row = document.querySelector('.dk-row[data-id="' + dragCtx.id + '"]');
    if(!row) return;
    var delta = e.clientY - dragCtx.startY;
    row.style.transform = 'translateY(' + delta + 'px)';
    var steps = Math.round(delta / dragCtx.rowH);
    var newIdx = Math.min(dragCtx.order.length - 1, Math.max(0, dragCtx.curIdx + steps));
    if(newIdx !== dragCtx.newIdx){
      dragCtx.newIdx = newIdx;
      updateGapPreview();
    }
  }

  function onDragEnd(e){
    if(!dragCtx) return;
    clearGapPreview();
    var order = dragCtx.order;
    var newIdx = dragCtx.newIdx;
    if(newIdx !== dragCtx.curIdx){
      var movedId = order[dragCtx.curIdx];
      order.splice(dragCtx.curIdx, 1);
      order.splice(newIdx, 0, movedId);
    }
    order.forEach(function(id, i){
      var t = state.tasks.find(function(x){ return x.id === id; });
      if(t && t.order !== i){ t.order = i; touch(t); }
    });
    dragCtx = null;
    render();
    save();
  }

  function closeEditingIfOutside(e){
    if(!editingId) return;
    var row = document.querySelector('.dk-row[data-id="' + editingId + '"]');
    if(!row || row.contains(e.target)) return;
    editingId = null;
    if(row.contains(document.activeElement)) document.activeElement.blur();
    row.classList.remove('editing');
    if(renderPending){
      // A remote change arrived while a title was being edited. Re-render, but
      // not synchronously: this runs on pointerdown, and replacing the DOM
      // before pointerup would swallow the tap that ended the edit.
      setTimeout(function(){ if(renderPending){ renderPending = false; render(); } }, 350);
    }
  }

  function scheduleSync(delay){
    if(!syncCfg) return;
    clearTimeout(syncState.timer);
    syncState.timer = setTimeout(syncNow, delay == null ? 1500 : delay);
  }

  // Pull the gist, merge with local, write back whichever side changed.
  function syncNow(){
    if(!syncCfg) return Promise.resolve();
    if(!navigator.onLine){ syncState.status = 'offline'; refreshStatus(); return Promise.resolve(); }
    if(syncState.inflight){ syncState.again = true; return Promise.resolve(); }
    syncState.inflight = true;
    syncState.status = 'syncing';
    refreshStatus();
    var token = syncCfg.token;
    var api = window.DocketSync.client(token);
    var ensureGist = syncCfg.gistId
      ? Promise.resolve(syncCfg.gistId)
      : api.find().then(function(id){ return id || api.create(liveTasks()); }).then(function(id){ saveSyncCfg({ token: token, gistId: id }); return id; });
    return ensureGist.then(function(id){
      return api.load(id).then(function(remote){
        var merged = window.DocketSync.merge(state.tasks, remote, Date.now());
        var m = window.DocketSync.normalize(merged);
        var localChanged = m !== window.DocketSync.normalize(state.tasks);
        var remoteChanged = m !== window.DocketSync.normalize(remote);
        if(localChanged){
          state.tasks = merged;
          saveLocal();
          if(editingId) renderPending = true; else render();
        }
        return remoteChanged ? api.save(id, merged) : null;
      }, function(err){
        if(err && err.message === 'missing'){ saveSyncCfg({ token: token }); throw new Error('gist missing'); }
        throw err;
      });
    }).then(function(){
      syncState.status = 'idle';
      syncState.lastAt = Date.now();
      syncState.error = '';
    }, function(err){
      syncState.status = 'error';
      syncState.error = (err && err.message) || String(err);
    }).then(function(){
      syncState.inflight = false;
      refreshStatus();
      if(syncState.again){ syncState.again = false; scheduleSync(500); }
    });
  }

  function connectSync(token){
    token = (token || '').trim();
    if(!token) return;
    saveSyncCfg({ token: token });
    syncState.error = '';
    return syncNow().then(function(){
      if(syncState.status === 'error'){
        // Don't keep a token that didn't work; keep the message so the panel can show it.
        var msg = syncState.error;
        saveSyncCfg(null);
        syncState.status = 'off';
        syncState.error = msg;
      }
      render();
    });
  }

  function disconnectSync(){
    clearTimeout(syncState.timer);
    saveSyncCfg(null);
    syncState.status = 'off';
    syncState.error = '';
    syncState.lastAt = 0;
    render();
  }

  function init(){
    render();
    document.addEventListener('pointerdown', closeEditingIfOutside);
    window.addEventListener('online', function(){ refreshStatus(); scheduleSync(0); });
    window.addEventListener('offline', refreshStatus);
    document.addEventListener('visibilitychange', function(){ if(document.visibilityState === 'visible') scheduleSync(0); });
    tickTimer = setInterval(refreshStatus, 20000);
    setInterval(function(){ if(document.visibilityState === 'visible') scheduleSync(0); }, 5 * 60 * 1000);
    if(syncCfg) scheduleSync(0);
  }

  init();
})();
