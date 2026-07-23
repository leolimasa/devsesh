# MVP

* [x] Simple SSH authentication
* [x] Fix no ping
* [x] Add multi passkey (create single use code to add another passkey)
* [x] SSH auth with CA using threshold signatures
* [x] Fix "command attach-session: too many arguments" when connecting. Suspect integration tests are NOT catting FLAG_FILE
* [x] Deploy to VM with HTTPS support + tailscale
* [x] Find a way to deploy without needing to have secrets unlocked
* [x] Make it available on the command line, and test a new session on mobile
* [x] Fix remote command exited without exit status or exit signal
* [x] Make it mobile friendly
	* [x] session details need to be under a haburger
* [x] When terminal grows screen gets covered up
* [ ] Session is being marked as inactive even when there is output
* [ ] Switching session doesn't resize terminal contents (needs a manual window resize)
* [ ] Looks like pings are not being sent
* [ ] Add button to delete existing session
* [ ] Cursor doesn't show in normal mode when in neovim
* [ ] Bar to change session when in detailed view
* [ ] Need to constant unlock SSH
* [ ] Looks like there are several endpoints that require session owner and do not have the middleware
* [ ] Support for copy and paste from terminal
* [ ] Notify (pushover) when session is idle

# Polishing

* [x] Terminal auto-connect when opening screen
* [x] Keyboard shortcuts
* [ ] Fix editing yaml file actually updates the metadata (needs integration test)
* [ ] Display metadata "status" field face up
* [ ] Display metadata as a formatted tree in the details panel
* [ ] Details panel font size is not consistent with rest of the app
* [ ] Sign in without e-mail (can i match a passkey to a user?)
* [ ] File browser
* [ ] File editor with Monaco
* [ ] Git diff browser
* [ ] Fix SSH trust on first use (if the target machine ssh key changes, the app won't say anythjing)
* [ ] Have the CA also sign host certificates
* [ ] Add support for CORS for all calls. Cors is sprinkled through the code. Need to centralize.
* [ ] Add SXG to sign JS bundle
* [ ] New session button
* [ ] SSH/command payload
* [ ] Sign the javascript bundle so that clients can verify it was not tampered with
* [ ] Add built in rate limits for endpoints
* [ ] Convert mutexes to actor model
* [ ] Replace internal/ssh/ca.GenerateKeyShares with a mechanism that generates the client share on the client.
* [ ] aes.ts has 0 byte salt?
* [ ] encoding.ts is reimplementing base64 encoding?
