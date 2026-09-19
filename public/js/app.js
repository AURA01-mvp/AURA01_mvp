// Shared helpers used across auth.html, onboarding.html, dashboard.html.
// Loaded after the Supabase CDN script and config.js.

const sb = window.supabase.createClient(
  window.VERYA_CONFIG.SUPABASE_URL,
  window.VERYA_CONFIG.SUPABASE_ANON_KEY
);

const Verya = {
  sb,

  // Call the AI brain. Always attaches the user's session token — the
  // function rejects unauthenticated calls.
  async ai(action, payload) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      window.location.href = "auth.html";
      throw new Error("Not signed in.");
    }
    const res = await fetch("/.netlify/functions/ai", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action, payload }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      await sb.auth.signOut();
      window.location.href = "auth.html";
      throw new Error("Session expired. Please sign in again.");
    }
    if (!res.ok) {
      if (data.detail) console.error("AI function detail:", data.detail);
      throw new Error(data.error || `AI request failed (${res.status})`);
    }
    return data;
  },

  async requireSession(redirectTo = "auth.html") {
    const { data } = await sb.auth.getSession();
    if (!data.session) {
      window.location.href = redirectTo;
      return null;
    }
    return data.session;
  },

  async signOut() {
    await sb.auth.signOut();
    window.location.href = "auth.html";
  },

  showAlert(container, message, type = "error") {
    container.innerHTML = `<div class="alert alert-${type}">${escapeHtml(message)}</div>`;
  },

  clearAlert(container) {
    container.innerHTML = "";
  },
};

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

window.Verya = Verya;
window.escapeHtml = escapeHtml;
