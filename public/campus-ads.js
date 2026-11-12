(() => {
const root=document.getElementById("campusAds"), grid=document.getElementById("campusAdsGrid");
if(!root||!grid)return;
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
fetch("/api/ads/public",{credentials:"same-origin"}).then(r=>r.ok?r.json():Promise.reject()).then(data=>{
 const ads=Array.isArray(data.ads)?data.ads:[];
 if(!ads.length)return;
 root.hidden=false;
 grid.innerHTML=ads.slice(0,4).map(ad=>{const internal=ad.destinationType==="internal";return '<a class="campus-ad-card" href="'+esc(ad.targetUrl)+'" '+(internal?'':'target="_blank" rel="noopener noreferrer" ')+'data-ad-click="'+esc(ad.id)+'"><img src="'+esc(ad.imageUrl)+'" alt=""><div class="campus-ad-copy"><span class="campus-ad-tag">Sponsored</span><h3>'+esc(ad.title)+'</h3><p>'+esc(ad.description||ad.advertiser)+'</p></div></a>';}).join("");
 ads.slice(0,4).forEach(ad=>fetch("/api/ads/"+encodeURIComponent(ad.id)+"/impression",{method:"POST",credentials:"same-origin"}).catch(()=>{}));
}).catch(()=>{});
grid.addEventListener("click",e=>{const card=e.target.closest("[data-ad-click]");if(!card)return;const id=card.dataset.adClick;const body=new Blob(["{}"],{type:"application/json"});if(navigator.sendBeacon)navigator.sendBeacon("/api/ads/"+encodeURIComponent(id)+"/click",body);else fetch("/api/ads/"+encodeURIComponent(id)+"/click",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}",keepalive:true}).catch(()=>{});});
})();