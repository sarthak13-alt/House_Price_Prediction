// auth_ui.js - the login / register screen, the logout button, and the Admin Panel.
// (The account logic itself is in auth.js.)

const AUTH = {};

function fmtTime(ms) {
  if (!ms) return "never";
  const d = new Date(ms);
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ------------------------------------------------------------ login / register screen
function showAuthMessage(text, ok = false) {
  $("auth-error").classList.toggle("hidden", ok || !text);
  $("auth-ok").classList.toggle("hidden", !ok || !text);
  (ok ? $("auth-ok") : $("auth-error")).textContent = text || "";
}

function switchAuthTab(tab) {
  document.querySelectorAll("[data-auth-tab]").forEach((b) => b.classList.toggle("active", b.dataset.authTab === tab));
  $("login-form").classList.toggle("hidden", tab !== "login");
  $("register-form").classList.toggle("hidden", tab !== "register");
  $("auth-title").textContent = tab === "login" ? "Welcome back" : "Create your account";
  $("auth-sub").textContent = tab === "login" ? "Login to continue" : "It only takes a minute";
  showAuthMessage("");
}
document.querySelectorAll("[data-auth-tab]").forEach((b) => b.addEventListener("click", () => switchAuthTab(b.dataset.authTab)));

document.querySelectorAll("input[name=reg-role]").forEach((r) => r.addEventListener("change", () => {
  $("reg-code-box").classList.toggle("hidden", document.querySelector("input[name=reg-role]:checked").value !== "admin");
}));

$("login-form").addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    Auth.login($("login-id").value, $("login-password").value, $("login-remember").checked);
    $("login-password").value = "";
    enterApp();
  } catch (e) {
    if (!(e instanceof AuthError)) console.error(e);
    showAuthMessage(e instanceof AuthError ? e.message : "Login failed. Please try again.");
  }
});

$("register-form").addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const result = Auth.register({
      role: document.querySelector("input[name=reg-role]:checked").value, adminCode: $("reg-code").value,
      name: $("reg-name").value, email: $("reg-email").value, username: $("reg-username").value,
      password: $("reg-password").value, confirm: $("reg-confirm").value,
    });
    $("register-form").reset();
    $("reg-code-box").classList.add("hidden");
    switchAuthTab("login");
    $("login-id").value = result.username;
    showAuthMessage(`Account created. You can login now as ${result.username}.`, true);
  } catch (e) {
    if (!(e instanceof AuthError)) console.error(e);
    showAuthMessage(e instanceof AuthError ? e.message : "Registration failed. Please check the details and try again.");
  }
});

// ------------------------------------------------------------ enter / leave the application
function applyRole() {
  const user = Auth.current();
  const admin = Auth.isAdmin();
  document.querySelectorAll(".admin-only").forEach((el) => el.classList.toggle("hidden", !admin));
  document.querySelectorAll(".admin-only-inline").forEach((el) => el.classList.toggle("hidden", !admin));
  $("user-avatar").textContent = user.name.trim().charAt(0).toUpperCase();
  $("user-label").innerHTML = `${esc(user.name)} <span class="role-badge ${admin ? "admin" : ""}">${admin ? "Admin" : "User"}</span>`;
  $("dash-welcome").innerHTML = `Welcome back, <b>${esc(user.name.split(" ")[0])}</b>! Compare 7 algorithms on your data and find the most accurate one.`;
}

function enterApp() {
  document.body.classList.remove("logged-out");
  applyRole();
  showPage("dashboard");
}

function leaveApp() {
  Auth.logout();
  STATE.df = null; STATE.original = null; STATE.trained = null;       // the next person starts clean
  document.body.classList.add("logged-out");
  location.reload();
}
$("logout-btn").addEventListener("click", leaveApp);

// ------------------------------------------------------------ dashboard: my history
function renderDashboardHistory() {
  const user = Auth.current();
  if (!user) return;
  $("dash-admin-box").classList.toggle("hidden", !Auth.isAdmin());
  if (Auth.isAdmin()) {
    const st = Auth.signupStats();
    $("dash-admin").innerHTML = [card(st.total, "Registered on the website", "stat-red"), card(st.today, "New today", "stat-orange"),
      card(st.week, "New in last 7 days", "stat-green"), card(st.users + " / " + st.admins, "Users / Admins")].join("");
  }
  const mine = History.all().filter((h) => h.user === user.username).slice(0, 8);
  $("dash-history-box").classList.toggle("hidden", mine.length === 0);
  $("dash-history").innerHTML = tableHTML({ columns: ["Time", "Comparison", "Dataset", "Best algorithm"],
    rows: mine.map((h) => [fmtTime(h.time), h.type, h.dataset, h.best]) });
}

// ------------------------------------------------------------ admin panel
function adminMessage(text, ok = false) {
  $("admin-message").innerHTML = text ? `<div class="${ok ? "note-box ok" : "error-box"}">${esc(text)}</div>` : "";
}

