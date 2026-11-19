# NOURISH HUB Frontend

This folder contains the standalone browser interface (HTML, CSS and JavaScript).

## Run locally

1. Start the backend API on `http://localhost:3000` (see `../backend/README.md`).
2. Open this folder in VS Code and launch `index.html` with the Live Server extension, or serve this folder with any static web server.
3. The frontend API URL is configured in `config.js` as `http://localhost:3000/api`.

When deploying, update `config.js` to the public API URL and configure the backend `APP_ORIGIN` to the frontend's origin.
