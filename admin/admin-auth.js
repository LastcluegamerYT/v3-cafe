// admin-auth.js — Authentication module for V3 Cafe Admin Panel

// ── Firebase imports MUST be first ──
import { ref, get, set } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import bakeryDB from "../connection/connection.js";

const { db } = bakeryDB;

// ── Default credentials (overridden by Firebase settings) ──
const DEFAULT_USER = "admin";
const DEFAULT_PASS = "v3cafe2024";
const SESSION_KEY  = "v3cafe_admin_session";

// ── Load credentials from Firebase ──
async function getStoredCredentials() {
    try {
        const snap = await get(ref(db, "settings/adminCredentials"));
        if (snap.exists()) {
            const val = snap.val();
            // Validate shape
            if (val && typeof val.username === "string" && typeof val.password === "string") {
                return val;
            }
        }
    } catch (_) {}
    return { username: DEFAULT_USER, password: DEFAULT_PASS };
}

// ── Login ──
export async function login(username, password) {
    if (!username || !password) return { ok: false, error: "Fields required" };
    const creds = await getStoredCredentials();
    if (username.trim() === creds.username && password === creds.password) {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ username: username.trim(), ts: Date.now() }));
        return { ok: true };
    }
    return { ok: false, error: "Invalid credentials" };
}

// ── Logout ──
export function logout() {
    sessionStorage.removeItem(SESSION_KEY);
}

// ── Check if logged in (12-hour session) ──
export function isLoggedIn() {
    try {
        const raw = sessionStorage.getItem(SESSION_KEY);
        if (!raw) return false;
        const data = JSON.parse(raw);
        return !!(data.ts && (Date.now() - data.ts) < 12 * 60 * 60 * 1000);
    } catch (_) {
        return false;
    }
}

// ── Change password (saves to Firebase) ──
export async function changePassword(oldPass, newPass, confirmPass) {
    if (!oldPass) throw new Error("Current password is required.");
    if (!newPass || newPass.length < 6) throw new Error("New password must be at least 6 characters.");
    if (newPass !== confirmPass) throw new Error("Passwords do not match.");

    const creds = await getStoredCredentials();
    if (oldPass !== creds.password) throw new Error("Current password is incorrect.");

    await set(ref(db, "settings/adminCredentials"), {
        username: creds.username,
        password: newPass
    });
    return true;
}

// ── Init login UI ──
export function initLoginUI(onSuccess) {
    const screen  = document.getElementById("login-screen");
    const form    = document.getElementById("login-form");
    const userInp = document.getElementById("l-user");
    const passInp = document.getElementById("l-pass");
    const errEl   = document.getElementById("login-err");
    const btnTxt  = document.getElementById("login-btn-txt");
    const spinner = document.getElementById("login-spinner");
    const eyeBtn  = document.getElementById("toggle-pass");

    // If already logged in, skip login screen immediately
    if (isLoggedIn()) {
        screen.classList.add("hidden");
        onSuccess();
        return;
    }

    // Toggle password visibility
    eyeBtn?.addEventListener("click", () => {
        const isPassword = passInp.type === "password";
        passInp.type = isPassword ? "text" : "password";
        eyeBtn.textContent = isPassword ? "🙈" : "👁";
    });

    form?.addEventListener("submit", async (e) => {
        e.preventDefault();

        const username = userInp.value.trim();
        const password = passInp.value;

        if (!username || !password) {
            errEl.textContent = "❌ Please fill in all fields.";
            errEl.classList.remove("hidden");
            return;
        }

        errEl.classList.add("hidden");
        btnTxt.classList.add("hidden");
        spinner.classList.remove("hidden");
        form.style.pointerEvents = "none";

        try {
            const result = await login(username, password);
            if (result.ok) {
                screen.style.transition = "opacity .4s ease";
                screen.style.opacity = "0";
                setTimeout(() => {
                    screen.classList.add("hidden");
                    screen.style.opacity = "";
                    screen.style.transition = "";
                    onSuccess();
                }, 420);
            } else {
                errEl.textContent = "❌ Wrong credentials. Try again.";
                errEl.classList.remove("hidden");
                passInp.value = "";
                passInp.focus();
            }
        } catch (err) {
            errEl.textContent = "❌ " + (err.message || "Login failed. Check connection.");
            errEl.classList.remove("hidden");
        } finally {
            btnTxt.classList.remove("hidden");
            spinner.classList.add("hidden");
            form.style.pointerEvents = "";
        }
    });
}
