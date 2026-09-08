#!/bin/sh
# Issue (or refresh) the chat-agent leaf certificate that Caddy serves on
# 0.0.0.0:4242. It is signed by Caddy's internal CA, which is trusted by the
# local system — so no public CA is involved and no cloud is needed.
#
# Re-run this when the machine's LAN IP changes, then restart Caddy.
# CA_DIR can override where Caddy keeps its storage.

set -e

CA_DIR="${CA_DIR:-$HOME/Library/Application Support/Caddy/pki/authorities/local}"
if [ ! -f "$CA_DIR/intermediate.crt" ] || [ ! -f "$CA_DIR/intermediate.key" ]; then
	# common fallback locations
	for d in \
		"$HOME/.local/share/caddy/pki/authorities/local" \
		"/usr/local/share/caddy/pki/authorities/local" \
		"/usr/local/lib/Caddy/pki/authorities/local"; do
		if [ -f "$d/intermediate.crt" ]; then CA_DIR="$d"; break; fi
	done
fi
if [ ! -f "$CA_DIR/intermediate.crt" ]; then
	echo "error: Caddy internal CA not found (run caddy once first)" >&2
	exit 1
fi

OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/certs"
mkdir -p "$OUT_DIR"
cd "$OUT_DIR"

LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || true)"
[ -n "$LAN_IP" ] || echo "warning: could not detect LAN IP; cert will only cover 127.0.0.1/localhost"

SAN="IP:127.0.0.1,DNS:localhost"
[ -n "$LAN_IP" ] && SAN="$SAN,IP:$LAN_IP"

cat > san.cnf <<CNF
[ v3 ]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = $SAN
CNF

openssl req -new -newkey rsa:2048 -nodes -keyout chat-agent.key \
	-subj "/CN=chat-agent.local" -out chat-agent.csr 2>/dev/null
openssl x509 -req -in chat-agent.csr \
	-CA "$CA_DIR/intermediate.crt" -CAkey "$CA_DIR/intermediate.key" \
	-CAcreateserial -days 825 -extfile san.cnf -extensions v3 -out chat-agent.leaf.crt 2>/dev/null
cat chat-agent.leaf.crt "$CA_DIR/intermediate.crt" > chat-agent.crt
rm -f chat-agent.csr san.cnf

echo "wrote $OUT_DIR/chat-agent.crt (SANs: $SAN)"
echo "restart Caddy to pick it up:  pkill -f 'caddy run' && caddy run --config Caddyfile"
