#!/usr/bin/env python3
"""Shop address: the drive from the shop to pickup and from delivery back to the shop.
Logged on every quote, looked up automatically, and (by default) counted in the price."""
import sys, os
P = os.path.join(os.path.dirname(__file__), '..', '..', 'web', 'index.html')
src = open(P, encoding='utf-8').read()
n = 0
def rep(old, new, count=1):
    global src, n
    c = src.count(old)
    if c != count: sys.exit('anchor found %d times (want %d): %r' % (c, count, old[:100]))
    src = src.replace(old, new); n += 1

# ---- settings: where the trucks start and end the day
rep("minHours:3,prod:45,mph:30,", "minHours:3,prod:45,mph:30,shopAddress:'',shopTravel:true,")
rep("""'<section class="card"><h2>Company</h2>'+fld('Name','<input data-s="company" data-t="text" value="'+esc(S.company)+'">')+'</section>'""",
    """'<section class="card"><h2>Company</h2>'+fld('Name','<input data-s="company" data-t="text" value="'+esc(S.company)+'">')+
     '<div style="margin-top:8px">'+fld('Shop address (where trucks start and end the day)','<input data-s="shopAddress" data-t="text" autocomplete="street-address" placeholder="1200 Industrial Blvd, Austin, TX" value="'+esc(S.shopAddress||'')+'">')+'</div>'+
     '<p class="hint">Quotes add the drive from here to the pickup and from the delivery back here.</p></section>'""")
rep("nf('Truck and fuel, per truck ($)','truckFee')+nf('Miles included','includedMiles')+nf('Per mile past that ($)','mileRate')+",
    "nf('Truck and fuel, per truck ($)','truckFee')+nf('Miles included','includedMiles')+nf('Per mile past that ($)','mileRate')+\n"
    "    '<label class=\"check span2\"><input type=\"checkbox\" data-s=\"shopTravel\" data-t=\"bool\"'+(S.shopTravel!==false?' checked':'')+'> Count the drive from and back to the shop in miles and hours'+(S.shopAddress?'':' (add the shop address under Company)')+'</label>'+")

# ---- pricing: the whole round trip counts when the shop is set and the switch is on
rep("  var miles=num(d.miles),flights=num(d.flights);",
    "  var moveMi=num(d.miles),legMi=(S.shopAddress&&S.shopTravel!==false)?num(d.milesOut)+num(d.milesBack):0,miles=moveMi+legMi,flights=num(d.flights);")
rep("    if(miles>S.includedMiles)lines.push({label:'Travel: '+fmtInt(miles-S.includedMiles)+' mi past '+S.includedMiles,amt:Math.round((miles-S.includedMiles)*S.mileRate)});",
    "    if(miles>S.includedMiles)lines.push({label:legMi?'Travel: '+fmtInt(miles)+' mi round trip from the shop, '+fmtInt(miles-S.includedMiles)+' past '+S.includedMiles:'Travel: '+fmtInt(miles-S.includedMiles)+' mi past '+S.includedMiles,amt:Math.round((miles-S.includedMiles)*S.mileRate)});")

# ---- quote form: the two shop legs, when there is a shop
rep("""     fld('Distance (miles)','<input data-d="miles" type="number" inputmode="decimal" value="'+dv('miles')+'">')+""",
    """     fld(S.shopAddress?'Pickup to delivery (miles)':'Distance (miles)','<input data-d="miles" type="number" inputmode="decimal" value="'+dv('miles')+'">')+""")
rep("""     '<div class="span2 hint" id="distNote" aria-live="polite" style="margin:-2px 0 2px"></div>'+""",
    """     '<div class="span2 hint" id="distNote" aria-live="polite" style="margin:-2px 0 2px"></div>'+
     (S.shopAddress?fld('From the shop to pickup (miles)','<input data-d="milesOut" type="number" inputmode="decimal" value="'+dv('milesOut')+'">')+
       fld('Delivery back to the shop (miles)','<input data-d="milesBack" type="number" inputmode="decimal" value="'+dv('milesBack')+'">')+
       '<div class="span2 hint" id="shopNote" aria-live="polite" style="margin:-2px 0 2px"></div>':'')+""")
rep("  if(step===1){renderDistNote();var dd=state.draft;if(dd.from.trim()&&dd.to.trim()&&!String(dd.miles||'').trim())distLookup()}",
    "  if(step===1){renderDistNote();renderShopNote();var dd=state.draft;if(dd.from.trim()&&dd.to.trim()&&!String(dd.miles||'').trim())distLookup();shopLookup(false)}")
# typing a shop leg yourself keeps it
rep("if(t.dataset.d==='miles'){state.draft.milesAuto=false;renderDistNote()}",
    "if(t.dataset.d==='miles'){state.draft.milesAuto=false;renderDistNote()}if(t.dataset.d==='milesOut'||t.dataset.d==='milesBack'){state.draft.shopManual=Object.assign({},state.draft.shopManual);state.draft.shopManual[t.dataset.d==='milesOut'?'out':'back']=true;renderShopNote()}")
# leaving an address field also looks up the shop legs
rep("  if(e.target&&e.target.dataset&&(e.target.dataset.d==='from'||e.target.dataset.d==='to')){distLookup();return}",
    "  if(e.target&&e.target.dataset&&(e.target.dataset.d==='from'||e.target.dataset.d==='to')){distLookup();shopLookup(false);return}")
# the Look up button covers the whole trip; Use buttons per leg
rep("      qd.milesAuto=true;distLookup();break}",
    "      qd.milesAuto=true;distLookup();shopLookup(true);break}\n"
    "    case 'q:useshop':{var uk=t.dataset.k,ul=shopLegs().find(function(x){return x.k===uk});if(!ul)break;var ur=dist.cache[distKey(ul.a,ul.b)];if(!ur)break;state.draft.shopManual=Object.assign({},state.draft.shopManual);state.draft.shopManual[uk]=false;applyShop(ul,ur);break}")

