# Objective

To create an integration test that tests the full passkey enrollment flow.

# Context

The code described in `llm/0011_passkey_enc/requirements.md` has been implemented. However, there are no integration tests that tests the whole workflow. Read that file to understand what the project requirements are in order to understand why we are structuring the test the way we are.

# Test

Integration test steps

**Machine A**

* Create a brand new playwright BrowserContext that will represent Machine A [req.waqmh7]
* Setup the virtual webauthn authenticator for Machine A (with PRF support) by using `integration_tests/helpers/webauthn.ts -> setupVirtualAuthenticator`. [req.zc5j3w]
* Create a user in the webapp for that particular authenticator [req.bntuym]
* Go to `/passkeys/add` and ensure the page displays. Keep that page open. [req.9vznsw]
* Leave the page/browser instance running so that the websocket eventually does the enrollment [req.dt9rcc]

**Machine B**

* Create a brand new playwright BrowserContext that will represent Machine B. This context should have NOTHING shared with Machine A's context. [req.vfgfyp]
* Setup the virtual webauthn authenticator (with PRF support) for Machine B by using `integration_tests/helpers/webauthn.ts -> setupVirtualAuthenticator`. [req.iixgv6]
* Go to `/passkeys/enroll` and read the generated code [req.xkxlj6]
* Leave the page/browser instance running so that the websocket eventually does the enrollment [req.jjspag]

**Machine A**

* Go back to the existing playright browser instance for Machine A [req.80uc34]
* Paste the code from machine B into the code textbox [req.gnqik5]
* Wait a few seconds [req.y9alku]
* Ensure that the page shows a success message [req.qhcoja]
* Ensure that the passkey for machine B has been added to the database [req.tu068q]


# Extra instructions

- Read README.md and the documents in the `doc/` folder to understand the project architecture
- Update doc/ if necessary with new architecture implementations
- Update integration tests with any new use cases
- Ensure all tests, both unit tests and integration tests pass after implementation. Iterate until both unit tests and integration tests pass.
- Ensure you are inside the nix environment before building and testing the project (use `nix develop`)
- Add any needed dependendencies to `flake.nix`
- All build outputs should be placed in `build/`
- Add logging as necessary
- Everytime you change the frontend, you must build it and then rebuild the binary. Use `build.sh` to build everything.
