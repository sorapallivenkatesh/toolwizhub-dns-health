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

Maps the pretty hostname to the HTTP API. Each sub-step runs in a specific place:

| Sub-step | Where |
| --- | --- |
| 2a request cert | AWS (ACM) |
| 2a add validation record | Cloudflare (DNS) |
| 2b custom domain + mapping | AWS (API Gateway) |
| 2c routing CNAME | Cloudflare (DNS) |

> The cert lives in **ACM (AWS) only** — API Gateway terminates TLS and only accepts ACM certs.
> Cloudflare's role is purely DNS (two grey-cloud records). The frontend's own cert is separate
> and auto-issued by Cloudflare in step 3.

### 2a. Request + validate the ACM certificate

**Request** (must be the **same region as the API**, `ap-south-1`):

```bash
aws acm request-certificate \
  --domain-name api.dns-health.toolwizhub.com \
  --validation-method DNS --region ap-south-1
```

**Get the validation CNAME** — Console → **ACM** (region `ap-south-1`) → the pending cert →
**Domains** section shows a CNAME **name** + **value** (ignore the "Create records in Route 53"
button — DNS is in Cloudflare). Or via CLI:

```bash
aws acm list-certificates --region ap-south-1 \
  --query "CertificateSummaryList[?DomainName=='api.dns-health.toolwizhub.com'].CertificateArn" --output text
aws acm describe-certificate --region ap-south-1 --certificate-arn <ARN> \
  --query "Certificate.DomainValidationOptions[].ResourceRecord"
```

**Add it in Cloudflare** (`toolwizhub.com` zone → DNS → Add record):
- **Type:** CNAME
- **Name:** ⚠️ strip the zone suffix — Cloudflare auto-appends `.toolwizhub.com`:
  ```
  ACM name:  _abc123.api.dns-health.toolwizhub.com.
  Cloudflare Name:  _abc123.api.dns-health
  ```
  (Pasting the full name creates `…toolwizhub.com.toolwizhub.com` and validation never passes.)
- **Target:** the ACM value, e.g. `_xyz789.mhbtsbpdnt.acm-validations.aws`
- **Proxy:** **DNS only (grey cloud)** — a proxied record breaks validation
- **Save**

**Wait for Issued** (a few minutes, up to ~30):

```bash
aws acm describe-certificate --region ap-south-1 --certificate-arn <ARN> \
  --query "Certificate.Status" --output text     # PENDING_VALIDATION → ISSUED
```

### 2b. Create the API Gateway custom domain + mapping  (AWS — API Gateway console)

1. AWS Console → **API Gateway** (region `ap-south-1`) → **Custom domain names** → **Create**.
2. **Domain name:** `api.dns-health.toolwizhub.com`
3. **API endpoint type:** **Regional** (HTTP APIs are regional)
4. **Minimum TLS version:** TLS 1.2
5. **ACM certificate:** select the cert from 2a (must be **Issued**, region `ap-south-1` — if it's
   not in the dropdown, it's the wrong region or not yet issued)
6. **Create domain name.**
7. Open the domain → **API mappings** → **Configure API mappings** → **Add new mapping**:
   - **API:** `toolwizhub-dns-health` · **Stage:** `$default` · **Path:** (empty) → **Save**
8. Copy the **"API Gateway domain name"** target: `d-xxxx.execute-api.ap-south-1.amazonaws.com`

CLI alternative:

```bash
aws apigatewayv2 create-domain-name --region ap-south-1 \
  --domain-name api.dns-health.toolwizhub.com \
  --domain-name-configurations CertificateArn=<ACM_ARN>,EndpointType=REGIONAL,SecurityPolicy=TLS_1_2
aws apigatewayv2 get-apis --region ap-south-1 \
  --query "Items[?Name=='toolwizhub-dns-health'].ApiId" --output text
aws apigatewayv2 create-api-mapping --region ap-south-1 \
  --domain-name api.dns-health.toolwizhub.com --api-id <ApiId> --stage '$default'
aws apigatewayv2 get-domain-name --region ap-south-1 \
  --domain-name api.dns-health.toolwizhub.com \
  --query "DomainNameConfigurations[0].ApiGatewayDomainName" --output text   # the d-xxxx target
```

### 2c. Point Cloudflare at the target  (Cloudflare — DNS)

In the `toolwizhub.com` zone, add:

```
CNAME   api.dns-health   →   d-xxxx.execute-api.ap-south-1.amazonaws.com
```

Set it **DNS-only (grey cloud)**, NOT proxied. Why: API Gateway routes by **SNI/Host** — the
browser must reach AWS directly so the TLS SNI is `api.dns-health.toolwizhub.com`, which matches
the custom domain and serves the ACM cert. If proxied (orange), Cloudflare terminates TLS and
re-originates with the wrong SNI/Host → API Gateway returns 403 / TLS handshake errors. Trade-off:
no Cloudflare proxy features (caching/WAF) on the API — fine for a `POST /check` endpoint.

### 2d. Verify

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
