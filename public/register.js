placeHeroLogo();
placeHeroSignals(13);

const form = document.getElementById("register-form");
const errorEl = document.getElementById("register-error");
const submitBtn = form?.querySelector(".login-form__submit");

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorEl.hidden = true;
  errorEl.textContent = "";
  submitBtn.disabled = true;

  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;
  const confirmPassword = document.getElementById("confirm-password").value;

  if (password !== confirmPassword) {
    errorEl.textContent = "Passwords do not match.";
    errorEl.hidden = false;
    submitBtn.disabled = false;
    return;
  }

  try {
    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || "Registration failed.");
    }

    window.location.href = "/login?registered=1";
  } catch (err) {
    errorEl.textContent = err.message || "Registration failed.";
    errorEl.hidden = false;
  } finally {
    submitBtn.disabled = false;
  }
});
