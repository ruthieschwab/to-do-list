// Cross-device sync backed by a secret GitHub Gist.
//
// This file has no DOM access. It provides:
//   - merge(local, remote, now): the conflict rule. Tasks carry `updatedAt`;
//     for each id the newer copy wins. Deleted tasks are kept as tombstones
//     ({id, deleted:true, updatedAt}) so a deletion made on one device reaches
//     the others; tombstones older than TOMBSTONE_TTL are dropped.
//   - normalize(tasks): canonical string form, used to detect "did anything
//     change" on either side.
//   - client(token): find / create / load / save the gist.
(function(){
  var API = 'https://api.github.com';
  var FILE = 'to-do-list.json';
  var TOMBSTONE_TTL = 90 * 24 * 60 * 60 * 1000;

  function merge(local, remote, now){
    var byId = {};
    [local, remote].forEach(function(list){
      (list || []).forEach(function(t){
        if(!t || typeof t.id !== 'string') return;
        var cur = byId[t.id];
        if(!cur || (t.updatedAt || 0) > (cur.updatedAt || 0)) byId[t.id] = t;
      });
    });
    return Object.keys(byId).map(function(id){ return byId[id]; }).filter(function(t){
      return !(t.deleted && now - (t.updatedAt || 0) > TOMBSTONE_TTL);
    });
  }

  function strip(tasks){
    return (tasks || []).map(function(t){
      var o = {};
      Object.keys(t).forEach(function(k){ if(k !== '_notesOpen') o[k] = t[k]; });
      return o;
    });
  }

  function normalize(tasks){
    return JSON.stringify(strip(tasks).sort(function(a, b){ return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }));
  }

  function fileBody(tasks){
    var files = {};
    files[FILE] = { content: JSON.stringify({ version: 1, tasks: strip(tasks), updatedAt: Date.now() }, null, 1) };
    return files;
  }

  function parseFile(text){
    var data = JSON.parse(text);
    return data && Array.isArray(data.tasks) ? data.tasks : [];
  }

  function client(token){
    function req(method, path, body){
      return fetch(API + path, {
        method: method,
        headers: {
          'Authorization': 'Bearer ' + token,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json'
        },
        body: body ? JSON.stringify(body) : undefined
      }).then(function(res){
        if(res.status === 401) throw new Error('unauthorized');
        if(res.status === 403) throw new Error('forbidden');
        if(res.status === 404) throw new Error('missing');
        if(!res.ok) throw new Error('http ' + res.status);
        return res.status === 204 ? null : res.json();
      });
    }

    return {
      // Look through the account's gists for one holding our file.
      find: function(){
        var page = 1;
        function next(){
          return req('GET', '/gists?per_page=100&page=' + page).then(function(list){
            var hit = list.find(function(g){ return g.files && g.files[FILE]; });
            if(hit) return hit.id;
            if(list.length < 100 || page >= 5) return null;
            page++;
            return next();
          });
        }
        return next();
      },
      create: function(tasks){
        return req('POST', '/gists', { description: 'To Do List sync data', public: false, files: fileBody(tasks) })
          .then(function(g){ return g.id; });
      },
      load: function(id){
        return req('GET', '/gists/' + id).then(function(g){
          var f = g.files && g.files[FILE];
          if(!f) throw new Error('missing');
          if(f.truncated) return fetch(f.raw_url).then(function(r){ return r.text(); }).then(parseFile);
          return parseFile(f.content);
        });
      },
      save: function(id, tasks){
        return req('PATCH', '/gists/' + id, { files: fileBody(tasks) }).then(function(){ return true; });
      }
    };
  }

  var api = { merge: merge, normalize: normalize, client: client, FILE: FILE, TOMBSTONE_TTL: TOMBSTONE_TTL };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  if(typeof window !== 'undefined') window.DocketSync = api;
})();
