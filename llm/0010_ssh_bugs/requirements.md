
## Fixes

Please fix the following:

* The "Connect" button should always show in the session details page. Currently, it only shows when the session is active. [req.o6b7de]
* The session connects to SSH successfuly, but it can't attach to temux because it can't find the tmux session by name. Fix that. [req.rb7cft]

## Context and extra instructions

- Read README.md and the documents in doc/ to understand the architecture
- Update doc/ if necessary with new architecture implementations
- Update integration tests with any new use cases
- Ensure all tests, both unit tests and integration tests pass after implementation
