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
  var storageOk = true;
  var dragCtx = null;
  var editingId = null;
  var filterTag = '';
  var view = 'active';
  var tickTimer = null;

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
  function activeTasks(){ return state.tasks.filter(function(t){ return !t.done && matchesFilter(t); }).sort(function(a,b){ return a.order - b.order; }); }
  function doneTasks(){ return state.tasks.filter(function(t){ return t.done && matchesFilter(t); }).sort(function(a,b){ return (b.doneAt||0) - (a.doneAt||0); }); }

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

  function statusText(){
    if(!storageOk) return "can't save on this device";
    var ts = state.savedAt;
    if(!ts) return 'not saved yet';
    var s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if(s < 45) return 'saved just now';
    var m = Math.floor(s / 60);
    if(m < 60) return 'saved ' + m + 'm ago';
    var h = Math.floor(m / 60);
    if(h < 24) return 'saved ' + h + 'h ago';
    var d = Math.floor(h / 24);
    return 'saved ' + d + 'd ago';
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
              '<span class="dk-sync' + (navigator.onLine ? '' : ' offline') + '" id="dk-sync"><span class="dot"></span><span id="dk-synctime">' + statusText() + '</span></span>' +
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
      '<input type="file" id="dk-importfile" accept=".json,application/json" hidden>' +
    '</div>';
    document.getElementById('app').innerHTML = html;
    wire();
  }

  function exportBackup(){
    var json = JSON.stringify({ tasks: state.tasks, exportedAt: Date.now() }, function(k, v){ return k === '_notesOpen' ? undefined : v; }, 1);
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
      if(state.tasks.length && !confirm('Replace the ' + state.tasks.length + ' tasks on this device with the ' + tasks.length + ' in the backup?')) return;
      state.tasks = tasks;
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
    if(sync) sync.classList.toggle('offline', !navigator.onLine);
  }

  function save(){
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

  function wire(){
    var addInput = document.getElementById('dk-new');
    var addBtn = document.getElementById('dk-addbtn');
    function doAdd(){
      var v = addInput.value.trim();
      if(!v) return;
      var active = activeTasks();
      var minOrder = active.reduce(function(m,t){ return Math.min(m, t.order||0); }, 0);
      state.tasks.push({ id: uid(), text: v, notes: '', done: false, order: minOrder - 1, doneAt: 0, tags: autoTags(v), urgent: false });
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
        if(v && v !== t.text){ t.text = v; save(); }
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
        render();
        save();
      });
    });

    document.querySelectorAll('[data-del]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var id = btn.getAttribute('data-del');
        state.tasks = state.tasks.filter(function(x){ return x.id !== id; });
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
      if(t) t.order = i;
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
  }

  function init(){
    render();
    document.addEventListener('pointerdown', closeEditingIfOutside);
    window.addEventListener('online', refreshStatus);
    window.addEventListener('offline', refreshStatus);
    tickTimer = setInterval(refreshStatus, 20000);
  }

  init();
})();