function renderAdminPanel() {
  if (!Auth.isAdmin()) return;
  const me = Auth.current(), users = Auth.users(), history = History.all(), activity = Log.all(), st = Auth.signupStats();

  $("admin-banner").innerHTML = `<div class="signup-banner"><div class="count">${st.total}</div>
    <div class="txt"><b>${st.total === 1 ? "person has" : "people have"} registered on this website</b>
    <span>${st.users} user${st.users === 1 ? "" : "s"} and ${st.admins} admin${st.admins === 1 ? "" : "s"} · ${st.today} new today · ${st.week} in the last 7 days</span></div></div>`;
  $("admin-cards").innerHTML = [card(st.total, "Registered (website)", "stat-red"), card(st.users, "Users", "stat-green"), card(st.admins, "Admins (registered)", "stat-orange"),
    card(users.length, "All accounts (incl. default admin)"), card(history.length, "Comparisons run"), card(activity.length, "Activity records")].join("");

  $("admin-chart").innerHTML = "";
  $("admin-chart").appendChild(barChart({ labels: st.days.map((d) => d.label), values: st.days.map((d) => d.count), title: "New registrations per day", color: "#ef4444" }, 560, 330));
  $("admin-recent").innerHTML = st.recent.length
    ? tableHTML({ columns: ["Name", "Role", "Registered"], rows: st.recent.map((u) => [u.name, u.role === "admin" ? "Admin" : "User", fmtTime(u.created)]) })
    : "<p>&nbsp;Nobody has registered yet. New sign-ups will appear here.</p>";

  const rows = users.map((u) => {
    const mine = u.username === me.username;
    return `<tr><td>${esc(u.name)}</td><td>${esc(u.username)}${mine ? " <small>(you)</small>" : ""}${Auth.isSeed(u) ? " <small>(default)</small>" : ""}</td><td>${esc(u.email)}</td>
      <td><span class="role-badge ${u.role === "admin" ? "admin" : ""}">${u.role === "admin" ? "Admin" : "User"}</span></td>
      <td>${fmtTime(u.created)}</td><td>${fmtTime(u.lastLogin)}</td>
      <td>${mine ? "-" : `<button class="btn small" data-act="role" data-user="${esc(u.username)}" data-role="${u.role === "admin" ? "user" : "admin"}">Make ${u.role === "admin" ? "User" : "Admin"}</button>
        <button class="btn small" data-act="reset" data-user="${esc(u.username)}">Reset password</button>
        <button class="btn small danger" data-act="delete" data-user="${esc(u.username)}">Delete</button>`}</td></tr>`;
  }).join("");
  $("admin-users").innerHTML = `<table><thead><tr><th>Name</th><th>Username</th><th>Email</th><th>Role</th><th>Registered</th><th>Last login</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table>`;

  $("admin-history").innerHTML = history.length
    ? tableHTML({ columns: ["Time", "User", "Comparison", "Dataset", "Best algorithm"], rows: history.slice(0, 50).map((h) => [fmtTime(h.time), h.user, h.type, h.dataset, h.best]) })
    : "<p>&nbsp;No comparisons have been run yet.</p>";
  $("admin-activity").innerHTML = activity.length
    ? tableHTML({ columns: ["Time", "User", "What happened"], rows: activity.slice(0, 50).map((a) => [fmtTime(a.time), a.user, a.text]) })
    : "<p>&nbsp;No activity yet.</p>";
}

$("admin-users").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-act]");
  if (!button) return;
  const { act, user, role } = button.dataset;
  try {
    if (act === "delete") {
      if (!confirm(`Delete the account '${user}'? This cannot be undone.`)) return;
      Auth.deleteUser(user);
      adminMessage(`The account '${user}' was deleted.`, true);
    } else if (act === "role") {
      Auth.setRole(user, role);
      adminMessage(`'${user}' is now ${role === "admin" ? "an Admin" : "a User"}.`, true);
    } else if (act === "reset") {
      const password = prompt(`Enter a new password for '${user}' (at least 6 characters, with a letter and a number):`);
      if (password === null) return;
      Auth.resetPassword(user, password);
      adminMessage(`The password of '${user}' was changed.`, true);
    }
  } catch (e) {
    adminMessage(e instanceof AuthError ? e.message : "This action failed. Please try again.");
  }
  renderAdminPanel();
});
$("clear-history").addEventListener("click", () => { if (Auth.isAdmin() && confirm("Clear the whole comparison history?")) { History.clear(); renderAdminPanel(); } });
$("clear-activity").addEventListener("click", () => { if (Auth.isAdmin() && confirm("Clear the whole activity log?")) { Log.clear(); renderAdminPanel(); } });

// ------------------------------------------------------------ start: skip the login screen if a session already exists
if (Auth.current()) enterApp(); else document.body.classList.add("logged-out");
