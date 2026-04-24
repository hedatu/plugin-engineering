# California Security Preflight

- Generated at: `2026-04-22T21:14:46.1861567+08:00`
- Result: `passed_with_mitigations`
- Base stack reused: `supabase-core` at `/opt/supabase-core/docker-compose.yml`

## Running Containers

- `supabase-kong` (`kong/kong:3.9.1`) with host bind `8000/tcp`
- `supabase-auth` (`supabase/gotrue:v2.186.0`)
- `supabase-rest` (`postgrest/postgrest:v14.8`)
- `supabase-db` (`supabase/postgres:15.8.1.085`) with host bind `5432/tcp`

## Public Exposure

- `22/tcp`: allowed
- `80/tcp`: allowed
- `443/tcp`: allowed
- `5432/tcp`: host bind still present, but external reachability check is `false`
- `8000/tcp`: host bind still present, but external reachability check is `false`

## Mitigation In Place

- UFW remains `deny incoming` by default
- `DOCKER-USER` blocks external `eth0` traffic to:
  - `5432/tcp`
  - `8000/tcp`

## Notes

- The preinstalled `supabase-core` stack is the intended lightweight staging base, not unknown third-party workload.
- PostgreSQL is not considered publicly exposed after the firewall and `DOCKER-USER` checks.
- Production cutover must still remove or internalize the host port bindings instead of relying only on firewall drops.
