# Deployment / Hosting

End-to-end deploy for **DNS & Cert Health**:

- **API** → AWS Lambda + API Gateway (HTTP API), deployed with **AWS SAM**
- **Frontend** → Cloudflare Pages (static `site/`)
- **DNS** → managed in **Cloudflare** (`toolwizhub.com` zone)

Two hostnames:
```
site → dns-health.toolwizhub.com         (Cloudflare Pages)
api  → api.dns-health.toolwizhub.com      (optional pretty domain; raw execute-api URL works too)
```

> **Why DNS records aren't auto-created for the API:** the API runs on AWS but its DNS lives in
> Cloudflare — AWS can't touch the Cloudflare zone, so the API's custom-domain CNAME is always a
> manual add. The frontend domain *is* near-automatic because Cloudflare Pages manages the zone.

---

## 0. Prerequisites (one-time)

```bash
brew install aws-sam-cli awscli      # SAM + AWS CLI
sam --version                        # verify
```

### AWS account setup (personal account — keep work account untouched)

Work account `478110679327` (`venky`) is the CLI `default` profile — **do not deploy there.**
Personal projects use a separate profile.

1. **Personal IAM user:** `venkatesh_toolwizhub`.
2. **Attach the `sam-deploy` policy** (least-privilege, no admin — see [Appendix C](#appendix-c--sam-deploy-iam-policy)).
3. **Create an access key** (IAM → user → Security credentials → Create access key → CLI).
4. **Configure a named profile:**
   ```bash
   aws configure --profile personal
   #   Access Key ID / Secret  → from step 3
   #   Default region          → ap-south-1
   #   Output                  → json
   ```
5. **Verify you're on the personal account (safety check):**
   ```bash
   aws sts get-caller-identity --profile personal     # Account must NOT be 478110679327
   export AWS_PROFILE=personal                         # lock this shell to personal
   ```

---

## 1. Deploy the API (SAM)

```bash
cd api
sam build
sam deploy --guided --region ap-south-1 \
  --parameter-overrides AllowOrigin=https://dns-health.toolwizhub.com
```

Guided prompts:

| Prompt | Answer |
|---|---|
| Stack Name | `toolwizhub-dns-health` |
| AWS Region `[ap-south-1]` | **press Enter** (don't retype — a leading space breaks it) |
| Parameter AllowOrigin | press Enter (already set) |
| Confirm changes before deploy | `y` |
| Allow SAM CLI IAM role creation | **`y`** |
| Disable rollback | `N` (cleaner; auto-rolls-back on failure) |
| `CheckFunction has no authentication. Is this okay?` | **`y`** (public by design) |
| Save arguments to configuration file | `y` |
| SAM configuration env `[default]` | press Enter |

➡️ Copy the **`ApiUrl`** output (e.g. `https://abc123.execute-api.ap-south-1.amazonaws.com`).

Smoke-test:
```bash
curl -s -X POST "<ApiUrl>/check" -H 'content-type: application/json' \
  -d '{"domain":"github.com"}' | head -c 200; echo
```

---

## 2. Point the frontend at the API

Edit `site/config.js` → set the **prod** branch to the API URL you'll use
(the raw `ApiUrl` for the quick path, or `https://api.dns-health.toolwizhub.com` if you set up
the custom domain in Appendix A):

```js
window.TWH = {
  API_BASE: ["localhost", "127.0.0.1"].includes(location.hostname)
    ? "http://localhost:3000"
    : "https://<ApiUrl-or-api.dns-health.toolwizhub.com>",
};
```
```bash
git add site/config.js && git commit -m "chore: point prod API at deployed URL" && git push
```

---

## 3. Deploy the frontend (Cloudflare Pages)

1. Cloudflare → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → `toolwizhub-dns-health`
2. Build settings:
   - Framework preset: **None**
   - Build command: **(empty)**
   - **Build output directory: `site`**
3. **Deploy** → you get `…pages.dev`
4. Project → **Custom domains** → add **`dns-health.toolwizhub.com`**
   → Cloudflare auto-creates the proxied CNAME + TLS cert.

CLI alternative: `npx wrangler pages deploy site --project-name=dns-health`.

---

## 4. Verify

Open **https://dns-health.toolwizhub.com**, run a check, and confirm (DevTools → Network) the
POST to the API returns **200**.

> Test on the real `dns-health.toolwizhub.com` domain, **not** `*.pages.dev` — CORS is locked to
> the site origin (+ `localhost:8080`), so the `pages.dev` URL would be blocked.

---

## Appendix A — (optional) pretty API domain `api.dns-health.toolwizhub.com`

Purely cosmetic; the raw `execute-api` URL works fine. To brand it:

1. **ACM cert** (same region as the API):
   ```bash
   aws acm request-certificate --domain-name api.dns-health.toolwizhub.com \
     --validation-method DNS --region ap-south-1
   ```
   Add the returned **validation CNAME** in Cloudflare (DNS-only) → wait for **Issued**.
2. **API Gateway → Custom domain names** → create `api.dns-health.toolwizhub.com` with that cert
   → add an **API mapping** to the HTTP API + `$default` stage → note the target
   `d-xxxx.execute-api.ap-south-1.amazonaws.com`.
3. **Cloudflare DNS** → `CNAME  api.dns-health → d-xxxx.execute-api…` set **DNS-only (grey cloud)**
   (so AWS serves the ACM cert; orange cloud would make Cloudflare terminate TLS).
4. Update `site/config.js` prod `API_BASE` → `https://api.dns-health.toolwizhub.com`, commit, push.

---

## Appendix B — redeploy & teardown

```bash
# API code changes
cd api && sam build && sam deploy            # reuses samconfig.toml, no --guided

# Frontend changes
git push                                     # Cloudflare Pages auto-redeploys

# Tear down the API stack
sam delete --stack-name toolwizhub-dns-health
```

---

## Appendix C — `sam-deploy` IAM policy

Least-privilege policy for SAM deploys (attach to `venkatesh_toolwizhub`). Replace
`<ACCOUNT_ID>` with the personal account ID.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "SamOrchestration", "Effect": "Allow",
      "Action": ["cloudformation:*","lambda:*","apigateway:*","logs:*"], "Resource": "*" },
    { "Sid": "SamArtifactBuckets", "Effect": "Allow", "Action": "s3:*",
      "Resource": ["arn:aws:s3:::aws-sam-cli-*","arn:aws:s3:::aws-sam-cli-*/*"] },
    { "Sid": "SamManagedRoles", "Effect": "Allow",
      "Action": ["iam:CreateRole","iam:DeleteRole","iam:GetRole","iam:PassRole","iam:TagRole","iam:UntagRole","iam:AttachRolePolicy","iam:DetachRolePolicy","iam:PutRolePolicy","iam:DeleteRolePolicy","iam:GetRolePolicy","iam:ListRolePolicies","iam:ListAttachedRolePolicies"],
      "Resource": "arn:aws:iam::<ACCOUNT_ID>:role/*" },
    { "Sid": "CertsForCustomDomains", "Effect": "Allow",
      "Action": ["acm:RequestCertificate","acm:DescribeCertificate","acm:ListCertificates","acm:AddTagsToCertificate","acm:DeleteCertificate"], "Resource": "*" }
  ]
}
```

---

## Troubleshooting

- **`region_name ' ap-south-1' doesn't match a supported format`** — a leading/trailing space in
  the region. Re-run; at the region prompt just press Enter (or pass `--region ap-south-1`).
  Delete a half-written `samconfig.toml` first: `rm -f api/samconfig.toml`.
- **`AccessDenied` during deploy** — the `sam-deploy` policy isn't attached to
  `venkatesh_toolwizhub` yet, or `AWS_PROFILE` isn't `personal`.
- **CORS errors in the browser** — CORS is currently set in **both** the Lambda handler and the
  API Gateway `CorsConfiguration`, which can emit duplicate `Access-Control-Allow-Origin`
  headers. Fix: keep CORS in the Lambda (needed for local dev) and remove `CorsConfiguration`
  from `template.yaml`. Also confirm you're testing from `dns-health.toolwizhub.com`.
- **Deployed to the wrong account** — always run `aws sts get-caller-identity --profile personal`
  before deploying; it must not be `478110679327`.
