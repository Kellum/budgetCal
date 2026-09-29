# Sync — summary (stage 7)

Encrypted, server can't read. Signal-style pairing (short-lived QR + ECDH). Per-record last-writer-wins
by HLC, losers kept 30 days. Live pokes over WebSocket, ~2 s phone→laptop. Status labels. Server copy
deleted after 12 months of no device connecting, stated with exact dates. Full design: `../../PLAN.md` §7.
