
# System documentation

Don't try to understand the entire system at once. Instead, read the following files when applicable:

doc/ARCHITECTURE.md for general architecture info
doc/SERVER_ENDPOINTS.md for endpoints exposed by `devsesh server`
doc/SSH_TESTING.md to understand how to mock different machines for SSH and session testing
doc/TABLES.md for the sqlite schema
README.md for command line usage

# Commands

build.sh: builds all artifacts, including web and go lang binary
test.sh: runs unit tests
integration_tests/integration_tests.sh: runs integration tests

# Testing

- All unit tests should pass, unless they have been marked as skipped 
- All integration tests should pass, unless they have been marked as skipped 

# General instructions

- Update the documents in `doc/` when you have relevant changes to systems specified on those files
- Update `flake.nix` with any needed dependencies to build, test, and run the system
- Use `nix develop` to run all commands and to access the flake environment
- All build output should be placed in `build/`. Do not place build outputs anywhere else.
