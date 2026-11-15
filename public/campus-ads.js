(() => {
const root=document.getElementById("campusAds"), grid=document.getElementById("campusAdsGrid");
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const safeTarget=value=>/^\/(?!\/)[A-Za-z0-9/_?&=.%#-]*$/.test(String(value||""))||/^https:\/\//i.test(String(value||""));
function showPopup(ad){
 if(!ad||!safeTarget(ad.targetUrl))return;
 const key="coc_popup_seen";
 try{const previous=Number(localStorage.getItem(key)||0);if(previous&&Date.now()-previous<24*60*60*1000)return;localStorage.setItem(key,String(Date.now()));}catch{}
 const overlay=document.createElement("div");
 overlay.className="coc-popup-overlay";overlay.setAttribute("role","dialog");overlay.setAttribute("aria-modal","true");overlay.setAttribute("aria-label","Sponsored promotion");
 overlay.innerHTML='<div class="coc-popup-card"><span class="coc-popup-sponsored">SPONSORED</span><img class="coc-popup-image" src="'+esc(ad.imageUrl)+'" alt=""><div class="coc-popup-copy"><h2>'+esc(ad.title)+'</h2><p>'+esc(ad.description||ad.advertiser||"")+'</p><p class="coc-popup-timer" aria-live="polite">You can skip this ad in <strong id="cocPopupCountdown">5</strong> seconds</p><button type="button" class="coc-popup-skip" disabled>Skip Ad · 5</button></div></div>';
 const style=document.createElement("style");
 style.textContent='.coc-popup-overlay{position:fixed;inset:0;z-index:10050;background:rgba(4,18,11,.78);display:flex;align-items:center;justify-content:center;padding:18px;box-sizing:border-box}.coc-popup-card{position:relative;width:min(560px,100%);max-height:92vh;overflow:auto;background:#fff;color:#173e2b;border-radius:20px;box-shadow:0 24px 80px #0007;cursor:pointer}.coc-popup-image{display:block;width:100%;max-height:48vh;object-fit:cover;background:#edf3ee}.coc-popup-sponsored{position:absolute;top:12px;left:12px;background:#fff;color:#176b45;border-radius:99px;padding:6px 10px;font-size:10px;font-weight:900;letter-spacing:.08em}.coc-popup-copy{padding:20px}.coc-popup-copy h2{margin:0 0 8px;font-size:24px}.coc-popup-copy p{color:#61766a;line-height:1.5}.coc-popup-timer{font-size:13px}.coc-popup-skip{border:0;border-radius:10px;padding:12px 18px;background:#176b45;color:white;font-weight:800;cursor:pointer}.coc-popup-skip:disabled{background:#a8b9ae;cursor:not-allowed}@media(max-width:480px){.coc-popup-copy{padding:16px}.coc-popup-copy h2{font-size:20px}}';
 document.head.appendChild(style);document.body.appendChild(overlay);
 fetch("/api/ads/"+encodeURIComponent(ad.id)+"/impression",{method:"POST",credentials:"same-origin"}).catch(()=>{});
 const skip=overlay.querySelector(".coc-popup-skip"),count=overlay.querySelector("#cocPopupCountdown");
 let remaining=5;
 const timer=setInterval(()=>{remaining--;count.textContent=String(remaining);skip.textContent=remaining>0?"Skip Ad · "+remaining:"Skip Ad";if(remaining<=0){clearInterval(timer);skip.disabled=false;}},1000);
 const close=()=>{clearInterval(timer);overlay.remove();style.remove();};
 skip.addEventListener("click",event=>{event.stopPropagation();close();});
 overlay.querySelector(".coc-popup-card").addEventListener("click",event=>{
  if(event.target.closest(".coc-popup-skip"))return;
  fetch("/api/ads/"+encodeURIComponent(ad.id)+"/click",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:"{}"}).catch(()=>{});
  location.href=ad.targetUrl;
 });
}
if(!root||!grid)return;
fetch("/api/ads/public",{credentials:"same-origin"}).then(r=>r.ok?r.json():Promise.reject()).then(data=>{
 if(data.hideAds){root.hidden=true;return;}
 const ads=Array.isArray(data.ads)?data.ads:[];
 root.hidden=false;
 if(!ads.length){grid.innerHTML='<div class="campus-ads-empty"><strong>No sponsored promotions yet.</strong><p>New campus offers will appear here when an advertisement is approved and activated.</p></div>';}
 else grid.innerHTML=ads.slice(0,4).map(ad=>{const internal=ad.destinationType==="internal";return '<a class="campus-ad-card" href="'+esc(ad.targetUrl)+'" '+(internal?'':'target="_blank" rel="noopener noreferrer" ')+'data-ad-click="'+esc(ad.id)+'"><img src="'+esc(ad.imageUrl)+'" alt=""><div class="campus-ad-copy"><span class="campus-ad-tag">Sponsored</span><h3>'+esc(ad.title)+'</h3><p>'+esc(ad.description||ad.advertiser)+'</p></div></a>';}).join("");
 ads.slice(0,4).forEach(ad=>fetch("/api/ads/"+encodeURIComponent(ad.id)+"/impression",{method:"POST",credentials:"same-origin"}).catch(()=>{}));
 const popupAds=Array.isArray(data.popupAds)?data.popupAds:[];
 if(popupAds.length&&document.body.classList.contains("student-dashboard-page"))showPopup(popupAds[0]);
}).catch(()=>{});
grid.addEventListener("click",e=>{const card=e.target.closest("[data-ad-click]");if(!card)return;const id=card.dataset.adClick;const body=new Blob(["{}"],{type:"application/json"});if(navigator.sendBeacon)navigator.sendBeacon("/api/ads/"+encodeURIComponent(id)+"/click",body);else fetch("/api/ads/"+encodeURIComponent(id)+"/click",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}",keepalive:true}).catch(()=>{});});
})();