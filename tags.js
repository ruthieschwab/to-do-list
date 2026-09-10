// Automatic tag suggestions for a task title.
//
// Two sources, combined:
//   - A small fixed keyword list per tag (the seed, useful on an empty list).
//   - The user's own tagged tasks: for each tag, every word in the title that
//     has appeared in a tagged title before contributes (share of those titles
//     that carry the tag − the tag's overall share), weighted by how rare the
//     word is. So a name or product seen once, tagged #house, pulls strongly
//     toward #house, while a word spread evenly across tags contributes nothing.
//     A tag is suggested when the total clears THRESHOLD. Titles only — notes
//     hold too much incidental text (book titles, addresses). Because it reads
//     the current tasks every time, suggestions improve as the list is tagged.
//
// No DOM access. suggest(text, examples) → array of tag keys.
(function(){
  var TAGS = ['work', 'fam', 'house'];
  var RULES = {
    work: /\b(work|meeting|email|e-mail|project|deadline|client|boss|office|standup|sprint|ticket|jira|slack|invoice|interview|report|presentation|call with|coworker|colleague|resume|linkedin|recruiter|apply|application|job|jobs)\b/i,
    fam: /\b(family|kid|kids|son|daughter|mom|dad|mother|father|sister|brother|husband|wife|spouse|partner|grandma|grandpa|birthday|bday|daycare|school|anniversary|pediatrician)\b/i,
    house: /\b(house|home|laundry|dishes|clean|cleaning|grocery|groceries|repair|plumber|electrician|contractor|rent|mortgage|trash|garbage|yard|lawn|furniture|vacuum|dishwasher|fridge|fix the|kitchen|bathroom|garage|roof|gutter|paint|painting|window|windows|door|floor|floors)\b/i
  };
  var STOP = {};
  ('the and for with from that this into out re up on in of to at by or an a is are be as it its w vs via per about after before over under ' +
   'set get put make call check figure follow order buy send find new').split(' ').forEach(function(w){ STOP[w] = true; });
  var MIN_EXAMPLES = 3;   // per tag, before learned evidence is used
  var THRESHOLD = 0.8;    // score a tag must clear (tuned on a real list: ~2/3 of tags recovered, ~1 in 8 over-suggested)

  function tokens(s){
    var seen = {}, out = [];
    String(s || '').toLowerCase().replace(/https?:\/\/\S+/g, ' ').split(/[^a-z0-9#]+/).forEach(function(w){
      if(w.length >= 3 && !STOP[w] && !seen[w]){ seen[w] = true; out.push(w); }
    });
    return out;
  }

  function suggest(text, examples){
    var words = tokens(text);
    var out = {};
    TAGS.forEach(function(tag){ if(RULES[tag].test(text || '')) out[tag] = true; });

    var docs = (examples || []).filter(function(e){ return e && (e.tags || []).length; }).map(function(e){
      return { tags: e.tags, words: tokens(e.text) };
    });
    var N = docs.length;
    TAGS.forEach(function(tag){
      var nT = docs.filter(function(d){ return d.tags.indexOf(tag) !== -1; }).length;
      if(nT < MIN_EXAMPLES) return;
      var base = nT / N;
      var score = 0;
      words.forEach(function(w){
        var withWord = docs.filter(function(d){ return d.words.indexOf(w) !== -1; });
        var df = withWord.length;
        if(!df) return;
        var cT = withWord.filter(function(d){ return d.tags.indexOf(tag) !== -1; }).length;
        var rarity = Math.log(1 + N / df);
        score += rarity * (cT / df - base);
      });
      if(score > THRESHOLD) out[tag] = true;
    });
    return TAGS.filter(function(tag){ return out[tag]; });
  }

  var api = { suggest: suggest, tokens: tokens, TAGS: TAGS };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  if(typeof window !== 'undefined') window.DocketTags = api;
})();