# office job sheet: the round trip, under the route
rep("""     fld('Delivery','<input data-j="to" value="'+esc(j.d.to)+'">','span2')+""",
    """     fld('Delivery','<input data-j="to" value="'+esc(j.d.to)+'">','span2')+
     (num(j.d.milesOut)||num(j.d.milesBack)?'<p class="hint span2" style="margin:0">Round trip from the shop: <b>'+fmtMi(num(j.d.milesOut)+num(j.d.miles)+num(j.d.milesBack))+' mi</b> ('+fmtMi(num(j.d.milesOut))+' to pickup, '+fmtMi(num(j.d.miles))+' to delivery, '+fmtMi(num(j.d.milesBack))+' back).</p>':'')+""")

# ---- the module
rep("""/* ---------- job messages: each person confirms they will be there ----------""",
"""/* ---------- quote: the drive from the shop and back ----------
   Same lookup as pickup-to-delivery, for shop -> pickup and delivery -> shop. A leg the
   person typed is kept; the note then offers Google's number with a Use button. */
function fmtMi(x){x=Math.round(x*10)/10;return (Math.abs(x-Math.round(x))<0.05?Math.round(x):x).toLocaleString('en-US')}
function shopLegs(){
  var S=state.settings,d=state.draft,shop=(S.shopAddress||'').trim(),out=[];
  if(!shop)return out;
  if((d.from||'').trim())out.push({k:'out',f:'milesOut',a:shop,b:d.from.trim(),label:'From the shop to pickup'});
  if((d.to||'').trim())out.push({k:'back',f:'milesBack',a:d.to.trim(),b:shop,label:'Delivery back to the shop'});
  return out;
}
dist.shopBusy={};
function shopLookup(force){
  if(!window.tallyMaps){renderShopNote();return}
  shopLegs().forEach(function(l){
    var k=distKey(l.a,l.b);
    if(force&&dist.cache[k]&&!(state.draft.shopManual||{})[l.k])delete dist.cache[k];
    if(force){state.draft.shopManual=Object.assign({},state.draft.shopManual);state.draft.shopManual[l.k]=false}
    if(dist.cache[k]){applyShop(l,dist.cache[k]);return}
    if(dist.shopBusy[k])return;
    dist.shopBusy[k]=1;renderShopNote();
    window.tallyMaps.distance(l.a,l.b).then(function(r){
      delete dist.shopBusy[k];
      if(r&&r.ok&&r.miles>=0){r.key=k;dist.cache[k]=r;var now=shopLegs().find(function(x){return x.k===l.k&&distKey(x.a,x.b)===k});if(now)applyShop(now,r);else renderShopNote()}
      else{dist.shopErr=(r&&r.message)||'Could not look up the drive.';renderShopNote()}
    });
  });
  renderShopNote();
}
function applyShop(l,r){
  var d=state.draft,cur=String(d[l.f]||'').trim();
  if(!cur||!(d.shopManual||{})[l.k]){
    d[l.f]=String(r.miles);save();
    var el=$('[data-d="'+l.f+'"]');if(el)el.value=d[l.f];updateQuote();
  }
  renderShopNote();
}
function shopTripUrl(){
  var S=state.settings,d=state.draft,shop=(S.shopAddress||'').trim(),a=(d.from||'').trim(),b=(d.to||'').trim();
  if(!shop||!a||!b)return '';
  return 'https://www.google.com/maps/dir/?api=1&origin='+encodeURIComponent(shop)+'&destination='+encodeURIComponent(shop)+'&waypoints='+encodeURIComponent(a+'|'+b)+'&travelmode=driving';
}
function renderShopNote(){
  var el=$('#shopNote');if(!el)return;
  var S=state.settings,d=state.draft,legs=shopLegs();
  if(!legs.length){el.innerHTML='Enter the addresses and the drive from and back to the shop fills itself in.';return}
  var rows=legs.map(function(l){
    var k=distKey(l.a,l.b),r=dist.cache[k],v=String(d[l.f]||'').trim();
    if(dist.shopBusy[k])return l.label+': looking up…';
    if(!r)return '';
    var same=v===String(r.miles);
    return l.label+': '+(same?'<b>'+r.miles+' mi</b>, about '+fmtDur(r.minutes*60000)+' by car':'Google Maps says <b>'+r.miles+' mi</b> <button class="btn sm" data-act="q:useshop" data-k="'+l.k+'">Use '+r.miles+' mi</button>');
  }).filter(Boolean);
  var total=num(d.milesOut)+num(d.miles)+num(d.milesBack);
  var url=shopTripUrl();
  var h=rows.join('<br>');
  if(!window.tallyMaps)h='Type the miles from the map.'+(url?' <a class="btn sm" href="'+esc(url)+'" target="_blank" rel="noopener">Open the whole trip in Google Maps</a>':'');
  else if(!rows.length&&dist.shopErr)h=esc(dist.shopErr)+' Type the miles instead.'+(url?' <a href="'+esc(url)+'" target="_blank" rel="noopener">See the whole trip on Google Maps</a>':'');
  if(total>0&&(num(d.milesOut)||num(d.milesBack)))h+=(h?'<br>':'')+'Round trip from the shop: <b>'+fmtMi(total)+' mi</b>'+(S.shopTravel===false?' (not counted in the price; see Setup › Rate card)':'');
  el.innerHTML=h;
}

/* ---------- job messages: each person confirms they will be there ----------""")

open(P, 'w', encoding='utf-8').write(src)
print('applied', n)
