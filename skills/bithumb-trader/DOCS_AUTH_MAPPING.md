Bithumb API auth & serialization mapping

Purpose
- Document which endpoints use JWT vs legacy HMAC, and the serialization rules for query_hash when using JWT.
- This file accompanies scripts/api/bithumb_client_safe.js and scripts/api/bithumb_jwt_suite.js.

Summary
- JWT is preferred for versioned endpoints (/v1/, /v2/). Legacy endpoints under /info/ generally use HMAC (Api-Key/Api-Sign/Api-Nonce).
- When sending parameters with a JWT-authenticated request, the server verifies a query_hash (SHA512) computed over a deterministically serialized parameter string. Different endpoints historically expect different serialization formats; the client implements endpoint-specific policies.

Current endpoint policies (applied in client)
- /v1/accounts (GET, no params)
  - Auth: JWT
  - Serialization: none (no query_hash)

- /v1/orders (POST/GET with params)
  - Auth: JWT
  - Serialization: RFC3986-style QS (encodeURIComponent(key)=encodeURIComponent(value) joined by &)
    - Example for {limit: 5} => "limit=5" (each key/value run through encodeURIComponent)
    - Client flag: forceRFC3986 or auto-detection for /v1/orders

- /info/* (legacy endpoints, e.g., /info/balance)
  - Auth: HMAC (legacy)
  - Signature: HMAC-SHA512 over (endpoint + '\0' + qs + '\0' + nonce), Api-Sign header contains base64 HMAC

Policy Guidelines
- Default behavior: client will auto-select auth mode by endpoint path (versioned -> JWT; legacy /info/ -> HMAC). Callers may override via opts.auth = 'jwt' | 'hmac'.
- For JWT endpoints that accept parameters, the client will apply per-endpoint serialization policy before computing query_hash. If server returns invalid_query_payload, try switching serialization per the suite (qs.stringify, RFC3986 QS, canonical JSON, compact JSON, array styles).
- Use debug mode (opts.debug = true) to log masked JWT payload, computed query string, and query_hash for troubleshooting. Never log secrets.

How to extend mapping
- Edit scripts/api/bithumb_client_safe.js: add path patterns to the isVersionedPath / endpoint policy logic and set forceRFC3986 or contentType accordingly.
- Update DOCS_AUTH_MAPPING.md with the endpoint, auth, and serialization rows.

Test suite
- scripts/api/bithumb_jwt_suite.js exercises key read-only endpoints and tries multiple serializations for /v1/orders.

Security notes
- Do not paste API keys/secrets into chat. Keep keys in environment variables and rotate if exposed.
- Debug logging masks access_key and token prefixes only; never include secretKey in logs.

Contact
- If an endpoint returns consistent invalid_query_payload despite trying supported serializations, contact Bithumb support with masked access_key and sample payloads for clarification.
