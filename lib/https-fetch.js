const insecure =
  process.env.TLS_INSECURE === "1" ||
  process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0";

if (insecure && process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

if (insecure && process.env.NODE_ENV === "production") {
  console.warn(
    "TLS certificate verification is disabled (TLS_INSECURE). Do not use in production."
  );
}

function httpsFetch(url, options = {}) {
  return fetch(url, options);
}

module.exports = { httpsFetch };
