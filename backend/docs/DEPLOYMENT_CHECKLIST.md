# Deployment checklist

- [ ] Configure a strong `JWT_SECRET` (32+ characters minimum; use a cryptographically random value).
- [ ] Configure a dedicated PostgreSQL database account and a strong database password.
- [ ] Change the initial administrator password and disable unused accounts.
- [ ] Set `APP_ORIGIN` to the trusted production domain.
- [ ] Deploy behind HTTPS/TLS and a maintained reverse proxy.
- [ ] Restrict PostgreSQL to private network access; do not expose port 5432 publicly.
- [ ] Configure automated encrypted database backups and test restoration.
- [ ] Configure log rotation, monitoring, uptime alerts and security updates.
- [ ] Confirm business role permissions and reporting timezone with NOURISH HUB management.
- [ ] Run `npm.cmd run db:init`, verify `DATABASE_URL`, and run the acceptance test walkthrough in README against the production-like environment.
- [ ] Conduct dependency audit (`npm audit`) and application security review before go-live.
