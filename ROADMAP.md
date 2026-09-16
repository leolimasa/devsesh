# Bugs

* [ ] Session is being marked as inactive even when there is output
* [ ] Need to constant unlock SSH
* [ ] Need to refresh the browser when restarting a session
* [ ] Fix SSH trust on first use (if the target machine ssh key changes, the app won't say anythjing)
* [ ] Details panel font size is not consistent with rest of the app

# Features

* [ ] Support for spawning local daemons 
* [ ] Display metadata as a formatted tree in the details panel
* [ ] Sign in without e-mail (can i match a passkey to a user?)
* [ ] File browser
* [ ] File editor with Monaco
* [ ] Git diff browser
* [ ] SSH/command payload
* [ ] Sign the javascript bundle so that clients can verify it was not tampered with
* [ ] Notify (pushover) when session is idle

# Code polish

* [ ] Add support for CORS for all calls. Cors is sprinkled through the code. Need to centralize.
* [ ] Add SXG to sign JS bundle
* [ ] Have the CA also sign host certificates
* [ ] Replace internal/ssh/ca.GenerateKeyShares with a mechanism that generates the client share on the client.
* [ ] aes.ts has 0 byte salt?
* [ ] Convert mutexes to actor model
* [ ] encoding.ts is reimplementing base64 encoding?
* [ ] Add built in rate limits for endpoints
* [ ] Looks like there are several endpoints that require session owner and do not have the middleware
