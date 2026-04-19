# Operator Dashboard — Acceptance Checklist

Run after any substantive change to the dashboard.

- [ ] `https://dashboard.numaradio.com` shows Cloudflare Access login on a fresh device (incognito)
- [ ] Signing in with an allowlisted email lands on the dashboard
- [ ] Top pill shows "Stream is live" (green pulse) when stream is up
- [ ] Listener count increments when I open `https://api.numaradio.com/stream` in a second tab
- [ ] Now playing shows correct title + artist ("Russell Ross — One More Dance" style)
- [ ] All 3 service rows (icecast2, numa-liquidsoap, cloudflared) show "active" with an uptime
- [ ] Health card shows Neon + B2 + Tunnel all green
- [ ] Logs card: click numa-liquidsoap → last 50 lines appear
- [ ] Click Restart on numa-liquidsoap → confirmation dialog → Confirm → success toast
- [ ] During restart, service row briefly shows "activating" then "active"
- [ ] Externally `sudo systemctl stop icecast2` → Icecast row goes red within ~5s
- [ ] Externally `sudo systemctl start icecast2` → recovers within ~5s
- [ ] Open dashboard on phone — all cards stack vertically and work
- [ ] Background the tab for 1 min → DevTools Network tab shows no requests during hidden time
- [ ] Return to tab → immediate fetch visible in Network tab (not waiting for 5s cadence)
