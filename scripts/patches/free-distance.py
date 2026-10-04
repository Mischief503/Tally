#!/usr/bin/env python3
"""Distance lookup that works with no setup: OpenStreetMap (Photon / Nominatim to find the
address, OSRM for the driving route). Google (through the Edge Function) is still used when
it's set up. The claude.ai artifact can't reach either, and keeps the map link."""
import sys, os
P = os.path.join(os.path.dirname(__file__), '..', '..', 'web', 'index.html')
src = open(P, encoding='utf-8').read()
n = 0
def rep(old, new, count=1):
    global src, n
    c = src.count(old)
    if c != count: sys.exit('anchor found %d times (want %d): %r' % (c, count, old[:100]))
    src = src.replace(old, new); n += 1

# the distance code asks one function, which picks Google or OpenStreetMap
rep("  if(!a||!b||!window.tallyMaps){renderDistNote();return}", "  if(!a||!b||!canLookup()){renderDistNote();return}")
rep("  window.tallyMaps.distance(a,b).then(function(r){", "  mapsDistance(a,b).then(function(r){")
rep("  var btn=window.tallyMaps&&dist.busy!==k?", "  var btn=canLookup()&&dist.busy!==k?")
# with a shop set, the map button shows the whole trip, shop to shop
rep("  if(!window.tallyMaps&&a&&b)link=' <a class=\"btn sm\" href=\"'+esc(mapsDirUrl(a,b))+'\" target=\"_blank\" rel=\"noopener\">Open the drive in Google Maps</a>';",
    "  if(!canLookup()&&a&&b)link=' <a class=\"btn sm\" href=\"'+esc(shopTripUrl()||mapsDirUrl(a,b))+'\" target=\"_blank\" rel=\"noopener\">'+(shopTripUrl()?'Open the whole trip in Google Maps':'Open the drive in Google Maps')+'</a>';")
rep("  if(!a||!b)h=window.tallyMaps?", "  if(!a||!b)h=canLookup()?")
rep("  else if(!window.tallyMaps)h='Type the miles from the map. This copy of Tally can’t reach Google Maps itself; the installed app does it for you.'+link;",
    "  else if(!canLookup())h='Type the miles from the map. This copy of Tally can’t look distances up itself; the Tally app on your phone does it for you.'+link;")
rep("  if(!window.tallyMaps){renderShopNote();return}", "  if(!canLookup()){renderShopNote();return}")
rep("    window.tallyMaps.distance(l.a,l.b).then(function(r){", "    mapsDistance(l.a,l.b).then(function(r){")
rep("  if(!window.tallyMaps)h='Type the miles from the map.'", "  if(!canLookup())h='Type the miles from the map.'")
# say where the numbers came from (OpenStreetMap asks for credit)
rep("  if(r&&dist.busy!==k&&String(d.miles||'').trim()===String(r.miles))h+=btn;\n  el.innerHTML=h;",
    "  if(r&&dist.busy!==k&&String(d.miles||'').trim()===String(r.miles))h+=btn;\n  if(r&&r.src==='osm')h+='<br><small>Distances from OpenStreetMap (© OpenStreetMap contributors).</small>';\n  el.innerHTML=h;")

rep("""/* ---------- quote: the drive from the shop and back ----------""",
"""/* ---------- where distances come from ----------
   1. Google, through the Edge Function, once the Google key is set up (most accurate).
   2. Otherwise OpenStreetMap, free and with no setup: Photon (or Nominatim) finds each
      address, OSRM measures the drive. Addresses are looked up one at a time, a second
      apart, which is what those free services ask for.
   The claude.ai artifact can't reach any outside service, so it keeps the map link. */
function canFree(){return !window.TALLY_ARTIFACT&&typeof fetch==='function'}
function canLookup(){return !!window.tallyMaps||canFree()}
function mapsDistance(a,b){
  if(window.tallyMaps&&window.tallyMaps.distance)return window.tallyMaps.distance(a,b).then(function(r){return r&&r.setup&&canFree()?freeDistance(a,b):r},function(){return canFree()?freeDistance(a,b):{ok:false,message:'Could not look up the drive.'}});
  return freeDistance(a,b);
}
var osm={geo:{},next:0};
function osmJson(url){return fetch(url,{headers:{'Accept':'application/json'}}).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()})}
function osmSlot(){var now=Date.now(),at=Math.max(now,osm.next);osm.next=at+1100;return new Promise(function(res){setTimeout(res,at-now)})}
function geocode(addr){
  var k=String(addr).trim().toLowerCase().replace(/\\s+/g,' ');
  if(osm.geo[k])return osm.geo[k];
  var p=osmSlot().then(function(){return osmJson('https://photon.komoot.io/api/?limit=1&q='+encodeURIComponent(addr))}).then(function(j){
    var f=j&&j.features&&j.features[0];if(!f)throw new Error('none');
    return {lat:f.geometry.coordinates[1],lon:f.geometry.coordinates[0]};
  }).catch(function(){
    return osmSlot().then(function(){return osmJson('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us,ca&q='+encodeURIComponent(addr))}).then(function(j){
      if(!j||!j[0])throw new Error('none');return {lat:+j[0].lat,lon:+j[0].lon};
    });
  });
  osm.geo[k]=p;p.catch(function(){delete osm.geo[k]});
  return p;
}
function freeDistance(a,b){
  if(!canFree())return Promise.resolve({ok:false,message:'Distance lookup is not available here.'});
  var ga,gb;
  return geocode(a).then(function(x){ga=x;return geocode(b)},function(){throw {where:a}}).then(function(y){gb=y},function(e){throw e&&e.where?e:{where:b}}).then(function(){
    return osmJson('https://router.project-osrm.org/route/v1/driving/'+ga.lon+','+ga.lat+';'+gb.lon+','+gb.lat+'?overview=false');
  }).then(function(j){
    var rt=j&&j.code==='Ok'&&j.routes&&j.routes[0];
    if(!rt)return {ok:false,message:'No driving route between those addresses. Check them.'};
    return {ok:true,src:'osm',miles:Math.round(rt.distance/1609.344*10)/10,minutes:Math.round(rt.duration/60)};
  }).catch(function(e){
    if(e&&e.where)return {ok:false,message:'Couldn’t find “'+e.where+'” on the map. Add the city and state.'};
    return {ok:false,message:'The map service didn’t answer. Check your connection.'};
  });
}

/* ---------- quote: the drive from the shop and back ----------""")

open(P, 'w', encoding='utf-8').write(src)
print('applied', n)
