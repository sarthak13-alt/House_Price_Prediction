// auth.js - user and admin register / login (runs fully in the browser, no server).
//
// How it works:
//  - Accounts are saved in the browser's localStorage (so they stay after you close the page).
//  - Passwords are never saved as plain text. We save a random "salt" + a SHA-256 hash of the password.
//  - A default admin account is created the first time the project is opened.
//  - Anyone can register as a normal User. Registering as an Admin needs the secret admin code below.
//
// NOTE: this is a college-project login. Because everything runs inside the browser, it is NOT real
// security (a person who knows how to open the browser console can still read the stored data).
// A real website would check the login on a server.

const ADMIN_SECRET_CODE = "DWM-ADMIN-2026";                       // change this to your own code
const DEFAULT_ADMIN = { name: "Administrator", email: "admin@example.com", username: "admin", password: "Admin@123" };

class AuthError extends Error {}                                  // an error whose message is safe to show to the user

// ---------------------------------------------------------------- safe storage
const _memory = {};                                              // used only if the browser blocks localStorage
const Store = {
  get(key, fallback) {
    try {
      const text = localStorage.getItem(key);
      return text === null ? fallback : JSON.parse(text);
    } catch (e) { return key in _memory ? _memory[key] : fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { _memory[key] = value; }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch (e) { delete _memory[key]; }
  },
};

// ---------------------------------------------------------------- SHA-256 (small version, no library)
const _primes = [];
for (let n = 2; _primes.length < 64; n++) if (_primes.every((p) => n % p !== 0)) _primes.push(n);
const _frac = (x) => Math.floor((x - Math.floor(x)) * 4294967296);
const SHA_K = _primes.map((p) => _frac(Math.cbrt(p)));
const SHA_H0 = _primes.slice(0, 8).map((p) => _frac(Math.sqrt(p)));
const rotr = (x, n) => (x >>> n) | (x << (32 - n));

function sha256(text) {
  const bytes = Array.from(new TextEncoder().encode(text));
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const high = Math.floor(bitLength / 4294967296), low = bitLength >>> 0;
  for (let i = 3; i >= 0; i--) bytes.push((high >>> (i * 8)) & 255);
  for (let i = 3; i >= 0; i--) bytes.push((low >>> (i * 8)) & 255);

  let h = SHA_H0.slice();
  const w = new Array(64);
  for (let start = 0; start < bytes.length; start += 64) {
    for (let i = 0; i < 16; i++) {
      const j = start + i * 4;
      w[i] = (bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SHA_K[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h = [h[0] + a, h[1] + b, h[2] + c, h[3] + d, h[4] + e, h[5] + f, h[6] + g, h[7] + hh].map((v) => v | 0);
  }
  return h.map((v) => (v >>> 0).toString(16).padStart(8, "0")).join("");
}

function randomSalt() {
  const bytes = new Uint8Array(16);
  if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// the hash is repeated many times so that guessing passwords is slower
function hashPassword(password, salt) {
  let digest = salt + ":" + password;
  for (let i = 0; i < 2000; i++) digest = sha256(salt + digest);
  return digest;
}

// ---------------------------------------------------------------- activity log and comparison history
const Log = {
  add(username, text) {
    const list = Store.get("hp_activity", []);
    list.unshift({ time: Date.now(), user: username || "-", text });
    Store.set("hp_activity", list.slice(0, 200));
  },
  all() { return Store.get("hp_activity", []); },
  clear() { Store.set("hp_activity", []); },
};

const History = {
  add(entry) {
    const list = Store.get("hp_history", []);
    list.unshift({ time: Date.now(), ...entry });
    Store.set("hp_history", list.slice(0, 200));
  },
  all() { return Store.get("hp_history", []); },
  clear() { Store.set("hp_history", []); },
};

// ---------------------------------------------------------------- accounts
const MAX_FAILED_LOGINS = 5, LOCK_MINUTES = 1;

const Auth = {
  users() { return Store.get("hp_users", []); },
  saveUsers(list) { Store.set("hp_users", list); },

  // creates the default admin the very first time
  init() {
    if (this.users().length) return;
    const salt = randomSalt();
    this.saveUsers([{ name: DEFAULT_ADMIN.name, email: DEFAULT_ADMIN.email, username: DEFAULT_ADMIN.username, role: "admin", seed: true,
      salt, hash: hashPassword(DEFAULT_ADMIN.password, salt), created: Date.now(), lastLogin: null, failed: 0, lockUntil: 0 }]);
  },

  validatePassword(password) {
    if (password.length < 6) throw new AuthError("Password must be at least 6 characters long.");
    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) throw new AuthError("Password must contain at least one letter and one number.");
  },

  register(f) {
    const name = (f.name || "").trim(), email = (f.email || "").trim().toLowerCase(), username = (f.username || "").trim();
    if (name.length < 2) throw new AuthError("Please enter your full name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError("Please enter a valid email address.");
    if (!/^[A-Za-z0-9_.]{3,20}$/.test(username)) throw new AuthError("Username must be 3-20 characters (letters, numbers, _ or .).");
    this.validatePassword(f.password || "");
    if (f.password !== f.confirm) throw new AuthError("The two passwords do not match.");
    const role = f.role === "admin" ? "admin" : "user";
    if (role === "admin" && (f.adminCode || "").trim() !== ADMIN_SECRET_CODE) throw new AuthError("The admin secret code is wrong. Only people who know the code can register as Admin.");

    const users = this.users();
    if (users.some((u) => u.username.toLowerCase() === username.toLowerCase())) throw new AuthError("This username is already taken. Please choose another one.");
    if (users.some((u) => u.email === email)) throw new AuthError("An account with this email already exists.");

    const salt = randomSalt();
    users.push({ name, email, username, role, salt, hash: hashPassword(f.password, salt), created: Date.now(), lastLogin: null, failed: 0, lockUntil: 0 });
    this.saveUsers(users);
    Log.add(username, `Registered a new ${role} account`);
    return { username, role };
  },

  // identifier = username or email
  login(identifier, password, remember) {
    const id = (identifier || "").trim().toLowerCase();
    if (!id || !password) throw new AuthError("Please enter your username (or email) and password.");
    const users = this.users();
    const user = users.find((u) => u.username.toLowerCase() === id || u.email === id);
    if (!user) throw new AuthError("Wrong username or password.");
    if (user.lockUntil && user.lockUntil > Date.now()) {
      const seconds = Math.ceil((user.lockUntil - Date.now()) / 1000);
      throw new AuthError(`Too many wrong attempts. Please try again in ${seconds} seconds.`);
    }
    if (hashPassword(password, user.salt) !== user.hash) {
      user.failed = (user.failed || 0) + 1;
      if (user.failed >= MAX_FAILED_LOGINS) { user.lockUntil = Date.now() + LOCK_MINUTES * 60000; user.failed = 0; }
      this.saveUsers(users);
      Log.add(user.username, "Failed login attempt");
      throw new AuthError("Wrong username or password.");
    }
    user.failed = 0; user.lockUntil = 0; user.lastLogin = Date.now();
    this.saveUsers(users);
    const session = JSON.stringify({ username: user.username });
    try {
      sessionStorage.removeItem("hp_session"); localStorage.removeItem("hp_session");
      (remember ? localStorage : sessionStorage).setItem("hp_session", session);
    } catch (e) { _memory.session = session; }
    Log.add(user.username, "Logged in");
    return user;
  },

  current() {
    let text = null;
    try { text = sessionStorage.getItem("hp_session") || localStorage.getItem("hp_session"); } catch (e) { text = _memory.session || null; }
    if (!text) return null;
    try {
      const { username } = JSON.parse(text);
      return this.users().find((u) => u.username === username) || null;   // null if the account was deleted
    } catch (e) { return null; }
  },

  logout() {
    const user = this.current();
    if (user) Log.add(user.username, "Logged out");
    try { sessionStorage.removeItem("hp_session"); localStorage.removeItem("hp_session"); } catch (e) { /* ignore */ }
    delete _memory.session;
  },

  isAdmin() { const u = this.current(); return !!u && u.role === "admin"; },
  ADMIN_PAGES: ["preprocessing", "admin"],
  canOpen(page) { return this.isAdmin() || !this.ADMIN_PAGES.includes(page); },

  // the built-in default admin is not a person who registered on the website
  isSeed(u) { return !!u.seed || (u.username === "admin" && u.email === DEFAULT_ADMIN.email); },

  // numbers for the Admin Panel: how many people registered, and when
  signupStats() {
    const registered = this.users().filter((u) => !this.isSeed(u));
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const day = 86400000;
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const from = startOfToday.getTime() - i * day;
      days.push({ label: new Date(from).toLocaleDateString([], { day: "numeric", month: "short" }),
                  count: registered.filter((u) => u.created >= from && u.created < from + day).length });
    }
    return {
      total: registered.length, users: registered.filter((u) => u.role === "user").length, admins: registered.filter((u) => u.role === "admin").length,
      today: registered.filter((u) => u.created >= startOfToday.getTime()).length,
      week: days.reduce((sum, d) => sum + d.count, 0), days,
      recent: [...registered].sort((a, b) => b.created - a.created).slice(0, 6),
    };
  },

  // ---- admin actions (each one checks that the person doing it is really an admin)
  requireAdmin() { if (!this.isAdmin()) throw new AuthError("Only an admin can do this."); return this.current(); },

  deleteUser(username) {
    const me = this.requireAdmin();
    if (username === me.username) throw new AuthError("You cannot delete your own account while you are logged in.");
    const users = this.users();
    const target = users.find((u) => u.username === username);
    if (!target) throw new AuthError("This user no longer exists.");
    this.saveUsers(users.filter((u) => u.username !== username));
    Log.add(me.username, `Deleted the account '${username}'`);
  },

  setRole(username, role) {
    const me = this.requireAdmin();
    const users = this.users();
    const target = users.find((u) => u.username === username);
    if (!target) throw new AuthError("This user no longer exists.");
    if (target.role === "admin" && role === "user" && users.filter((u) => u.role === "admin").length <= 1) {
      throw new AuthError("There must always be at least one admin.");
    }
    target.role = role;
    this.saveUsers(users);
    Log.add(me.username, `Changed '${username}' to ${role}`);
  },

  resetPassword(username, newPassword) {
    const me = this.requireAdmin();
    this.validatePassword(newPassword);
    const users = this.users();
    const target = users.find((u) => u.username === username);
    if (!target) throw new AuthError("This user no longer exists.");
    target.salt = randomSalt();
    target.hash = hashPassword(newPassword, target.salt);
    target.failed = 0; target.lockUntil = 0;
    this.saveUsers(users);
    Log.add(me.username, `Reset the password of '${username}'`);
  },
};

Auth.init();
