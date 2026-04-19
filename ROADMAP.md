# Minimul usage

* [x] Simple SSH authentication
* [x] Fix no ping
* [ ] Looks like there are several endpoints that require session owner and do not have the middleware
* [ ] SSH auth with CA / prevent storing creds on server
* [ ] Add passkey (create single use code to add another passkey)

# Mvp

* [ ] Join dashboard and session details in single screen
* [ ] Fix editing yaml file actually updates the metadata (needs integration test)
* [ ] File browser
* [ ] File editor with Monaco
* [ ] Git diff browser
* [ ] Notify (pushover) when session is idle

# Polishing

* [ ] Fix SSH trust on first use (if the target machine ssh key changes, the app won't say anythjing)
* [ ] Add support for CORS for all calls
* [ ] New session button
* [ ] SSH/command payload
* [ ] Keyboard shortcuts
