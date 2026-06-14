/* config.js — where the frontend finds the API. */
window.TWH = {
  API_BASE: ["localhost", "127.0.0.1"].includes(location.hostname)
    ? "http://localhost:3000"
    : "https://api.dns-health.toolwizhub.com",
};
