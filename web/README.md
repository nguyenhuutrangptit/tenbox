# TenBox Web Manager

Local web-based dashboard for managing TenBox VMs. Replaces the need for the `tenbox` CLI with a browser UI that runs on localhost.

## Features

- **VM List** — view all VMs with live state, resources, and quick actions
- **Create VM** — form-driven VM creation with validation
- **VM Details** — inspect configuration, view logs, edit settings, and control power state
- **System** — host info and KVM doctor check

## Tech Stack

- **Frontend:** Vue 3 + Vite
- **Backend:** Node.js + Express (proxies to `tenboxd` Unix socket)
- **Design:** Cal.com-inspired clean UI (white canvas, black CTAs, Inter font)

## Development

```bash
cd web
npm install
npm run dev
```

This starts:
- API server on `http://localhost:3000`
- Vite dev server on `http://localhost:5173` (proxies `/api` to :3000)

Open `http://localhost:5173` in your browser.

## Production

```bash
cd web
npm install
npm run build
npm start
```

This builds the frontend into `dist/` and starts the Express server on port 3000. Open `http://localhost:3000`.

## Requirements

- `tenboxd` must be running and accessible via its Unix socket.
- The backend auto-discovers the socket path using the same logic as the CLI:
  1. `$TENBOX_SOCK`
  2. `/run/tenbox/tenbox.sock`
  3. `$XDG_RUNTIME_DIR/tenbox.sock`
  4. `/tmp/tenbox-<uid>.sock`
