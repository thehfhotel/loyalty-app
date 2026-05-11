//! Minimal HTTP healthcheck binary for Distroless container images.
//!
//! Distroless images ship without a shell or `curl`, so the standard
//! `HEALTHCHECK CMD curl -f http://localhost:4001/api/health` cannot run.
//! This binary replaces that command with a tiny statically-linked probe
//! that hits the local `/api/health` endpoint and exits 0 on a 2xx
//! response, 1 otherwise.
//!
//! Listens on the same `PORT` env var the main backend uses (default 4001).
//! Uses `ureq` with no TLS feature flags — plain HTTP loopback only —
//! to keep the compiled binary small and free of additional runtime
//! dynamic-linking requirements beyond libc.

use std::process::ExitCode;
use std::time::Duration;

const DEFAULT_PORT: &str = "4001";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

fn main() -> ExitCode {
    let port = std::env::var("PORT").unwrap_or_else(|_| DEFAULT_PORT.to_string());
    let url = format!("http://127.0.0.1:{port}/api/health");

    let agent = ureq::AgentBuilder::new().timeout(REQUEST_TIMEOUT).build();

    match agent.get(&url).call() {
        Ok(response) if (200..300).contains(&response.status()) => ExitCode::SUCCESS,
        Ok(response) => {
            eprintln!(
                "healthcheck: unexpected status {} from {url}",
                response.status()
            );
            ExitCode::FAILURE
        },
        Err(ureq::Error::Status(code, _)) => {
            eprintln!("healthcheck: HTTP {code} from {url}");
            ExitCode::FAILURE
        },
        Err(err) => {
            eprintln!("healthcheck: request to {url} failed: {err}");
            ExitCode::FAILURE
        },
    }
}
