import { db, auth, googleProvider, SUPER_ADMIN_EMAIL } from "../js/firebase-config.js";
import {
  signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";
import {
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc, getDoc,
  getDocs, query, where, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";

export function isSuperAdmin(user) {
  return user && user.email === SUPER_ADMIN_EMAIL;
}

export async function isApprovedAdmin(user) {
  if (!user) return false;
  if (isSuperAdmin(user)) return true;
  const snap = await getDoc(doc(db, "admins", user.email));
  return snap.exists();
}

export function googleSignIn() {
  return signInWithPopup(auth, googleProvider);
}

export function adminSignOut() {
  return signOut(auth);
}

/* Guard a page: redirects to login.html if not an approved admin.
   requireSuper=true additionally locks it to only the super admin email. */
export function guardAdminPage({ requireSuper = false } = {}) {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        window.location.href = "login.html";
        return;
      }
      const approved = requireSuper ? isSuperAdmin(user) : await isApprovedAdmin(user);
      if (!approved) {
        alert(requireSuper
          ? "This page is restricted to the super admin only."
          : "Your Gmail isn't approved for admin access. Ask the super admin to add you.");
        window.location.href = requireSuper ? "dashboard.html" : "login.html";
        return;
      }
      resolve(user);
    });
  });
}

/* ---------------- Tournaments ---------------- */

export async function publishTournament(data) {
  return addDoc(collection(db, "tournaments"), {
    ...data,
    status: "live",
    slotsFilled: 0,
    createdAt: serverTimestamp()
  });
}

export async function listLiveTournaments(gameFilter = null) {
  // No orderBy here on purpose — combining where() + orderBy() on a
  // different field requires a Firestore composite index to be created
  // manually in the console. Sorting client-side avoids that entirely.
  const q = query(collection(db, "tournaments"), where("status", "==", "live"));
  const snap = await getDocs(q);
  const results = [];
  snap.forEach(d => {
    if (!gameFilter || d.data().game === gameFilter) results.push({ id: d.id, ...d.data() });
  });
  results.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  return results;
}

/* Crown a winner: sets status to "ended" so it auto-drops off the live
   list everywhere, and records the winner for the Hall of Fame. */
export async function crownWinner(tournamentId, winnerName, winnerLogoUrl = "") {
  return updateDoc(doc(db, "tournaments", tournamentId), {
    status: "ended",
    winnerName,
    winnerLogoUrl,
    endedAt: serverTimestamp()
  });
}

/* ---------------- Access Codes ---------------- */

function makeCode(gamePrefix) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let rand = "";
  for (let i = 0; i < 4; i++) rand += chars[Math.floor(Math.random() * chars.length)];
  return `TGE-${gamePrefix.toUpperCase()}-${rand}`;
}

export async function generateCode(tournamentId, gamePrefix) {
  const code = makeCode(gamePrefix);
  await setDoc(doc(db, "accessCodes", code), {
    tournamentId,
    used: false,
    createdAt: serverTimestamp()
  });
  return code;
}

export async function listCodesForTournament(tournamentId) {
  const q = query(collection(db, "accessCodes"), where("tournamentId", "==", tournamentId));
  const snap = await getDocs(q);
  const codes = [];
  snap.forEach(d => codes.push({ id: d.id, ...d.data() }));
  return codes;
}

/* ---------------- Site Settings (Connect links) ---------------- */

export async function getSocialLinks() {
  const snap = await getDoc(doc(db, "settings", "social"));
  return snap.exists() ? snap.data() : {};
}

export async function saveSocialLinks(links) {
  return setDoc(doc(db, "settings", "social"), links, { merge: true });
}

/* ---------------- Applications ---------------- */

export async function listSponsorApplications() {
  const snap = await getDocs(query(collection(db, "sponsorApplications"), orderBy("createdAt", "desc")));
  const out = [];
  snap.forEach(d => out.push({ id: d.id, ...d.data() }));
  return out;
}

export async function listCelebrityApplications() {
  const snap = await getDocs(query(collection(db, "celebrityApplications"), orderBy("createdAt", "desc")));
  const out = [];
  snap.forEach(d => out.push({ id: d.id, ...d.data() }));
  return out;
}

export async function approveCelebrityApplication(app) {
  await addDoc(collection(db, "celebrities"), {
    name: app.name, game: app.game, addedAt: serverTimestamp()
  });
  return updateDoc(doc(db, "celebrityApplications", app.id), { status: "approved" });
}

export async function dismissApplication(collectionName, id) {
  return updateDoc(doc(db, collectionName, id), { status: "dismissed" });
}

/* ---------------- Admin management (super admin only) ---------------- */

export async function addAdmin(email) {
  return setDoc(doc(db, "admins", email.trim().toLowerCase()), {
    addedAt: serverTimestamp()
  });
}

export async function removeAdmin(email) {
  return deleteDoc(doc(db, "admins", email.trim().toLowerCase()));
}

export async function listAdmins() {
  const snap = await getDocs(collection(db, "admins"));
  const admins = [];
  snap.forEach(d => admins.push(d.id));
  return admins;
  }
