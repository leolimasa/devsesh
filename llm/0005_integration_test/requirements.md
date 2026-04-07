# Goal

To create a script that tests all the `devsesh` functionality (web + server + cli), and start by testing the webauthn user registration flow.

## Requirements

* Create a new `integration_tests.sh` to run all integration tests [req.gd4jig]
* Use Playwright as the testing framework [req.pmu63v]
* Use Playwright webauthn emulation functionality to test webauthn authentication [req.ddmaai]
* Create an integration test that: [req.u2rh0f]
  * Starts the Go server (`devsesh server`) using a blank postgres database [req.pgme3l]
  * Registers a new user using the web interface. Use the Playwright virtual webauthn device to simulate passkey availability. [req.bsqvjs]
* Starting the Go server should be a utility that can be used for future tests [req.v4jfhx]
* Test environment setup: [req.ysdxv4]
  * Use a temporary database file that is deleted after tests [req.aef5gm]
  * Clean up session files from ~/.devsesh/sessions/ between test runs [req.74e81k]
  * Have a fresh server instance per test [req.ukgow2]
* Test organization: [req.9zv9zk]
  * Group tests by feature area (auth, sessions, pairing, CLI) [req.og61px]
  * Use descriptive test names that indicate the scenario being tested [req.a38eez]
* Run all integration tests yourself. Fix any that may be failing. It is possible that there are bugs in the code. Fix those when appropriate. This project is not considered done until all tests pass. [req.k1384u]

## Implementation notes

* Add any needed tools or dependencies to `flake.nix` in the project root. [req.840wbb]
* Load `flake.nix` before executing tests so that all tools are available. [req.pf3q47]
