import { db } from "./firebase-config.js";
import {
  collection, query, where, getCountFromServer,
  orderBy, limit, getDocs
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";

async function loadStats() {
  try {
    const liveQ = query(collection(db, "tournaments"), where("status", "==", "live"));
    const liveSnap = await getCountFromServer(liveQ);
    document.getElementById("stat-live").textContent = liveSnap.data().count;

    const wonQ = query(collection(db, "tournaments"), where("status", "==", "ended"));
    const wonSnap = await getCountFromServer(wonQ);
    document.getElementById("stat-winners").textContent = wonSnap.data().count;
  } catch (e) {
    // Firestore not seeded yet — show zero instead of a broken UI
    document.getElementById("stat-live").textContent = "0";
    document.getElementById("stat-winners").textContent = "0";
  }
}

async function loadHallOfFamePreview() {
  const el = document.getElementById("hof-preview");
  try {
    // No orderBy — where()+orderBy() on a different field needs a
    // Firestore composite index. Sort client-side instead, then slice to 3.
    const q = query(collection(db, "tournaments"), where("status", "==", "ended"));
    const snap = await getDocs(q);
    if (snap.empty) {
      el.textContent = "No tournaments crowned yet — check back soon.";
      return;
    }
    const docs = [];
    snap.forEach(d => docs.push(d.data()));
    docs.sort((a, b) => (b.endedAt?.toMillis?.() || 0) - (a.endedAt?.toMillis?.() || 0));
    el.innerHTML = "";
    docs.slice(0, 3).forEach(t => {
      const row = document.createElement("div");
      row.style.padding = "10px 0";
      row.style.borderBottom = "1px solid var(--tge-olive)";
      row.textContent = `${t.game || "—"} · ${t.title || "Tournament"} — Winner: ${t.winnerName || "TBD"}`;
      el.appendChild(row);
    });
  } catch (e) {
    el.textContent = "No tournaments crowned yet — check back soon.";
  }
}

loadStats();
loadHallOfFamePreview();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {
    // Non-fatal — site still works without the installable-app layer.
  });
}

// ---------------- PWA "Install App" button ----------------
// Browsers fire this event only when the site qualifies as installable
// (manifest + service worker present, which TGE already has).
let deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  const btn = document.getElementById("install-app-btn");
  if (btn) btn.classList.add("show");
});

const installBtn = document.getElementById("install-app-btn");
if (installBtn) {
  installBtn.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installBtn.classList.remove("show");
  });
}
