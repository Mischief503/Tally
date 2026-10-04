#!/usr/bin/env python3
"""Test pack: about 100 made-up jobs from last week through three weeks out, in every stage,
using the company's own crew and trucks. Marked "Test", never texted, removable in one tap."""
import sys, os
P = os.path.join(os.path.dirname(__file__), '..', '..', 'web', 'index.html')
src = open(P, encoding='utf-8').read()
n = 0
def rep(old, new, count=1):
    global src, n
    c = src.count(old)
    if c != count: sys.exit('anchor found %d times (want %d): %r' % (c, count, old[:100]))
    src = src.replace(old, new); n += 1

# test flag rides with the job
for side in ("if(j[k]!=null)o[k]=j[k]", "if(v[k]!=null)j[k]=v[k]"):
    rep("['startedAt','finishedAt','actualHours','phases','minPaid'].forEach(function(k){" + side + "});",
        "['startedAt','finishedAt','actualHours','phases','minPaid','test'].forEach(function(k){" + side + "});")

# a "Test" tag wherever a job shows up
TAG = "(j.test?' <span class=\"pill\" style=\"border:1px dashed var(--muted);background:transparent\">Test</span>':'')"
rep("    if(needsSched(j))badges+=' <span class=\"pill warn\">Needs scheduling</span>';",
    "    if(needsSched(j))badges+=' <span class=\"pill warn\">Needs scheduling</span>';\n    if(j.test)badges+=" + TAG.replace("(j.test?", "").rsplit(":''", 1)[0] + ";")
rep("<h2>'+esc(j.d.name||'Unnamed')+'</h2><div style=\"margin-top:4px\">'+pill(j.status)+'",
    "<h2>'+esc(j.d.name||'Unnamed')+'</h2><div style=\"margin-top:4px\">'+pill(j.status)+" + TAG + "+'")
rep("<div class=\"grow\"><h3>'+esc(j.d.name)+'</h3><div class=\"cc-sub\">'",
    "<div class=\"grow\"><h3>'+esc(j.d.name)+" + TAG + "+'</h3><div class=\"cc-sub\">'")
rep("<span class=\"tm\">'+fmtTime(j.d.time)+' · '+esc(j.d.name)+'</span>",
    "<span class=\"tm\">'+fmtTime(j.d.time)+' · '+esc(j.d.name)+(j.test?' · test':'')+'</span>")

# no texts or calls for test jobs (their phone numbers are made up)
rep("    if(live&&had)commsSchedule(j.id);", "    if(live&&had&&!j.test)commsSchedule(j.id);")
rep("function commsFormsCheck(j){\n  if(!commsReady()||", "function commsFormsCheck(j){\n  if(j.test||!commsReady()||")
rep("  var has=!!j.d.phone,on=has&&s.text,co=commsReady(),msg=etaText(j,s.mins);",
    "  var has=!!j.d.phone,on=has&&s.text,co=commsReady()&&!j.test,msg=etaText(j,s.mins);")
rep("  var go=on&&!co?'<a class=\"btn primary bigbtn\"",
    "  if(on&&j.test)box=box.replace(/<p class=\"hint\">[\\s\\S]*<\\/p>$/,'<p class=\"hint\">Test job: this is what the customer would get. Nothing is sent.</p>');\n  var go=on&&!co&&!j.test?'<a class=\"btn primary bigbtn\"")
rep("      var send=!!(sj.d.phone&&gs.text),viaCo=send&&commsReady(),isLink=t.tagName==='A';",
    "      var send=!!(sj.d.phone&&gs.text)&&!sj.test,viaCo=send&&commsReady(),isLink=t.tagName==='A';")
rep("    case 'jm:remind':{j=byId(ui.jobId);if(!j||!commsReady())break;",
    "    case 'jm:remind':{j=byId(ui.jobId);if(!j||!commsReady())break;if(j.test){toast('Test job: no reminder sent.');break}")
rep("    case 'call:company':{var cc=ui.call;if(!cc)break;",
    "    case 'call:company':{var cc=ui.call;if(!cc)break;if((byId(cc.jobId)||{}).test){ui.call=null;renderCall();toast('Test job: the customer’s number is made up, so no call.');break}")

# setup: add / remove
rep("'<div class=\"row\" style=\"margin-top:14px\">'+arm('st:demo','Load sample data')",
    "'<div class=\"row\" style=\"margin-top:14px\">'+arm('st:testpack','Add 3 weeks of test jobs')+(state.jobs.some(function(j){return j.test})?arm('st:rmtest','Remove the '+state.jobs.filter(function(j){return j.test}).length+' test jobs'):'')+'</div>'+"
    "'<p class=\"hint\">Test jobs are made up: last week through three weeks out, in every stage, using your crew and trucks. They are tagged “Test”, never send a text or call, and Remove takes out only them.</p>'+"
    "'<div class=\"row\" style=\"margin-top:14px\">'+arm('st:demo','Load sample data')")
