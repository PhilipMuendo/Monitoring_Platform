// The backend collector only pulls fresh readings from inverter APIs every
// POLL_INTERVAL (5 minutes by default — see docker-compose.yml). Polling
// the dashboard's own REST endpoints faster than that just re-fetches
// identical rows over and over. This is a freshness safety net, not the
// primary update path — alert changes arrive instantly over SSE
// (useAlertStream) and invalidate these queries directly.
export const FLEET_REFETCH_INTERVAL_MS = 120_000;
