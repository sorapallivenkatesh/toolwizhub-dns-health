# Deployment / Hosting

End-to-end deploy for **DNS & Cert Health**:

- **API** → AWS Lambda + API Gateway (HTTP API), deployed with **AWS SAM**
- **Frontend** → Cloudflare Pages (static `site/`)
- **DNS** → managed in **Cloudflare** (`toolwizhub.com` zone)

Target hostnames:

```
site → dns-health.toolwizhub.com         (Cloudflare Pages)
api  → api.dns-health.toolwizhub.com      (API Gateway custom domain)
```

```
Browser → https://dns-health.toolwizhub.com            (Cloudflare Pages, static)
        → fetch POST https://api.dns-health.toolwizhub.com/check
              └─ Cloudflare DNS CNAME → API Gateway custom domain → Lambda → JSON
```

> **Why the API DNS record is manual:** the API runs on AWS but its DNS lives in Cloudflare —
> AWS can't create records in the Cloudflare zone, so the API's CNAME (and the ACM validation
> record) are added by hand in Cloudflare. The frontend domain is near-automatic because
> Cloudflare Pages manages the zone.

---

## 0. Prerequisites (one-time)

```bash
brew install aws-sam-cli awscli      # SAM + AWS CLI
sam --version
```

### AWS account setup (dedicated deploy profile)

Use a dedicated named CLI profile for this project so deploys can't land in the wrong account.

1. **IAM user:** `venkatesh_toolwizhub`.
2. **Attach the `sam-deploy` policy** (least-privilege, no admin — see [Appendix C](#appendix-c--sam-deploy-iam-policy)).
3. **Create an access key** (IAM → user → Security credentials → Create access key → CLI).
4. **Configure a named profile:**
   ```bash
   aws configure --profile personal
   #   Access Key ID / Secret  → from step 3
   #   Default region          → ap-south-1
   #   Output                  → json
   ```
5. **Verify + lock the shell to personal (safety check):**
   ```bash
   aws sts get-caller-identity --profile personal     # confirm it's the intended account
   export AWS_PROFILE=personal
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
| --- | --- |
| Stack Name | `toolwizhub-dns-health` |
| AWS Region `[ap-south-1]` | press Enter (don't retype — a leading space breaks it) |
| Parameter AllowOrigin | press Enter (already set) |
| Confirm changes before deploy | `y` |
| Allow SAM CLI IAM role creation | `y` |
| Disable rollback | `N` |
| `CheckFunction has no authentication. Is this okay?` | `y` (public by design) |
| Save arguments to configuration file | `y` |
| SAM configuration env `[default]` | press Enter |

Note the **ApiUrl** output (e.g. `https://abc123.execute-api.ap-south-1.amazonaws.com`). The API
is live on that raw URL now. Smoke-test:

```bash
curl -s -X POST "<ApiUrl>/check" -H 'content-type: application/json' \
  -d '{"domain":"github.com"}' | head -c 200; echo
```

---

## 2. Custom domain for the API → `api.dns-health.toolwizhub.com`

Maps the pretty hostname to the HTTP API. (AWS can't edit Cloudflare DNS, so the cert validation
and final CNAME are added manually in Cloudflare.)

**a. Request an ACM certificate** (same region as the API):

```bash
aws acm request-certificate \
  --domain-name api.dns-health.toolwizhub.com \
  --validation-method DNS --region ap-south-1
```

Get the **validation CNAME** (Console → ACM → the cert → "Create records" shows name/value, or
`aws acm describe-certificate`). Add it in **Cloudflare DNS** (DNS-only). Wait for status **Issued**.

**b. Create the API Gateway custom domain + mapping** (Console → **API Gateway → Custom domain
names → Create**):

- Domain name: `api.dns-health.toolwizhub.com`
- TLS cert: the ACM cert from step a
- Add an **API mapping** → select your HTTP API → stage `$default`
- Copy the **API Gateway domain** target shown: `d-xxxx.execute-api.ap-south-1.amazonaws.com`

**c. Point Cloudflare at it** — in the `toolwizhub.com` zone, add:

```
CNAME   api.dns-health   →   d-xxxx.execute-api.ap-south-1.amazonaws.com
```

Set it **DNS-only (grey cloud)** so AWS serves the ACM cert (orange cloud would make Cloudflare
terminate TLS and break it).

**d. Verify:**

```bash
curl -s -X POST https://api.dns-health.toolwizhub.com/check \
  -H 'content-type: application/json' -d '{"domain":"github.com"}' | head -c 200; echo
```

> **Frontend config:** `site/config.js` already targets `https://api.dns-health.toolwizhub.com`
> in prod — **no change needed.** (Only the quick path in [Appendix A](#appendix-a--quick-path-skip-the-custom-api-domain) edits it.)

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

## 4. Verify end-to-end

Open **https://dns-health.toolwizhub.com**, run a check, and confirm (DevTools → Network) the
POST to `api.dns-health.toolwizhub.com` returns **200**.

> Test on the real `dns-health.toolwizhub.com` domain, **not** `*.pages.dev` — CORS is locked to
> the site origin (+ `localhost:8080`), so the `pages.dev` URL would be blocked.

---

## Appendix A — quick path (skip the custom API domain)

To ship without the API custom domain: after step 1, set `site/config.js` prod `API_BASE` to the
raw `ApiUrl`, commit, push, and skip step 2. The API works identically — only its URL is unbranded.

```bash
git add site/config.js && git commit -m "chore: point prod API at raw ApiUrl" && git push
```

## Appendix B — redeploy & teardown

```bash
# API code changes
cd api && sam build && sam deploy            # reuses samconfig.toml, no --guided

# Frontend changes
git push                                     # Cloudflare Pages auto-redeploys

# Tear down the API stack
sam delete --stack-name toolwizhub-dns-health
```

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
  Delete a half-written config first: `rm -f api/samconfig.toml`.
- **`AccessDenied` during deploy** — the `sam-deploy` policy isn't attached to
  `venkatesh_toolwizhub`, or `AWS_PROFILE` isn't `personal`.
- **ACM cert stuck "Pending validation"** — the validation CNAME isn't in Cloudflare yet, or is
  orange-clouded. Add it as **DNS-only**; allow a few minutes.
- **`api.dns-health…` returns 5xx / TLS handshake errors** — the Cloudflare CNAME is
  orange-clouded. Switch it to **DNS-only (grey cloud)** so AWS serves the ACM cert.
- **CORS errors in the browser** — CORS is set in **both** the Lambda handler and the API Gateway
  `CorsConfiguration`, which can emit duplicate `Access-Control-Allow-Origin` headers. Fix: keep
  CORS in the Lambda (needed for local dev) and remove `CorsConfiguration` from `template.yaml`.
  Also confirm you're testing from `dns-health.toolwizhub.com`.
- **Deployed to the wrong account** — always run `aws sts get-caller-identity --profile personal`
  before deploying and confirm it's the intended account.
