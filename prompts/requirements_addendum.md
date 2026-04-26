## Extra instructions

- Read README.md and the documents in the `doc/` folder to understand the project architecture
- Update doc/ if necessary with new architecture implementations
- Update integration tests with any new use cases
- Ensure all tests, both unit tests and integration tests pass after implementation. Iterate until both unit tests and integration tests pass.
- Ensure you are inside the nix environment before building and testing the project (use `nix develop`)
- Add any needed dependendencies to `flake.nix`
- All build outputs should be placed in `build/`
- Add logging as necessary
- Everytime you change the frontend, you must build it and then rebuild the binary. Use `build.sh` to build everything.
