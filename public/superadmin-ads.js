(() => {
const $ = s => document.querySelector(s);
const money = n => "₦" + Number(n || 0).toLocaleString("en-NG");
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function api(url, options={}) {
  const response = await fetch(url, {credentials:"same-origin", ...options, headers:{"Content-Type":"application/json", ...(options.headers||{})}});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}
function status(message, error=false) { $("#adsStatus").textContent=message; $("#adsStatus").className="ads-status"+(error?" error":""); }
function render(data) {
  const t=data.totals||{};
  $("#adsMetrics").innerHTML=[["Campaigns",t.campaigns],["Live campaigns",t.active],["Impressions",t.impressions],["Clicks",t.clicks],["Recorded ad revenue",money(t.revenue)]].map(([k,v])=>'<div class="ads-metric"><span>'+esc(k)+'</span><strong>'+esc(v??0)+'</strong></div>').join("");
  const rows=data.ads||[];
  $("#adsRows").innerHTML=rows.length?rows.map(ad=>{
    const state=ad.status==="active"&&new Date(ad.endsAt).getTime()>Date.now()?"active":esc(ad.status||"pending");
    return '<tr><td><div style="display:flex;gap:9px;align-items:flex-start"><img class="ads-preview" src="'+esc(ad.imageUrl)+'" alt=""><div><strong>'+esc(ad.title)+'</strong><br><span class="ads-note">'+esc(ad.advertiser)+' · '+esc(ad.type)+'</span><br><span class="ads-note">'+esc(ad.description)+'</span></div></div></td><td>'+esc(ad.packageKey)+'<br><strong>'+money(ad.price)+'</strong></td><td>'+new Date(ad.startsAt).toLocaleString()+'<br>to '+new Date(ad.endsAt).toLocaleString()+'</td><td><span class="ads-pill '+(ad.paymentReceived?"active":"pending")+'">'+(ad.paymentReceived?"Received":"Not received")+'</span><br><button class="ads-btn light" data-payment="'+esc(ad.id)+'" data-received="'+(!ad.paymentReceived)+'">'+(ad.paymentReceived?"Clear payment":"Confirm payment")+'</button></td><td><span class="ads-pill '+esc(ad.status)+'">'+esc(state)+'</span></td><td>'+Number(ad.impressions||0).toLocaleString()+' views<br>'+Number(ad.clicks||0).toLocaleString()+' clicks</td><td><div class="ads-actions">'+(ad.status==="active"?'<button class="ads-btn light" data-action="pause" data-id="'+esc(ad.id)+'">Pause</button>':'<button class="ads-btn" data-action="activate" data-id="'+esc(ad.id)+'" '+(!ad.paymentReceived?'disabled title="Confirm payment first"':'')+'>Activate</button>')+'<button class="ads-btn danger" data-action="reject" data-id="'+esc(ad.id)+'">Reject</button></div></td></tr>';
  }).join(""):'<tr><td colspan="7">No campaigns yet.</td></tr>';
}
async function load(){try{const data=await api("/api/superadmin/ads");render(data);status("Advertising workspace loaded. Payment confirmation is a manual record; no money is transferred by this dashboard.");}catch(e){status(e.message,true);if(/log in/i.test(e.message))setTimeout(()=>location.href="/admin-login.html",900);}}
$("#adsForm").addEventListener("submit",async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{const form=new FormData(e.currentTarget);const payload=Object.fromEntries(form.entries());if(payload.startsAt)payload.startsAt=new Date(payload.startsAt).toISOString();else delete payload.startsAt;const data=await api("/api/superadmin/ads",{method:"POST",body:JSON.stringify(payload)});e.currentTarget.reset();status(data.message);await load();}catch(err){status(err.message,true);}finally{button.disabled=false;}});
$("#adsRows").addEventListener("click",async e=>{const pay=e.target.closest("[data-payment]");const action=e.target.closest("[data-action]");try{if(pay){pay.disabled=true;await api("/api/superadmin/ads/"+encodeURIComponent(pay.dataset.payment)+"/payment",{method:"POST",body:JSON.stringify({received:pay.dataset.received==="true"})});status("Payment status updated.");await load();}else if(action){action.disabled=true;await api("/api/superadmin/ads/"+encodeURIComponent(action.dataset.id)+"/action",{method:"POST",body:JSON.stringify({action:action.dataset.action})});status("Campaign updated.");await load();}}catch(err){status(err.message,true);}finally{if(pay)pay.disabled=false;if(action)action.disabled=false;}});
$("#refreshAds").addEventListener("click",load);
load();
})();