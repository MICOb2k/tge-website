import { db, storage } from "./firebase-config.js";
import {
  collection, query, where, orderBy, getDocs, addDoc, doc,
  runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";
import {
  ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-storage.js";

/* ---------------------------------------------------------
   Compress an uploaded image client-side before it ever
   touches Firebase Storage, so logos can't blow up the quota.
   Resizes to max 500px on the long edge and re-encodes as
   JPEG at 0.72 quality — a team badge doesn't need more.
--------------------------------------------------------- */
function compressImage(file, maxDim = 500, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = e => { img.src = e.target.result; };
    reader.onerror = reject;
    img.onload = () => {
      let { width, height } = img;
      if (width > height && width > maxDim) {
        height = Math.round(height * (maxDim / width));
        width = maxDim;
      } else if (height > maxDim) {
        width = Math.round(width * (maxDim / height));
        height = maxDim;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      canvas.toBlob(blob => resolve(blob), "image/jpeg", quality);
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ---------------------------------------------------------
   Load live tournaments for a given game into a <select>.
--------------------------------------------------------- */
export async function loadTournamentOptions(gameId, selectEl, listEl) {
  // No orderBy on purpose — where()+orderBy() on a different field needs a
  // Firestore composite index. Sorting client-side avoids that entirely.
  const q = query(
    collection(db, "tournaments"),
    where("game", "==", gameId),
    where("status", "==", "live")
  );
  const snap = await getDocs(q);
  selectEl.innerHTML = '<option value="">— Select a tournament —</option>';

  if (snap.empty) {
    if (listEl) listEl.innerHTML = `<div class="tourney-card"><div></div><div><p>No live tournaments for this game right now. Check back soon or follow our channels for announcements.</p></div><div></div></div>`;
    return {};
  }

  const docs = [];
  snap.forEach(d => docs.push({ id: d.id, ...d.data() }));
  docs.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));

  const map = {};
  let listHtml = "";
  docs.forEach(t => {
    map[t.id] = t;
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = `${t.title} (${t.format || gameId}) — ${t.entryType === "paid" ? "Paid, code required" : "Free entry"}`;
    selectEl.appendChild(opt);

    const shareText = encodeURIComponent(`${t.title} — register now on Terminators Global Esports! ${window.location.href}`);

    listHtml += `
      <div class="tourney-card">
        <span class="tourney-badge live-pulse">LIVE</span>
        <div>
          <h3 style="margin:0 0 4px;font-size:1.05rem;">${t.title}</h3>
          <div class="tourney-meta">
            <span class="tourney-badge ${t.entryType === "paid" ? "paid" : "free"}" style="margin-right:4px;">${t.entryType === "paid" ? "PAID" : "FREE"}</span>
            <span>${t.format || ""}</span>
            <span>Prize: ${t.prizePool || "TBA"}</span>
            <span>Slots: ${t.slotsFilled ?? 0}/${t.slots ?? "—"}</span>
            ${t.startAt ? `<span class="countdown-chip" data-start="${t.startAt}"></span>` : ""}
          </div>
        </div>
        <a class="share-btn" href="https://wa.me/?text=${shareText}" target="_blank" rel="noopener">Share</a>
      </div>`;
  });
  if (listEl) listEl.innerHTML = listHtml;

  // Live countdown ticking for any tournament with a start time set
  const countdownEls = listEl ? listEl.querySelectorAll(".countdown-chip") : [];
  if (countdownEls.length) {
    const tick = () => {
      countdownEls.forEach(el => {
        const target = new Date(el.dataset.start).getTime();
        const diff = target - Date.now();
        if (isNaN(target)) { el.textContent = ""; return; }
        if (diff <= 0) { el.textContent = "STARTING NOW"; return; }
        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        el.textContent = `STARTS IN ${h}h ${m}m ${s}s`;
      });
    };
    tick();
    setInterval(tick, 1000);
  }

  return map;
}

/* ---------------------------------------------------------
   Wire up a registration form.
   formEl must contain fields with these names:
   tournamentId, teamName, format, leaderName, leaderUID,
   whatsapp, instagram, telegram, discord, code (optional), logo (file input)
--------------------------------------------------------- */
export function initRegistrationForm(gameId, formEl, tournamentsMap, msgEl) {
  const logoInput = formEl.querySelector('[name="logo"]');
  const logoDrop = formEl.querySelector(".logo-drop");
  const logoPreview = formEl.querySelector(".logo-preview");
  let compressedLogoBlob = null;

  logoInput.addEventListener("change", async () => {
    const file = logoInput.files[0];
    if (!file) return;
    logoDrop.textContent = "Compressing…";
    compressedLogoBlob = await compressImage(file);
    logoDrop.classList.add("has-file");
    logoDrop.textContent = `✓ Logo ready (${Math.round(compressedLogoBlob.size / 1024)}KB after compression)`;
    if (logoPreview) {
      logoPreview.src = URL.createObjectURL(compressedLogoBlob);
      logoPreview.style.display = "block";
    }
  });

  const tournamentSelect = formEl.querySelector('[name="tournamentId"]');
  const codeField = formEl.querySelector(".code-field");
  tournamentSelect.addEventListener("change", () => {
    const t = tournamentsMap[tournamentSelect.value];
    if (t && t.entryType === "paid") {
      codeField.style.display = "block";
      codeField.querySelector("input").required = true;
    } else {
      codeField.style.display = "none";
      codeField.querySelector("input").required = false;
    }
  });

  function showMsg(text, type) {
    msgEl.textContent = text;
    msgEl.className = `form-msg show ${type}`;
  }

  formEl.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = formEl.querySelector('[type="submit"]');
    const data = Object.fromEntries(new FormData(formEl).entries());

    // 2-of-3 rule: WhatsApp is required separately; need >=2 of Instagram/Telegram/Discord... 
    // per spec: WhatsApp required, PLUS at least 2 of {Instagram, Telegram, Discord}
    const optionalContacts = [data.instagram, data.telegram, data.discord].filter(v => v && v.trim());
    if (!data.whatsapp || !data.whatsapp.trim()) {
      showMsg("WhatsApp number is required.", "error");
      return;
    }
    if (optionalContacts.length < 2) {
      showMsg("Please provide at least 2 of: Instagram, Telegram, Discord.", "error");
      return;
    }
    if (!compressedLogoBlob) {
      showMsg("Please upload a team logo.", "error");
      return;
    }
    const tournamentId = data.tournamentId;
    const tournament = tournamentsMap[tournamentId];
    if (!tournament) {
      showMsg("Please select a tournament.", "error");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting…";

    try {
      // Paid tournaments: validate + atomically lock the single-use code first.
      if (tournament.entryType === "paid") {
        const codeVal = (data.code || "").trim().toUpperCase();
        if (!codeVal) {
          showMsg("This tournament requires an access code.", "error");
          submitBtn.disabled = false; submitBtn.textContent = "Submit Registration";
          return;
        }
        const codeRef = doc(db, "accessCodes", codeVal);
        await runTransaction(db, async (tx) => {
          const codeSnap = await tx.get(codeRef);
          if (!codeSnap.exists()) throw new Error("That code doesn't exist.");
          const codeData = codeSnap.data();
          if (codeData.tournamentId !== tournamentId) throw new Error("That code isn't valid for this tournament.");
          if (codeData.used) throw new Error("That code has already been used.");
          tx.update(codeRef, { used: true, usedAt: serverTimestamp(), usedByTeam: data.teamName });
        });
      }

      // Upload compressed logo
      const path = `logos/${gameId}/${tournamentId}/${Date.now()}_${data.teamName.replace(/\s+/g, "_")}.jpg`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, compressedLogoBlob);
      const logoUrl = await getDownloadURL(storageRef);

      await addDoc(collection(db, "registrations"), {
        game: gameId,
        tournamentId,
        teamName: data.teamName,
        format: data.format || "",
        leaderName: data.leaderName,
        leaderUID: data.leaderUID || "",
        whatsapp: data.whatsapp,
        instagram: data.instagram || "",
        telegram: data.telegram || "",
        discord: data.discord || "",
        logoUrl,
        createdAt: serverTimestamp()
      });

      showMsg("Registration submitted! Your slot is confirmed once admin reviews it.", "success");
      formEl.reset();
      logoDrop.textContent = "Tap to upload team logo (auto-compressed)";
      logoDrop.classList.remove("has-file");
      if (logoPreview) logoPreview.style.display = "none";
      compressedLogoBlob = null;
    } catch (err) {
      showMsg(err.message || "Something went wrong. Please try again.", "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit Registration";
    }
  });
}
