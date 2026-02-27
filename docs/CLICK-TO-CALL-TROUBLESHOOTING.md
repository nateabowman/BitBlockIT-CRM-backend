# Click-to-Call Troubleshooting Guide

When you hear **"An application error has occurred"** on a click-to-call, Twilio played that message because it received a 5xx HTTP response or couldn't reach your webhook URL. Use this guide to diagnose and fix issues without diving into the codebase.

---

## Quick Reference: Click-to-Call Flow

1. User clicks "Call" on a lead → CRM backend calls Twilio to ring the agent's phone
2. Agent answers their phone
3. **Twilio fetches** `GET` or `POST` `{TWILIO_STATUS_CALLBACK_BASE_URL}/api/v1/twilio/voice/connect?token=...`
4. Your backend returns TwiML that tells Twilio to dial the lead's number
5. Lead's phone rings; agent and lead are connected

The error occurs at **step 3–4**: when Twilio fetches your voice/connect URL and gets a failure (5xx, timeout, or connection error).

---

## Step 1: Verify Environment Variables

All of these must be set and correct:

| Variable | Required | Example | Notes |
|----------|----------|---------|-------|
| `TWILIO_ACCOUNT_SID` | Yes | `AC...` | From [Twilio Console](https://console.twilio.com) |
| `TWILIO_AUTH_TOKEN` | Yes | `...` | Same place |
| `TWILIO_PHONE_NUMBER` | Yes | `+15551234567` | E.164 format, your Twilio number |
| `TWILIO_STATUS_CALLBACK_BASE_URL` | Yes | `https://api.yourcompany.com` | **Must be a public HTTPS URL Twilio can reach** |

### Common mistakes

- **`TWILIO_STATUS_CALLBACK_BASE_URL`** set to `http://localhost:3001` → Twilio (in the cloud) cannot reach localhost.
- Missing `https://` → Use `https://` for production.
- Trailing slash → OK; the app trims it. `https://api.example.com` and `https://api.example.com/` both work.
- Wrong domain → Must be the actual public URL of your backend (e.g. `https://crmapi.bitblockit.com`).

---

## Step 2: Test Webhook URL Manually

From a machine with network access (your laptop, a server), run:

```bash
# Replace with your actual base URL
BASE="https://api.yourcompany.com"

# Test 1: Health (no token)
curl -s -o /dev/null -w "%{http_code}" "$BASE/api/v1/twilio/voice/connect"
# Expect: 200 (missing token returns 200 with "Missing token" TwiML)

# Test 2: With invalid token
curl -s -o /dev/null -w "%{http_code}" "$BASE/api/v1/twilio/voice/connect?token=invalid"
# Expect: 200 (invalid token returns 200 with error TwiML, never 5xx)
```

- **5xx** → Problem is in your backend or reverse proxy; proceed to Step 3.
- **Timeout / connection refused** → Backend unreachable from that network; check firewall, DNS, reverse proxy.
- **200** → URL is reachable. Issue may be token expiry, wrong URL, or Twilio network routing.

---

## Step 3: Check Twilio Debugger (Twilio Console)

1. Go to [Twilio Console → Monitor → Logs → Calls](https://console.twilio.com/us1/monitor/logs/calls)
2. Find the failed call and open it
3. Look for errors, especially:
   - **11200** – HTTP retrieval failure (timeout, connection refused, DNS)
   - **11217** – HTTP error response code (your server returned 4xx or 5xx)

### Interpreting error codes

| Code | Meaning | Likely cause |
|------|---------|--------------|
| 11200 | Could not reach your webhook URL | Firewall, wrong URL, DNS, backend down |
| 11217 | Webhook returned 4xx/5xx | Backend error, proxy 502/503/504 |
| 20429 | Rate limit | Too many calls in a short time |

---

## Step 4: 502 Bad Gateway from nginx (Very Common)

If Twilio logs show **502 Bad Gateway** with `nginx/1.x` in the response body, the failure is between **nginx** and your **Node.js backend**—not from your app returning 5xx.

### What 502 means

- Nginx could not get a valid response from the upstream (your NestJS app).
- Common causes: upstream not running, upstream crashed, upstream too slow (timeout), or wrong upstream address/port.

### What to do

1. **Confirm the backend is running**  
   On the server: `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:PORT/health` (use your app port). Expect 200.

2. **Check nginx error log** (often `/var/log/nginx/error.log`):
   - `connect() failed (111: Connection refused)` → Backend not listening on the port nginx uses.
   - `upstream timed out` → Increase `proxy_read_timeout` (see below).
   - `upstream prematurely closed connection` → Backend crashed or closed the connection during the request.

3. **Raise timeouts for Twilio webhooks** so a slow DB or cold start doesn’t cause 502:

```nginx
location /api/v1/twilio/ {
    proxy_pass http://your_backend_upstream;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 10s;
    proxy_read_timeout 30s;   # Twilio expects response within ~15s; 30s gives headroom
    proxy_send_timeout 30s;
}
```

4. **Test from the server** (so traffic goes through the app, not nginx):
   ```bash
   curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:3001/api/v1/twilio/voice/connect?token=test"
   ```
   Expect 200. If this works but Twilio still gets 502, the issue is nginx or network between Twilio and your server.

5. **Twilio may use POST for voice/connect**  
   The app supports both GET and POST. If you previously had only GET, adding POST support may resolve 502 if the failure was due to method handling.

---

## Step 5: Check Reverse Proxy / Load Balancer (General)

If you use nginx, Apache, Cloudflare, or a load balancer:

- **502 Bad Gateway** → See **Step 4** above (nginx ↔ backend).
- **503 Service Unavailable** → Backend not responding or overloaded.
- **504 Gateway Timeout** → Backend too slow; increase `proxy_read_timeout` (or equivalent).

If you use **Cloudflare**, ensure the proxy is not blocking or timing out requests from Twilio.

---

## Step 6: Check Backend Logs

Look for errors around the time of the failed call:

```bash
# If using PM2
pm2 logs

# If using systemd
journalctl -u your-crm-backend -f

# Search for Twilio-related errors
grep -i "voice/connect\|twilio" /var/log/your-app.log
```

You may see:

- `voice/connect error: <message>` → Error inside `getConnectTwiML` (e.g. token, DB, config)
- Database connection errors
- Out-of-memory or crashes

---

## Step 7: Verify Agent and Lead Phone Numbers

Even if the webhook returns 200, bad phone data can cause failures:

- **Agent phone** – User profile must have a valid E.164 phone number (e.g. `+15551234567`)
- **Lead contact phone** – Lead’s primary contact must have a valid phone number
- **Twilio number** – Must be able to make outbound calls (check Twilio account status and region)

---

## Step 8: Checklist Summary

- [ ] `TWILIO_STATUS_CALLBACK_BASE_URL` is a **public** HTTPS URL
- [ ] `curl` to `/api/v1/twilio/voice/connect` returns 200 (not 5xx)
- [ ] Twilio Debugger shows the exact error (11200, 11217, etc.)
- [ ] Reverse proxy timeouts are sufficient (e.g. 30s read timeout)
- [ ] Backend logs show no crashes or DB errors when the call happens
- [ ] Agent and lead phone numbers are in E.164 format
- [ ] Twilio account is in good standing (no suspension, correct region)

---

## Test URLs for Verification

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `{BASE}/health` | GET | Basic liveness check |
| `{BASE}/api/v1/twilio/voice/connect?token=test` | GET or POST | Voice connect (returns 200 with error TwiML for invalid token) |

Replace `{BASE}` with your `TWILIO_STATUS_CALLBACK_BASE_URL`.

---

## Additional Resources

- [Twilio: "An application error has occurred"](https://help.twilio.com/articles/223132427)
- [Twilio Error 11200 (HTTP retrieval failure)](https://www.twilio.com/docs/api/errors/11200)
- [Twilio Error 11217 (HTTP error response code)](https://www.twilio.com/docs/api/errors/11217)
- [Twilio Webhooks Best Practices](https://www.twilio.com/docs/usage/webhooks/webhooks-connection-overrides)
