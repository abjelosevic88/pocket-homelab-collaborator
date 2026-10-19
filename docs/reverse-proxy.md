# Reverse proxy

The app needs plain HTTP plus a WebSocket at `/api/v1/reviews/{id}/live`. Set `BASE_URL` and `SECURE_COOKIES=true` when it is served over HTTPS.

**Caddy** passes WebSockets through on its own:

```caddy
review.example.com {
	reverse_proxy pocket-collaborator:8080
}
```

**nginx**:

```nginx
location / {
    proxy_pass http://pocket-collaborator:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 120s;
    client_max_body_size 110m;
}
```

**Traefik**: works without extra settings.

The live channel only accepts connections whose `Origin` matches the `Host`, so the proxy must keep the original `Host` header.

Forward-auth (Tinyauth, Authelia, Authentik) works with `AUTH_MODE=proxy`; see `deploy/reverse-proxy/Caddyfile`.