rep("    case 'st:demo':",
    "    case 'st:testpack':if(armed(a)){var tp=testPack(S);state.jobs=state.jobs.concat(tp);save();renderSettings();toast('Added '+tp.length+' test jobs, from last week through three weeks out.')}break;\n"
    "    case 'st:rmtest':if(armed(a)){var nt0=state.jobs.length;state.jobs=state.jobs.filter(function(x){return !x.test});save();renderSettings();toast('Removed '+(nt0-state.jobs.length)+' test jobs. Your real jobs are untouched.')}break;\n"
    "    case 'st:demo':")

# the generator
rep("function demoPhases(j){",
r"""/* ---------- test pack ----------
   Made-up jobs for trying every part of Tally. Same crew and trucks as the company, two
   time slots per truck so nobody is double-booked, a fixed seed so every load looks alike. */
var TP_FIRST=['Harper','Diego','Priya','Owen','Mai','Grace','Leo','Sofia','Caleb','Nora','Isaac','Ruby','Hannah','Theo','Ava','Elijah','Zoe','Samuel','Lily','Jonah','Maya','Felix','Chloe','Ezra','Ivy','Rowan','Nadia','Silas','Wren','Jasper'];
var TP_LAST=['Lane','Morales','Shah','Fitzgerald','Tran','Okafor','Brennan','Reyes','Wright','Lindqvist','Patel','Chen','Kim','Novak','Robinson','Brooks','Fischer','Ortiz','Nakamura','Weiss','Johnson','Andersen','Dubois','Cohen','Martinez','Clarke','Haddad','Grant','Takahashi','Moreau'];
var TP_ADDR=['2310 SE Hawthorne Blvd, Portland, OR','8125 N Lombard St, Portland, OR','1450 NW Everett St, Portland, OR','3922 NE Sandy Blvd, Portland, OR','11850 SW Canyon Rd, Beaverton, OR','4400 SE Division St, Portland, OR','17200 SE Stark St, Portland, OR','5200 SE Foster Rd, Portland, OR','1820 NE Alberta St, Portland, OR','16100 SW Boones Ferry Rd, Lake Oswego, OR','12000 SW Pacific Hwy, Tigard, OR','650 NE Cornell Rd, Hillsboro, OR','10700 SE Main St, Milwaukie, OR','2400 NE 162nd Ave, Portland, OR','3600 N Williams Ave, Portland, OR','7300 SW Macadam Ave, Portland, OR','900 NE Burnside Rd, Gresham, OR','2200 Main St, Vancouver, WA','6100 NE Fremont St, Portland, OR','4100 SW Beaverton Hillsdale Hwy, Portland, OR'];
var TP_NOTES=['Gate code 4411.','Third floor walk-up, no elevator.','Piano on the ground floor.','Parking permit is on the dash.','Customer works nights; call after 9 AM.','Two cats; keep the back door shut.','Long carry from the street, about 75 ft.',''];
function tpRand(seed){return function(){seed|=0;seed=seed+0x6D2B79F5|0;var t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function testPack(S){
  var rnd=tpRand(20261004),r=function(k){return Math.floor(rnd()*k)},t=todayISO(),out=[],ni=0;
  var SIZES=[{sofa3:1,bedq:1,dresser:1,tv:1,boxm:10,boxs:6},{sofa3:1,chair:2,coffee:1,tvstand:1,tv:1,bedq:1,dresser:1,nightstand:2,dintable:1,dinchair:4,boxs:8,boxm:14,boxl:6},
    {sofa3:1,loveseat:1,recliner:1,bedk:1,bedq:1,dresser:2,nightstand:3,dintable:1,dinchair:6,fridge:1,washer:1,dryer:1,boxs:12,boxm:24,boxl:10,boxw:3},
    {desk:4,ochair:4,filecab:3,bookcase:2,boxm:18,boxl:8},{piano:1,sofa3:1,bedq:1,dresser:1,boxm:10,boxs:4}];
  var leads=(S.leads||[]).filter(function(x){return S.crew.indexOf(x)>=0}),base=S.crew.filter(function(x){return leads.indexOf(x)<0});
  if(!leads.length)leads=(S.office||[]).map(function(o){return o.name}).slice(0,1);
  var trucks=(S.trucks||[]).slice(0,3),slots=['08:00','13:00'];
  var form=formsRequired()[0];
  function nextName(){var f=TP_FIRST[ni%TP_FIRST.length],l=TP_LAST[(ni*7+Math.floor(ni/TP_FIRST.length))%TP_LAST.length];ni++;return f+' '+l}
  function at(day,time,minsLater){var p=parseISO(day),hm=time.split(':');p.setHours(+hm[0],+hm[1]+(minsLater||0),0,0);return p.getTime()}
  function mk(day,time,status){
    var a=r(TP_ADDR.length),b=(a+1+r(TP_ADDR.length-1))%TP_ADDR.length;
    var d=Object.assign(blankDraft(),{name:nextName(),phone:'503-555-01'+String(r(100)).padStart(2,'0'),source:['Google','Referral','Yelp','Facebook','Repeat customer'][r(5)],
      moveDate:day||'',time:time||'08:00',from:TP_ADDR[a],to:TP_ADDR[b],miles:String(4+r(25)),flights:String(r(4)),pack:rnd()<0.3,items:clone(SIZES[r(SIZES.length)]),notes:TP_NOTES[r(TP_NOTES.length)]});
    var j=newJob(d,S,status);j.test=true;j.createdAt=Date.now()-(3+r(20))*864e5;j.log.push({ts:j.createdAt,ev:'Test job'});
    out.push(j);return j;
  }
  function staff(j,busy,truck){
    var need=j.quote.crew||2,lead=leads.filter(function(x){return !busy[x]})[0];
    var crew=[];if(lead){crew.push(lead);busy[lead]=1}
    base.forEach(function(x){if(crew.length<need&&!busy[x]){crew.push(x);busy[x]=1}});
    j.assign={truckId:truck?truck.id:'',crew:crew};
  }
  function deposit(j,day){var amt=j.quote.deposit||Math.round(j.quote.total*0.25);j.payments.push({id:uid(),amt:amt,method:'Card',date:addDays(day,-5),ts:at(addDays(day,-5),'10:00')})}
  for(var off=-7;off<=20;off++){
    var day=addDays(t,off),dow=parseISO(day).getDay();if(dow===0)continue;
    var count=Math.min(trucks.length*2,off<0?3+r(2):3+r(3)),busy={'08:00':{},'13:00':{}};
    for(var k=0;k<count;k++){
      var truck=trucks[k%trucks.length],time=slots[Math.floor(k/trucks.length)]||'13:00',roll=rnd(),j;
      if(off<0){
        j=mk(day,time,'booked');staff(j,busy[time],truck);deposit(j,day);
        var short=rnd()<0.15;j.actualHours=short?1.2:Math.round(j.quote.hours*(0.8+rnd()*0.45)*10)/10;
        j.startedAt=at(day,time,20);j.finishedAt=j.startedAt+j.actualHours*36e5;j.phases=demoPhases(j);j.minPaid=num(S.minHours);
        var signed=roll<0.85;
        if(signed&&form)j.signed.push({id:uid(),formId:form.id,title:form.title,name:j.d.name,sig:'',ts:j.finishedAt,by:j.assign.crew[0]||''});
        if(roll<0.55){j.status='paid';j.payments.push({id:uid(),amt:round2(totalOf(j)-paidOf(j)),method:['Card','Cash','Check'][r(3)],date:day,ts:j.finishedAt+6e5})}
        else j.status='done';
      }else if(off===0){
        j=mk(day,time,'booked');staff(j,busy[time],truck);deposit(j,day);
        if(k===0){j.status='active';j.startedAt=Date.now()-50*60000;j.phases={loadStart:Date.now()-25*60000}}
        else j.assign.crew.forEach(function(c){j.confirm[c]={ts:Date.now()-864e5,for:slotOf(j)}});
      }else if(off<=7){
        j=mk(day,time,'booked');staff(j,busy[time],truck);if(rnd()<0.7)deposit(j,day);
        j.assign.crew.forEach(function(c,ci){if(off<=2?ci>0||k>0:rnd()<0.5)j.confirm[c]={ts:Date.now()-r(48)*36e5,for:slotOf(j)}});
      }else if(roll<0.6){
        j=mk(day,time,'booked');staff(j,busy[time],truck);if(rnd()<0.5)deposit(j,day);
      }else if(roll<0.8){
        j=mk(day,time,'booked');if(rnd()<0.5)staff(j,busy[time],null);
      }else j=mk(day,time,'quoted');
      if(!j.confirm)j.confirm={};
    }
  }
  for(var i=0;i<5;i++){var ld=mk('','08:00','lead');ld.d.items={};ld.quote=calc(ld.d,S);ld.items=[];ld.d.notes='Asked for a call back about a '+(2+r(3))+'-bedroom move.'}
  for(var q=0;q<2;q++)mk(addDays(t,3+r(10)),'08:00','lost');
  out.forEach(function(j){if(!j.confirm)j.confirm={}});
  return out;
}
function demoPhases(j){""")

open(P, 'w', encoding='utf-8').write(src)
print('applied', n)
