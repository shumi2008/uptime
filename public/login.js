placeHeroLogo();
placeHeroSignals(13);

const registered = new URLSearchParams(window.location.search).get("registered");
if (registered === "1") {
  const lede = document.querySelector(".login-card__lede");
  if (lede) {
    lede.textContent = "Account created. Sign in with your new credentials.";
  }
}

const form = document.getElementById("login-form");
const errorEl = document.getElementById("login-error");
const submitBtn = form?.querySelector(".login-form__submit");

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorEl.hidden = true;
  errorEl.textContent = "";
  submitBtn.disabled = true;

  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;

  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Invalid username or password.");
    }

    window.location.href = "/";
  } catch (err) {
    errorEl.textContent = err.message || "Sign in failed.";
    errorEl.hidden = false;
  } finally {
    submitBtn.disabled = false;
  }
});
