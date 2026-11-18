(()=>{
  const $ = id => document.getElementById(id);
  let refreshInProgress = false;

  function applyMembership(account) {
    const premium = account && account.premium ? account.premium : {};
    const active = account?.role === "student" && premium.active === true;

    const extras = $("premiumMemberExtras");
    if (extras) extras.style.display = active ? "block" : "none";

    const badge = $("premiumBadge");
    if (badge) badge.hidden = !active;

    const heading = $("premiumHeading");
    const description = $("premiumDescription");
    const status = $("premiumStatus");

    if (active) {
      if (heading) heading.textContent = "Your Premium membership is active";
      if (description) description.textContent = "Your dashboard and pop-up advertisements are hidden, and you earn 1.5% FoodBack on eligible completed orders while Premium is active.";
      if (status) {
        const expiry = new Date(premium.endsAt);
        status.textContent = Number.isFinite(expiry.getTime())
          ? "Active until " + expiry.toLocaleDateString("en-NG") + ". Contact support to request renewal."
          : "Premium membership is active.";
      }
    } else {
      if (heading) heading.textContent = "Enjoy an ad-free campus experience";
      if (description) description.textContent = "Premium includes a membership badge, fewer advertisements, and 1.5% FoodBack on eligible completed orders.";
      if (status) status.textContent = "Premium is not active. Expired or revoked access is removed automatically. Contact ChowOnCampus support on 09169398221 if you believe this is an error.";
    }
  }

  async function refreshMembership() {
    if (refreshInProgress || document.visibilityState === "hidden") return;
    refreshInProgress = true;
    try {
      const response = await fetch("/api/me", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Cache-Control": "no-cache", "Pragma": "no-cache" }
      });
      if (!response.ok) throw new Error("Membership status could not be verified.");
      const data = await response.json();
      if (!data.account || data.account.role !== "student") {
        applyMembership(null);
        return;
      }
      applyMembership(data.account);
    } catch (error) {
      // Fail closed: never leave a stale Premium badge or benefit visible when
      // the server cannot confirm that membership is still active.
      applyMembership(null);
      const status = $("premiumStatus");
      if (status) status.textContent = "Premium status could not be verified. Premium-only benefits are temporarily hidden. Please refresh or contact support.";
    } finally {
      refreshInProgress = false;
    }
  }

  refreshMembership();
  window.addEventListener("focus", refreshMembership);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshMembership();
  });
  window.setInterval(refreshMembership, 15000);
})();