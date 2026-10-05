# Bugs

* [ ] Session is being marked as inactive even when there is output
* [ ] Need to refresh the browser when restarting a session
* [ ] Fix SSH trust on first use (if the target machine ssh key changes, the app won't say anythjing)
* [ ] Details panel font size is not consistent with rest of the app
* [ ] After internet loss + ssh key timeout, need to refresh the page several times until it comes back to normal
* [ ] Using the "reconnect session" button starts a sessino fine, but the frontend flickers and glitches and sometimes goes back to the dashboard view instead of cleanly connecting
* [ ] Sometimes "devsesh set status ..." doesn't work, even when "devsesh copy ..." does (meaning the problem is not auth)
* [ ] Copying large buffers fails
* [ ] When a session is connected, we should check that the JWT is not expired. If it is close to expiring, create a way to automatically renew it FROM THE FRONTEND (since the frontend is authenticated)                         

# Features

* [ ] LOCAL APP (self signed on mac)
* [ ] Support for spawning local daemons 
* [ ] File browser

* [ ] Display a "pair" button in the dashboard
* [ ] Display metadata as a formatted tree in the details panel
* [ ] Sign in without e-mail (can i match a passkey to a user?)
* [ ] File editor with Monaco
* [ ] Git diff browser
* [ ] SSH/command payload
* [ ] Sign the javascript bundle so that clients can verify it was not tampered with
* [ ] Notify (pushover) when session is idle
* [ ] Ability to filter sessions in the sidebar

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
