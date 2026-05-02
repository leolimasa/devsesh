# Minimul usage

* [x] Simple SSH authentication
* [x] Fix no ping
* [x] Add multi passkey (create single use code to add another passkey)
* [ ] SSH auth with CA using threshold signatures
* [ ] Looks like there are several endpoints that require session owner and do not have the middleware
* [ ] Deploy to VM with HTTPS support + tailscale

# Mvp

* [ ] Join dashboard and session details in single screen
* [ ] Fix editing yaml file actually updates the metadata (needs integration test)
* [ ] File browser
* [ ] File editor with Monaco
* [ ] Git diff browser
* [ ] Notify (pushover) when session is idle

# Polishing

* [ ] Fix SSH trust on first use (if the target machine ssh key changes, the app won't say anythjing)
* [ ] Have the CA also sign host certificates
* [ ] Add support for CORS for all calls
* [ ] Add SXG to sign JS bundle
* [ ] New session button
* [ ] SSH/command payload
* [ ] Keyboard shortcuts
* [ ] Sign the javascript bundle so that clients can verify it was not tampered with
* [ ] Add built in rate limits for endpoints
* [ ] Convert mutexes to actor model
* [ ] Replace internal/ssh/ca.GenerateKeyShares with a mechanism that generates the client share on the client.
