# Goal

To create a script that tests all the `devsesh` functionality (web + server + cli) without access to the code.

## Requirements

* Create a new `integration_tests.sh` to run all integration tests [req.gd4jig]
* Use Playwright as the testing framework for both CLI and web [req.3ch3dq]
* Use Playwright webauthn emulation functionality to test webauthn authentication [req.ddmaai]
* Create integration tests for all features covered in README.md and all the markdown files in `doc/`. [req.ra9irr]
* Create integration tests for all pages in `web/` [req.ofvba1]
* Create integration tests for all UI workflows [req.azeczb]
* Create integration tests for all command line options [req.yrg291]
* Integration tests should use either the binary CLI or playwright to test system functionality and workflows. Do not test the code directly (like a unit test would). [req.cceh4b]
* Test environment setup: [req.ysdxv4]
  * Use a temporary database file that is deleted after tests [req.aef5gm]
  * Clean up session files from ~/.devsesh/sessions/ between test runs [req.74e81k]
  * Have a fresh server instance per test [req.ukgow2]
* Test organization: [req.9zv9zk]
  * Group tests by feature area (auth, sessions, pairing, CLI) [req.og61px]
  * Use descriptive test names that indicate the scenario being tested [req.a38eez]
* Run all integration tests yourself. Fix any that may be failing. This project is not considered done until all tests pass. [req.k1384u]
* Allow running individual tests [req.o5gj47]

## Implementation notes

* Use `flake.nix` to add any dependencies for testing [req.vofp0j]
* Run the tests inside the flake environment [req.nih7aj]
