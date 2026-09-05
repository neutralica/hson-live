# Local transport test TLS material

This self-signed certificate and unencrypted private key are public, test-only
fixtures. Never use them for a deployed host. The certificate covers `localhost`
and `127.0.0.1`; tests trust it explicitly rather than disabling TLS verification.

Generated with:

```sh
openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem \
  -days 36500 -subj '/CN=localhost' \
  -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1'
```
