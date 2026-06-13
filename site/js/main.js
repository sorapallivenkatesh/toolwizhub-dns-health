/* main.js — wire the form to the API and render results. */

import { renderReport, renderLoading, renderError } from "./ui/render.js";

const form = document.getElementById("search");
const input = document.getElementById("domain");
const btn = document.getElementById("check-btn");
const results = document.getElementById("results");

async function check(domain) {
  results.hidden = false;
  results.replaceChildren(renderLoading(domain));
  btn.disabled = true;
  try {
    const res = await fetch(`${window.TWH.API_BASE}/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    results.replaceChildren(renderReport(data));
  } catch (e) {
    const msg = e instanceof TypeError ? "Couldn't reach the API. Is it running?" : e.message;
    results.replaceChildren(renderError(msg));
  } finally {
    btn.disabled = false;
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const domain = input.value.trim();
  if (domain) check(domain);
});

document.querySelectorAll(".example").forEach((b) =>
  b.addEventListener("click", () => {
    input.value = b.dataset.domain;
    check(b.dataset.domain);
  })
);

// Auto-run from ?d=<domain> (shareable / deep-linkable).
const deep = new URLSearchParams(location.search).get("d");
if (deep) {
  input.value = deep;
  check(deep);
}
